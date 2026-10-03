import { ScheduleAt, Timestamp, type Identity } from 'spacetimedb';
import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, { advanceSchedule, tickSchedule } from './schema';
import {
  AUTO_CLICK_MAX_MS,
  COLORS,
  AUTO_CLICK_MIN_MS,
  COUNTDOWN_S,
  LEVEL_ROTATION,
  RULES,
  STAGES,
  STAGE_SPECS,
  targetPos,
  type StageMeta,
  WORLD_H,
  WORLD_W,
  aggregate,
  cellAt,
  chaos as chaosOf,
  clamp,
  integrate,
  makeMaze,
  makeMines,
  makeTargets,
  mazeHit,
  revealCell,
  sha256Hex,
  tileAt,
  tileCenter,
  type LevelKind,
  type MazeParams,
  type MazeProgress,
  type MinesParams,
  type MinesProgress,
  type Pt,
  type Rule,
  type TargetsParams,
  type TargetsProgress,
} from './sim';

export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;


const MICROS = 1_000_000n;
/** set_pointer may run this many rate-limit intervals ahead before calls are dropped. */
const POINTER_BURST = 4n;

const now = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;
const ts = (micros: bigint) => new Timestamp(micros);
const hex = (id: Identity) => id.toHexString();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfig(ctx: Ctx) {
  const c = ctx.db.config.id.find(0);
  if (!c) throw new Error('config row missing');
  return c;
}

function getCursor(ctx: Ctx) {
  const c = ctx.db.cursor.id.find(0);
  if (!c) throw new Error('cursor row missing');
  return c;
}

function currentLevel(ctx: Ctx) {
  let best: ReturnType<typeof ctx.db.level.id.find> = null;
  for (const l of ctx.db.level.iter()) if (!best || l.id > best.id) best = l;
  return best;
}

function log(ctx: Ctx, kind: string, who: string, payload: unknown) {
  const lvl = currentLevel(ctx);
  ctx.db.eventLog.insert({
    id: 0n,
    at: ctx.timestamp,
    kind,
    levelId: lvl?.id ?? 0n,
    who,
    payload: JSON.stringify(payload ?? {}),
  });
}

function fx(ctx: Ctx, kind: string, x: number, y: number, who = '') {
  ctx.db.fx.insert({ kind, x, y, who });
}

function isAdmin(ctx: Ctx) {
  return ctx.db.admin.identity.find(ctx.sender) != null;
}

function requireAdmin(ctx: Ctx) {
  if (!isAdmin(ctx)) throw new SenderError('not an admin');
}

function connectedPlayerCount(ctx: Ctx) {
  let n = 0;
  for (const p of ctx.db.player.iter()) if (p.connected) n++;
  return n;
}

/** Energy lever: shrink the per-client pointer rate as the room grows. */
function recomputePointerHz(ctx: Ctx) {
  const c = getConfig(ctx);
  const n = Math.max(1, connectedPlayerCount(ctx));
  const eff = Math.round(clamp(Math.min(c.pointerHz, c.pointerBudget / n), 1, 30) * 10) / 10;
  if (eff !== c.pointerHzEffective) ctx.db.config.id.update({ ...c, pointerHzEffective: eff });
}

/** Tick runs only while at least one player is connected: zero idle burn. */
function syncTickSchedule(ctx: Ctx) {
  const want = connectedPlayerCount(ctx) > 0 && !getConfig(ctx).paused;
  const rows = [...ctx.db.tickSchedule.iter()];
  if (want && rows.length === 0) {
    const hz = getConfig(ctx).tickHz;
    ctx.db.tickSchedule.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.interval(MICROS / BigInt(hz)),
    });
    // Reset dt so the first tick after a pause does not jump.
    ctx.db.cursor.id.update({ ...getCursor(ctx), lastTickAt: ctx.timestamp });
  } else if (!want) {
    for (const r of rows) ctx.db.tickSchedule.scheduledId.delete(r.scheduledId);
  }
}

function refreshPresence(ctx: Ctx, identity: Identity) {
  const p = ctx.db.player.identity.find(identity);
  if (!p) return;
  const online = [...ctx.db.session.identity.filter(identity)].length > 0;
  if (p.connected !== online) ctx.db.player.identity.update({ ...p, connected: online });
  if (!online) {
    ctx.db.pointer.identity.delete(identity);
    ctx.db.pointerRate.identity.delete(identity);
    ctx.db.clickVote.identity.delete(identity);
  }
}

function sanitizeName(raw: string, ctx: Ctx) {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return s || `Anon${ctx.random.integerInRange(1000, 9999)}`;
}

function resetStats(ctx: Ctx) {
  for (const s of [...ctx.db.playerStats.iter()]) ctx.db.playerStats.identity.delete(s.identity);
}

