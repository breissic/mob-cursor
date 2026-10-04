import { ScheduleAt, Timestamp, type Identity } from 'spacetimedb';
import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, { advanceSchedule, tickSchedule } from './schema';
import {
  COLORS,
  COUNTDOWN_S,
  DEFAULT_ROOM_CODE,
  DEFAULT_ROOM_ID,
  LEVEL_ROTATION,
  MAX_PLAYERS_CEILING,
  MAX_ROOMS_CEILING,
  ROOM_IDLE_S,
  RULES,
  STAGES,
  VOTE_SECS,
  VOTE_START,
  WORLD_H,
  WORLD_W,
  aggregate,
  autoClickMs,
  balloonStep,
  cellAt,
  chairsStep,
  chaos as chaosOf,
  clamp,
  cursorPhysics,
  dampingMax,
  gainMax,
  ghostKey,
  huntStep,
  integrate,
  isPlayKind,
  keyboardStep,
  makeBalloons,
  makeChairs,
  makeHunt,
  makeKeyboard,
  makeMaze,
  makeMines,
  makeMoles,
  makePotato,
  makeRedlight,
  makeRoomCode,
  makeStations,
  makeTargets,
  targetsStep,
  makeValves,
  mazeHit,
  moleStep,
  normalizeRoomCode,
  packGhosts,
  pointerHzFor,
  potatoStep,
  redlightStep,
  revealCell,
  sanitizeSettings,
  settingsFor,
  sha256Hex,
  shiftLevelTimes,
  stageSeconds,
  stageSpec,
  stationsStep,
  tileAt,
  tileCenter,
  valvesStep,
  voteLayout,
  voteResolve,
  pickCards,
  postIntegrate,
  makeEcho,
  echoStep,
  makeCrane,
  craneStep,
  makeSpotlight,
  spotlightStep,
  makeSheep,
  sheepStep,
  makeIce,
  iceStep,
  makePlank,
  plankStep,
  makeSeesaw,
  seesawStep,
  makeBelts,
  beltsStep,
  makeNeedle,
  needleStep,
  NEEDLE_TOP,
  makeWires,
  wiresStep,
  type EchoParams,
  type EchoProgress,
  type EchoSecret,
  type CraneParams,
  type CraneProgress,
  type SpotlightParams,
  type SpotlightProgress,
  type SheepParams,
  type SheepProgress,
  type IceParams,
  type IceProgress,
  type PlankParams,
  type PlankProgress,
  type SeesawParams,
  type SeesawProgress,
  type BeltsParams,
  type BeltsProgress,
  type NeedleParams,
  type NeedleProgress,
  type WiresParams,
  type WiresProgress,
  type WiresSecret,
  type BalloonParams,
  type BalloonProgress,
  type ChairsParams,
  type ChairsProgress,
  type HuntParams,
  type HuntProgress,
  type HuntSecret,
  type KeyboardParams,
  type KeyboardProgress,
  type MazeParams,
  type MazeProgress,
  type MinesParams,
  type MinesProgress,
  type MoleParams,
  type MoleProgress,
  type PlayKind,
  type PotatoParams,
  type PotatoProgress,
  type Pt,
  type RedlightParams,
  type RedlightProgress,
  type Rule,
  type StageMeta,
  type StationsParams,
  type StationsProgress,
  type TargetsParams,
  type TargetsProgress,
  type ValvesParams,
  type ValvesProgress,
  type VoteParams,
  type VoteProgress,
} from './sim';

export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type RoomRow = NonNullable<ReturnType<Ctx['db']['room']['id']['find']>>;
type LevelRow = NonNullable<ReturnType<Ctx['db']['level']['id']['find']>>;

const MICROS = 1_000_000n;
/** set_pointer may run this many rate-limit intervals ahead before calls are dropped. */
const POINTER_BURST = 4n;
/** Seconds between a level ending and the next one starting (and before a fresh room's first game). */
const ADVANCE_S = 10n;
const FIRST_GAME_S = 5n;

const now = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;
const nowMs = (ctx: Ctx) => Number(now(ctx) / 1000n);
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

function getRoom(ctx: Ctx, roomId: number): RoomRow {
  const r = ctx.db.room.id.find(roomId);
  if (!r) throw new SenderError('no such room');
  return r;
}

function getCursor(ctx: Ctx, roomId: number) {
  const c = ctx.db.cursor.id.find(roomId);
  if (!c) throw new Error(`cursor row missing for room ${roomId}`);
  return c;
}

function currentLevel(ctx: Ctx, room: RoomRow): LevelRow | null {
  return room.levelId === 0n ? null : (ctx.db.level.id.find(room.levelId) ?? null);
}

function log(ctx: Ctx, roomId: number, kind: string, who: string, payload: unknown) {
  ctx.db.eventLog.insert({
    id: 0n,
    roomId,
    at: ctx.timestamp,
    kind,
    levelId: ctx.db.room.id.find(roomId)?.levelId ?? 0n,
    who,
    payload: JSON.stringify(payload ?? {}),
  });
}

function fx(ctx: Ctx, roomId: number, kind: string, x: number, y: number, who = '') {
  ctx.db.fx.insert({ roomId, kind, x, y, who });
}

function isAdmin(ctx: Ctx) {
  return ctx.db.admin.identity.find(ctx.sender) != null;
}

function requireAdmin(ctx: Ctx) {
  if (!isAdmin(ctx)) throw new SenderError('not an admin');
}

/** Room-level controls: global admins, or the identity that created the room. */
function requireHost(ctx: Ctx, room: RoomRow) {
  if (!isAdmin(ctx) && !room.host.isEqual(ctx.sender)) throw new SenderError('not the host of this room');
}

function roomPlayers(ctx: Ctx, roomId: number) {
  let n = 0;
  for (const p of ctx.db.player.roomId.filter(roomId)) if (p.connected) n++;
  return n;
}

function anyoneOnline(ctx: Ctx) {
  for (const r of ctx.db.room.iter()) if (r.players > 0) return true;
  return false;
}

/**
 * Recount a room's connected players and its share of the pointer budget
 * (energy lever: the per-client rate shrinks as the room grows; the budget is
 * per room so a full room never starves the others). A room waking up from
 * empty resumes its paused level.
 */
function refreshRoom(ctx: Ctx, roomId: number) {
  const room = ctx.db.room.id.find(roomId);
  if (!room) return;
  const cfg = getConfig(ctx);
  const players = roomPlayers(ctx, roomId);
  const eff = pointerHzFor(cfg.pointerHz, cfg.pointerBudget, players);
  const woke = room.players === 0 && players > 0;
  if (players !== room.players || eff !== room.pointerHzEffective) {
    ctx.db.room.id.update({ ...room, players, pointerHzEffective: eff, lastActiveAt: ctx.timestamp });
  }
  if (woke) {
    const cur = getCursor(ctx, roomId);
    resumeLevel(ctx, getRoom(ctx, roomId), now(ctx) - cur.lastTickAt.microsSinceUnixEpoch);
    ctx.db.cursor.id.update({ ...getCursor(ctx, roomId), lastTickAt: ctx.timestamp });
  }
}

/** Tick runs only while at least one player is connected somewhere: zero idle burn. */
function syncTickSchedule(ctx: Ctx) {
  const want = anyoneOnline(ctx) && !getConfig(ctx).paused;
  const rows = [...ctx.db.tickSchedule.iter()];
  if (want && rows.length === 0) {
    const hz = getConfig(ctx).tickHz;
    ctx.db.tickSchedule.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.interval(MICROS / BigInt(hz)),
    });
    // The whole tick was stopped (pause / rate change): every live room resumes.
    for (const room of [...ctx.db.room.iter()]) {
      if (room.players === 0) continue;
      const cur = getCursor(ctx, room.id);
      resumeLevel(ctx, room, now(ctx) - cur.lastTickAt.microsSinceUnixEpoch);
      // Reset dt so the first tick after a pause does not jump.
      ctx.db.cursor.id.update({ ...getCursor(ctx, room.id), lastTickAt: ctx.timestamp });
    }
  } else if (!want) {
    for (const r of rows) ctx.db.tickSchedule.scheduledId.delete(r.scheduledId);
    // Nobody left to draw: clear the phones' ghost frames so stale ghosts don't flash on return.
    for (const gf of [...ctx.db.ghostFrame.iter()]) if (gf.data.length > 1) ctx.db.ghostFrame.id.update({ ...gf, data: packGhosts([]) });
  }
}

/** Deadline for a running level given its (possibly shifted) params and progress. */
function deadlineUs(kind: string, params: StageMeta & Record<string, unknown>, prog: Record<string, unknown>, fallbackUs: bigint): bigint {
  if (kind === 'vote') return BigInt((prog as VoteProgress).endsAt) * 1000n;
  if (kind === 'potato') {
    const p = params as unknown as PotatoParams;
    const pr = prog as unknown as PotatoProgress;
    return BigInt(pr.fuseAt) * 1000n + BigInt(Math.max(0, p.rounds - pr.round - 1) * p.fuseS) * MICROS + 2n * MICROS;
  }
  return fallbackUs;
}

