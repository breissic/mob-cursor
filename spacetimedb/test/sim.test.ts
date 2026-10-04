import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  balloonStep,
  balloonsNow,
  capWeights,
  chairsStep,
  chaos,
  cursorPhysics,
  geometricMedian,
  ghostKey,
  inRect,
  integrate,
  keyAt,
  keyboardStep,
  LEVEL_ROTATION,
  makeBalloons,
  makeChairs,
  makeKeyboard,
  makeMaze,
  makeMines,
  makeMoles,
  makePotato,
  makeRedlight,
  moleStep,
  packGhosts,
  potatoInBucket,
  bucketPos,
  redlightStep,
  REDLIGHT_FREEZE_MS,
  unpackGhosts,
  revealCell,
  sha256Hex,
  shiftLevelTimes,
  targetPos,
  STAGE_SPECS,
  voteHover,
  voteLayout,
  voteResolve,
  VOTE_SECS,
  VOTE_START,
  WORLD_H,
  WORLD_W,
  type Pt,
} from '../src/sim.ts';

const pt = (id: string, x: number, y: number, team = 0, w = 1): Pt => ({ id, x, y, team, w });
const seeded = (s: number) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test('sha256 matches known vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('geometric median resists a single far troll', () => {
  const pts = [pt('a', 1, 1), pt('b', 1.1, 1), pt('c', 1, 1.1), pt('troll', 15, 8)];
  const med = geometricMedian(pts);
  const mean = aggregate('mean', pts, 1, '')!;
  assert.ok(Math.hypot(med.x - 1.03, med.y - 1.03) < 0.3, `median ${JSON.stringify(med)}`);
  assert.ok(mean.x > 4, 'mean is dragged by the troll');
});

test('capWeights caps any single share', () => {
  const w = capWeights([100, 1, 1, 1, 1], 0.25);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(w[0] <= 0.25 + 1e-9, `top weight ${w[0]}`);
});

test('tug weights teams equally regardless of size', () => {
  const pts = [pt('r1', 0, 0, 0), pt('r2', 0, 0, 0), pt('r3', 0, 0, 0), pt('b1', 10, 0, 1)];
  assert.equal(aggregate('tug', pts, 1, '')!.x, 5);
});

test('dictator rule follows the dictator only', () => {
  const pts = [pt('a', 1, 1), pt('boss', 9, 9)];
  assert.deepEqual(aggregate('dictator', pts, 1, 'boss'), { x: 9, y: 9 });
});

test('chaos: agreement ~0, opposition ~1', () => {
  assert.ok(chaos([pt('a', 10, 5), pt('b', 10, 5.1)], 5, 5) < 0.05);
  assert.ok(chaos([pt('a', 10, 5), pt('b', 0, 5)], 5, 5) > 0.95);
});

test('integrate converges to target and stays in bounds', () => {
  let b = { x: 8, y: 4.5, vx: 0, vy: 0 };
  for (let i = 0; i < 300; i++) b = integrate(b, { x: 12, y: 2 }, 1 / 15, 6, 4.5, 7);
  assert.ok(Math.hypot(b.x - 12, b.y - 2) < 0.05);
  for (let i = 0; i < 100; i++) b = integrate(b, { x: 100, y: -100 }, 1 / 15, 6, 4.5, 7);
  assert.ok(b.x <= 16 && b.y >= 0);
});

test('maze: goal reachable from start', () => {
  for (let s = 1; s < 20; s++) {
    const m = makeMaze(seeded(s));
    const seen = new Set<number>();
    const q = [m.start.r * m.cols + m.start.c];
    while (q.length) {
      const i = q.pop()!;
      if (seen.has(i) || m.tiles[i] === '#') continue;
      seen.add(i);
      const c = i % m.cols;
      const r = Math.floor(i / m.cols);
      if (c > 0) q.push(i - 1);
      if (c < m.cols - 1) q.push(i + 1);
      if (r > 0) q.push(i - m.cols);
      if (r < m.rows - 1) q.push(i + m.cols);
    }
    assert.ok(seen.has(m.goal.r * m.cols + m.goal.c), `seed ${s}`);
  }
});