function resetCursorTo(ctx: Ctx, x: number, y: number) {
  const c = getCursor(ctx);
  ctx.db.cursor.id.update({ ...c, x, y, vx: 0, vy: 0, tx: x, ty: y });
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

type PlayKind = Exclude<LevelKind, 'lobby'>;
const nowMs = (ctx: Ctx) => Number(now(ctx) / 1000n);
const randMs = (ctx: Ctx) =>
  AUTO_CLICK_MIN_MS + Math.floor(ctx.random() * (AUTO_CLICK_MAX_MS - AUTO_CLICK_MIN_MS));

function stageOf(l: { params: string }): number {
  return (JSON.parse(l.params) as Partial<StageMeta>).stage ?? 1;
}
function playAtOf(l: { params: string }): number {
  return (JSON.parse(l.params) as Partial<StageMeta>).playAt ?? 0;
}

/** Where the cursor waits during the countdown (and respawns in the maze). */
function startPos(kind: string, params: unknown) {
  if (kind === 'maze') {
    const m = params as MazeParams;
    return tileCenter(m, m.start.c, m.start.r);
  }
  return { x: WORLD_W / 2, y: WORLD_H / 2 };
}

function startLevel(ctx: Ctx, kind: PlayKind, stage = 1) {
  stage = Math.max(1, Math.min(STAGES, Math.round(stage)));
  const cur = currentLevel(ctx);
  if (cur && cur.state === 'running') endLevel(ctx, cur.id, 'skipped');
  for (const v of [...ctx.db.clickVote.iter()]) ctx.db.clickVote.identity.delete(v.identity);
  for (const a of [...ctx.db.advanceSchedule.iter()])
    ctx.db.advanceSchedule.scheduledId.delete(a.scheduledId);
  resetStats(ctx);

  const rand = () => ctx.random();
  const playAt = nowMs(ctx) + COUNTDOWN_S * 1000;
  const meta: StageMeta = { stage, stages: STAGES, playAt };
  let params: object = {};
  let progress: object = {};
  let secret: string | null = null;
  let secs = 60;
  if (kind === 'targets') {
    const sp = STAGE_SPECS.targets[stage - 1];
    params = makeTargets(rand, sp.n, sp.r, sp.move);
    progress = { next: 0 } satisfies TargetsProgress;
    secs = sp.secs;
  } else if (kind === 'maze') {
    const sp = STAGE_SPECS.maze[stage - 1];
    params = makeMaze(rand, sp.cw, sp.ch);
    progress = { hits: 0, frozenUntil: 0 } satisfies MazeProgress;
    secs = sp.secs;
  } else if (kind === 'minesweeper') {
    const sp = STAGE_SPECS.minesweeper[stage - 1];
    const m = makeMines(rand, sp.cols, sp.rows, sp.mines);
    params = m.params;
    progress = { ...m.progress, nextAutoAt: playAt + randMs(ctx) } satisfies MinesProgress;
    secret = m.secret;
    secs = sp.secs;
  }
  const start = startPos(kind, params);
  const row = ctx.db.level.insert({
    id: 0n,
    kind,
    state: 'running',
    params: JSON.stringify({ ...params, ...meta }),
    progress: JSON.stringify(progress),
    startedAt: ctx.timestamp,
    deadline: ts(BigInt(playAt) * 1000n + BigInt(secs) * MICROS),
    endedAt: undefined,
    score: 0,
    chaosSum: 0,
    ticks: 0,
  });
  if (secret !== null) ctx.db.levelSecret.insert({ levelId: row.id, data: secret });
  resetCursorTo(ctx, start.x, start.y);
  log(ctx, 'level_start', '', { kind, stage, levelId: row.id.toString() });
}

/** Party flow: stage 1..STAGES of a game, then the next game. */
function nextUp(ctx: Ctx): { kind: PlayKind; stage: number } {
  const cur = currentLevel(ctx);
  if (!cur || !LEVEL_ROTATION.includes(cur.kind as PlayKind)) return { kind: LEVEL_ROTATION[0] as PlayKind, stage: 1 };
  const stage = stageOf(cur);
  if (stage < STAGES) return { kind: cur.kind as PlayKind, stage: stage + 1 };
  const i = LEVEL_ROTATION.indexOf(cur.kind as PlayKind);
  return { kind: LEVEL_ROTATION[(i + 1) % LEVEL_ROTATION.length] as PlayKind, stage: 1 };
}

function endLevel(ctx: Ctx, levelId: bigint, state: 'won' | 'lost' | 'skipped') {
  const l = ctx.db.level.id.find(levelId);
  if (!l || l.state !== 'running') return;
  const elapsed = Number(now(ctx) - l.startedAt.microsSinceUnixEpoch) / 1e6;
  const left = Math.max(0, Number(l.deadline.microsSinceUnixEpoch - now(ctx)) / 1e6);
  const avgChaos = l.ticks > 0 ? l.chaosSum / l.ticks : 1;
  const coop = Math.round(100 * (1 - avgChaos));
  let score = 0;
  if (state === 'won') score = (100 + Math.round(left * 2) + coop) * stageOf(l);
  if (state === 'won' && l.kind === 'maze') score = Math.max(25, score - 5 * (JSON.parse(l.progress) as MazeProgress).hits);
  else if (state === 'lost') score = 10;
  ctx.db.level.id.update({ ...l, state, endedAt: ctx.timestamp, score });
  ctx.db.levelSecret.levelId.delete(levelId);

  if (state !== 'skipped') {
    // Everyone who actually showed up for this level shares the team score.
    for (const s of ctx.db.playerStats.iter()) {
      const p = ctx.db.player.identity.find(s.identity);
      if (p && s.activeSamples > 0) ctx.db.player.identity.update({ ...p, score: p.score + score });
    }
    giveAwards(ctx, levelId);
    const c = getCursor(ctx);
    fx(ctx, state === 'won' ? 'win' : 'lose', c.x, c.y);
    if (getConfig(ctx).autoAdvance) {
      ctx.db.advanceSchedule.insert({
        scheduledId: 0n,
        scheduledAt: ScheduleAt.time(now(ctx) + 10n * MICROS),
        afterLevelId: levelId,
      });
    }
  }
  log(ctx, 'level_end', '', {
    kind: l.kind,
    stage: stageOf(l),
    state,
    score,
    seconds: Math.round(elapsed),
    coop,
  });
}

function giveAwards(ctx: Ctx, levelId: bigint) {
  type S = { id: Identity; name: string; v: number; detail: string };
  const rows = [...ctx.db.playerStats.iter()].filter(s => s.samples > 0);
  if (rows.length === 0) return;
  const named = (pick: (s: (typeof rows)[number]) => number, detail: (v: number) => string): S[] =>
    rows.map(s => {
      const p = ctx.db.player.identity.find(s.identity);
      const v = pick(s);
      return { id: s.identity, name: p?.name ?? '???', v, detail: detail(v) };
    });
  const best = (xs: S[]) => xs.reduce((a, b) => (b.v > a.v ? b : a));
  const grant = (title: string, s: S) => {
    if (!(s.v > 0)) return; // nobody earned it
    ctx.db.award.insert({ id: 0n, levelId, title, who: hex(s.id), name: s.name, detail: s.detail });
    log(ctx, 'award', hex(s.id), { title, name: s.name, detail: s.detail });
  };

  const active = rows.filter(s => s.activeSamples > 0);
  if (active.length > 0) {
    const ratio = (a: number, b: number) => (a + b > 0 ? a / (a + b) : 0);
    grant(
      'Most Disagreeable Player',
      best(named(s => ratio(s.disagree, s.agree), v => `pulled against the mob ${Math.round(v * 100)}% of the time`).filter(x => active.some(a => a.identity.isEqual(x.id))))
    );
    grant(
      'Biggest Troll',
      best(named(s => (s.activeSamples ? s.distSum / s.activeSamples : 0), v => `parked ${v.toFixed(1)} units from the cursor on average`).filter(x => active.some(a => a.identity.isEqual(x.id))))
    );
    grant(
      'MVP (Most Valuable Puppet)',
      best(named(s => ratio(s.agree, s.disagree), v => `agreed with the mob ${Math.round(v * 100)}% of the time`).filter(x => active.some(a => a.identity.isEqual(x.id))))
    );
  }
  const clickers = named(s => s.clicks, v => `${v} click votes`);
  const goblin = best(clickers);
  if (goblin.v > 0) grant('Click Goblin', goblin);
  grant(
    'Moral Support',
    best(named(s => s.samples - s.activeSamples, v => `was there in spirit (idle) for ${v}s`))
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  ctx.db.admin.insert({ identity: ctx.sender, grantedAt: ctx.timestamp });
  ctx.db.config.insert({
    id: 0,
    rule: 'mean',
    // Sending faster than the tick just overwrites itself before it is read.
    pointerHz: 15,
    pointerBudget: 400,
    pointerHzEffective: 15,
    tickHz: 15,
    // omega ~6.3 rad/s, zeta ~0.95: covers half the distance in ~0.27 s.
    gain: 40,
    damping: 12,
    maxSpeed: 20,
    influenceCap: 0.25,
    quorumMin: 1,
    quorumFrac: 0.3,
    quorumRadius: 1.2,
    quorumWindowMs: 1500,
    maxPlayers: 150,
    freshMs: 2000,
    dictatorSecs: 5,
    autoAdvance: true,
    paused: false,
  });
  ctx.db.cursor.insert({
    id: 0,
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    vx: 0,
    vy: 0,
    tx: WORLD_W / 2,
    ty: WORLD_H / 2,
    chaos: 0,
    active: 0,
    tick: 0n,
    lastTickAt: ctx.timestamp,
    dictator: '',
    dictatorUntil: ctx.timestamp,
  });
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  if (ctx.connectionId) ctx.db.session.insert({ connectionId: ctx.connectionId, identity: ctx.sender });
  refreshPresence(ctx, ctx.sender);
  recomputePointerHz(ctx);
  syncTickSchedule(ctx);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  if (ctx.connectionId) ctx.db.session.connectionId.delete(ctx.connectionId);
  const before = ctx.db.player.identity.find(ctx.sender);
  refreshPresence(ctx, ctx.sender);
  const after = ctx.db.player.identity.find(ctx.sender);
  if (before?.connected && after && !after.connected) log(ctx, 'leave', hex(ctx.sender), { name: after.name });
  recomputePointerHz(ctx);
  syncTickSchedule(ctx);
});

// ---------------------------------------------------------------------------
// Player reducers
// ---------------------------------------------------------------------------

export const join = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const ban = ctx.db.banned.identity.find(ctx.sender);
  if (ban && ban.until.microsSinceUnixEpoch > now(ctx)) throw new SenderError('you were kicked; try again soon');
  const existing = ctx.db.player.identity.find(ctx.sender);
  const clean = sanitizeName(name, ctx);
  if (existing) {
    ctx.db.player.identity.update({ ...existing, name: clean, connected: true });
  } else {
    const cfg = getConfig(ctx);
    if (connectedPlayerCount(ctx) >= cfg.maxPlayers) throw new SenderError('room is full');
    let n = 0;
    const teamCount = [0, 0];
    for (const p of ctx.db.player.iter()) {
      n++;
      if (p.connected) teamCount[p.team]++;
    }
    ctx.db.player.insert({
      identity: ctx.sender,
      name: clean,
      color: COLORS[n % COLORS.length],
      team: teamCount[0] <= teamCount[1] ? 0 : 1,
      score: 0,
      connected: true,
      joinedAt: ctx.timestamp,
    });
  }
  log(ctx, 'join', hex(ctx.sender), { name: clean });
  recomputePointerHz(ctx);
  syncTickSchedule(ctx);
});