/**
 * A room's tick stops while nobody is in it (or the host pauses), but level
 * deadlines are wall-clock times. Without this, a stage that was running when
 * the room emptied "fails" the instant the tick comes back. Long pauses get a
 * fresh 3-2-1 countdown; short ones (re-arming after a tickHz change) just shift.
 */
function resumeLevel(ctx: Ctx, room: RoomRow, pausedUs: bigint) {
  const l = currentLevel(ctx, room);
  if (!l || l.state !== 'running' || pausedUs <= 0n) return;
  const params = JSON.parse(l.params) as StageMeta & Record<string, unknown>;
  const lastTickUs = now(ctx) - pausedUs;
  // Time the stage had left when the tick stopped (a stage started while paused has its full time).
  const sinceStart = l.deadline.microsSinceUnixEpoch - l.startedAt.microsSinceUnixEpoch;
  const sincePause = l.deadline.microsSinceUnixEpoch - lastTickUs;
  const remainingUs = sincePause < sinceStart ? sincePause : sinceStart;
  const fresh = pausedUs > 2n * MICROS;
  const playAt = fresh ? nowMs(ctx) + COUNTDOWN_S * 1000 : (params.playAt ?? 0) + Number(pausedUs / 1000n);
  const generic = fresh
    ? BigInt(playAt) * 1000n + (remainingUs > 10n * MICROS ? remainingUs : 10n * MICROS)
    : l.deadline.microsSinceUnixEpoch + pausedUs;
  // Every in-progress timer (light flips, fuses, music stops...) moves with playAt.
  let pr = shiftLevelTimes(JSON.parse(l.progress) as Record<string, unknown>, playAt - (params.playAt ?? 0));
  if (l.kind === 'vote') pr = { ...pr, endsAt: playAt + VOTE_SECS * 1000 }; // the picker timer is always exactly VOTE_SECS after play resumes
  ctx.db.level.id.update({ ...l, params: JSON.stringify({ ...params, playAt }), progress: JSON.stringify(pr), deadline: ts(deadlineUs(l.kind, params, pr, generic)) });
  if (fresh) {
    const s = startPos(l.kind, params);
    resetCursorTo(ctx, room.id, s.x, s.y);
    log(ctx, room.id, 'level_resume', '', { kind: l.kind, pausedS: Number(pausedUs / MICROS) });
  }
}

/** Seconds without any pointer input before a still-"connected" player is treated as gone. */
const IDLE_AWAY_S = 60n;

function markIdle(ctx: Ctx, identity: Identity, since: Timestamp) {
  const row = { identity, since };
  if (ctx.db.idle.identity.find(identity)) ctx.db.idle.identity.update(row);
  else ctx.db.idle.insert(row);
}

/** 1 Hz: players idle for IDLE_AWAY_S are marked gone (connected = false). */
function sweepIdle(ctx: Ctx, tNow: bigint) {
  const touched = new Set<number>();
  for (const row of [...ctx.db.idle.iter()]) {
    const p = ctx.db.player.identity.find(row.identity);
    if (!p || !p.connected) {
      ctx.db.idle.identity.delete(row.identity);
      continue;
    }
    if (tNow - row.since.microsSinceUnixEpoch < IDLE_AWAY_S * MICROS) continue;
    ctx.db.player.identity.update({ ...p, connected: false });
    ctx.db.pointer.identity.delete(row.identity);
    ctx.db.pointerRate.identity.delete(row.identity);
    ctx.db.idle.identity.delete(row.identity);
    log(ctx, p.roomId, 'leave', hex(row.identity), { name: p.name, reason: 'idle' });
    touched.add(p.roomId);
  }
  if (touched.size) {
    for (const r of touched) refreshRoom(ctx, r);
    syncTickSchedule(ctx);
  }
}

function refreshPresence(ctx: Ctx, identity: Identity) {
  const p = ctx.db.player.identity.find(identity);
  if (!p) return;
  const online = [...ctx.db.session.identity.filter(identity)].length > 0;
  if (p.connected !== online) ctx.db.player.identity.update({ ...p, connected: online });
  if (!online) {
    ctx.db.pointer.identity.delete(identity);
    ctx.db.idle.identity.delete(identity);
    ctx.db.pointerRate.identity.delete(identity);
  }
  if (p.connected !== online) refreshRoom(ctx, p.roomId);
}

function sanitizeName(raw: string, ctx: Ctx) {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return s || `Anon${ctx.random.integerInRange(1000, 9999)}`;
}

function resetStats(ctx: Ctx, roomId: number) {
  for (const s of [...ctx.db.playerStats.roomId.filter(roomId)]) ctx.db.playerStats.identity.delete(s.identity);
}