test('minesweeper: first click is safe, mines are conserved, winnable', () => {
  const { params, progress, secret } = makeMines(seeded(7));
  const firstMine = secret.indexOf('1');
  const c = firstMine % params.cols;
  const r = Math.floor(firstMine / params.cols);
  const res = revealCell(params, progress, secret, c, r);
  assert.notEqual(res.result, 'mine');
  assert.equal([...res.secret].filter(b => b === '1').length, params.mines);
  // Reveal every safe cell -> won.
  let st = res;
  for (let i = 0; i < params.cols * params.rows; i++) {
    if (st.secret[i] === '0' && st.prog.cells[i] === '#') {
      st = revealCell(params, st.prog, st.secret, i % params.cols, Math.floor(i / params.cols));
    }
  }
  assert.equal(st.result, 'won');
});

test('minesweeper: first bomb after the safe opener explodes and loses, revealing all mines', () => {
  const { params, progress, secret } = makeMines(seeded(3));
  let st = revealCell(params, progress, secret, 0, 0);
  assert.notEqual(st.result, 'lost');
  const mine = [...st.secret].findIndex(b => b === '1');
  st = revealCell(params, st.prog, st.secret, mine % params.cols, Math.floor(mine / params.cols));
  assert.equal(st.result, 'lost');
  const shown = [...st.prog.cells].filter(c => c === '*' || c === 'm').length;
  assert.equal(shown, params.mines);
});

test('revealCell keeps extra progress fields (auto-click timer)', () => {
  const { params, progress, secret } = makeMines(seeded(5));
  const res = revealCell(params, { ...progress, nextAutoAt: 12345 }, secret, 0, 0);
  assert.equal(res.prog.nextAutoAt, 12345);
});

test('moving targets stay on the field; static targets do not move', () => {
  const p = { targets: [{ x: 1, y: 1, ph: 0 }, { x: 15, y: 8, ph: 2 }], r: 0.5, move: 1.6 };
  for (let t = 0; t < 60; t += 0.37)
    for (let i = 0; i < 2; i++) {
      const q = targetPos(p, i, t);
      assert.ok(q.x >= 0.6 && q.x <= 15.4 && q.y >= 0.6 && q.y <= 8.4);
    }
  assert.deepEqual(targetPos({ ...p, move: 0 }, 0, 10), { x: 1, y: 1 });
});

test('stage specs get harder', () => {
  const m = STAGE_SPECS.minesweeper;
  assert.ok(m[2].mines > m[1].mines && m[1].mines > m[0].mines);
  assert.ok(STAGE_SPECS.maze[2].cw > STAGE_SPECS.maze[0].cw);
});

test('ghost frame round-trips and rejects unknown formats', () => {
  const gs = [
    { key: 0xbeef, color: 3, team: 1, dictator: true, x: 0, y: 1 },
    { key: 7, color: 11, team: 0, dictator: false, x: 0.5, y: 0.25 },
  ];
  const back = unpackGhosts(packGhosts(gs));
  assert.equal(back.length, 2);
  assert.deepEqual({ ...back[0], x: 0, y: 1 }, gs[0]);
  assert.equal(back[0].y, 1);
  assert.ok(Math.abs(back[1].x - 0.5) < 1 / 255 && Math.abs(back[1].y - 0.25) < 1 / 255);
  assert.deepEqual(unpackGhosts(new Uint8Array([3, 1, 0, 128, 128])), []); // old 4-byte format
  assert.deepEqual(unpackGhosts(new Uint8Array(0)), []);
});

test('ghost keys are stable and spread out', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `c200${(i * 2654435761 >>> 0).toString(16).padStart(60, '0')}`);
  assert.equal(ghostKey(ids[0]), ghostKey(ids[0]));
  const keys = new Set(ids.map(ghostKey));
  assert.ok(keys.size >= 198, `only ${keys.size} distinct keys for 200 ids`);
  for (const k of keys) assert.ok(k >= 0 && k <= 0xffff);
});