export const set_pointer = spacetimedb.reducer({ x: t.f32(), y: t.f32() }, (ctx, { x, y }) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new SenderError('bad coordinates');
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || !p.connected) throw new SenderError('join first');
  const cx = clamp(x, 0, 1);
  const cy = clamp(y, 0, 1);
  // Safety-net rate limit (GCRA) at 2x the advertised rate with a burst of a few
  // calls, so packets bunched by mobile Wi-Fi land instead of the newest being dropped.
  // The real lever is the client throttle.
  const tNow = now(ctx);
  const intervalUs = BigInt(Math.floor(1e6 / (getConfig(ctx).pointerHzEffective * 2)));
  const rate = ctx.db.pointerRate.identity.find(ctx.sender);
  const tat = rate && rate.tatUs > tNow ? rate.tatUs : tNow;
  if (tat - tNow > POINTER_BURST * intervalUs) return;
  if (rate) ctx.db.pointerRate.identity.update({ ...rate, tatUs: tat + intervalUs });
  else ctx.db.pointerRate.insert({ identity: ctx.sender, tatUs: tat + intervalUs });

  const prev = ctx.db.pointer.identity.find(ctx.sender);
  if (!prev) {
    ctx.db.pointer.insert({ identity: ctx.sender, x: cx, y: cy, activity: 0, updatedAt: ctx.timestamp });
    return;
  }
  const dtUs = tNow - prev.updatedAt.microsSinceUnixEpoch;
  const decay = Math.exp(-Number(dtUs) / 1.5e6);
  const activity = prev.activity * decay + Math.hypot(cx - prev.x, cy - prev.y);
  ctx.db.pointer.identity.update({ ...prev, x: cx, y: cy, activity, updatedAt: ctx.timestamp });
});