function resetCursorTo(ctx: Ctx, roomId: number, x: number, y: number) {
  const c = getCursor(ctx, roomId);
  ctx.db.cursor.id.update({ ...c, x, y, vx: 0, vy: 0, tx: x, ty: y });
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function insertRoom(ctx: Ctx, id: number, code: string, name: string, host: Identity) {
  ctx.db.room.insert({ id, code, name, host, players: 0, pointerHzEffective: getConfig(ctx).pointerHz, levelId: 0n, createdAt: ctx.timestamp, lastActiveAt: ctx.timestamp });
  ctx.db.cursor.insert({
    id,
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
  ctx.db.ghostFrame.insert({ id, data: packGhosts([]) });
}

function createRoom(ctx: Ctx, name: string): RoomRow {
  const cfg = getConfig(ctx);
  let count = 0;
  let maxId = 0;
  for (const r of ctx.db.room.iter()) {
    count++;
    if (r.id > maxId) maxId = r.id;
  }
  if (count >= Math.min(cfg.maxRooms, MAX_ROOMS_CEILING)) throw new SenderError('no free rooms right now');
  let code = '';
  for (let i = 0; i < 50 && !code; i++) {
    const c = makeRoomCode(() => ctx.random());
    if (!ctx.db.room.code.find(c)) code = c;
  }
  if (!code) throw new SenderError('could not allocate a room code');
  const id = maxId + 1;
  insertRoom(ctx, id, code, name, ctx.sender);
  log(ctx, id, 'room_create', hex(ctx.sender), { code, name });
  return getRoom(ctx, id);
}

/** Move a player between rooms: their live state belongs to the old room. */
function movePlayer(ctx: Ctx, identity: Identity, roomId: number) {
  const p = ctx.db.player.identity.find(identity);
  if (!p || p.roomId === roomId) return;
  ctx.db.pointer.identity.delete(identity);
  ctx.db.pointerRate.identity.delete(identity);
  ctx.db.playerStats.identity.delete(identity);
  ctx.db.player.identity.update({ ...p, roomId });
  if (!ctx.db.pointer.identity.find(identity)) markIdle(ctx, identity, ctx.timestamp);
  refreshRoom(ctx, p.roomId);
  refreshRoom(ctx, roomId);
}

/** Everything a room owns, then the room. Players who were in it (all offline) fall back to the default room. */
function deleteRoom(ctx: Ctx, room: RoomRow) {
  for (const l of [...ctx.db.level.roomId.filter(room.id)]) {
    ctx.db.levelSecret.levelId.delete(l.id);
    ctx.db.level.id.delete(l.id);
  }
  for (const a of [...ctx.db.award.roomId.filter(room.id)]) ctx.db.award.id.delete(a.id);
  for (const e of [...ctx.db.eventLog.roomId.filter(room.id)]) ctx.db.eventLog.id.delete(e.id);
  for (const c of [...ctx.db.commentary.roomId.filter(room.id)]) ctx.db.commentary.id.delete(c.id);
  for (const a of [...ctx.db.advanceSchedule.iter()]) if (a.roomId === room.id) ctx.db.advanceSchedule.scheduledId.delete(a.scheduledId);
  for (const s of [...ctx.db.playerStats.roomId.filter(room.id)]) ctx.db.playerStats.identity.delete(s.identity);
  for (const p of [...ctx.db.player.roomId.filter(room.id)]) ctx.db.player.identity.update({ ...p, roomId: DEFAULT_ROOM_ID });
  ctx.db.cursor.id.delete(room.id);
  ctx.db.ghostFrame.id.delete(room.id);
  ctx.db.room.id.delete(room.id);
}

/** 1 Hz: empty rooms (never the default one) are deleted after ROOM_IDLE_S. */
function gcRooms(ctx: Ctx, tNow: bigint) {
  for (const room of [...ctx.db.room.iter()]) {
    if (room.id === DEFAULT_ROOM_ID || room.players > 0) continue;
    if (tNow - room.lastActiveAt.microsSinceUnixEpoch < BigInt(ROOM_IDLE_S) * MICROS) continue;
    deleteRoom(ctx, room);
  }
}

/** A room that has never run a game starts its first one shortly after someone shows up. */
function ensureStarted(ctx: Ctx, room: RoomRow) {
  if (!getConfig(ctx).autoAdvance || room.levelId !== 0n) return;
  for (const a of ctx.db.advanceSchedule.iter()) if (a.roomId === room.id) return;
  scheduleAdvance(ctx, room.id, 0n, FIRST_GAME_S);
}

function scheduleAdvance(ctx: Ctx, roomId: number, afterLevelId: bigint, secs: bigint) {
  ctx.db.advanceSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(now(ctx) + secs * MICROS), roomId, afterLevelId });
}

function clearAdvance(ctx: Ctx, roomId: number) {
  for (const a of [...ctx.db.advanceSchedule.iter()]) if (a.roomId === roomId) ctx.db.advanceSchedule.scheduledId.delete(a.scheduledId);
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

function stageOf(l: { params: string }): number {
  return (JSON.parse(l.params) as Partial<StageMeta>).stage ?? 1;
}
function playAtOf(l: { params: string }): number {
  return (JSON.parse(l.params) as Partial<StageMeta>).playAt ?? 0;
}

/** Where the cursor waits during the countdown (and respawns in the maze). */
function startPos(kind: string, params: unknown) {
  if (kind === 'vote') return VOTE_START;
  if (kind === 'maze') {
    const m = params as MazeParams;
    return tileCenter(m, m.start.c, m.start.r);
  }
  if (kind === 'redlight') return (params as RedlightParams).path[0];
  if (kind === 'spotlight') return (params as SpotlightParams).path[0];
  if (kind === 'belts') return (params as BeltsParams).start;
  if (kind === 'needle') return { x: 1, y: (NEEDLE_TOP + WORLD_H) / 2 };
  if (kind === 'plank') {
    const t0 = (params as PlankParams).tiles[0];
    return t0 ? { x: Math.max(0.3, t0.x - 0.6), y: t0.y + t0.h / 2 } : { x: WORLD_W / 2, y: WORLD_H / 2 };
  }
  return { x: WORLD_W / 2, y: WORLD_H / 2 };
}

function startLevel(ctx: Ctx, room: RoomRow, kind: PlayKind, stage = 1) {
  stage = Math.max(1, Math.min(STAGES, Math.round(stage)));
  const cur = currentLevel(ctx, room);
  if (cur && cur.state === 'running') endLevel(ctx, room, cur.id, 'skipped');
  clearAdvance(ctx, room.id);
  resetStats(ctx, room.id);

  const rand = () => ctx.random();
  const playAt = nowMs(ctx) + COUNTDOWN_S * 1000;
  const meta: StageMeta = { stage, stages: STAGES, playAt };
  // Admin-saved stage-1 defaults, hardened for later stages.
  const sp = stageSpec(kind, stage, settingsFor(kind, ctx.db.modeSettings.kind.find(kind)?.json));
  let params: object = {};
  let progress: object = {};
  let secret: string | null = null;
  const secs = stageSeconds(kind, sp);
  if (kind === 'targets') {
    params = makeTargets(rand, sp.n, sp.r, sp.move, sp.strikes);
    progress = { next: 0, strikes: 0, on: -1 } satisfies TargetsProgress;
  } else if (kind === 'maze') {
    params = makeMaze(rand, sp.cw, sp.ch, sp.bonks);
    progress = { hits: 0, frozenUntil: 0 } satisfies MazeProgress;
  } else if (kind === 'minesweeper') {
    const m = makeMines(rand, sp.cols, sp.rows, sp.mines, sp.autoMinS, sp.autoMaxS);
    params = m.params;
    progress = { ...m.progress, nextAutoAt: playAt + autoClickMs(m.params, rand) } satisfies MinesProgress;
    secret = m.secret;
  } else if (kind === 'redlight') {
    ({ params, progress } = makeRedlight(rand, sp, playAt));
  } else if (kind === 'balloon') {
    ({ params, progress } = makeBalloons(rand, sp, playAt));
  } else if (kind === 'mole') {
    ({ params, progress } = makeMoles(sp, playAt));
  } else if (kind === 'potato') {
    ({ params, progress } = makePotato(rand, sp, playAt));
  } else if (kind === 'chairs') {
    ({ params, progress } = makeChairs(rand, sp, playAt));
  } else if (kind === 'keyboard') {
    ({ params, progress } = makeKeyboard(rand, sp, stage));
  } else if (kind === 'hunt') {
    const h = makeHunt(rand, sp, playAt);
    params = h.params;
    progress = h.progress;
    secret = JSON.stringify(h.secret);
  } else if (kind === 'valves') {
    ({ params, progress } = makeValves(rand, sp, playAt));
  } else if (kind === 'stations') {
    ({ params, progress } = makeStations(rand, sp));
  } else if (kind === 'echo') {
    const e = makeEcho(rand, sp, playAt);
    params = e.params;
    progress = e.progress;
    secret = JSON.stringify(e.secret);
  } else if (kind === 'crane') {
    ({ params, progress } = makeCrane(sp));
  } else if (kind === 'spotlight') {
    ({ params, progress } = makeSpotlight(sp, playAt));
  } else if (kind === 'sheep') {
    ({ params, progress } = makeSheep(rand, sp, playAt));
  } else if (kind === 'ice') {
    ({ params, progress } = makeIce(rand, sp));
  } else if (kind === 'plank') {
    ({ params, progress } = makePlank(sp));
  } else if (kind === 'seesaw') {
    ({ params, progress } = makeSeesaw(rand, sp));
  } else if (kind === 'belts') {
    ({ params, progress } = makeBelts(rand, sp));
  } else if (kind === 'needle') {
    ({ params, progress } = makeNeedle(rand, sp));
  } else if (kind === 'wires') {
    const w = makeWires(rand, sp);
    params = w.params;
    progress = w.progress;
    secret = JSON.stringify(w.secret);
  }
  const start = startPos(kind, params);
  const row = ctx.db.level.insert({
    id: 0n,
    roomId: room.id,
    kind,
    state: 'running',
    params: JSON.stringify({ ...params, ...meta }),
    progress: JSON.stringify(progress),
    startedAt: ctx.timestamp,
    deadline: ts(BigInt(playAt) * 1000n + BigInt(Math.round(secs)) * MICROS),
    endedAt: undefined,
    score: 0,
    chaosSum: 0,
    ticks: 0,
  });
  if (secret !== null) ctx.db.levelSecret.insert({ levelId: row.id, data: secret });
  ctx.db.room.id.update({ ...getRoom(ctx, room.id), levelId: row.id });
  resetCursorTo(ctx, room.id, start.x, start.y);
  log(ctx, room.id, 'level_start', '', { kind, stage, levelId: row.id.toString() });
}

/**
 * Party flow. A round with no game on the board opens with a random game (never
 * the picker). A game runs stage 1..STAGES; once all three are done, or the run
 * is lost, the mob picks the next game. There is no fixed rotation.
 */
function nextUp(ctx: Ctx, room: RoomRow): { kind: PlayKind; stage: number } | 'vote' {
  const cur = currentLevel(ctx, room);
  if (!cur || !isPlayKind(cur.kind) || cur.state === 'skipped') {
    return { kind: LEVEL_ROTATION[ctx.random.integerInRange(0, LEVEL_ROTATION.length - 1)], stage: 1 };
  }
  const stage = stageOf(cur);
  if (cur.state !== 'lost' && stage < STAGES) return { kind: cur.kind, stage: stage + 1 };
  return 'vote';
}

function startNext(ctx: Ctx, room: RoomRow) {
  const n = nextUp(ctx, room);
  if (n === 'vote') startVote(ctx, room);
  else startLevel(ctx, room, n.kind, n.stage);
}

/** Picker round: a fresh random PICK_CARDS-card subset (never the game that just finished); the card the cursor is inside when the timer hits zero is the next game. */
function startVote(ctx: Ctx, room: RoomRow) {
  const cur = currentLevel(ctx, room);
  if (cur && cur.state === 'running') endLevel(ctx, room, cur.id, 'skipped');
  clearAdvance(ctx, room.id);
  const playAt = nowMs(ctx) + COUNTDOWN_S * 1000;
  const endsAt = playAt + VOTE_SECS * 1000;
  const lastKind = cur && isPlayKind(cur.kind) ? cur.kind : undefined;
  const params: VoteParams & StageMeta = {
    cards: voteLayout(pickCards(() => ctx.random(), lastKind)),
    lastKind,
    stage: 1,
    stages: 1,
    playAt,
  };
  const progress: VoteProgress = { endsAt, restarts: 0 };
  const row = ctx.db.level.insert({
    id: 0n,
    roomId: room.id,
    kind: 'vote',
    state: 'running',
    params: JSON.stringify(params),
    progress: JSON.stringify(progress),
    startedAt: ctx.timestamp,
    deadline: ts(BigInt(endsAt) * 1000n),
    endedAt: undefined,
    score: 0,
    chaosSum: 0,
    ticks: 0,
  });
  ctx.db.room.id.update({ ...getRoom(ctx, room.id), levelId: row.id });
  resetCursorTo(ctx, room.id, VOTE_START.x, VOTE_START.y);
  log(ctx, room.id, 'vote_start', '', {});
}

/**
 * Picker timer hit zero. Cursor inside a card: that game starts now (stage 1);
 * returns where its cursor starts. Cursor in a gap: restart the timer, picker
 * stays up, returns null.
 */
function resolveVote(ctx: Ctx, room: RoomRow, l: LevelRow, x: number, y: number) {
  const p = JSON.parse(l.params) as VoteParams;
  const prog = JSON.parse(l.progress) as VoteProgress;
  const r = voteResolve(p, prog, x, y, nowMs(ctx));
  if (!('chosen' in r)) {
    ctx.db.level.id.update({ ...l, progress: JSON.stringify(r.prog), deadline: ts(BigInt(r.prog.endsAt) * 1000n) });
    fx(ctx, room.id, 'vote_restart', x, y);
    log(ctx, room.id, 'vote_restart', '', { restarts: r.prog.restarts });
    return null;
  }
  const win = r.chosen;
  ctx.db.level.id.update({ ...l, state: 'won', endedAt: ctx.timestamp, progress: JSON.stringify({ ...prog, chosen: win.kind }) });
  fx(ctx, room.id, 'voted', win.x + win.w / 2, win.y + win.h / 2, win.kind);
  log(ctx, room.id, 'vote_result', '', { chosen: win.kind });
  if (!isPlayKind(win.kind)) return null;
  startLevel(ctx, getRoom(ctx, room.id), win.kind, 1);
  const nl = currentLevel(ctx, getRoom(ctx, room.id));
  return nl ? startPos(nl.kind, JSON.parse(nl.params)) : null;
}

function endLevel(ctx: Ctx, room: RoomRow, levelId: bigint, state: 'won' | 'lost' | 'skipped') {
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
    for (const s of ctx.db.playerStats.roomId.filter(room.id)) {
      const p = ctx.db.player.identity.find(s.identity);
      if (p && s.activeSamples > 0) ctx.db.player.identity.update({ ...p, score: p.score + score });
    }
    giveAwards(ctx, room, levelId);
    const c = getCursor(ctx, room.id);
    fx(ctx, room.id, state === 'won' ? 'win' : 'lose', c.x, c.y);
    if (getConfig(ctx).autoAdvance) scheduleAdvance(ctx, room.id, levelId, ADVANCE_S);
  }
  log(ctx, room.id, 'level_end', '', {
    kind: l.kind,
    stage: stageOf(l),
    state,
    score,
    seconds: Math.round(elapsed),
    coop,
  });
}

function giveAwards(ctx: Ctx, room: RoomRow, levelId: bigint) {
  type S = { id: Identity; name: string; v: number; detail: string };
  const rows = [...ctx.db.playerStats.roomId.filter(room.id)].filter(s => s.samples > 0);
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
    ctx.db.award.insert({ id: 0n, roomId: room.id, levelId, title, who: hex(s.id), name: s.name, detail: s.detail });
    log(ctx, room.id, 'award', hex(s.id), { title, name: s.name, detail: s.detail });
  };

  const active = rows.filter(s => s.activeSamples > 0);
  if (active.length > 0) {
    const ratio = (a: number, b: number) => (a + b > 0 ? a / (a + b) : 0);
    const onlyActive = (xs: S[]) => xs.filter(x => active.some(a => a.identity.isEqual(x.id)));
    grant('Most Disagreeable Player', best(onlyActive(named(s => ratio(s.disagree, s.agree), v => `pulled against the mob ${Math.round(v * 100)}% of the time`))));
    grant('Biggest Troll', best(onlyActive(named(s => (s.activeSamples ? s.distSum / s.activeSamples : 0), v => `parked ${v.toFixed(1)} units from the cursor on average`))));
    grant('MVP (Most Valuable Puppet)', best(onlyActive(named(s => ratio(s.agree, s.disagree), v => `agreed with the mob ${Math.round(v * 100)}% of the time`))));
    grant('Wiggle Champion', best(onlyActive(named(s => s.activitySum, v => `moved the most (${v.toFixed(1)} pad-lengths)`))));
  }
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
    tickHz: 15,
    // omega ~6.3 rad/s, zeta ~0.95: covers half the distance in ~0.27 s.
    gain: 40,
    damping: 12,
    maxSpeed: 20,
    influenceCap: 0.25,
    maxPlayers: MAX_PLAYERS_CEILING,
    maxRooms: MAX_ROOMS_CEILING,
    freshMs: 2000,
    dictatorSecs: 5,
    autoAdvance: true,
    paused: false,
  });
  insertRoom(ctx, DEFAULT_ROOM_ID, DEFAULT_ROOM_CODE, 'The Lobby', ctx.sender);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  if (ctx.connectionId) ctx.db.session.insert({ connectionId: ctx.connectionId, identity: ctx.sender });
  refreshPresence(ctx, ctx.sender);
  syncTickSchedule(ctx);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  if (ctx.connectionId) ctx.db.session.connectionId.delete(ctx.connectionId);
  const before = ctx.db.player.identity.find(ctx.sender);
  refreshPresence(ctx, ctx.sender);
  const after = ctx.db.player.identity.find(ctx.sender);
  if (before?.connected && after && !after.connected) log(ctx, after.roomId, 'leave', hex(ctx.sender), { name: after.name });
  syncTickSchedule(ctx);
});