test('picker: one card per playable game, cards fit the field and do not overlap, start spot is outside every card', () => {
  const cards = voteLayout(LEVEL_ROTATION);
  assert.equal(cards.length, LEVEL_ROTATION.length);
  assert.deepEqual(
    cards.map(c => c.kind),
    [...LEVEL_ROTATION]
  );
  for (const c of cards) {
    assert.ok(c.x >= 0 && c.x + c.w <= WORLD_W && c.y >= 0 && c.y + c.h <= WORLD_H, JSON.stringify(c));
    assert.ok(c.w > 2 && c.h > 2, 'cards are big enough to read');
    assert.ok(!inRect(c, VOTE_START.x, VOTE_START.y));
  }
  for (const a of cards)
    for (const b of cards)
      if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'cards overlap');
  // Small sets still lay out in one row.
  assert.equal(new Set(voteLayout(['targets', 'maze', 'minesweeper']).map(c => c.y)).size, 1);
});

test('picker: hover is geometric; only the card containing the cursor, nothing in a gap', () => {
  const cards = voteLayout(LEVEL_ROTATION);
  for (const c of cards) assert.equal(voteHover(cards, c.x + c.w / 2, c.y + c.h / 2), c);
  // The gap between the first two cards, and the start strip above the cards.
  assert.equal(voteHover(cards, cards[0].x + cards[0].w + 0.01, cards[0].y + 1), null);
  assert.equal(voteHover(cards, VOTE_START.x, VOTE_START.y), null);
  // Edge of a card counts as inside; one unit past its corner does not.
  assert.equal(voteHover(cards, cards[2].x, cards[2].y), cards[2]);
  assert.equal(voteHover(cards, cards[0].x - 0.05, cards[0].y), null);
});

test('picker: timer end inside a card picks that game; in a gap it restarts the 5 s timer and picks nothing', () => {
  const p = { cards: voteLayout(LEVEL_ROTATION) };
  const prog = { endsAt: 10_000, restarts: 0 };
  const c = p.cards[4];
  const r1 = voteResolve(p, prog, c.x + 0.2, c.y + 0.2, 10_000);
  assert.ok('chosen' in r1 && r1.chosen.kind === c.kind);
  const r2 = voteResolve(p, prog, VOTE_START.x, VOTE_START.y, 10_000);
  assert.ok(!('chosen' in r2));
  if (!('chosen' in r2)) {
    assert.equal(r2.prog.endsAt, 10_000 + VOTE_SECS * 1000);
    assert.equal(r2.prog.restarts, 1);
    assert.equal(VOTE_SECS, 5);
    // A second miss restarts again from the new deadline.
    const r3 = voteResolve(p, r2.prog, 0.1, 0.1, r2.prog.endsAt);
    assert.ok(!('chosen' in r3) && r3.prog.endsAt === r2.prog.endsAt + 5000 && r3.prog.restarts === 2);
  }
});

// ---------------------------------------------------------------------------
// New minigames
// ---------------------------------------------------------------------------

const still = (x: number, y: number) => ({ x, y, vx: 0, vy: 0 });