export const click = spacetimedb.reducer(ctx => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || !p.connected) throw new SenderError('join first');
  const cfg = getConfig(ctx);
  const cur = getCursor(ctx);
  const prev = ctx.db.clickVote.identity.find(ctx.sender);
  if (prev && now(ctx) - prev.at.microsSinceUnixEpoch < 250_000n) return;
  const vote = { identity: ctx.sender, x: cur.x, y: cur.y, at: ctx.timestamp };
  if (prev) ctx.db.clickVote.identity.update(vote);
  else ctx.db.clickVote.insert(vote);
  const st = ctx.db.playerStats.identity.find(ctx.sender);
  if (st) ctx.db.playerStats.identity.update({ ...st, clicks: st.clicks + 1 });
  fx(ctx, 'vote', cur.x, cur.y, hex(ctx.sender));

  // Quorum: enough recent votes near the current cursor position.
  const windowUs = BigInt(cfg.quorumWindowMs) * 1000n;
  const near = [...ctx.db.clickVote.iter()].filter(
    v =>
      now(ctx) - v.at.microsSinceUnixEpoch <= windowUs &&
      Math.hypot(v.x - cur.x, v.y - cur.y) <= cfg.quorumRadius
  );
  const need = Math.max(cfg.quorumMin, Math.ceil(cfg.quorumFrac * Math.max(1, cur.active)));
  if (near.length < need) return;
  for (const v of near) ctx.db.clickVote.identity.delete(v.identity);
  registerClick(ctx, cur.x, cur.y, near.length);
});