// ---------------------------------------------------------------------------
// Player reducers
// ---------------------------------------------------------------------------

/**
 * Join (or re-join) with a name. `code` picks a room: '' keeps the player's
 * current room (the default lobby for newcomers).
 */
export const join = spacetimedb.reducer({ name: t.string(), code: t.string() }, (ctx, { name, code }) => {
  const ban = ctx.db.banned.identity.find(ctx.sender);
  if (ban && ban.until.microsSinceUnixEpoch > now(ctx)) throw new SenderError('you were kicked; try again soon');
  const existing = ctx.db.player.identity.find(ctx.sender);
  const clean = sanitizeName(name, ctx);
  const want = normalizeRoomCode(code);
  let roomId = existing?.roomId ?? DEFAULT_ROOM_ID;
  if (want) {
    const r = ctx.db.room.code.find(want);
    if (!r) throw new SenderError(`no room with code ${want}`);
    roomId = r.id;
  } else if (!ctx.db.room.id.find(roomId)) roomId = DEFAULT_ROOM_ID; // their old room was garbage-collected
  const cfg = getConfig(ctx);
  const joiningRoom = !existing || !existing.connected || existing.roomId !== roomId;
  if (joiningRoom && roomPlayers(ctx, roomId) >= Math.min(cfg.maxPlayers, MAX_PLAYERS_CEILING)) throw new SenderError('room is full');
  if (existing) {
    if (existing.roomId !== roomId) movePlayer(ctx, ctx.sender, roomId);
    ctx.db.player.identity.update({ ...ctx.db.player.identity.find(ctx.sender)!, name: clean, connected: true });
  } else {
    let n = 0;
    const teamCount = [0, 0];
    for (const p of ctx.db.player.roomId.filter(roomId)) {
      n++;
      if (p.connected) teamCount[p.team]++;
    }
    ctx.db.player.insert({
      identity: ctx.sender,
      roomId,
      name: clean,
      color: COLORS[n % COLORS.length],
      team: teamCount[0] <= teamCount[1] ? 0 : 1,
      score: 0,
      connected: true,
      joinedAt: ctx.timestamp,
    });
  }
  if (!ctx.db.pointer.identity.find(ctx.sender)) markIdle(ctx, ctx.sender, ctx.timestamp);
  log(ctx, roomId, 'join', hex(ctx.sender), { name: clean });
  refreshRoom(ctx, roomId);
  syncTickSchedule(ctx);
  ensureStarted(ctx, getRoom(ctx, roomId));
});

/** Any joined player can open a room; they become its host and move into it. */
export const create_room = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) throw new SenderError('join first');
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || `${p.name}'s room`; // eslint-disable-line no-control-regex
  const room = createRoom(ctx, clean);
  movePlayer(ctx, ctx.sender, room.id);
  ctx.db.player.identity.update({ ...ctx.db.player.identity.find(ctx.sender)!, connected: true });
  refreshRoom(ctx, room.id);
  syncTickSchedule(ctx);
  ensureStarted(ctx, getRoom(ctx, room.id));
});

/** Leave the room entirely (back to the join screen). Like a kick without the ban: the player row goes, so a reload does not quietly rejoin. */
export const leave = spacetimedb.reducer(ctx => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  ctx.db.player.identity.delete(ctx.sender);
  ctx.db.pointer.identity.delete(ctx.sender);
  ctx.db.pointerRate.identity.delete(ctx.sender);
  ctx.db.idle.identity.delete(ctx.sender);
  ctx.db.playerStats.identity.delete(ctx.sender);
  log(ctx, p.roomId, 'leave', hex(ctx.sender), { name: p.name });
  refreshRoom(ctx, p.roomId);
  syncTickSchedule(ctx);
});