test('redlight: moving past the dead-band on red is a fault that snaps the cursor to the start; green is free', () => {
  const sp = STAGE_SPECS.redlight[0];
  const { params: p, progress: p0 } = makeRedlight(seeded(1), sp, 1000);
  assert.equal(p0.light, 'green');
  // Green: run freely, no fault.
  let r = redlightStep(p, p0, still(5, 4.5), 1500, seeded(2));
  assert.equal(r.events.length, 0);
  assert.equal(r.body.x, 5);
  assert.equal(r.prog, p0, 'unchanged progress is the same object');
  // Flip to red.
  r = redlightStep(p, p0, still(5, 4.5), p0.flipAt, seeded(2));
  assert.deepEqual(r.events, ['red']);
  assert.equal(r.prog.light, 'red');
  assert.equal(r.prog.anchor, null);
  const red = r.prog;
  // Within the grace period nothing is armed, even if we move.
  r = redlightStep(p, red, still(6, 4.5), red.litAt + sp.graceMs - 1, seeded(2));
  assert.equal(r.prog.anchor, null);
  // Grace over: the anchor is set where the cursor is...
  r = redlightStep(p, red, still(6, 4.5), red.litAt + sp.graceMs, seeded(2));
  assert.deepEqual(r.prog.anchor, { x: 6, y: 4.5 });
  const armed = r.prog;
  // ...a wiggle inside the dead-band is fine...
  r = redlightStep(p, armed, still(6 + sp.deadband * 0.9, 4.5), armed.litAt + sp.graceMs + 50, seeded(2));
  assert.equal(r.events.length, 0);
  assert.equal(r.prog.faults, 0);
  // ...but moving further is a fault: back to the start, frozen for a moment.
  const t = armed.litAt + sp.graceMs + 100;
  r = redlightStep(p, armed, still(6 + sp.deadband * 1.5, 4.5), t, seeded(2));
  assert.deepEqual(r.events, ['fault']);
  assert.equal(r.prog.faults, 1);
  assert.deepEqual({ x: r.body.x, y: r.body.y }, p.start);
  assert.equal(r.prog.frozenUntil, t + REDLIGHT_FREEZE_MS);
  // While frozen the body is pinned at the start whatever the spring says.
  const r2 = redlightStep(p, r.prog, still(9, 2), t + 100, seeded(2));
  assert.deepEqual({ x: r2.body.x, y: r2.body.y }, p.start);
  assert.equal(r2.events.length, 0);
  // Crossing the finish line wins.
  const win = redlightStep(p, p0, still(p.finishX + 0.1, 4.5), 1500, seeded(2));
  assert.ok(win.won);
  // Stages get harder.
  const s = STAGE_SPECS.redlight;
  assert.ok(s[2].deadband < s[0].deadband && s[2].flipMaxS < s[0].flipMaxS && s[2].faults <= s[0].faults);
});

test('balloon: a hand under the balloon pops it back up (save); hitting the floor is a drop that respawns it', () => {
  const sp = STAGE_SPECS.balloon[0];
  const { params: p, progress: p0 } = makeBalloons(seeded(3), sp, 0);
  assert.equal(p0.balloons.length, 1);
  // Nothing in reach: no event, same progress object.
  const idle = balloonStep(p, p0, 100, { x: 0.5, y: 8.5 }, seeded(4));
  assert.equal(idle.prog, p0);
  assert.equal(idle.events.length, 0);
  // It falls under gravity.
  const [falling] = balloonsNow(p, p0, 1000);
  assert.ok(falling.y > p0.balloons[0].y && falling.vy > 0);
  // Hand just below the balloon, within reach: save.
  const b = balloonsNow(p, p0, 1000)[0];
  const save = balloonStep(p, p0, 1000, { x: b.x, y: b.y + p.r + p.handR * 0.5 }, seeded(4));
  assert.equal(save.events.length, 1);
  assert.equal(save.events[0].kind, 'save');
  assert.equal(save.prog.saves, 1);
  assert.equal(save.prog.drops, 0);
  assert.equal(save.prog.at, 1000);
  assert.ok(save.prog.balloons[0].vy < 0, 'balloon is going up again');
  // A hand ABOVE the balloon does nothing.
  const above = balloonStep(p, p0, 1000, { x: b.x, y: b.y - p.r - 0.1 }, seeded(4));
  assert.equal(above.events.length, 0);
  // Let it fall until it hits the floor: drop + respawn near the top.
  const tFall = 1000 + Math.ceil(Math.sqrt((2 * (WORLD_H - p.r - b.y)) / p.gravity) * 1000) + 50;
  const drop = balloonStep(p, p0, tFall, { x: 0.5, y: 0.5 }, seeded(4));
  assert.equal(drop.events[0]?.kind, 'drop');
  assert.equal(drop.prog.drops, 1);
  assert.ok(drop.prog.balloons[0].y < 2, 'respawned at the top');
  // Stage 3 has two balloons and wind.
  const s3 = makeBalloons(seeded(5), STAGE_SPECS.balloon[2], 0);
  assert.equal(s3.progress.balloons.length, 2);
  assert.ok(s3.params.wind > 0 && STAGE_SPECS.balloon[0].wind === 0);
});