function registerClick(ctx: Ctx, x: number, y: number, votes: number, auto = false) {
  const l = currentLevel(ctx);
  if (l && l.state === 'running' && nowMs(ctx) < playAtOf(l)) return; // still counting down
  fx(ctx, auto ? 'autoclick' : 'click', x, y);
  log(ctx, auto ? 'autoclick' : 'click', '', { x: +x.toFixed(2), y: +y.toFixed(2), votes });
  if (!l || l.state !== 'running' || l.kind !== 'minesweeper') return;
  const params = JSON.parse(l.params) as MinesParams;
  const prog = JSON.parse(l.progress) as MinesProgress;
  const sec = ctx.db.levelSecret.levelId.find(l.id);
  if (!sec) return;
  const { c, r } = cellAt(params, x, y);
  const res = revealCell(params, prog, sec.data, c, r);
  if (res.result === 'noop') return;
  ctx.db.levelSecret.levelId.update({ ...sec, data: res.secret });
  ctx.db.level.id.update({ ...l, progress: JSON.stringify(res.prog) });
  if (res.result === 'mine' || res.result === 'lost') {
    fx(ctx, 'mine', x, y);
    log(ctx, 'mine', '', { c, r, lives: res.prog.lives });
  } else fx(ctx, 'reveal', x, y);
  if (res.result === 'won') endLevel(ctx, l.id, 'won');
  if (res.result === 'lost') endLevel(ctx, l.id, 'lost');
}

// ---------------------------------------------------------------------------
// Tick (scheduled, private)
// ---------------------------------------------------------------------------