export const set_pointer = spacetimedb.reducer({ x: t.f32(), y: t.f32() }, (ctx, { x, y }) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new SenderError('bad coordinates');
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) throw new SenderError('join first');
  const room = ctx.db.room.id.find(p.roomId);
  if (!room) throw new SenderError('room is gone; join again');
  if (!p.connected) {
    // Marked gone for idling, but this connection is alive: welcome back.
    if ([...ctx.db.session.identity.filter(ctx.sender)].length === 0) throw new SenderError('join first');
    ctx.db.player.identity.update({ ...p, connected: true });
    log(ctx, p.roomId, 'join', hex(ctx.sender), { name: p.name, reason: 'back' });
    refreshRoom(ctx, p.roomId);
    syncTickSchedule(ctx);
  }
  const cx = clamp(x, 0, 1);
  const cy = clamp(y, 0, 1);
  // Safety-net rate limit (GCRA) at 2x the room's advertised rate with a burst of a
  // few calls, so packets bunched by mobile Wi-Fi land instead of the newest being
  // dropped. The real lever is the client throttle.
  const tNow = now(ctx);
  const intervalUs = BigInt(Math.floor(1e6 / (Math.max(1, room.pointerHzEffective) * 2)));
  const rate = ctx.db.pointerRate.identity.find(ctx.sender);
  const tat = rate && rate.tatUs > tNow ? rate.tatUs : tNow;
  if (tat - tNow > POINTER_BURST * intervalUs) return;
  if (rate) ctx.db.pointerRate.identity.update({ ...rate, tatUs: tat + intervalUs });
  else ctx.db.pointerRate.insert({ identity: ctx.sender, tatUs: tat + intervalUs });

  const prev = ctx.db.pointer.identity.find(ctx.sender);
  if (!prev) {
    ctx.db.pointer.insert({ identity: ctx.sender, roomId: p.roomId, x: cx, y: cy, activity: 0, updatedAt: ctx.timestamp });
    ctx.db.idle.identity.delete(ctx.sender);
    return;
  }
  const dtUs = tNow - prev.updatedAt.microsSinceUnixEpoch;
  const decay = Math.exp(-Number(dtUs) / 1.5e6);
  const activity = prev.activity * decay + Math.hypot(cx - prev.x, cy - prev.y);
  ctx.db.pointer.identity.update({ ...prev, roomId: p.roomId, x: cx, y: cy, activity, updatedAt: ctx.timestamp });
});

/**
 * Mob Sweeper's only reveal: the server clicks the cell under the cursor when
 * the random timer fires. Phones cannot click.
 */
function autoClick(ctx: Ctx, room: RoomRow, l: LevelRow, x: number, y: number) {
  fx(ctx, room.id, 'autoclick', x, y);
  log(ctx, room.id, 'autoclick', '', { x: +x.toFixed(2), y: +y.toFixed(2) });
  const params = JSON.parse(l.params) as MinesParams;
  const prog = JSON.parse(l.progress) as MinesProgress;
  const sec = ctx.db.levelSecret.levelId.find(l.id);
  if (!sec) return;
  const { c, r } = cellAt(params, x, y);
  const res = revealCell(params, prog, sec.data, c, r);
  const next = { ...(res.result === 'noop' ? prog : res.prog), nextAutoAt: nowMs(ctx) + autoClickMs(params, () => ctx.random()) };
  if (res.result !== 'noop') ctx.db.levelSecret.levelId.update({ ...sec, data: res.secret });
  ctx.db.level.id.update({ ...l, progress: JSON.stringify(next) });
  if (res.result === 'noop') return;
  if (res.result === 'mine' || res.result === 'lost') {
    fx(ctx, room.id, 'mine', x, y);
    log(ctx, room.id, 'mine', '', { c, r, lives: res.prog.lives });
  } else fx(ctx, room.id, 'reveal', x, y);
  if (res.result === 'won') endLevel(ctx, room, l.id, 'won');
  if (res.result === 'lost') endLevel(ctx, room, l.id, 'lost');
}

// ---------------------------------------------------------------------------
// Tick (scheduled, private): one call advances every room that has players.
// ---------------------------------------------------------------------------

export const tick = spacetimedb.reducer({ onSchedule: tickSchedule }, { arg: tickSchedule.rowType }, ctx => {
  const cfg = getConfig(ctx);
  const tNow = now(ctx);
  const freshUs = BigInt(cfg.freshMs) * 1000n;
  const intervalUs = MICROS / BigInt(Math.max(1, cfg.tickHz));
  // The tick that crosses a wall-clock second does the 1 Hz housekeeping.
  const secondTick = tNow / MICROS !== (tNow - intervalUs) / MICROS;

  // One pass over every pointer, grouped by room.
  const byRoom = new Map<number, Pt[]>();
  for (const ptr of ctx.db.pointer.iter()) {
    if (tNow - ptr.updatedAt.microsSinceUnixEpoch > freshUs) continue;
    const pl = ctx.db.player.identity.find(ptr.identity);
    if (!pl || !pl.connected || pl.roomId !== ptr.roomId) continue;
    let pts = byRoom.get(ptr.roomId);
    if (!pts) byRoom.set(ptr.roomId, (pts = []));
    pts.push({ id: hex(ptr.identity), x: ptr.x * WORLD_W, y: ptr.y * WORLD_H, w: ptr.activity, team: pl.team });
  }

  for (const room of [...ctx.db.room.iter()]) {
    if (room.players === 0) continue;
    tickRoom(ctx, cfg, room, byRoom.get(room.id) ?? [], tNow, secondTick);
  }

  if (secondTick) {
    gcStalePointers(ctx, tNow);
    sweepIdle(ctx, tNow);
    gcRooms(ctx, tNow);
  }
});