test('mole: cursor inside the hole when the window ends scores, outside is a miss, then the next mole pops up elsewhere', () => {
  const sp = STAGE_SPECS.mole[0];
  const { params: p, progress: p0 } = makeMoles(sp, 0);
  assert.equal(p.holes.length, sp.holes);
  assert.equal(p0.up, -1);
  // Before the gap ends nothing happens.
  assert.equal(moleStep(p, p0, p0.until - 1, { x: 0, y: 0 }, seeded(6)).prog, p0);
  // Gap over: a mole pops up for upMs.
  const up = moleStep(p, p0, p0.until, { x: 0, y: 0 }, seeded(6));
  assert.equal(up.event, 'up');
  assert.ok(up.prog.up >= 0 && up.prog.up < sp.holes);
  assert.equal(up.prog.until, p0.until + sp.upMs);
  const hole = p.holes[up.prog.up];
  // Still up: no change yet even if we sit on it.
  assert.equal(moleStep(p, up.prog, up.prog.until - 1, hole, seeded(6)).prog, up.prog);
  // Window ends with the cursor inside the hole: hit.
  const hit = moleStep(p, up.prog, up.prog.until, { x: hole.x + p.r * 0.5, y: hole.y }, seeded(6));
  assert.equal(hit.event, 'hit');
  assert.equal(hit.prog.score, 1);
  assert.equal(hit.prog.misses, 0);
  assert.equal(hit.prog.up, -1);
  // Window ends with the cursor elsewhere: miss.
  const miss = moleStep(p, up.prog, up.prog.until, { x: hole.x + p.r * 2, y: hole.y }, seeded(6));
  assert.equal(miss.event, 'miss');
  assert.equal(miss.prog.misses, 1);
  assert.equal(miss.prog.score, 0);
  // The next mole never uses the same hole twice in a row.
  for (let s = 0; s < 20; s++) {
    const next = moleStep(p, hit.prog, hit.prog.until, { x: 0, y: 0 }, seeded(s));
    assert.notEqual(next.prog.up, hit.prog.last);
  }
  const m = STAGE_SPECS.mole;
  assert.ok(m[2].holes > m[0].holes && m[2].upMs < m[0].upMs);
});

test('potato: in the bucket when the fuse hits zero wins, outside loses; the bucket wanders in later stages', () => {
  const { params: p, progress } = makePotato(seeded(7), STAGE_SPECS.potato[0], 5000);
  assert.equal(progress.fuseAt, 5000 + STAGE_SPECS.potato[0].fuseS * 1000);
  assert.ok(Math.hypot(p.bucket.x - WORLD_W / 2, p.bucket.y - WORLD_H / 2) >= 4, 'bucket is away from the start');
  const b = bucketPos(p, 3);
  assert.deepEqual(b, p.bucket, 'stage 1 bucket is static');
  assert.ok(potatoInBucket(p, 3, b.x + p.r * 0.7, b.y));
  assert.ok(!potatoInBucket(p, 3, b.x + p.r * 1.2, b.y));
  const p3 = makePotato(seeded(8), STAGE_SPECS.potato[2], 0).params;
  assert.ok(p3.move > 0 && p3.fuseS < p.fuseS && p3.r < p.r);
  const a = bucketPos(p3, 0);
  const c = bucketPos(p3, 2);
  assert.ok(Math.hypot(a.x - c.x, a.y - c.y) > 0.2, 'stage 3 bucket moves');
  for (let t = 0; t < 30; t += 0.7) {
    const q = bucketPos(p3, t);
    assert.ok(q.x >= p3.r && q.x <= WORLD_W - p3.r && q.y >= p3.r && q.y <= WORLD_H - p3.r, 'bucket stays on the field');
  }
});