export const tick = spacetimedb.reducer({ onSchedule: tickSchedule }, { arg: tickSchedule.rowType }, ctx => {
  const cfg = getConfig(ctx);
  const cur = getCursor(ctx);
  const tNow = now(ctx);
  const dt = clamp(Number(tNow - cur.lastTickAt.microsSinceUnixEpoch) / 1e6, 0, 0.2);
  const freshUs = BigInt(cfg.freshMs) * 1000n;

  const pts: Pt[] = [];
  for (const ptr of ctx.db.pointer.iter()) {
    if (tNow - ptr.updatedAt.microsSinceUnixEpoch > freshUs) continue;
    const pl = ctx.db.player.identity.find(ptr.identity);
    if (!pl || !pl.connected) continue;
    pts.push({ id: hex(ptr.identity), x: ptr.x * WORLD_W, y: ptr.y * WORLD_H, w: ptr.activity, team: pl.team });
  }

  // Rotating dictator: one random fresh player rules for a few seconds.
  let dictator = cur.dictator;
  let dictatorUntil = cur.dictatorUntil;
  if (cfg.rule === 'dictator' && pts.length > 0) {
    const stillThere = pts.some(p => p.id === dictator);
    if (!stillThere || tNow >= dictatorUntil.microsSinceUnixEpoch) {
      const pick = pts[ctx.random.integerInRange(0, pts.length - 1)];
      dictator = pick.id;
      dictatorUntil = ts(tNow + BigInt(Math.round(cfg.dictatorSecs * 1e6)));
      const pl = [...ctx.db.player.iter()].find(p => hex(p.identity) === pick.id);
      log(ctx, 'dictator', pick.id, { name: pl?.name ?? '?' });
      fx(ctx, 'dictator', pick.x, pick.y, pick.id);
    }
  } else if (cfg.rule !== 'dictator') dictator = '';

  const target = aggregate(cfg.rule as Rule, pts, cfg.influenceCap, dictator);
  const lvl = currentLevel(ctx);
  const running = lvl && lvl.state === 'running' ? lvl : undefined;
  const before = { x: cur.x, y: cur.y };
  let body = integrate(cur, target, dt, cfg.gain, cfg.damping, cfg.maxSpeed);
  const ch = chaosOf(pts, cur.x, cur.y);
  const chaosSmoothed = cur.chaos + (ch - cur.chaos) * Math.min(1, dt * 3);

  // Countdown: hold the cursor on the start spot until play begins.
  const countingDown = !!running && Number(tNow / 1000n) < playAtOf(running);
  if (running && countingDown) {
    const s = startPos(running.kind, JSON.parse(running.params));
    body = { x: s.x, y: s.y, vx: 0, vy: 0 };
  }

  // Level rules.
  if (running && !countingDown) {
    let progress = running.progress;
    let outcome: 'won' | 'lost' | null = null;
    if (running.kind === 'targets') {
      const p = JSON.parse(running.params) as TargetsParams;
      const prog = JSON.parse(progress) as TargetsProgress;
      const tg = prog.next < p.targets.length ? targetPos(p, prog.next, (Number(tNow / 1000n) - playAtOf(running)) / 1000) : null;
      if (tg && Math.hypot(body.x - tg.x, body.y - tg.y) <= p.r) {
        prog.next += 1;
        progress = JSON.stringify(prog);
        fx(ctx, 'target', tg.x, tg.y);
        log(ctx, 'target', '', { n: prog.next, of: p.targets.length });
        if (prog.next >= p.targets.length) outcome = 'won';
      }
    } else if (running.kind === 'maze') {
      const m = JSON.parse(running.params) as MazeParams;
      const prog = JSON.parse(progress) as MazeProgress;
      const s = tileCenter(m, m.start.c, m.start.r);
      const nowMs = Number(tNow / 1000n);
      if (nowMs < prog.frozenUntil) {
        // Just respawned: hold at the start so the mob can regroup.
        body = { x: s.x, y: s.y, vx: 0, vy: 0 };
      } else if (mazeHit(m, before, body)) {
        prog.hits += 1;
        prog.frozenUntil = nowMs + 700;
        progress = JSON.stringify(prog);
        fx(ctx, 'wall', body.x, body.y);
        log(ctx, 'wall', '', { hits: prog.hits });
        body = { x: s.x, y: s.y, vx: 0, vy: 0 };
      } else {
        const tl = tileAt(m, body.x, body.y);
        if (tl.c === m.goal.c && tl.r === m.goal.r) outcome = 'won';
      }
    }
    if (!outcome && tNow >= running.deadline.microsSinceUnixEpoch) outcome = 'lost';
    // The level row is broadcast to every phone, so only write it when progress
    // changes or once a second (cooperation sample), never every tick.
    const sampleNow = (cur.tick + 1n) % BigInt(cfg.tickHz) === 0n;
    if (progress !== running.progress || sampleNow || outcome) {
      ctx.db.level.id.update({
        ...running,
        progress,
        chaosSum: running.chaosSum + (sampleNow ? chaosSmoothed : 0),
        ticks: running.ticks + (sampleNow ? 1 : 0),
      });
    }
    if (outcome) endLevel(ctx, running.id, outcome);
    else if (running.kind === 'minesweeper') maybeAutoClick(ctx, running.id, body);
  }

  const tickNo = cur.tick + 1n;
  ctx.db.cursor.id.update({
    ...cur,
    ...body,
    tx: target?.x ?? cur.tx,
    ty: target?.y ?? cur.ty,
    chaos: chaosSmoothed,
    active: pts.length,
    tick: tickNo,
    lastTickAt: ctx.timestamp,
    dictator,
    dictatorUntil,
  });

  // 5 Hz: compact ghost frame so phones can draw everyone without the pointer table.
  if (tickNo % 3n === 0n) writeGhostFrame(ctx, pts, dictator);

  // 1 Hz: behaviour stats for awards + a replay/heatmap sample.
  if (tickNo % BigInt(cfg.tickHz) === 0n) {
    sampleStats(ctx, pts, body, target);
    log(ctx, 'sample', '', { x: +body.x.toFixed(2), y: +body.y.toFixed(2), c: +chaosSmoothed.toFixed(2), n: pts.length });
  }
});

/** Minesweeper: at a random moment (2-30 s apart) the cursor clicks by itself. */
function maybeAutoClick(ctx: Ctx, levelId: bigint, body: { x: number; y: number }) {
  const l = ctx.db.level.id.find(levelId);
  if (!l || l.state !== 'running') return;
  const prog = JSON.parse(l.progress) as MinesProgress;
  const t = nowMs(ctx);
  if (prog.nextAutoAt === undefined || t < prog.nextAutoAt) return;
  ctx.db.level.id.update({ ...l, progress: JSON.stringify({ ...prog, nextAutoAt: t + randMs(ctx) }) });
  registerClick(ctx, body.x, body.y, 0, true);
}

/**
 * ghost_frame.data: 4 bytes per fresh pointer [colorIndex, flags, x, y]
 * flags bit0 = team blue, bit1 = current dictator. x/y quantized to 0..255.
 */