function tickRoom(ctx: Ctx, cfg: ReturnType<typeof getConfig>, room: RoomRow, pts: Pt[], tNow: bigint, secondTick: boolean) {
  const cur = getCursor(ctx, room.id);
  const dt = clamp(Number(tNow - cur.lastTickAt.microsSinceUnixEpoch) / 1e6, 0, 0.2);

  // Rotating dictator: one random fresh player rules for a few seconds.
  let dictator = cur.dictator;
  let dictatorUntil = cur.dictatorUntil;
  if (cfg.rule === 'dictator' && pts.length > 0) {
    const stillThere = pts.some(p => p.id === dictator);
    if (!stillThere || tNow >= dictatorUntil.microsSinceUnixEpoch) {
      const pick = pts[ctx.random.integerInRange(0, pts.length - 1)];
      dictator = pick.id;
      dictatorUntil = ts(tNow + BigInt(Math.round(cfg.dictatorSecs * 1e6)));
      const pl = [...ctx.db.player.roomId.filter(room.id)].find(p => hex(p.identity) === pick.id);
      log(ctx, room.id, 'dictator', pick.id, { name: pl?.name ?? '?' });
      fx(ctx, room.id, 'dictator', pick.x, pick.y, pick.id);
    }
  } else if (cfg.rule !== 'dictator') dictator = '';

  const target = aggregate(cfg.rule as Rule, pts, cfg.influenceCap, dictator);
  const lvl = currentLevel(ctx, room);
  const running = lvl && lvl.state === 'running' ? lvl : undefined;
  const before = { x: cur.x, y: cur.y };
  const spring = cursorPhysics(running?.kind, cfg);
  let body = integrate(cur, target, dt, spring.gain, spring.damping, spring.maxSpeed);
  // Mode-specific motion on top of the spring (ice slide, plank shove, belt drag); shared with the client's prediction.
  const tPlaySec = running ? (Number(tNow / 1000n) - playAtOf(running)) / 1000 : 0;
  if (running && tPlaySec >= 0) body = postIntegrate(running.kind, JSON.parse(running.params), cur, body, dt, tPlaySec);
  const ch = chaosOf(pts, cur.x, cur.y);
  const chaosSmoothed = cur.chaos + (ch - cur.chaos) * Math.min(1, dt * 3);

  // Countdown: hold the cursor on the start spot until play begins.
  const tMs = Number(tNow / 1000n);
  const countingDown = !!running && tMs < playAtOf(running);
  if (running && countingDown) {
    const s = startPos(running.kind, JSON.parse(running.params));
    body = { x: s.x, y: s.y, vx: 0, vy: 0 };
  }

  // Level rules.
  if (running && !countingDown) {
    let progress = running.progress;
    let outcome: 'won' | 'lost' | null = null;
    const timeUp = tNow >= running.deadline.microsSinceUnixEpoch;
    const tPlay = (tMs - playAtOf(running)) / 1000;
    const rand = () => ctx.random();
    const emit = (kind: string, x: number, y: number, who = '') => fx(ctx, room.id, kind, x, y, who);
    if (running.kind === 'targets') {
      const p = JSON.parse(running.params) as TargetsParams;
      const prog = JSON.parse(progress) as TargetsProgress;
      const r = targetsStep(p, prog, tPlay, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event === 'hit' && r.at) {
        emit('target', r.at.x, r.at.y);
        log(ctx, room.id, 'target', '', { n: r.prog.next, of: p.targets.length });
      } else if (r.event === 'zap' && r.at) {
        emit('zap', r.at.x, r.at.y);
        log(ctx, room.id, 'zap', '', { strikes: r.prog.strikes, of: p.strikeCap, wanted: r.prog.next + 1, hit: r.prog.on + 1 });
      }
      if (r.won) outcome = 'won';
      else if (r.prog.strikes >= p.strikeCap) outcome = 'lost';
    } else if (running.kind === 'maze') {
      const m = JSON.parse(running.params) as MazeParams;
      const prog = JSON.parse(progress) as MazeProgress;
      const s = tileCenter(m, m.start.c, m.start.r);
      if (tMs < prog.frozenUntil) {
        // Just respawned: hold at the start so the mob can regroup.
        body = { x: s.x, y: s.y, vx: 0, vy: 0 };
      } else if (mazeHit(m, before, body)) {
        prog.hits += 1;
        prog.frozenUntil = tMs + 700;
        progress = JSON.stringify(prog);
        emit('wall', body.x, body.y);
        log(ctx, room.id, 'wall', '', { hits: prog.hits, of: m.bonkCap });
        body = { x: s.x, y: s.y, vx: 0, vy: 0 };
        if (prog.hits >= m.bonkCap) outcome = 'lost';
      } else {
        const tl = tileAt(m, body.x, body.y);
        if (tl.c === m.goal.c && tl.r === m.goal.r) outcome = 'won';
      }
    } else if (running.kind === 'redlight') {
      const p = JSON.parse(running.params) as RedlightParams;
      const prog = JSON.parse(progress) as RedlightProgress;
      const r = redlightStep(p, prog, body, tMs, rand);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      for (const e of r.events) {
        if (e === 'fault') {
          emit('fault', body.x, body.y);
          log(ctx, room.id, 'fault', '', { faults: r.prog.faults, of: p.faultCap, rewind: p.rewind });
        } else emit('light', WORLD_W / 2, 0.9, e);
      }
      if (r.won) outcome = 'won';
      else if (r.prog.faults >= p.faultCap) outcome = 'lost';
    } else if (running.kind === 'balloon') {
      const p = JSON.parse(running.params) as BalloonParams;
      const prog = JSON.parse(progress) as BalloonProgress;
      const r = balloonStep(p, prog, tMs, body, rand);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      for (const e of r.events) {
        emit(e.kind, e.x, e.y);
        if (e.kind === 'drop') log(ctx, room.id, 'drop', '', { drops: r.prog.drops, of: p.dropCap });
      }
      if (r.prog.drops >= p.dropCap) outcome = 'lost';
      else if (r.prog.saves >= p.saveTarget) outcome = 'won';
    } else if (running.kind === 'mole') {
      const p = JSON.parse(running.params) as MoleParams;
      const prog = JSON.parse(progress) as MoleProgress;
      const r = moleStep(p, prog, tMs, body, rand);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event === 'hit' || r.event === 'miss') {
        const h = p.holes[prog.up];
        emit(r.event === 'hit' ? 'mole_hit' : 'mole_miss', h.x, h.y);
        log(ctx, room.id, r.event === 'hit' ? 'mole_hit' : 'mole_miss', '', { score: r.prog.score, of: p.target, misses: r.prog.misses });
      }
      if (r.prog.score >= p.target) outcome = 'won';
      else if (r.prog.misses >= p.missCap) outcome = 'lost';
    } else if (running.kind === 'potato') {
      const p = JSON.parse(running.params) as PotatoParams;
      const prog = JSON.parse(progress) as PotatoProgress;
      const r = potatoStep(p, prog, tMs, tPlay, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        emit(r.event === 'boom' ? 'boom' : 'splash', body.x, body.y);
        log(ctx, room.id, 'potato', '', { event: r.event, round: r.prog.round, of: p.rounds });
        if (r.event === 'won') outcome = 'won';
        else if (r.event === 'boom') outcome = 'lost';
      }
    } else if (running.kind === 'chairs') {
      const p = JSON.parse(running.params) as ChairsParams;
      const prog = JSON.parse(progress) as ChairsProgress;
      const r = chairsStep(p, prog, tMs, body, rand);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        const sat = r.prog.sat >= 0 ? p.chairs[r.prog.sat] : null;
        emit(r.event === 'lost' ? 'no_chair' : 'sit', sat ? sat.x + sat.w / 2 : body.x, sat ? sat.y + sat.h / 2 : body.y);
        log(ctx, room.id, 'chairs', '', { event: r.event, round: prog.round, left: r.prog.left.length });
        if (r.event === 'won') outcome = 'won';
        else if (r.event === 'lost') outcome = 'lost';
      }
    } else if (running.kind === 'keyboard') {
      const p = JSON.parse(running.params) as KeyboardParams;
      const prog = JSON.parse(progress) as KeyboardProgress;
      const r = keyboardStep(p, prog, tMs, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        emit(r.event === 'key' ? 'key' : 'buzz', body.x, body.y, r.event === 'key' ? prog.onKey || r.prog.onKey : r.prog.onKey);
        log(ctx, room.id, r.event, '', { typed: p.word.slice(0, r.prog.next), word: p.word, typos: r.prog.buzzes, of: p.typoCap });
      }
      if (r.won) outcome = 'won';
      else if (r.prog.buzzes >= p.typoCap) outcome = 'lost';
    } else if (running.kind === 'hunt') {
      const p = JSON.parse(running.params) as HuntParams;
      const prog = JSON.parse(progress) as HuntProgress;
      const sec = ctx.db.levelSecret.levelId.find(running.id);
      if (sec) {
        const secret = JSON.parse(sec.data) as HuntSecret;
        const r = huntStep(p, prog, secret, tMs, body, rand);
        if (r.prog !== prog) progress = JSON.stringify(r.prog);
        if (r.secret !== secret) ctx.db.levelSecret.levelId.update({ ...sec, data: JSON.stringify(r.secret) });
        if (r.event === 'found') {
          emit('hunt_found', body.x, body.y);
          log(ctx, room.id, 'hunt_found', '', { found: r.prog.found.length, of: p.finds });
        } else if (r.event === 'reset') emit('hunt_reset', body.x, body.y);
        else if (r.event === 'trap') {
          emit('trap', body.x, body.y);
          log(ctx, room.id, 'trap', '', { traps: r.prog.traps, of: p.trapCap });
        }
        if (r.won) outcome = 'won';
        else if (r.prog.traps >= p.trapCap) outcome = 'lost';
      }
    } else if (running.kind === 'valves') {
      const p = JSON.parse(running.params) as ValvesParams;
      const prog = JSON.parse(progress) as ValvesProgress;
      const r = valvesStep(p, prog, tMs, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        const v = r.event.i >= 0 ? p.valves[r.event.i] : body;
        emit(`valve_${r.event.kind}`, v.x, v.y);
        if (r.event.kind === 'blow') log(ctx, room.id, 'valve_blow', '', { blowouts: r.prog.blowouts, of: p.blowCap });
      }
      if (r.prog.blowouts >= p.blowCap) outcome = 'lost';
      else if (r.won) outcome = 'won';
    } else if (running.kind === 'stations') {
      const p = JSON.parse(running.params) as StationsParams;
      const prog = JSON.parse(progress) as StationsProgress;
      const r = stationsStep(p, prog, tMs, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        const st = p.stations[prog.next];
        emit(r.event === 'visit' ? 'station' : 'station_cancel', st.x, st.y);
        log(ctx, room.id, r.event === 'visit' ? 'station' : 'station_cancel', '', { next: r.prog.next, of: p.stations.length, skips: r.prog.cancels, skipCap: p.skipCap });
      }
      if (r.won) outcome = 'won';
      else if (r.prog.cancels >= p.skipCap) outcome = 'lost';
    } else if (running.kind === 'echo') {
      const p = JSON.parse(running.params) as EchoParams;
      const prog = JSON.parse(progress) as EchoProgress;
      const sec = ctx.db.levelSecret.levelId.find(running.id);
      if (sec) {
        const r = echoStep(p, prog, JSON.parse(sec.data) as EchoSecret, tMs, body);
        if (r.prog !== prog) progress = JSON.stringify(r.prog);
        if (r.event) {
          const at = r.pad >= 0 ? p.pads[r.pad] : body;
          emit(`echo_${r.event}`, at.x, at.y, String(r.pad));
          if (r.event !== 'flash') log(ctx, room.id, `echo_${r.event}`, '', { round: r.prog.round, of: p.rounds, faults: r.prog.faults, faultCap: p.faultCap });
        }
        if (r.won) outcome = 'won';
        else if (r.prog.faults >= p.faultCap) outcome = 'lost';
      }
    } else if (running.kind === 'crane') {
      const p = JSON.parse(running.params) as CraneParams;
      const prog = JSON.parse(progress) as CraneProgress;
      const r = craneStep(p, prog, tMs, tPlay, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        const top = r.prog.blocks[r.prog.blocks.length - 1];
        emit(`crane_${r.event}`, top.x, p.baseY - r.prog.blocks.length * p.blockH);
        log(ctx, room.id, `crane_${r.event}`, '', { height: r.prog.blocks.length - 1, of: p.target, dx: r.prog.lastDx });
      }
      if (r.prog.toppled) outcome = 'lost';
      else if (r.won) outcome = 'won';
    } else if (running.kind === 'spotlight') {
      const p = JSON.parse(running.params) as SpotlightParams;
      const prog = JSON.parse(progress) as SpotlightProgress;
      const r = spotlightStep(p, prog, tMs, tPlay, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) emit(`spot_${r.event}`, body.x, body.y);
      if (r.lost) outcome = 'lost';
      else if (r.won) outcome = 'won';
    } else if (running.kind === 'sheep') {
      const p = JSON.parse(running.params) as SheepParams;
      const prog = JSON.parse(progress) as SheepProgress;
      const r = sheepStep(p, prog, tMs, dt, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      for (const e of r.events) {
        if (e.kind === 'push') continue;
        const sh = r.prog.sheep[e.i];
        emit(`sheep_${e.kind}`, sh.x, sh.y);
        log(ctx, room.id, `sheep_${e.kind}`, '', { penned: r.prog.sheep.filter(q => q.in).length, of: p.n, escapes: r.prog.escapes, escapeCap: p.escapeCap });
      }
      if (r.prog.escapes >= p.escapeCap) outcome = 'lost';
      else if (r.won) outcome = 'won';
    } else if (running.kind === 'ice') {
      const p = JSON.parse(running.params) as IceParams;
      const prog = JSON.parse(progress) as IceProgress;
      const r = iceStep(p, prog, tMs, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        const gte = p.gates[prog.next] ?? body;
        emit(`ice_${r.event}`, gte.x, gte.y);
        log(ctx, room.id, `ice_${r.event}`, '', { next: r.prog.next, of: p.gates.length, faults: r.prog.faults, faultCap: p.faultCap });
      }
      if (r.won) outcome = 'won';
      else if (r.prog.faults >= p.faultCap) outcome = 'lost';
    } else if (running.kind === 'plank') {
      const p = JSON.parse(running.params) as PlankParams;
      const prog = JSON.parse(progress) as PlankProgress;
      const r = plankStep(p, prog, tMs, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      if (r.event) {
        const tl = p.tiles[prog.next] ?? { x: body.x, y: body.y, w: 0, h: 0 };
        emit(`plank_${r.event}`, tl.x + tl.w / 2, tl.y + tl.h / 2);
        if (r.event === 'tile') log(ctx, room.id, 'plank_tile', '', { next: r.prog.next, of: p.tiles.length });
      }
      if (r.won) outcome = 'won';
    } else if (running.kind === 'seesaw') {
      const p = JSON.parse(running.params) as SeesawParams;
      const prog = JSON.parse(progress) as SeesawProgress;
      const r = seesawStep(p, prog, dt, body, rand);
      progress = JSON.stringify(r.prog);
      for (const e of r.events) {
        emit(`seesaw_${e.kind}`, p.pivot.x, p.pivot.y);
        log(ctx, room.id, `seesaw_${e.kind}`, '', { pockets: r.prog.pockets, of: p.target, faults: r.prog.faults, faultCap: p.faultCap });
      }
      if (r.won) outcome = 'won';
      else if (r.prog.faults >= p.faultCap) outcome = 'lost';
    } else if (running.kind === 'belts') {
      const p = JSON.parse(running.params) as BeltsParams;
      const prog = JSON.parse(progress) as BeltsProgress;
      const r = beltsStep(p, prog, tMs, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      body = r.body;
      if (r.event) {
        emit(`belts_${r.event}`, before.x, before.y);
        log(ctx, room.id, `belts_${r.event}`, '', { faults: r.prog.faults, faultCap: p.faultCap, checkpoints: r.prog.checkpoints });
      }
      if (r.won) outcome = 'won';
      else if (r.prog.faults >= p.faultCap) outcome = 'lost';
    } else if (running.kind === 'needle') {
      const p = JSON.parse(running.params) as NeedleParams;
      const prog = JSON.parse(progress) as NeedleProgress;
      const r = needleStep(p, prog, tMs, tPlay, body);
      if (r.prog !== prog) progress = JSON.stringify(r.prog);
      body = r.body;
      if (r.event) {
        emit(`needle_${r.event}`, p.walls[prog.next].x, before.y);
        log(ctx, room.id, `needle_${r.event}`, '', { next: r.prog.next, of: p.walls.length, faults: r.prog.faults, faultCap: p.faultCap });
      }
      if (r.won) outcome = 'won';
      else if (r.prog.faults >= p.faultCap) outcome = 'lost';
    } else if (running.kind === 'wires') {
      const p = JSON.parse(running.params) as WiresParams;
      const prog = JSON.parse(progress) as WiresProgress;
      const sec = ctx.db.levelSecret.levelId.find(running.id);
      if (sec) {
        const r = wiresStep(p, prog, JSON.parse(sec.data) as WiresSecret, tMs, body);
        if (r.prog !== prog) progress = JSON.stringify(r.prog);
        if (r.event) {
          const nd = r.node >= 0 ? p.nodes[r.node] : body;
          emit(`wires_${r.event}`, nd.x, nd.y);
          log(ctx, room.id, `wires_${r.event}`, '', { pos: r.prog.pos, of: p.total, strikes: r.prog.strikes, strikeCap: p.strikeCap });
        }
        if (r.won) outcome = 'won';
        else if (r.prog.strikes >= p.strikeCap) outcome = 'lost';
      }
    }
    if (running.kind === 'vote') {
      if (timeUp) {
        const s = resolveVote(ctx, room, running, body.x, body.y);
        if (s) body = { x: s.x, y: s.y, vx: 0, vy: 0 };
      }
    } else if (!outcome && timeUp) outcome = 'lost';
    // The level row is broadcast to every phone in the room, so only write it
    // when progress changes or once a second (cooperation sample), never every tick.
    if (running.kind !== 'vote' && (progress !== running.progress || secondTick || outcome)) {
      ctx.db.level.id.update({
        ...running,
        progress,
        chaosSum: running.chaosSum + (secondTick ? chaosSmoothed : 0),
        ticks: running.ticks + (secondTick ? 1 : 0),
      });
    }
    if (outcome) endLevel(ctx, room, running.id, outcome);
    else if (running.kind === 'minesweeper') {
      const l = ctx.db.level.id.find(running.id);
      const prog = l ? (JSON.parse(l.progress) as MinesProgress) : null;
      if (l && prog && prog.nextAutoAt !== undefined && tMs >= prog.nextAutoAt) autoClick(ctx, room, l, body.x, body.y);
    }
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
  if (tickNo % 3n === 0n) writeGhostFrame(ctx, room.id, pts, dictator);

  // 1 Hz: behaviour stats for awards + a replay/heatmap sample.
  if (secondTick) {
    sampleStats(ctx, room.id, pts, body, target);
    log(ctx, room.id, 'sample', '', { x: +body.x.toFixed(2), y: +body.y.toFixed(2), c: +chaosSmoothed.toFixed(2), n: pts.length });
  }
}

/** ghost_frame.data: see packGhosts in sim.ts. */
function writeGhostFrame(ctx: Ctx, roomId: number, pts: Pt[], dictator: string) {
  const colorById = new Map<string, number>();
  for (const pl of ctx.db.player.roomId.filter(roomId)) if (pl.connected) colorById.set(hex(pl.identity), Math.max(0, COLORS.indexOf(pl.color)));
  const data = packGhosts(
    pts
      .map(p => ({
        key: ghostKey(p.id),
        color: colorById.get(p.id) ?? 0,
        team: p.team,
        dictator: p.id === dictator,
        x: p.x / WORLD_W,
        y: p.y / WORLD_H,
      }))
      // Deterministic order, so an idle room produces identical bytes and no write.
      .sort((a, b) => a.key - b.key || a.color - b.color)
  );
  const prev = ctx.db.ghostFrame.id.find(roomId);
  if (prev) {
    if (prev.data.length === data.length && prev.data.every((v, i) => v === data[i])) return; // idle room: no write
    ctx.db.ghostFrame.id.update({ ...prev, data });
  } else ctx.db.ghostFrame.insert({ id: roomId, data });
}

/**
 * Phones that sleep or get backgrounded often never send a clean disconnect,
 * leaving a frozen pointer behind. Live clients heartbeat every 1 s, so any
 * pointer silent for 10 s is dead: delete it (it is re-created on the next move).
 */
const POINTER_GC_US = 10_000_000n;
function gcStalePointers(ctx: Ctx, tNow: bigint) {
  for (const p of [...ctx.db.pointer.iter()])
    if (tNow - p.updatedAt.microsSinceUnixEpoch > POINTER_GC_US) {
      ctx.db.pointer.identity.delete(p.identity);
      markIdle(ctx, p.identity, p.updatedAt);
    }
}

function sampleStats(ctx: Ctx, roomId: number, pts: Pt[], body: { x: number; y: number }, target: { x: number; y: number } | null) {
  const byId = new Map(pts.map(p => [p.id, p]));
  const tdx = target ? target.x - body.x : 0;
  const tdy = target ? target.y - body.y : 0;
  const tl = Math.hypot(tdx, tdy);
  for (const pl of ctx.db.player.roomId.filter(roomId)) {
    if (!pl.connected) continue;
    const p = byId.get(hex(pl.identity));
    const st = ctx.db.playerStats.identity.find(pl.identity) ?? {
      identity: pl.identity,
      roomId,
      samples: 0,
      activeSamples: 0,
      agree: 0,
      disagree: 0,
      distSum: 0,
      activitySum: 0,
    };
    const next = { ...st, roomId, samples: st.samples + 1 };
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
    const room = ctx.db.room.id.find(arg.roomId);
    if (!room || !getConfig(ctx).autoAdvance) return;
    const cur = currentLevel(ctx, room);
    // afterLevelId 0 = a fresh room's first game; otherwise only advance past the level that scheduled us.
    if (arg.afterLevelId === 0n ? cur !== null : !cur || cur.id !== arg.afterLevelId || cur.state === 'running') return;
    startNext(ctx, room);
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

/** Lets the admin UI know whether this identity is a global admin (public read of a private table). */
export const amIAdmin = spacetimedb.view({ public: true }, t.array(t.object('AdminFlag', { yes: t.bool() })), ctx =>
  ctx.db.admin.identity.find(ctx.sender) ? [{ yes: true }] : []
);

export const admin_set_rule = spacetimedb.reducer({ rule: t.string() }, (ctx, { rule }) => {
  requireAdmin(ctx);
  if (!RULES.includes(rule as Rule)) throw new SenderError(`unknown rule ${rule}`);
  ctx.db.config.id.update({ ...getConfig(ctx), rule });
  for (const r of ctx.db.room.iter()) log(ctx, r.id, 'rule', '', { rule });
});

const NUMERIC_KEYS: Record<string, [number, number]> = {
  pointerHz: [1, 30],
  pointerBudget: [10, 5000],
  tickHz: [5, 30],
  gain: [0.5, 40],
  damping: [0, 60],
  maxSpeed: [0.5, 30],
  influenceCap: [0.01, 1],
  maxPlayers: [1, MAX_PLAYERS_CEILING],
  maxRooms: [1, MAX_ROOMS_CEILING],
  freshMs: [250, 10000],
  dictatorSecs: [1, 60],
};
const INT_KEYS = new Set(['tickHz', 'maxPlayers', 'maxRooms', 'freshMs']);

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
    const next = { ...c, [key]: v };
    // The spring must stay in the range the integrator resolves at this tick rate.
    next.damping = clamp(next.damping, 0, dampingMax(next.tickHz));
    next.gain = clamp(next.gain, 0.5, Math.min(NUMERIC_KEYS.gain[1], gainMax(next.tickHz)));
    ctx.db.config.id.update(next);
  }
  if (key === 'tickHz' || key === 'paused') {
    // Re-arm the interval at the new rate.
    for (const r of [...ctx.db.tickSchedule.iter()]) ctx.db.tickSchedule.scheduledId.delete(r.scheduledId);
  }
  if (key === 'pointerHz' || key === 'pointerBudget') for (const r of [...ctx.db.room.iter()]) refreshRoom(ctx, r.id);
  syncTickSchedule(ctx);
});

/** Per-mode stage-1 defaults. `json` is an object of numeric settings; unknown keys are dropped, values clamped. '{}' restores the shipped defaults. */
export const admin_set_mode_settings = spacetimedb.reducer({ kind: t.string(), json: t.string() }, (ctx, { kind, json }) => {
  requireAdmin(ctx);
  if (!isPlayKind(kind)) throw new SenderError(`unknown mode ${kind}`);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SenderError('settings must be a JSON object');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SenderError('settings must be a JSON object');
  const clean = JSON.stringify(sanitizeSettings(kind, raw as Record<string, unknown>));
  const row = { kind, json: clean, updatedAt: ctx.timestamp };
  if (ctx.db.modeSettings.kind.find(kind)) ctx.db.modeSettings.kind.update(row);
  else ctx.db.modeSettings.insert(row);
  log(ctx, DEFAULT_ROOM_ID, 'mode_settings', hex(ctx.sender), { kind, settings: JSON.parse(clean) });
});

export const admin_start_level = spacetimedb.reducer({ roomId: t.u32(), kind: t.string() }, (ctx, { roomId, kind }) => {
  const room = getRoom(ctx, roomId);
  requireHost(ctx, room);
  if (kind === 'next') return startNext(ctx, room);
  if (kind === 'vote') return startVote(ctx, room);
  if (!isPlayKind(kind)) throw new SenderError(`unknown level ${kind}`);
  startLevel(ctx, room, kind, 1);
});

export const admin_start_stage = spacetimedb.reducer({ roomId: t.u32(), kind: t.string(), stage: t.u32() }, (ctx, { roomId, kind, stage }) => {
  const room = getRoom(ctx, roomId);
  requireHost(ctx, room);
  if (!isPlayKind(kind)) throw new SenderError(`unknown level ${kind}`);
  if (stage < 1 || stage > STAGES) throw new SenderError(`stage must be 1..${STAGES}`);
  startLevel(ctx, room, kind, stage);
});

export const admin_stop_level = spacetimedb.reducer({ roomId: t.u32() }, (ctx, { roomId }) => {
  const room = getRoom(ctx, roomId);
  requireHost(ctx, room);
  const l = currentLevel(ctx, room);
  if (l && l.state === 'running') endLevel(ctx, room, l.id, 'skipped');
  clearAdvance(ctx, roomId);
});

export const admin_kick = spacetimedb.reducer({ who: t.identity() }, (ctx, { who }) => {
  const p = ctx.db.player.identity.find(who);
  if (!p) throw new SenderError('no such player');
  requireHost(ctx, getRoom(ctx, p.roomId));
  ctx.db.player.identity.delete(who);
  ctx.db.pointer.identity.delete(who);
  ctx.db.pointerRate.identity.delete(who);
  ctx.db.idle.identity.delete(who);
  ctx.db.playerStats.identity.delete(who);
  const until = ts(now(ctx) + 120n * MICROS);
  if (ctx.db.banned.identity.find(who)) ctx.db.banned.identity.update({ identity: who, until });
  else ctx.db.banned.insert({ identity: who, until });
  log(ctx, p.roomId, 'kick', hex(who), { name: p.name });
  refreshRoom(ctx, p.roomId);
  syncTickSchedule(ctx);
});

export const admin_reset_round = spacetimedb.reducer({ roomId: t.u32() }, (ctx, { roomId }) => {
  const room = getRoom(ctx, roomId);
  requireHost(ctx, room);
  const l = currentLevel(ctx, room);
  if (l && l.state === 'running') endLevel(ctx, room, l.id, 'skipped');
  clearAdvance(ctx, roomId);
  for (const p of [...ctx.db.player.roomId.filter(roomId)]) ctx.db.player.identity.update({ ...p, score: 0 });
  for (const a of [...ctx.db.award.roomId.filter(roomId)]) ctx.db.award.id.delete(a.id);
  for (const lv of [...ctx.db.level.roomId.filter(roomId)]) {
    ctx.db.levelSecret.levelId.delete(lv.id);
    ctx.db.level.id.delete(lv.id);
  }
  resetStats(ctx, roomId);
  ctx.db.room.id.update({ ...getRoom(ctx, roomId), levelId: 0n });
  resetCursorTo(ctx, roomId, WORLD_W / 2, WORLD_H / 2);
  log(ctx, roomId, 'round_reset', '', {});
  ensureStarted(ctx, getRoom(ctx, roomId));
});

/** Written by the LLM commentator worker (which claims admin with the passphrase). */
export const post_commentary = spacetimedb.reducer({ roomId: t.u32(), text: t.string() }, (ctx, { roomId, text }) => {
  requireAdmin(ctx);
  const room = getRoom(ctx, roomId);
  const clean = text.trim().slice(0, 280);
  if (!clean) return;
  ctx.db.commentary.insert({ id: 0n, roomId, at: ctx.timestamp, levelId: room.levelId, text: clean });
});