test('chairs: at stopAt the cursor must be on a chair; that chair goes, the music restarts, the last chair wins', () => {
  const sp = STAGE_SPECS.chairs[0];
  const { params: p, progress: p0 } = makeChairs(seeded(9), sp, 0);
  assert.equal(p.chairs.length, sp.chairs);
  assert.equal(p0.left.length, sp.chairs);
  for (const c of p.chairs) assert.ok(c.x >= 0 && c.x + c.w <= WORLD_W && c.y >= 0 && c.y + c.h <= WORLD_H);
  // Music still playing: nothing happens wherever the cursor is.
  assert.equal(chairsStep(p, p0, p0.stopAt - 1, { x: 0, y: 0 }, seeded(1)).event, null);
  // Music stops with the cursor in a gap: lost.
  assert.equal(chairsStep(p, p0, p0.stopAt, { x: WORLD_W / 2, y: WORLD_H / 2 }, seeded(1)).event, 'lost');
  // Music stops with the cursor on chair 0: safe, chair 0 removed, new stopAt after the pause.
  const c0 = p.chairs[0];
  const safe = chairsStep(p, p0, p0.stopAt, { x: c0.x + c0.w / 2, y: c0.y + c0.h / 2 }, seeded(1));
  assert.equal(safe.event, 'safe');
  assert.deepEqual(safe.prog.left, [1, 2, 3]);
  assert.equal(safe.prog.sat, 0);
  assert.equal(safe.prog.round, 2);
  assert.ok(safe.prog.stopAt >= p0.stopAt + p.pauseMs + sp.musicMinS * 1000);
  assert.ok(safe.prog.stopAt <= p0.stopAt + p.pauseMs + sp.musicMaxS * 1000);
  // The removed chair no longer counts as a seat.
  assert.equal(chairsStep(p, safe.prog, safe.prog.stopAt, { x: c0.x + c0.w / 2, y: c0.y + c0.h / 2 }, seeded(1)).event, 'lost');
  // Down to the last chair: sitting on it wins.
  const last = { ...safe.prog, left: [2] };
  const c2 = p.chairs[2];
  assert.equal(chairsStep(p, last, last.stopAt, { x: c2.x + 0.1, y: c2.y + 0.1 }, seeded(1)).event, 'won');
  const s = STAGE_SPECS.chairs;
  assert.ok(s[2].warnS < s[0].warnS && s[2].w < s[0].w && s[2].chairs > s[0].chairs);
});