function writeGhostFrame(ctx: Ctx, pts: Pt[], dictator: string) {
  const colorById = new Map<string, number>();
  for (const pl of ctx.db.player.iter()) if (pl.connected) colorById.set(hex(pl.identity), Math.max(0, COLORS.indexOf(pl.color)));
  const data = new Uint8Array(pts.length * 4);
  pts.forEach((p, i) => {
    data[i * 4] = colorById.get(p.id) ?? 0;
    data[i * 4 + 1] = (p.team & 1) | (p.id === dictator ? 2 : 0);
    data[i * 4 + 2] = Math.round(clamp(p.x / WORLD_W, 0, 1) * 255);
    data[i * 4 + 3] = Math.round(clamp(p.y / WORLD_H, 0, 1) * 255);
  });
  const prev = ctx.db.ghostFrame.id.find(0);
  if (prev) {
    if (prev.data.length === data.length && prev.data.every((v, i) => v === data[i])) return; // idle room: no write
    ctx.db.ghostFrame.id.update({ ...prev, data });
  } else ctx.db.ghostFrame.insert({ id: 0, data });
}

function sampleStats(ctx: Ctx, pts: Pt[], body: { x: number; y: number }, target: { x: number; y: number } | null) {
  const byId = new Map(pts.map(p => [p.id, p]));
  const tdx = target ? target.x - body.x : 0;
  const tdy = target ? target.y - body.y : 0;
  const tl = Math.hypot(tdx, tdy);
  for (const pl of ctx.db.player.iter()) {
    if (!pl.connected) continue;
    const p = byId.get(hex(pl.identity));
    const st = ctx.db.playerStats.identity.find(pl.identity) ?? {
      identity: pl.identity,
      samples: 0,
      activeSamples: 0,
      agree: 0,
      disagree: 0,
      distSum: 0,
      activitySum: 0,
      clicks: 0,
    };
    const next = { ...st, samples: st.samples + 1 };
    if (p) {
      next.activeSamples += 1;
      const dx = p.x - body.x;
      const dy = p.y - body.y;
      const d = Math.hypot(dx, dy);
      next.distSum += d;
      next.activitySum += p.w;
      if (tl > 0.2 && d > 0.3) {
        const dot = (dx * tdx + dy * tdy) / (d * tl);
        if (dot > 0.5) next.agree += 1;
        else if (dot < -0.2) next.disagree += 1;
      }
    }
    if (ctx.db.playerStats.identity.find(pl.identity)) ctx.db.playerStats.identity.update(next);
    else ctx.db.playerStats.insert(next);
  }
}

export const auto_advance = spacetimedb.reducer(
  { onSchedule: advanceSchedule },
  { arg: advanceSchedule.rowType },
  (ctx, { arg }) => {
    const cur = currentLevel(ctx);
    if (!cur || cur.id !== arg.afterLevelId || cur.state === 'running') return;
    if (!getConfig(ctx).autoAdvance) return;
    const n = nextUp(ctx);
    startLevel(ctx, n.kind, n.stage);
  }
);

// ---------------------------------------------------------------------------
// Admin (all checks server-side)
// ---------------------------------------------------------------------------

/** Owner (or existing admin) sets the passphrase other devices use to claim admin. */
export const admin_set_passphrase = spacetimedb.reducer({ passphrase: t.string() }, (ctx, { passphrase }) => {
  requireAdmin(ctx);
  if (passphrase.length < 8) throw new SenderError('passphrase must be at least 8 characters');
  const salt = sha256Hex(`${now(ctx)}:${ctx.random()}`).slice(0, 16);
  const row = { id: 0, salt, hash: sha256Hex(`${salt}:${passphrase}`) };
  if (ctx.db.adminSecret.id.find(0)) ctx.db.adminSecret.id.update(row);
  else ctx.db.adminSecret.insert(row);
});

export const admin_claim = spacetimedb.reducer({ passphrase: t.string() }, (ctx, { passphrase }) => {
  const sec = ctx.db.adminSecret.id.find(0);
  if (!sec || sha256Hex(`${sec.salt}:${passphrase}`) !== sec.hash) throw new SenderError('wrong passphrase');
  if (!isAdmin(ctx)) ctx.db.admin.insert({ identity: ctx.sender, grantedAt: ctx.timestamp });
});

/** Lets the admin UI know whether this identity is an admin (public read of a private table). */
export const amIAdmin = spacetimedb.view({ public: true }, t.array(t.object('AdminFlag', { yes: t.bool() })), ctx =>
  ctx.db.admin.identity.find(ctx.sender) ? [{ yes: true }] : []
);

export const admin_set_rule = spacetimedb.reducer({ rule: t.string() }, (ctx, { rule }) => {
  requireAdmin(ctx);
  if (!RULES.includes(rule as Rule)) throw new SenderError(`unknown rule ${rule}`);
  ctx.db.config.id.update({ ...getConfig(ctx), rule });
  log(ctx, 'rule', '', { rule });
});