test('keyboard: dwelling on the next letter types it, a wrong key buzzes once and does not advance', () => {
  const sp = STAGE_SPECS.keyboard[0];
  const { params: p, progress: p0 } = makeKeyboard(seeded(10), sp);
  assert.ok(sp.words.includes(p.word as (typeof sp.words)[number]));
  assert.equal(p.keys.length, 26);
  for (const k of p.keys) assert.ok(k.x >= 0 && k.x + k.w <= WORLD_W && k.y >= 0 && k.y + k.h <= WORLD_H);
  const key = (ch: string) => {
    const k = p.keys.find(k => k.ch === ch)!;
    return { x: k.x + k.w / 2, y: k.y + k.h / 2 };
  };
  const first = p.word[0];
  const wrong = first === 'Q' ? 'P' : 'Q';
  assert.equal(keyAt(p.keys, key(first).x, key(first).y)?.ch, first);
  assert.equal(keyAt(p.keys, WORLD_W / 2, 0.5), null, 'word strip is not a key');
  // Enter the right key: timer starts, nothing typed yet.
  let r = keyboardStep(p, p0, 1000, key(first));
  assert.equal(r.event, null);
  assert.equal(r.prog.onKey, first);
  assert.equal(r.prog.since, 1000);
  // Just short of the dwell: still nothing.
  r = keyboardStep(p, r.prog, 1000 + p.dwellMs - 1, key(first));
  assert.equal(r.event, null);
  assert.equal(r.prog.next, 0);
  // Dwell reached: typed.
  r = keyboardStep(p, r.prog, 1000 + p.dwellMs, key(first));
  assert.equal(r.event, 'key');
  assert.equal(r.prog.next, 1);
  assert.equal(r.won, p.word.length === 1);
  // Staying parked on the typed key does not buzz (it already fired).
  r = keyboardStep(p, r.prog, 1000 + p.dwellMs * 3, key(first));
  assert.equal(r.event, null);
  // Wrong key: dwell -> one buzz, no advance, then quiet until the cursor leaves.
  let w = keyboardStep(p, p0, 2000, key(wrong));
  w = keyboardStep(p, w.prog, 2000 + p.dwellMs, key(wrong));
  assert.equal(w.event, 'buzz');
  assert.equal(w.prog.next, 0);
  assert.equal(w.prog.buzzes, 1);
  w = keyboardStep(p, w.prog, 2000 + p.dwellMs * 4, key(wrong));
  assert.equal(w.event, null);
  assert.equal(w.prog.buzzes, 1);
  // Leaving and coming back re-arms it.
  w = keyboardStep(p, w.prog, 9000, { x: WORLD_W / 2, y: 0.5 });
  assert.equal(w.prog.onKey, '');
  w = keyboardStep(p, w.prog, 9100, key(wrong));
  w = keyboardStep(p, w.prog, 9100 + p.dwellMs, key(wrong));
  assert.equal(w.prog.buzzes, 2);
  // Spell the whole word: won on the last letter.
  let s = p0;
  let t = 20000;
  for (const ch of p.word) {
    s = keyboardStep(p, s, t, { x: WORLD_W / 2, y: 0.5 }).prog; // leave
    s = keyboardStep(p, s, t + 10, key(ch)).prog; // enter
    const done = keyboardStep(p, s, t + 10 + p.dwellMs, key(ch));
    assert.equal(done.event, 'key');
    s = done.prog;
    t += 5000;
    if (s.next === p.word.length) assert.ok(done.won);
  }
  assert.equal(s.next, p.word.length);
  const ks = STAGE_SPECS.keyboard;
  assert.ok(ks[2].dwellMs < ks[0].dwellMs && Math.min(...ks[2].words.map(w => w.length)) > Math.max(...ks[0].words.map(w => w.length)));
});

test('keyboard: double letters need a second dwell on the same key', () => {
  const { params } = makeKeyboard(seeded(10), STAGE_SPECS.keyboard[0]);
  const p = { ...params, word: 'LL' };
  const l = p.keys.find(k => k.ch === 'L')!;
  const at = { x: l.x + l.w / 2, y: l.y + l.h / 2 };
  let r = keyboardStep(p, { next: 0, onKey: '', since: 0, pressed: false, buzzes: 0 }, 0, at);
  r = keyboardStep(p, r.prog, p.dwellMs, at);
  assert.equal(r.prog.next, 1);
  r = keyboardStep(p, r.prog, p.dwellMs + 1, at);
  assert.equal(r.event, null, 'not instantly typed twice');
  r = keyboardStep(p, r.prog, p.dwellMs * 2, at);
  assert.equal(r.event, 'key');
  assert.ok(r.won);
});

test('resume: every wall-clock timer in progress shifts by the pause, zero/missing ones do not', () => {
  const shifted = shiftLevelTimes({ flipAt: 1000, litAt: 900, frozenUntil: 0, faults: 2, at: 500, stopAt: 2000, since: 0, endsAt: 7000 }, 250);
  assert.deepEqual(shifted, { flipAt: 1250, litAt: 1150, frozenUntil: 0, faults: 2, at: 750, stopAt: 2250, since: 0, endsAt: 7250 });
});

test('picker rounds run a stronger spring, everything else the config spring', () => {
  const cfg = { gain: 40, damping: 12, maxSpeed: 20 };
  assert.deepEqual(cursorPhysics('maze', cfg), cfg);
  assert.deepEqual(cursorPhysics(undefined, cfg), cfg);
  const v = cursorPhysics('vote', cfg);
  assert.ok(v.gain > cfg.gain && v.damping > cfg.damping && v.maxSpeed > cfg.maxSpeed);
});