const NUMERIC_KEYS: Record<string, [number, number]> = {
  pointerHz: [1, 30],
  pointerBudget: [10, 5000],
  tickHz: [5, 30],
  gain: [0.5, 40],
  damping: [0, 30],
  maxSpeed: [0.5, 30],
  influenceCap: [0.01, 1],
  quorumMin: [1, 200],
  quorumFrac: [0, 1],
  quorumRadius: [0.1, 10],
  quorumWindowMs: [100, 10000],
  maxPlayers: [1, 1000],
  freshMs: [250, 10000],
  dictatorSecs: [1, 60],
};
const INT_KEYS = new Set(['tickHz', 'quorumMin', 'quorumWindowMs', 'maxPlayers', 'freshMs']);

export const admin_set_config = spacetimedb.reducer({ key: t.string(), value: t.f64() }, (ctx, { key, value }) => {
  requireAdmin(ctx);
  const c = getConfig(ctx);
  if (key === 'autoAdvance' || key === 'paused') {
    ctx.db.config.id.update({ ...c, [key]: value !== 0 });
  } else {
    const range = NUMERIC_KEYS[key];
    if (!range || !Number.isFinite(value)) throw new SenderError(`bad config key ${key}`);
    let v = clamp(value, range[0], range[1]);
    if (INT_KEYS.has(key)) v = Math.round(v);
    ctx.db.config.id.update({ ...c, [key]: v });
  }
  if (key === 'tickHz' || key === 'paused') {
    // Re-arm the interval at the new rate.
    for (const r of [...ctx.db.tickSchedule.iter()]) ctx.db.tickSchedule.scheduledId.delete(r.scheduledId);
  }
  recomputePointerHz(ctx);
  syncTickSchedule(ctx);
});

export const admin_start_level = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  requireAdmin(ctx);
  const n = kind === 'next' ? nextUp(ctx) : { kind: kind as PlayKind, stage: 1 };
  if (!LEVEL_ROTATION.includes(n.kind)) throw new SenderError(`unknown level ${kind}`);
  startLevel(ctx, n.kind, n.stage);
});

export const admin_start_stage = spacetimedb.reducer({ kind: t.string(), stage: t.u32() }, (ctx, { kind, stage }) => {
  requireAdmin(ctx);
  if (!LEVEL_ROTATION.includes(kind as PlayKind)) throw new SenderError(`unknown level ${kind}`);
  if (stage < 1 || stage > STAGES) throw new SenderError(`stage must be 1..${STAGES}`);
  startLevel(ctx, kind as PlayKind, stage);
});

export const admin_stop_level = spacetimedb.reducer(ctx => {
  requireAdmin(ctx);
  const l = currentLevel(ctx);
  if (l && l.state === 'running') endLevel(ctx, l.id, 'skipped');
  for (const a of [...ctx.db.advanceSchedule.iter()]) ctx.db.advanceSchedule.scheduledId.delete(a.scheduledId);
});

export const admin_kick = spacetimedb.reducer({ who: t.identity() }, (ctx, { who }) => {
  requireAdmin(ctx);
  const p = ctx.db.player.identity.find(who);
  ctx.db.player.identity.delete(who);
  ctx.db.pointer.identity.delete(who);
  ctx.db.pointerRate.identity.delete(who);
  ctx.db.clickVote.identity.delete(who);
  ctx.db.playerStats.identity.delete(who);
  const until = ts(now(ctx) + 120n * MICROS);
  if (ctx.db.banned.identity.find(who)) ctx.db.banned.identity.update({ identity: who, until });
  else ctx.db.banned.insert({ identity: who, until });
  log(ctx, 'kick', hex(who), { name: p?.name ?? '?' });
  recomputePointerHz(ctx);
  syncTickSchedule(ctx);
});

export const admin_reset_round = spacetimedb.reducer(ctx => {
  requireAdmin(ctx);
  const l = currentLevel(ctx);
  if (l && l.state === 'running') endLevel(ctx, l.id, 'skipped');
  for (const a of [...ctx.db.advanceSchedule.iter()]) ctx.db.advanceSchedule.scheduledId.delete(a.scheduledId);
  for (const p of [...ctx.db.player.iter()]) ctx.db.player.identity.update({ ...p, score: 0 });
  for (const a of [...ctx.db.award.iter()]) ctx.db.award.id.delete(a.id);
  for (const lv of [...ctx.db.level.iter()]) ctx.db.level.id.delete(lv.id);
  for (const s of [...ctx.db.levelSecret.iter()]) ctx.db.levelSecret.levelId.delete(s.levelId);
  resetStats(ctx);
  resetCursorTo(ctx, WORLD_W / 2, WORLD_H / 2);
  log(ctx, 'round_reset', '', {});
});

/** Written by the LLM commentator worker (which claims admin with the passphrase). */
export const post_commentary = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  requireAdmin(ctx);
  const clean = text.trim().slice(0, 280);
  if (!clean) return;
  ctx.db.commentary.insert({ id: 0n, at: ctx.timestamp, levelId: currentLevel(ctx)?.id ?? 0n, text: clean });
});
