import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  autoClickMs,
  balloonStep,
  balloonsNow,
  bucketPos,
  capWeights,
  chairRing,
  chairsStep,
  chaos,
  cursorPhysics,
  dampingMax,
  DEFAULT_ROOM_CODE,
  dollPos,
  dollS,
  FAKE_MS,
  gainMax,
  geometricMedian,
  ghostKey,
  HUNT_BARS,
  HUNT_METER_MS,
  huntHeat,
  huntStep,
  inRect,
  integrate,
  isPlayKind,
  keyAt,
  KEYBOARD_PHRASES,
  keyboardStep,
  LEVEL_ROTATION,
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
  makeValves,
  MAX_PLAYERS_CEILING,
  MAX_ROOMS_CEILING,
  MODE_SETTINGS,
  moleStep,
  normalizeRoomCode,
  packGhosts,
  pathLength,
  pathPos,
  pointerHzFor,
  potatoInBucket,
  potatoStep,
  redlightPath,
  redlightStep,
  REDLIGHT_TOP,
  revealCell,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LEN,
  sanitizeSettings,
  settingsFor,
  sha256Hex,
  shiftLevelTimes,
  stageSeconds,
  stageSpec,
  STAGES,
  stationsStep,
  targetPos,
  targetsStep,
  STATION_SLACK,
  unpackGhosts,
  valveLevelsNow,
  valvesStep,
  voteHover,
  voteLayout,
  voteResolve,
  VOTE_SECS,
  pickCards,
  PICK_CARDS,
  postIntegrate,
  WRONG_MS,
  makeEcho,
  echoStep,
  echoLit,
  makeCrane,
  craneStep,
  craneMarkerX,
  craneHeight,
  makeSpotlight,
  spotlightStep,
  spotPos,
  spotHp,
  decoyPos,
  makeSheep,
  sheepStep,
  sheepAt,
  makeIce,
  iceStep,
  makePlank,
  plankStep,
  plankFill,
  makeSeesaw,
  seesawStep,
  makeBelts,
  beltsStep,
  beltCell,
  beltDir,
  beltsReversed,
  makeNeedle,
  needleStep,
  needleGapY,
  NEEDLE_TOP,
  makeWires,
  wiresStep,
  stationsRevealed,
  dist,
  VOTE_START,
  WORLD_H,
  WORLD_W,
  type Pt,
} from '../src/sim.ts';

const pt = (id: string, x: number, y: number, team = 0, w = 1): Pt => ({ id, x, y, team, w });
const seeded = (s: number) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const still = (x: number, y: number) => ({ x, y, vx: 0, vy: 0 });

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

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

test('integrate converges to target and stays in bounds', () => {
  let b = { x: 8, y: 4.5, vx: 0, vy: 0 };
  for (let i = 0; i < 300; i++) b = integrate(b, { x: 12, y: 2 }, 1 / 15, 6, 4.5, 7);
  assert.ok(Math.hypot(b.x - 12, b.y - 2) < 0.05);
  for (let i = 0; i < 100; i++) b = integrate(b, { x: 100, y: -100 }, 1 / 15, 6, 4.5, 7);
  assert.ok(b.x <= 16 && b.y >= 0);
});

/** Run a 1-D step response and report whether it ever reversed direction (bounced) and how close it settled. */
function stepResponse(dt: number, gain: number, damping: number, maxSpeed: number, ticks = 400) {
  let b = { x: 2, y: 4.5, vx: 0, vy: 0 };
  let reversals = 0;
  let prevV = 0;
  let maxX = 2;
  for (let i = 0; i < ticks; i++) {
    b = integrate(b, { x: 10, y: 4.5 }, dt, gain, damping, maxSpeed);
    if (prevV > 1e-6 && b.vx < -1e-6) reversals++;
    if (Math.abs(b.vx) > 1e-6) prevV = b.vx;
    maxX = Math.max(maxX, b.x);
  }
  return { b, reversals, overshoot: maxX - 10 };
}

test('damping never bounces: at every tick rate, critically-or-over-damped springs settle with no reversal right up to the slider max', () => {
  for (const hz of [5, 10, 15, 20, 30]) {
    const dt = 1 / hz;
    const dMax = dampingMax(hz);
    // Explicit Euler explodes once damping*dt > 2; the exact integrator must be calm right up to the slider max.
    assert.ok(dMax * dt >= 1.9, `slider max ${dMax} at ${hz} Hz covers the range Euler could not`);
    const gain = Math.min(40, gainMax(hz));
    const crit = 2 * Math.sqrt(gain);
    assert.ok(crit <= dMax, `critical damping ${crit} is reachable on the slider at ${hz} Hz`);
    for (const damping of [crit, (crit + dMax) / 2, dMax]) {
      const r = stepResponse(dt, gain, damping, 20);
      assert.ok(Number.isFinite(r.b.x) && Math.abs(r.b.x - 10) < 0.05, `settles at ${hz} Hz, damping ${damping}: ${r.b.x}`);
      assert.equal(r.reversals, 0, `no bounce at ${hz} Hz, damping ${damping}`);
      assert.ok(r.overshoot <= 1e-6, `no overshoot at ${hz} Hz, damping ${damping}: ${r.overshoot}`);
    }
    // Any damping on the slider stays bounded and converges (an under-damped spring may wobble, it never diverges).
    for (const damping of [0.5, dMax * 0.25, dMax * 0.5]) {
      const r = stepResponse(dt, gain, damping, 20, 1500);
      assert.ok(Number.isFinite(r.b.x) && Math.abs(r.b.x - 10) < 0.5, `bounded at ${hz} Hz, damping ${damping}: ${r.b.x}`);
    }
  }
});

test('damping is monotonic: higher = heavier (less overshoot, slower), lower = looser', () => {
  const loose = stepResponse(1 / 15, 40, 3, 50, 120);
  const heavy = stepResponse(1 / 15, 40, 12, 50, 120);
  assert.ok(loose.overshoot > heavy.overshoot, `loose overshoots more (${loose.overshoot} vs ${heavy.overshoot})`);
  // The heavy spring still arrives.
  assert.ok(Math.abs(heavy.b.x - 10) < 0.05);
  // A very loose spring still never diverges (velocity is bounded by maxSpeed and the exact decay).
  for (let i = 0; i < 2000; i++) {
    const r = stepResponse(1 / 30, gainMax(30), 0.5, 20, 50);
    assert.ok(Number.isFinite(r.b.x));
    break;
  }
});

test('gain cap keeps the spring resolvable at the configured tick rate', () => {
  for (const hz of [5, 15, 30]) {
    const r = stepResponse(1 / hz, gainMax(hz), dampingMax(hz), 50, 600);
    assert.ok(Math.abs(r.b.x - 10) < 0.05, `max gain + max damping settles at ${hz} Hz: ${r.b.x}`);
    assert.equal(r.reversals, 0);
  }
  assert.ok(gainMax(30) > gainMax(15) && gainMax(15) > gainMax(5));
});

test('picker rounds run a stronger spring, everything else the config spring', () => {
  const cfg = { gain: 40, damping: 12, maxSpeed: 20 };
  assert.deepEqual(cursorPhysics('maze', cfg), cfg);
  assert.deepEqual(cursorPhysics(undefined, cfg), cfg);
  const v = cursorPhysics('vote', cfg);
  assert.ok(v.gain > cfg.gain && v.damping > cfg.damping && v.maxSpeed > cfg.maxSpeed);
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

test('room codes: short, unambiguous alphabet, normalized on input; the default room has a fixed code', () => {
  for (let s = 0; s < 50; s++) {
    const c = makeRoomCode(seeded(s));
    assert.equal(c.length, ROOM_CODE_LEN);
    for (const ch of c) assert.ok(ROOM_CODE_ALPHABET.includes(ch), `${c} uses only the room alphabet`);
  }
  assert.ok(!ROOM_CODE_ALPHABET.includes('O') && !ROOM_CODE_ALPHABET.includes('0') && !ROOM_CODE_ALPHABET.includes('I') && !ROOM_CODE_ALPHABET.includes('1'));
  assert.equal(normalizeRoomCode('  ab-cd '), 'ABCD');
  assert.equal(normalizeRoomCode('lobby'), DEFAULT_ROOM_CODE);
  assert.equal(normalizeRoomCode(''), '');
  assert.equal(normalizeRoomCode('x'.repeat(40)).length, 8);
});

test('pointer budget is per room: a full room gets a smaller per-client rate, an empty one the cap; ceilings are 200/200', () => {
  assert.equal(pointerHzFor(15, 400, 0), 15);
  assert.equal(pointerHzFor(15, 400, 10), 15);
  assert.ok(Math.abs(pointerHzFor(15, 400, 100) - 4) < 1e-9);
  assert.ok(pointerHzFor(15, 400, 200) >= 1, 'never below 1 Hz');
  assert.equal(MAX_ROOMS_CEILING, 200);
  assert.equal(MAX_PLAYERS_CEILING, 200);
});

// ---------------------------------------------------------------------------
// Per-mode settings and stage hardening
// ---------------------------------------------------------------------------

test('every playable mode has settings with labels, a stage-1 default inside its range, and party-length stages', () => {
  for (const kind of LEVEL_ROTATION) {
    assert.ok(isPlayKind(kind));
    const defs = MODE_SETTINGS[kind];
    assert.ok(defs.length > 0, `${kind} has settings`);
    for (const d of defs) {
      assert.ok(d.label && d.up, `${kind}.${d.key} says what raising it does`);
      assert.ok(d.min <= d.def && d.def <= d.max, `${kind}.${d.key} default in range`);
      assert.ok(d.step > 0);
    }
    for (let stage = 1; stage <= STAGES; stage++) {
      const secs = stageSeconds(kind, stageSpec(kind, stage));
      assert.ok(secs >= 45 && secs <= 200, `${kind} stage ${stage} lasts ${secs}s`);
    }
  }
  assert.ok(!isPlayKind('vote') && !isPlayKind('lobby') && !isPlayKind(undefined));
});

test('saved settings overlay the defaults: unknown keys dropped, values clamped and snapped, bad JSON ignored', () => {
  const d = settingsFor('redlight');
  assert.equal(d.leash, 1.6);
  const s = settingsFor('redlight', JSON.stringify({ leash: 99, rewind: 1.26, bogus: 5, faults: 'x' }));
  assert.equal(s.leash, 4, 'clamped to max');
  assert.equal(s.rewind, 1.5, 'snapped to step');
  assert.equal(s.faults, d.faults, 'non-numbers fall back');
  assert.equal((s as Record<string, unknown>).bogus, undefined);
  assert.deepEqual(settingsFor('redlight', '{not json'), d);
  assert.deepEqual(sanitizeSettings('mole', { holes: 100, upMs: 1000, nope: 1 }), { holes: 12, upMs: 1000 });
});

test('stages 2 and 3 get harder on top of whatever stage 1 is set to', () => {
  const harder: Record<string, (a: Record<string, number>, b: Record<string, number>) => boolean> = {
    targets: (a, b) => b.n > a.n && b.r < a.r && b.strikes <= a.strikes,
    maze: (a, b) => b.cw > a.cw && b.ch >= a.ch && b.bonks < a.bonks,
    minesweeper: (a, b) => b.mines > a.mines && b.autoMaxS < a.autoMaxS,
    redlight: (a, b) => b.leash < a.leash && b.greenMaxS < a.greenMaxS && b.rewind > a.rewind && b.faults <= a.faults && b.fakeP > a.fakeP,
    balloon: (a, b) => b.gravity > a.gravity && b.saves > a.saves,
    mole: (a, b) => b.holes > a.holes && b.upMs < a.upMs && b.target > a.target,
    potato: (a, b) => b.rounds > a.rounds && b.fuseS < a.fuseS && b.r < a.r && b.move > a.move,
    chairs: (a, b) => b.chairs > a.chairs && b.w < a.w && b.warnS < a.warnS,
    keyboard: (a, b) => b.dwellMs < a.dwellMs && b.typos < a.typos,
    hunt: (a, b) => b.finds > a.finds && b.radius < a.radius && b.dwellS > a.dwellS && b.decoys > a.decoys && b.traps <= a.traps,
    valves: (a, b) => b.valves > a.valves && b.drift > a.drift && b.holdS > a.holdS,
    stations: (a, b) => b.stations > a.stations && b.dwellS < a.dwellS && b.skips <= a.skips && b.revealS < a.revealS,
    echo: (a, b) => b.pads >= a.pads && b.rounds > a.rounds && b.dwellMs < a.dwellMs && b.showMs < a.showMs,
    crane: (a, b) => b.periodS < a.periodS && b.tol < a.tol && b.target > a.target,
    spotlight: (a, b) => b.radius < a.radius && b.speed > a.speed && b.lanes >= a.lanes,
    sheep: (a, b) => b.n > a.n && b.wander > a.wander && b.penW < a.penW,
    ice: (a, b) => b.gates > a.gates && b.r < a.r && b.slide > a.slide,
    plank: (a, b) => b.tiles > a.tiles && b.deadband < a.deadband && b.shove >= a.shove,
    seesaw: (a, b) => b.mass > a.mass && b.pocketW < a.pocketW && b.target > a.target,
    belts: (a, b) => b.beltCols > a.beltCols && b.speed > a.speed && b.hazards > a.hazards,
    needle: (a, b) => b.walls > a.walls && b.gapH < a.gapH && b.periodS < a.periodS,
    wires: (a, b) => b.order > a.order && b.dwellMs < a.dwellMs && b.decoys > a.decoys,
  };
  for (const kind of LEVEL_ROTATION) {
    const s1 = stageSpec(kind, 1);
    const s2 = stageSpec(kind, 2);
    const s3 = stageSpec(kind, 3);
    assert.deepEqual(s1, settingsFor(kind), `${kind} stage 1 is exactly the defaults`);
    assert.ok(harder[kind](s1, s2), `${kind}: stage 2 harder than 1`);
    assert.ok(harder[kind](s2, s3), `${kind}: stage 3 harder than 2`);
    // Hardening respects the admin's stage-1 choice.
    const custom = { ...s1 };
    const def = MODE_SETTINGS[kind].find(d => d.def !== d.min)!;
    custom[def.key] = def.min;
    const c3 = stageSpec(kind, 3, custom);
    assert.notDeepEqual(c3, s3, `${kind}: custom base changes stage 3`);
  }
  // Min/max pairs never invert even if the admin crosses them.
  const sp = stageSpec('redlight', 3, { ...settingsFor('redlight'), greenMinS: 10, greenMaxS: 1 });
  assert.ok(sp.greenMaxS >= sp.greenMinS);
});

// ---------------------------------------------------------------------------
// Classic modes
// ---------------------------------------------------------------------------

test('maze: goal reachable from start at every stage size', () => {
  for (let s = 1; s < 12; s++)
    for (let stage = 1; stage <= 3; stage++) {
      const sp = stageSpec('maze', stage);
      const m = makeMaze(seeded(s), sp.cw, sp.ch, sp.bonks);
      assert.equal(m.bonkCap, sp.bonks);
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
      assert.ok(seen.has(m.goal.r * m.cols + m.goal.c), `seed ${s} stage ${stage}`);
    }
});

test('targets: every stage is a real trip (each target far from the previous one), moving targets stay on the field', () => {
  for (let stage = 1; stage <= 3; stage++) {
    const sp = stageSpec('targets', stage);
    const p = makeTargets(seeded(stage), sp.n, sp.r, sp.move);
    assert.equal(p.targets.length, sp.n);
    let prev = { x: WORLD_W / 2, y: WORLD_H / 2 };
    for (const tg of p.targets) {
      assert.ok(Math.hypot(tg.x - prev.x, tg.y - prev.y) > 3, 'targets are spread out');
      prev = tg;
    }
    for (let t = 0; t < 60; t += 0.37)
      for (let i = 0; i < p.targets.length; i++) {
        const q = targetPos(p, i, t);
        assert.ok(q.x >= 0.6 && q.x <= 15.4 && q.y >= 0.6 && q.y <= 8.4);
      }
  }
  const p = { targets: [{ x: 1, y: 1, ph: 0 }], r: 0.5, move: 0, strikeCap: 3 };
  assert.deepEqual(targetPos(p, 0, 10), { x: 1, y: 1 });
});

test('targets: touching the wrong number is a strike (once per visit), targets never overlap, the right one hits', () => {
  for (let stage = 1; stage <= 3; stage++) {
    const sp = stageSpec('targets', stage);
    const p = makeTargets(seeded(20 + stage), sp.n, sp.r, sp.move, sp.strikes);
    assert.equal(p.strikeCap, sp.strikes);
    for (let i = 0; i < p.targets.length; i++)
      for (let j = i + 1; j < p.targets.length; j++)
        assert.ok(Math.hypot(p.targets[i].x - p.targets[j].x, p.targets[i].y - p.targets[j].y) > 2 * p.r, 'no target hides under another');
  }
  const p = makeTargets(seeded(21), 5, 0.6, 0, 2);
  const p0 = { next: 0, strikes: 0, on: -1 };
  const nowhere = { x: -5, y: -5 };
  assert.equal(targetsStep(p, p0, 0, nowhere).prog, p0, 'nothing touched: same object');
  // Sit on #3 while #1 is wanted: one strike, and staying there does not stack.
  let r = targetsStep(p, p0, 0, p.targets[2]);
  assert.equal(r.event, 'zap');
  assert.equal(r.prog.strikes, 1);
  assert.equal(r.prog.on, 2);
  assert.equal(targetsStep(p, r.prog, 0.1, p.targets[2]).prog, r.prog);
  // Leave, come back: strikes again.
  r = targetsStep(p, r.prog, 0.2, nowhere);
  assert.equal(r.prog.on, -1);
  r = targetsStep(p, r.prog, 0.3, p.targets[2]);
  assert.equal(r.prog.strikes, 2);
  // The right one still hits and clears the "on" marker.
  r = targetsStep(p, r.prog, 0.4, p.targets[0]);
  assert.equal(r.event, 'hit');
  assert.equal(r.prog.next, 1);
  assert.equal(r.prog.on, -1);
  // Already-hit targets are harmless.
  assert.equal(targetsStep(p, r.prog, 0.5, p.targets[0]).prog, r.prog);
  // Last one wins.
  const last = { next: 4, strikes: 0, on: -1 };
  assert.ok(targetsStep(p, last, 1, p.targets[4]).won);
});

test('minesweeper: first click is safe, mines are conserved, winnable; the random-click gap comes from the settings', () => {
  const sp = stageSpec('minesweeper', 1);
  const { params, progress, secret } = makeMines(seeded(7), sp.cols, sp.rows, sp.mines, sp.autoMinS, sp.autoMaxS);
  assert.equal(params.mines, sp.mines);
  const firstMine = secret.indexOf('1');
  const c = firstMine % params.cols;
  const r = Math.floor(firstMine / params.cols);
  const res = revealCell(params, progress, secret, c, r);
  assert.notEqual(res.result, 'mine');
  assert.equal([...res.secret].filter(b => b === '1').length, params.mines);
  let st = res;
  for (let i = 0; i < params.cols * params.rows; i++) {
    if (st.secret[i] === '0' && st.prog.cells[i] === '#') {
      st = revealCell(params, st.prog, st.secret, i % params.cols, Math.floor(i / params.cols));
    }
  }
  assert.equal(st.result, 'won');
  for (let s = 0; s < 30; s++) {
    const ms = autoClickMs(params, seeded(s));
    assert.ok(ms >= sp.autoMinS * 1000 && ms <= sp.autoMaxS * 1000);
  }
  // Stage 3 is a bigger, denser grid.
  const s3 = stageSpec('minesweeper', 3);
  assert.ok(s3.cols * s3.rows > sp.cols * sp.rows && s3.mines > sp.mines);
});

test('minesweeper: a bomb after the safe opener loses and reveals all mines', () => {
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

// ---------------------------------------------------------------------------
// Red Light, Green Light (doll + leash)
// ---------------------------------------------------------------------------

test('redlight path: serpentine lanes below the light strip, a real walk but not a slog', () => {
  for (let lanes = 1; lanes <= 4; lanes++) {
    const path = redlightPath(lanes);
    assert.equal(path.length, lanes * 2);
    for (const q of path) assert.ok(q.y > REDLIGHT_TOP && q.y < WORLD_H && q.x >= 1 && q.x <= WORLD_W - 1);
    const len = pathLength(path);
    assert.ok(len >= 14 * lanes, `${lanes} lanes = ${len} units`);
    assert.deepEqual(pathPos(path, 0), path[0]);
    assert.deepEqual(pathPos(path, len + 5), path[path.length - 1]);
    const mid = pathPos(path, len / 2);
    assert.ok(mid.x >= 1 && mid.x <= WORLD_W - 1);
  }
  // With the stage-1 defaults the doll needs a good half-minute of pure green walking (party length, not a slog).
  const sp = stageSpec('redlight', 1);
  const walk = pathLength(redlightPath(sp.lanes)) / sp.speed;
  assert.ok(walk > 30 && walk < sp.secs * 0.6, `pure walk ${walk}s fits a ${sp.secs}s stage`);
});

test('redlight: the doll walks only on green with the cursor inside the leash; red freezes her', () => {
  const sp = stageSpec('redlight', 1);
  const { params: p, progress: p0 } = makeRedlight(seeded(1), sp, 1000);
  assert.equal(p0.light, 'green');
  assert.equal(p0.s, 0);
  assert.ok(!p0.walking);
  const start = p.path[0];
  // Cursor far from the doll: green, but she does not move.
  let r = redlightStep(p, p0, still(WORLD_W - 1, WORLD_H - 1), 1500, seeded(2));
  assert.equal(r.events.length, 0);
  assert.ok(!r.prog.walking);
  assert.equal(dollS(p, r.prog, 2500), 0);
  // Cursor next to the doll: she starts walking from where she is.
  r = redlightStep(p, p0, still(start.x + 0.5, start.y), 1500, seeded(2));
  assert.ok(r.prog.walking);
  assert.equal(r.prog.at, 1500);
  const walking = r.prog;
  const after1s = dollS(p, walking, 2500);
  assert.ok(Math.abs(after1s - p.speed) < 1e-9, 'advances speed units per second');
  assert.ok(dollPos(p, walking, 2500).x > start.x);
  // Still inside the leash a tick later: progress object unchanged (no row write).
  r = redlightStep(p, walking, still(start.x + 0.9, start.y), 1600, seeded(2));
  assert.equal(r.prog, walking);
  // Cursor leaves the leash: she stops where she got to.
  r = redlightStep(p, walking, still(start.x + p.leash + 3, start.y), 2500, seeded(2));
  assert.ok(!r.prog.walking);
  assert.ok(Math.abs(r.prog.s - p.speed) < 1e-9);
  // Red flips: she freezes even with the cursor beside her.
  r = redlightStep(p, walking, still(start.x + 0.5, start.y), walking.flipAt, seeded(2));
  assert.deepEqual(r.events, ['red']);
  assert.equal(r.prog.light, 'red');
  assert.ok(!r.prog.walking);
  assert.equal(r.prog.anchor, null);
});

test('redlight: moving on red (after the grace) rewinds the doll a few steps, never below the start, and counts a fault', () => {
  const sp = stageSpec('redlight', 1);
  const { params: p, progress: p0 } = makeRedlight(seeded(1), sp, 1000);
  // Put the doll 10 units in, red just lit.
  const red = { ...p0, light: 'red' as const, litAt: 5000, flipAt: 8000, s: 10, at: 5000, walking: false };
  const cur = still(5, 5);
  // Within the grace: nothing armed even if we move.
  let r = redlightStep(p, red, still(9, 5), red.litAt + p.graceMs - 1, seeded(2));
  assert.equal(r.prog.anchor, null);
  assert.equal(r.prog.faults, 0);
  // Grace over: anchor set where the cursor is.
  r = redlightStep(p, red, cur, red.litAt + p.graceMs, seeded(2));
  assert.deepEqual(r.prog.anchor, { x: 5, y: 5 });
  const armed = r.prog;
  // Wiggle inside the dead-band: fine.
  r = redlightStep(p, armed, still(5 + p.deadband * 0.9, 5), armed.litAt + p.graceMs + 50, seeded(2));
  assert.equal(r.events.length, 0);
  // Real movement: fault, doll rewinds exactly `rewind`, anchor re-arms after a fresh grace.
  const t = armed.litAt + p.graceMs + 100;
  r = redlightStep(p, armed, still(5 + p.deadband * 1.5, 5), t, seeded(2));
  assert.deepEqual(r.events, ['fault']);
  assert.equal(r.prog.faults, 1);
  assert.equal(r.prog.s, 10 - p.rewind);
  assert.ok(r.prog.s > 0, 'not all the way back to the start');
  assert.equal(r.prog.anchor, null);
  assert.equal(r.prog.litAt, t);
  // A fault near the start clamps at 0.
  const nearStart = { ...armed, s: 1 };
  r = redlightStep(p, nearStart, still(9, 5), t, seeded(2));
  assert.equal(r.prog.s, 0);
  // Stage 3 rewinds further, with a tighter leash and shorter greens.
  const s3 = stageSpec('redlight', 3);
  assert.ok(s3.rewind > sp.rewind && s3.leash < sp.leash && s3.greenMaxS < sp.greenMaxS && s3.faults < sp.faults);
});

test('redlight: fake-out greens die after FAKE_MS and never move the doll; a real green walks; reaching the end wins', () => {
  const sp = stageSpec('redlight', 1);
  const { params: p, progress: p0 } = makeRedlight(seeded(1), sp, 1000);
  const red = { ...p0, light: 'red' as const, litAt: 5000, flipAt: 8000, s: 3, at: 5000, walking: false };
  const doll = pathPos(p.path, 3);
  // rand() < fakeP -> fake green.
  const fakeRand = () => 0.01;
  let r = redlightStep(p, red, still(doll.x, doll.y), 8000, fakeRand);
  assert.deepEqual(r.events, ['green']);
  assert.ok(r.prog.fake);
  assert.equal(r.prog.flipAt, 8000 + FAKE_MS);
  assert.ok(!r.prog.walking, 'a fake green never walks the doll');
  // It dies: back to red with a "fake" event (gotcha), anchor cleared.
  r = redlightStep(p, r.prog, still(doll.x, doll.y), 8000 + FAKE_MS, fakeRand);
  assert.deepEqual(r.events, ['fake']);
  assert.equal(r.prog.light, 'red');
  // Real green (rand() >= fakeP): walks when the cursor is beside her.
  const realRand = () => 0.99;
  r = redlightStep(p, red, still(doll.x, doll.y), 8000, realRand);
  assert.deepEqual(r.events, ['green']);
  assert.ok(!r.prog.fake && r.prog.walking);
  const win = { ...p0, s: p.length - 0.1, at: 1000, walking: true };
  const end = p.path[p.path.length - 1];
  const w = redlightStep(p, win, still(end.x, end.y), 1000 + 1000, seeded(2));
  assert.ok(w.won);
  assert.equal(dollS(p, w.prog, 99999), p.length, 'never past the end');
});

// ---------------------------------------------------------------------------
// Balloon, mole, potato, chairs, keyboard
// ---------------------------------------------------------------------------

test('balloon: a hand under the balloon saves it, the floor is a drop that respawns it; saves to win is a run', () => {
  const sp = stageSpec('balloon', 1);
  const { params: p, progress: p0 } = makeBalloons(seeded(3), sp, 0);
  assert.equal(p0.balloons.length, 1);
  assert.equal(p.saveTarget, sp.saves);
  assert.ok(p.saveTarget >= 15, 'a stage is a good run of bops');
  const idle = balloonStep(p, p0, 100, { x: 0.5, y: 8.5 }, seeded(4));
  assert.equal(idle.prog, p0);
  const b = balloonsNow(p, p0, 1000)[0];
  assert.ok(b.y > p0.balloons[0].y && b.vy > 0);
  const save = balloonStep(p, p0, 1000, { x: b.x, y: b.y + p.r + p.handR * 0.5 }, seeded(4));
  assert.equal(save.events[0]?.kind, 'save');
  assert.equal(save.prog.saves, 1);
  assert.ok(save.prog.balloons[0].vy < 0);
  const above = balloonStep(p, p0, 1000, { x: b.x, y: b.y - p.r - 0.1 }, seeded(4));
  assert.equal(above.events.length, 0);
  const tFall = 1000 + Math.ceil(Math.sqrt((2 * (WORLD_H - p.r - b.y)) / p.gravity) * 1000) + 50;
  const drop = balloonStep(p, p0, tFall, { x: 0.5, y: 0.5 }, seeded(4));
  assert.equal(drop.events[0]?.kind, 'drop');
  assert.equal(drop.prog.drops, 1);
  assert.ok(drop.prog.balloons[0].y < 2);
  const s3 = makeBalloons(seeded(5), stageSpec('balloon', 3), 0);
  assert.equal(s3.progress.balloons.length, 2);
  assert.ok(s3.params.wind > 0 && sp.wind === 0);
});

test('mole: scoring, missing, no repeat hole; a stage needs a run of whacks', () => {
  const sp = stageSpec('mole', 1);
  const { params: p, progress: p0 } = makeMoles(sp, 0);
  assert.equal(p.holes.length, sp.holes);
  assert.ok(p.target >= 10);
  assert.equal(p0.up, -1);
  assert.equal(moleStep(p, p0, p0.until - 1, { x: 0, y: 0 }, seeded(6)).prog, p0);
  const up = moleStep(p, p0, p0.until, { x: 0, y: 0 }, seeded(6));
  assert.equal(up.event, 'up');
  assert.equal(up.prog.until, p0.until + sp.upMs);
  const hole = p.holes[up.prog.up];
  const hit = moleStep(p, up.prog, up.prog.until, { x: hole.x + p.r * 0.5, y: hole.y }, seeded(6));
  assert.equal(hit.event, 'hit');
  assert.equal(hit.prog.score, 1);
  assert.equal(hit.prog.until, up.prog.until + sp.gapMs);
  const miss = moleStep(p, up.prog, up.prog.until, { x: hole.x + p.r * 2, y: hole.y }, seeded(6));
  assert.equal(miss.event, 'miss');
  assert.equal(miss.prog.misses, 1);
  for (let s = 0; s < 20; s++) assert.notEqual(moleStep(p, hit.prog, hit.prog.until, { x: 0, y: 0 }, seeded(s)).prog.up, hit.prog.last);
  // Holes never overlap each other.
  for (const a of p.holes) for (const b of p.holes) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2 * p.r);
});

test('potato: a chain of deliveries; in the bucket at the fuse moves to the next one, the last one wins, outside explodes', () => {
  const sp = stageSpec('potato', 1);
  const { params: p, progress: p0 } = makePotato(seeded(7), sp, 5000);
  assert.equal(p.rounds, sp.rounds);
  assert.equal(p.buckets.length, sp.rounds);
  assert.equal(p0.fuseAt, 5000 + sp.fuseS * 1000);
  assert.ok(stageSeconds('potato', sp) >= sp.rounds * sp.fuseS);
  let prev = { x: WORLD_W / 2, y: WORLD_H / 2 };
  for (const b of p.buckets) {
    assert.ok(Math.hypot(b.x - prev.x, b.y - prev.y) > 3, 'each bucket is a trip');
    prev = b;
  }
  const b0 = bucketPos(p, 0, 3);
  assert.deepEqual(b0, p.buckets[0], 'stage 1 buckets are static');
  assert.ok(potatoInBucket(p, 0, 3, b0.x + p.r * 0.7, b0.y));
  assert.ok(!potatoInBucket(p, 0, 3, b0.x + p.r * 1.2, b0.y));
  // Fuse not up: nothing.
  assert.equal(potatoStep(p, p0, p0.fuseAt - 1, 10, b0).event, null);
  // Fuse up, outside: boom.
  assert.equal(potatoStep(p, p0, p0.fuseAt, 10, { x: 0.2, y: 0.2 }).event, 'boom');
  // Fuse up, inside: splash, next round with a fresh fuse.
  const s = potatoStep(p, p0, p0.fuseAt, 10, b0);
  assert.equal(s.event, 'splash');
  assert.equal(s.prog.round, 1);
  assert.equal(s.prog.fuseAt, p0.fuseAt + sp.fuseS * 1000);
  // Last delivery wins.
  const last = { round: p.rounds - 1, fuseAt: 99000 };
  const bl = bucketPos(p, p.rounds - 1, 0);
  assert.equal(potatoStep(p, last, 99000, 0, bl).event, 'won');
  // Stage 3: more rounds, shorter fuse, smaller wandering bucket that stays on the field.
  const sp3 = stageSpec('potato', 3);
  const p3 = makePotato(seeded(8), sp3, 0).params;
  assert.ok(p3.rounds > p.rounds && p3.fuseS < p.fuseS && p3.r < p.r && p3.move > 0);
  for (let round = 0; round < p3.rounds; round++)
    for (let t = 0; t < 30; t += 0.7) {
      const q = bucketPos(p3, round, t);
      assert.ok(q.x >= p3.r && q.x <= WORLD_W - p3.r && q.y >= p3.r && q.y <= WORLD_H - p3.r);
    }
});

test('chairs: ring of non-overlapping chairs, one goes per round, last chair wins; stage 1 has several rounds', () => {
  const sp = stageSpec('chairs', 1);
  assert.ok(sp.chairs >= 5);
  const { params: p, progress: p0 } = makeChairs(seeded(9), sp, 0);
  assert.equal(p.chairs.length, sp.chairs);
  for (const c of p.chairs) assert.ok(c.x >= 0 && c.x + c.w <= WORLD_W && c.y >= 0 && c.y + c.h <= WORLD_H, JSON.stringify(c));
  for (const a of p.chairs)
    for (const b of p.chairs)
      if (a !== b) assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9, 'chairs overlap');
  // Stage 3 ring (more, smaller chairs) also fits.
  const sp3 = stageSpec('chairs', 3);
  for (const c of makeChairs(seeded(2), sp3, 0).params.chairs) assert.ok(c.x >= 0 && c.x + c.w <= WORLD_W && c.y >= 0 && c.y + c.h <= WORLD_H);
  const ring = chairRing(4, 1, 1, 0);
  assert.equal(ring.length, 4);
  assert.equal(chairsStep(p, p0, p0.stopAt - 1, { x: 0, y: 0 }, seeded(1)).event, null);
  assert.equal(chairsStep(p, p0, p0.stopAt, { x: WORLD_W / 2, y: WORLD_H / 2 }, seeded(1)).event, 'lost');
  const c0 = p.chairs[0];
  const safe = chairsStep(p, p0, p0.stopAt, { x: c0.x + c0.w / 2, y: c0.y + c0.h / 2 }, seeded(1));
  assert.equal(safe.event, 'safe');
  assert.equal(safe.prog.left.length, sp.chairs - 1);
  assert.ok(!safe.prog.left.includes(0));
  assert.equal(safe.prog.round, 2);
  assert.ok(safe.prog.stopAt >= p0.stopAt + p.pauseMs + sp.musicMinS * 1000 && safe.prog.stopAt <= p0.stopAt + p.pauseMs + sp.musicMaxS * 1000);
  assert.equal(chairsStep(p, safe.prog, safe.prog.stopAt, { x: c0.x + c0.w / 2, y: c0.y + c0.h / 2 }, seeded(1)).event, 'lost');
  const last = { ...safe.prog, left: [2] };
  const c2 = p.chairs[2];
  assert.equal(chairsStep(p, last, last.stopAt, { x: c2.x + 0.1, y: c2.y + 0.1 }, seeded(1)).event, 'won');
});

test('keyboard: phrases per stage, spaces are free, dwell types, wrong key buzzes once', () => {
  const sp = stageSpec('keyboard', 1);
  const { params: p, progress: p0 } = makeKeyboard(seeded(10), sp, 1);
  assert.equal(p.typoCap, sp.typos);
  assert.ok(p.typoCap >= 1, 'typos are a strike, not free');
  assert.ok(KEYBOARD_PHRASES[0].includes(p.word));
  assert.ok(p.word.length >= 18, 'a phrase, not a word');
  assert.equal(p.keys.length, 26);
  for (const k of p.keys) assert.ok(k.x >= 0 && k.x + k.w <= WORLD_W && k.y >= 0 && k.y + k.h <= WORLD_H);
  const key = (ch: string) => {
    const k = p.keys.find(k => k.ch === ch)!;
    return { x: k.x + k.w / 2, y: k.y + k.h / 2 };
  };
  const first = p.word[0];
  const wrong = first === 'Q' ? 'P' : 'Q';
  assert.equal(keyAt(p.keys, key(first).x, key(first).y)?.ch, first);
  assert.equal(keyAt(p.keys, WORLD_W / 2, 0.5), null);
  let r = keyboardStep(p, p0, 1000, key(first));
  assert.equal(r.event, null);
  r = keyboardStep(p, r.prog, 1000 + p.dwellMs - 1, key(first));
  assert.equal(r.event, null);
  r = keyboardStep(p, r.prog, 1000 + p.dwellMs, key(first));
  assert.equal(r.event, 'key');
  assert.equal(r.prog.next, 1);
  let w = keyboardStep(p, p0, 2000, key(wrong));
  w = keyboardStep(p, w.prog, 2000 + p.dwellMs, key(wrong));
  assert.equal(w.event, 'buzz');
  assert.equal(w.prog.buzzes, 1);
  w = keyboardStep(p, w.prog, 2000 + p.dwellMs * 4, key(wrong));
  assert.equal(w.event, null);
  // Spell the whole phrase; spaces never need a key.
  let s = p0;
  let t = 20000;
  let typed = 0;
  for (const ch of p.word) {
    if (ch === ' ') continue;
    s = keyboardStep(p, s, t, { x: WORLD_W / 2, y: 0.5 }).prog;
    s = keyboardStep(p, s, t + 10, key(ch)).prog;
    const done = keyboardStep(p, s, t + 10 + p.dwellMs, key(ch));
    assert.equal(done.event, 'key', `letter ${typed} (${ch})`);
    s = done.prog;
    typed++;
    t += 5000;
    if (s.next >= p.word.length) assert.ok(done.won);
  }
  assert.ok(s.next >= p.word.length);
  // Later stages: longer phrases, shorter dwell.
  const s3 = stageSpec('keyboard', 3);
  assert.ok(s3.dwellMs < sp.dwellMs);
  assert.ok(Math.min(...KEYBOARD_PHRASES[2].map(w => w.length)) > Math.max(...KEYBOARD_PHRASES[0].map(w => w.length)));
});

test('keyboard: double letters need a second dwell on the same key', () => {
  const { params } = makeKeyboard(seeded(10), stageSpec('keyboard', 1), 1);
  const p = { ...params, word: 'LL' };
  const l = p.keys.find(k => k.ch === 'L')!;
  const at = { x: l.x + l.w / 2, y: l.y + l.h / 2 };
  let r = keyboardStep(p, { next: 0, onKey: '', since: 0, pressed: false, buzzes: 0 }, 0, at);
  r = keyboardStep(p, r.prog, p.dwellMs, at);
  assert.equal(r.prog.next, 1);
  r = keyboardStep(p, r.prog, p.dwellMs + 1, at);
  assert.equal(r.event, null);
  r = keyboardStep(p, r.prog, p.dwellMs * 2, at);
  assert.equal(r.event, 'key');
  assert.ok(r.won);
});

// ---------------------------------------------------------------------------
// Hunt, Valves, Stations
// ---------------------------------------------------------------------------

test('hunt: the target is secret, the meter is warmer/colder with noise, dwelling finds it, leaving early resets', () => {
  const sp = stageSpec('hunt', 1);
  const { params: p, progress: p0, secret } = makeHunt(seeded(11), sp, 1000);
  assert.ok(!('target' in p), 'public params never contain the target');
  assert.ok(Math.hypot(secret.target.x - WORLD_W / 2, secret.target.y - WORLD_H / 2) >= 3, 'not under the start');
  // Heat is monotone in distance: on the target = 1, far away = 0.
  assert.equal(huntHeat(p, secret, secret.target), 1);
  const far = { x: secret.target.x < 8 ? 15.5 : 0.5, y: secret.target.y < 4.5 ? 8.5 : 0.5 };
  assert.ok(huntHeat(p, secret, far) < 0.3);
  // Meter updates every HUNT_METER_MS with bounded noise.
  const noiseless = { ...p, noise: 0 };
  let r = huntStep(noiseless, p0, secret, 1000 + HUNT_METER_MS, far, seeded(1));
  assert.ok(r.prog.bars >= 0 && r.prog.bars <= HUNT_BARS);
  assert.equal(r.prog.bars, Math.round(huntHeat(p, secret, far) * HUNT_BARS));
  // Between meter reads with nothing else happening: same object.
  assert.equal(huntStep(p, r.prog, secret, r.prog.barsAt + 10, far, seeded(1)).prog, r.prog);
  // Dwell: enter, wait, found; a new secret is generated and the old spot revealed.
  const on = secret.target;
  r = huntStep(noiseless, p0, secret, 2000, on, seeded(2));
  assert.equal(r.prog.dwellSince, 2000);
  r = huntStep(noiseless, r.prog, secret, 2000 + p.dwellS * 1000 - 1, on, seeded(2));
  assert.equal(r.event, null);
  r = huntStep(noiseless, r.prog, secret, 2000 + p.dwellS * 1000, on, seeded(2));
  assert.equal(r.event, 'found');
  assert.equal(r.prog.found.length, 1);
  assert.ok(Math.hypot(r.prog.found[0].x - on.x, r.prog.found[0].y - on.y) < 0.02);
  assert.notDeepEqual(r.secret.target, secret.target);
  assert.ok(Math.hypot(r.secret.target.x - on.x, r.secret.target.y - on.y) >= 3, 'next target is a trip away');
  assert.ok(!r.won);
  // Leaving before the dwell completes resets it.
  let q = huntStep(noiseless, p0, secret, 3000, on, seeded(2));
  q = huntStep(noiseless, q.prog, secret, 3500, far, seeded(2));
  assert.equal(q.event, 'reset');
  assert.equal(q.prog.dwellSince, 0);
  // Finishing the last find wins.
  const lastProg = { ...p0, found: Array.from({ length: p.finds - 1 }, () => ({ x: 1, y: 1 })), dwellSince: 100 };
  const w = huntStep(noiseless, lastProg, secret, 100 + p.dwellS * 1000, on, seeded(2));
  assert.ok(w.won);
  // Stage 3: decoys that never read hot, smaller radius.
  const sp3 = stageSpec('hunt', 3);
  const h3 = makeHunt(seeded(12), sp3, 0);
  assert.ok(h3.secret.decoys.length >= 2 && h3.params.radius < p.radius);
  for (const d of h3.secret.decoys) assert.ok(huntHeat(h3.params, { ...h3.secret, target: { x: -50, y: -50 } }, d) < 0.8, 'a decoy is warm, never hot');
});

test('hunt: decoys are traps — sitting on one for the dwell springs it, reveals it, and a fresh decoy appears', () => {
  const sp = stageSpec('hunt', 1);
  assert.ok(sp.decoys >= 1 && sp.traps >= 1, 'stage 1 already has teeth');
  const { params: p, progress: p0, secret } = makeHunt(seeded(31), sp, 1000);
  assert.equal(p.trapCap, sp.traps);
  assert.equal(secret.decoys.length, sp.decoys);
  const noiseless = { ...p, noise: 0 };
  const d = secret.decoys[0];
  assert.ok(huntHeat(p, secret, d) < 0.8, 'a decoy never reads boiling');
  let r = huntStep(noiseless, p0, secret, 2000, d, seeded(1));
  assert.equal(r.prog.trapSince, 2000);
  assert.equal(r.prog.dwellSince, 0, 'a decoy is not the treasure');
  r = huntStep(noiseless, r.prog, secret, 2000 + p.dwellS * 1000 - 1, d, seeded(1));
  assert.equal(r.event, null);
  r = huntStep(noiseless, r.prog, secret, 2000 + p.dwellS * 1000, d, seeded(1));
  assert.equal(r.event, 'trap');
  assert.equal(r.prog.traps, 1);
  assert.equal(r.prog.trapSince, 0);
  assert.equal(r.prog.sprung.length, 1);
  assert.ok(Math.hypot(r.prog.sprung[0].x - d.x, r.prog.sprung[0].y - d.y) < 0.02);
  assert.equal(r.secret.decoys.length, sp.decoys, 'sprung decoy is replaced');
  assert.ok(r.secret.decoys.every(q => Math.hypot(q.x - d.x, q.y - d.y) > 0.02), 'the sprung one is gone from the secret');
  assert.deepEqual(r.secret.target, secret.target, 'the treasure did not move');
  // Stepping off a decoy early just clears the timer, no strike.
  r = huntStep(noiseless, p0, secret, 3000, d, seeded(1));
  r = huntStep(noiseless, r.prog, secret, 3100, { x: d.x < 8 ? 15.5 : 0.5, y: d.y < 4.5 ? 8.5 : 0.5 }, seeded(1));
  assert.equal(r.prog.trapSince, 0);
  assert.equal(r.prog.traps, 0);
  assert.notEqual(r.event, 'trap');
});

test('valves: unheld valves drift down, the held one fills; blowouts count; all-in-zone for the hold wins and slipping resets the hold', () => {
  const sp = stageSpec('valves', 1);
  const { params: p, progress: p0 } = makeValves(seeded(13), sp, 1000);
  assert.equal(p.valves.length, sp.valves);
  assert.equal(p0.held, -1);
  for (const v of p.valves) assert.ok(v.x > 0 && v.x < WORLD_W && v.y > 0 && v.y < WORLD_H);
  // Drift: every level falls when nothing is held.
  const l1 = valveLevelsNow(p, p0, 11000);
  for (let i = 0; i < l1.length; i++) assert.ok(l1[i] < p0.levels[i]);
  // Nothing on the cursor and nothing crossing a threshold: same object.
  const idle = valvesStep(p, p0, 1100, { x: 0.2, y: 0.2 });
  assert.equal(idle.prog, p0);
  // Grab valve 0: fill from now.
  const g = valvesStep(p, p0, 1100, p.valves[0]);
  assert.deepEqual(g.event, { kind: 'grab', i: 0 });
  assert.equal(g.prog.held, 0);
  const l2 = valveLevelsNow(p, g.prog, 2100);
  assert.ok(l2[0] > g.prog.levels[0], 'held valve rises');
  if (l2.length > 1) assert.ok(l2[1] < g.prog.levels[1], 'others keep falling');
  // Blowout: a valve that runs dry resets to half and counts.
  const dry = { ...p0, levels: p0.levels.map(() => 0.5), at: 1000 };
  const blow = valvesStep(p, dry, 1000 + Math.ceil(0.5 / Math.min(...p.drift)) * 1000 + 1000, { x: 0.2, y: 0.2 });
  assert.ok(blow.prog.blowouts >= 1);
  assert.equal(blow.event?.kind, 'blow');
  // All in zone: hold starts; held long enough wins; a slip clears the hold.
  const allIn = { ...p0, levels: p0.levels.map(() => 0.5), at: 5000, held: -1 };
  const a = valvesStep(p, allIn, 5000, { x: 0.2, y: 0.2 });
  assert.equal(a.prog.allInSince, 5000);
  assert.equal(a.event?.kind, 'all_in');
  // Hold the lowest-drift valve... actually keep everyone in by re-stamping at the win time.
  const steady = { ...a.prog, levels: a.prog.levels.map(() => 0.5), at: 5000 + sp.holdS * 1000 };
  const w = valvesStep(p, steady, 5000 + sp.holdS * 1000, { x: 0.2, y: 0.2 });
  assert.ok(w.won);
  const slipped = { ...a.prog, levels: a.prog.levels.map((_, i) => (i === 0 ? 0.2 : 0.5)), at: 6000 };
  const s = valvesStep(p, slipped, 6000, { x: 0.2, y: 0.2 });
  assert.equal(s.prog.allInSince, 0);
  assert.equal(s.event?.kind, 'slip');
  // Feasible: with the default drift a room can refill a valve faster than the rest leak out.
  assert.ok(sp.fill > sp.drift * (sp.valves - 1) * 3, 'filling beats the leaks with margin');
  const sp3 = stageSpec('valves', 3);
  assert.ok(sp3.valves > sp.valves && sp3.drift > sp.drift);
});

test('stations: visit in order, dwell per station, leaving early cancels that station, last one wins', () => {
  const sp = stageSpec('stations', 1);
  const { params: p, progress: p0 } = makeStations(seeded(14), sp);
  assert.equal(p.stations.length, sp.stations);
  assert.ok(sp.stations >= 4);
  let prev = { x: WORLD_W / 2, y: WORLD_H / 2 };
  for (const s of p.stations) {
    assert.ok(Math.hypot(s.x - prev.x, s.y - prev.y) > 2.5, 'each station is a trip');
    prev = s;
  }
  const s0 = p.stations[0];
  const s1 = p.stations[1];
  // Sitting on the wrong (second) station does nothing.
  assert.equal(stationsStep(p, p0, 1000, s1).prog, p0);
  let r = stationsStep(p, p0, 1000, s0);
  assert.equal(r.prog.since, 1000);
  r = stationsStep(p, r.prog, 1000 + p.dwellS * 1000 - 1, s0);
  assert.equal(r.event, null);
  // Jittering just past the rim keeps the dwell alive; clearly leaving cancels it.
  const rim = { x: s0.x + p.r * (STATION_SLACK - 0.05), y: s0.y };
  assert.equal(stationsStep(p, r.prog, 1400, rim).prog, r.prog);
  assert.equal(p.skipCap, sp.skips);
  const cancel = stationsStep(p, r.prog, 1500, { x: 0.1, y: 0.1 });
  assert.equal(cancel.event, 'cancel');
  assert.equal(cancel.prog.cancels, 1);
  assert.equal(cancel.prog.since, 0);
  assert.equal(cancel.prog.next, 0);
  r = stationsStep(p, r.prog, 1000 + p.dwellS * 1000, s0);
  assert.equal(r.event, 'visit');
  assert.equal(r.prog.next, 1);
  assert.ok(!r.won);
  const last = { next: p.stations.length - 1, since: 100, cancels: 0 };
  const w = stationsStep(p, last, 100 + p.dwellS * 1000, p.stations[p.stations.length - 1]);
  assert.ok(w.won);
  const sp3 = stageSpec('stations', 3);
  assert.ok(sp3.stations > sp.stations && sp3.dwellS < sp.dwellS);
});

// ---------------------------------------------------------------------------
// Picker, resume, ghosts
// ---------------------------------------------------------------------------

test('picker: the catalog has 22 games, a PICK_CARDS subset fits the field without overlap, start spot is outside every card', () => {
  assert.equal(LEVEL_ROTATION.length, 22);
  const kinds = pickCards(seeded(3), undefined);
  const cards = voteLayout(kinds);
  assert.equal(cards.length, PICK_CARDS);
  assert.deepEqual(
    cards.map(c => c.kind),
    [...kinds]
  );
  for (const c of cards) {
    assert.ok(c.x >= 0 && c.x + c.w <= WORLD_W && c.y >= 0 && c.y + c.h <= WORLD_H, JSON.stringify(c));
    assert.ok(c.w > 2 && c.h > 1.5, 'cards are big enough to read');
    assert.ok(!inRect(c, VOTE_START.x, VOTE_START.y));
  }
  for (const a of cards)
    for (const b of cards)
      if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'cards overlap');
  assert.equal(new Set(voteLayout(['targets', 'maze', 'minesweeper']).map(c => c.y)).size, 1);
});

test('picker: hover is geometric; timer end inside a card picks it, in a gap restarts the timer', () => {
  const cards = voteLayout(pickCards(seeded(3), undefined));
  for (const c of cards) assert.equal(voteHover(cards, c.x + c.w / 2, c.y + c.h / 2), c);
  assert.equal(voteHover(cards, VOTE_START.x, VOTE_START.y), null);
  const p = { cards };
  const prog = { endsAt: 10_000, restarts: 0 };
  const c = cards[4];
  const r1 = voteResolve(p, prog, c.x + 0.2, c.y + 0.2, 10_000);
  assert.ok('chosen' in r1 && r1.chosen.kind === c.kind);
  const r2 = voteResolve(p, prog, VOTE_START.x, VOTE_START.y, 10_000);
  assert.ok(!('chosen' in r2));
  if (!('chosen' in r2)) {
    assert.equal(r2.prog.endsAt, 10_000 + VOTE_SECS * 1000);
    assert.equal(r2.prog.restarts, 1);
  }
});

test('resume: every wall-clock timer in progress shifts by the pause, zero/missing ones do not', () => {
  const shifted = shiftLevelTimes(
    { flipAt: 1000, litAt: 900, frozenUntil: 0, faults: 2, at: 500, stopAt: 2000, since: 0, endsAt: 7000, nextAutoAt: 3000, dwellSince: 0, allInSince: 100, barsAt: 50, fuseAt: 9 },
    250
  );
  assert.deepEqual(shifted, {
    flipAt: 1250,
    litAt: 1150,
    frozenUntil: 0,
    faults: 2,
    at: 750,
    stopAt: 2250,
    since: 0,
    endsAt: 7250,
    nextAutoAt: 3250,
    dwellSince: 0,
    allInSince: 350,
    barsAt: 300,
    fuseAt: 259,
  });
});

test('ghost frame round-trips and rejects unknown formats', () => {
  const gs = [
    { key: 0xbeef, color: 3, team: 1, dictator: true, x: 0, y: 1 },
    { key: 7, color: 11, team: 0, dictator: false, x: 0.5, y: 0.25 },
  ];
  const back = unpackGhosts(packGhosts(gs));
  assert.equal(back.length, 2);
  assert.deepEqual({ ...back[0], x: 0, y: 1 }, gs[0]);
  assert.ok(Math.abs(back[1].x - 0.5) < 1 / 255 && Math.abs(back[1].y - 0.25) < 1 / 255);
  assert.deepEqual(unpackGhosts(new Uint8Array([3, 1, 0, 128, 128])), []);
  assert.deepEqual(unpackGhosts(new Uint8Array(0)), []);
});

test('ghost keys are stable and spread out', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `c200${((i * 2654435761) >>> 0).toString(16).padStart(60, '0')}`);
  assert.equal(ghostKey(ids[0]), ghostKey(ids[0]));
  const keys = new Set(ids.map(ghostKey));
  assert.ok(keys.size >= 198, `only ${keys.size} distinct keys for 200 ids`);
});

// ---------------------------------------------------------------------------
// The newer modes
// ---------------------------------------------------------------------------

test('echo: the show reveals the secret pad by pad, then retracing in order advances; a wrong pad is a fault that restarts the round', () => {
  const sp = stageSpec('echo', 1);
  const { params: p, progress: p0, secret } = makeEcho(seeded(41), sp, 1000);
  assert.equal(p.pads.length, sp.pads);
  assert.equal(secret.seq.length, sp.startLen + sp.rounds - 1);
  assert.deepEqual(p0.shown, [], 'nothing revealed before the show');
  for (let i = 1; i < secret.seq.length; i++) assert.notEqual(secret.seq[i], secret.seq[i - 1], 'no back-to-back repeats');
  const far = { x: 0.2, y: 0.2 };
  // Show: one flash per slot, each revealing the next secret pad into public progress.
  let r = echoStep(p, p0, secret, p0.showAt - 1, far);
  assert.equal(r.prog, p0, 'dark gap before the show: same object');
  r = echoStep(p, p0, secret, p0.showAt, far);
  assert.equal(r.event, 'flash');
  assert.deepEqual(r.prog.shown, [secret.seq[0]]);
  assert.equal(echoLit(p, r.prog, r.prog.showAt - p.showMs), secret.seq[0], 'the revealed pad is lit at the start of its slot');
  assert.equal(echoLit(p, r.prog, r.prog.showAt - 1), -1, 'and dark at the end of it');
  for (let i = 1; i < p0.len; i++) {
    r = echoStep(p, r.prog, secret, r.prog.showAt, far);
    assert.equal(r.event, 'flash');
  }
  assert.deepEqual(r.prog.shown, secret.seq.slice(0, p0.len));
  // Cursor on a pad during the show does nothing.
  assert.equal(echoStep(p, r.prog, secret, r.prog.showAt - 10, p.pads[secret.seq[0]]).prog, r.prog);
  r = echoStep(p, r.prog, secret, r.prog.showAt, far);
  assert.equal(r.event, 'go');
  assert.equal(r.prog.phase, 'retrace');
  // Retrace: dwell on the first pad.
  const first = p.pads[secret.seq[0]];
  let t = r.prog.showAt + 500;
  r = echoStep(p, r.prog, secret, t, first);
  assert.equal(r.prog.since, t);
  r = echoStep(p, r.prog, secret, t + p.dwellMs - 1, first);
  assert.equal(r.event, null);
  r = echoStep(p, r.prog, secret, t + p.dwellMs, first);
  assert.equal(r.event, 'pad');
  assert.equal(r.prog.pos, 1);
  // Wrong pad: settle on it -> fault, round restarts (show again, same length).
  const wrongIdx = p.pads.findIndex((_, i) => i !== secret.seq[1] && i !== secret.seq[0]);
  t += p.dwellMs + 200;
  r = echoStep(p, r.prog, secret, t, far);
  r = echoStep(p, r.prog, secret, t + 50, p.pads[wrongIdx]);
  assert.equal(r.prog.wrongSince, t + 50);
  r = echoStep(p, r.prog, secret, t + 50 + WRONG_MS, p.pads[wrongIdx]);
  assert.equal(r.event, 'fault');
  assert.equal(r.prog.faults, 1);
  assert.equal(r.prog.phase, 'show');
  assert.equal(r.prog.len, p0.len, 'same round again');
  assert.deepEqual(r.prog.shown, []);
  // Leaving the right pad early is also a fault.
  let q = { ...r.prog, phase: 'retrace' as const, pos: 0, onPad: secret.seq[0], since: 5000, wrongSince: 0 };
  const left = echoStep(p, q, secret, 5100, far);
  assert.equal(left.event, 'fault');
  // Finishing the last round wins.
  q = { ...p0, phase: 'retrace', round: p.rounds, len: 1, pos: 0, onPad: secret.seq[0], since: 7000 };
  const w = echoStep(p, q, secret, 7000 + p.dwellMs, first);
  assert.ok(w.won);
  const s3 = stageSpec('echo', 3);
  assert.ok(s3.pads > sp.pads && s3.rounds > sp.rounds && s3.dwellMs < sp.dwellMs);
});

test('crane: holding the lever drops the block where the swing is; centred = clean, off = narrower block + fault, way off = topple', () => {
  const sp = stageSpec('crane', 1);
  const { params: p, progress: p0 } = makeCrane(sp);
  assert.equal(craneHeight(p0), 0);
  const lever = { x: p.lever.x + p.lever.w / 2, y: p.lever.y + p.lever.h / 2 };
  // Marker is a public sine: centred at t = 0 and every half period.
  assert.ok(Math.abs(craneMarkerX(p, 0) - WORLD_W / 2) < 1e-9);
  assert.ok(Math.abs(craneMarkerX(p, p.periodS / 4) - (WORLD_W / 2 + p.amp)) < 1e-6);
  let r = craneStep(p, p0, 1000, 0, lever);
  assert.equal(r.prog.since, 1000);
  r = craneStep(p, r.prog, 1000 + p.dwellMs - 1, 0, lever);
  assert.equal(r.event, null);
  r = craneStep(p, r.prog, 1000 + p.dwellMs, 0, lever);
  assert.equal(r.event, 'drop');
  assert.equal(craneHeight(r.prog), 1);
  assert.equal(r.prog.blocks[1].w, p0.blocks[0].w, 'a centred drop keeps the width');
  assert.equal(r.prog.since, -1, 'must leave the lever before the next drop');
  assert.equal(craneStep(p, r.prog, 5000, 0, lever).prog, r.prog);
  r = craneStep(p, r.prog, 5000, 0, { x: 0.5, y: 8 });
  assert.equal(r.prog.since, 0);
  // Misaligned: marker well off but still over the block.
  const tOff = p.periodS / 4; // marker at +amp
  const base = { ...r.prog, blocks: [{ x: WORLD_W / 2 + p.amp - 1.2, w: 3 }], since: 2000 };
  r = craneStep(p, base, 2000 + p.dwellMs, tOff, lever);
  assert.equal(r.event, 'miss');
  assert.equal(r.prog.faults, 1);
  assert.ok(r.prog.blocks[1].w < 3 && r.prog.blocks[1].w > 0, 'the new block is narrower');
  // Topple: marker misses the stack entirely.
  const miss = { ...r.prog, blocks: [{ x: WORLD_W / 2 - p.amp, w: 2 }], since: 3000, toppled: false };
  r = craneStep(p, miss, 3000 + p.dwellMs, tOff, lever);
  assert.equal(r.event, 'topple');
  assert.ok(r.prog.toppled);
  // Tall enough wins.
  const tall = { ...p0, blocks: Array.from({ length: p.target }, () => ({ x: WORLD_W / 2, w: 3 })), since: 4000 };
  assert.ok(craneStep(p, tall, 4000 + p.dwellMs, 0, lever).won);
  const s3 = stageSpec('crane', 3);
  assert.ok(s3.periodS < sp.periodS && s3.tol < sp.tol && s3.target > sp.target);
});

test('spotlight: inside the light nothing drains; outside drains health per second; the end of the path with health left wins', () => {
  const sp = stageSpec('spotlight', 1);
  const { params: p, progress: p0 } = makeSpotlight(sp, 1000);
  assert.ok(p.length / p.speed > 60, 'a real walk');
  assert.equal(stageSeconds('spotlight', sp), Math.ceil(p.length / p.speed) + 5);
  const on = spotPos(p, 2);
  let r = spotlightStep(p, p0, 3000, 2, on);
  assert.equal(r.prog, p0, 'inside, same object');
  assert.ok(!r.won && !r.lost);
  const far = { x: on.x < 8 ? 15.5 : 0.5, y: on.y < 4.5 ? 8.5 : 0.5 };
  r = spotlightStep(p, p0, 3000, 2, far);
  assert.equal(r.event, 'out');
  assert.equal(r.prog.at, 3000);
  r = spotlightStep(p, r.prog, 5000, 4, far);
  assert.ok(Math.abs(r.prog.hp - (p.hp - 2)) < 1e-6, 'two seconds outside = two hp');
  assert.ok(Math.abs(spotHp(r.prog, 6000) - (p.hp - 3)) < 1e-6, 'readers see the live drain');
  r = spotlightStep(p, r.prog, 6000, 5, spotPos(p, 5));
  assert.equal(r.event, 'in');
  assert.ok(Math.abs(r.prog.hp - (p.hp - 3)) < 1e-6);
  // Out of health loses; at the end with health wins.
  const dead = spotlightStep(p, { hp: 1, at: 0, outside: true }, 2000, 5, far);
  assert.ok(dead.lost);
  const tEnd = p.length / p.speed + 1;
  assert.ok(spotlightStep(p, { hp: 3, at: 0, outside: false }, 1000, tEnd, spotPos(p, tEnd)).won);
  // Decoy sits elsewhere on the same path.
  assert.ok(dist(decoyPos(p, 2), spotPos(p, 2)) > 1);
  const s3 = stageSpec('spotlight', 3);
  assert.ok(s3.radius < sp.radius && s3.speed > sp.speed && s3.decoy === 1);
});

test('sheep: deterministic wander from the seed, the cursor nudges a sheep toward the pen, all penned for the hold wins, a gate escape counts', () => {
  const sp = stageSpec('sheep', 1);
  const { params: p, progress: p0 } = makeSheep(seeded(51), sp, 1000);
  assert.equal(p0.sheep.length, sp.n);
  assert.ok(p0.sheep.every(s => !s.in && s.x < WORLD_W / 2), 'sheep start on the open side');
  // Same seed, same wander.
  const a = sheepStep(p, p0, 1000 + 5000, 0.066, { x: -5, y: -5 });
  const b = sheepStep(p, p0, 1000 + 5000, 0.066, { x: -5, y: -5 });
  assert.deepEqual(a.prog, b.prog);
  assert.ok(a.prog !== p0, 'by then at least one sheep turned (rebased)');
  // Positions extrapolate linearly between writes.
  const s0 = p0.sheep[0];
  const at = sheepAt(p0, 2000)[0];
  assert.ok(Math.abs(at.x - (s0.x + s0.vx)) < 1e-6 && Math.abs(at.y - (s0.y + s0.vy)) < 1e-6);
  // Push: cursor next to sheep 0 sends it toward the pen.
  const near = { x: s0.x + 0.3, y: s0.y };
  const r = sheepStep(p, p0, 1066, 0.066, near);
  const pushed = r.prog.sheep[0];
  assert.ok(pushed.pushed);
  const penC = { x: p.pen.x + p.pen.w * 0.6, y: p.pen.y + p.pen.h / 2 };
  assert.ok(pushed.vx > 0 && dist({ x: pushed.x + pushed.vx, y: pushed.y + pushed.vy }, penC) < dist(pushed, penC), 'heading toward the pen');
  assert.ok(r.events.some(e => e.kind === 'push' && e.i === 0));
  // Entering through the open side flips `in`; all in starts the hold; the hold wins.
  const gateX = p.pen.x - 0.05;
  const midY = p.pen.y + p.pen.h / 2;
  const entering = { ...p0, at: 10_000, sheep: p0.sheep.map(() => ({ x: gateX, y: midY, vx: 1, vy: 0, turnAt: 99_999_999, pushed: false, in: false })) };
  const q = sheepStep(p, entering, 10_200, 0.2, { x: -5, y: -5 });
  assert.ok(q.prog.sheep.every(s => s.in), 'through the gate');
  assert.ok(q.events.filter(e => e.kind === 'in').length === p.n);
  assert.equal(q.prog.inSince, 10_200);
  // Inside the pen, moving into a fence bounces instead of leaving.
  const fenceWard = { ...q.prog, at: 10_200, sheep: q.prog.sheep.map(s => ({ ...s, x: p.pen.x + p.pen.w - 0.1, vx: 2, vy: 0, turnAt: 99_999_999 })) };
  const bounced = sheepStep(p, fenceWard, 10_400, 0.2, { x: -5, y: -5 });
  assert.ok(bounced.prog.sheep.every(s => s.in && s.vx < 0), 'fence bounce keeps them in');
  assert.equal(bounced.prog.escapes, 0);
  const held = sheepStep(p, { ...bounced.prog, inSince: 10_200, sheep: bounced.prog.sheep.map(s => ({ ...s, vx: 0, vy: 0 })) }, 10_200 + p.holdS * 1000, 0.066, { x: -5, y: -5 });
  assert.ok(held.won);
  // Wandering back out through the gate is an escape.
  const leaving = { ...q.prog, at: 20_000, inSince: 20_000, sheep: q.prog.sheep.map(s => ({ ...s, x: p.pen.x + 0.1, y: midY, vx: -2, vy: 0, turnAt: 99_999_999 })) };
  const esc = sheepStep(p, leaving, 20_200, 0.2, { x: -5, y: -5 });
  assert.equal(esc.prog.escapes, p.n);
  assert.ok(esc.prog.sheep.every(s => !s.in));
  assert.equal(esc.prog.inSince, 0);
  const s3 = stageSpec('sheep', 3);
  assert.ok(s3.n > sp.n && s3.wander > sp.wander && s3.penW < sp.penW);
});

test('ice: slide keeps part of the old velocity after integrate; stopping inside a gate clears it, sliding through is a fault', () => {
  const sp = stageSpec('ice', 1);
  const { params: p, progress: p0 } = makeIce(seeded(61), sp);
  assert.equal(p.gates.length, sp.gates);
  // postIntegrate: with slide the new velocity is between the old and the spring's.
  const prev = { x: 5, y: 5, vx: 4, vy: 0 };
  const next = { x: 5.1, y: 5, vx: 1, vy: 0 };
  const slid = postIntegrate('ice', p, prev, next, 0.1, 1);
  assert.ok(slid.vx > next.vx && slid.vx < prev.vx, `slide blends velocity: ${slid.vx}`);
  assert.deepEqual(postIntegrate('targets', {}, prev, next, 0.1, 1), next, 'other modes untouched');
  const g = p.gates[0];
  const fast = { x: g.x, y: g.y, vx: 5, vy: 0 };
  let r = iceStep(p, p0, 1000, fast);
  assert.ok(r.prog.inGate && r.prog.since === 0, 'inside but moving: no rest timer');
  const slow = { x: g.x, y: g.y, vx: 0.1, vy: 0 };
  r = iceStep(p, r.prog, 1100, slow);
  assert.equal(r.prog.since, 1100);
  r = iceStep(p, r.prog, 1100 + p.restMs - 1, slow);
  assert.equal(r.event, null);
  r = iceStep(p, r.prog, 1100 + p.restMs, slow);
  assert.equal(r.event, 'gate');
  assert.equal(r.prog.next, 1);
  // Through gate 2 without stopping: fault, same gate stays current.
  const g1 = p.gates[1];
  r = iceStep(p, r.prog, 2000, { x: g1.x, y: g1.y, vx: 6, vy: 0 });
  r = iceStep(p, r.prog, 2100, { x: g1.x + p.r + 1, y: g1.y, vx: 6, vy: 0 });
  assert.equal(r.event, 'slide');
  assert.equal(r.prog.faults, 1);
  assert.equal(r.prog.next, 1);
  const last = { next: p.gates.length - 1, since: 100, inGate: true, faults: 0 };
  const gl = p.gates[p.gates.length - 1];
  assert.ok(iceStep(p, last, 100 + p.restMs, { x: gl.x, y: gl.y, vx: 0, vy: 0 }).won);
  const s3 = stageSpec('ice', 3);
  assert.ok(s3.gates > sp.gates && s3.r < sp.r && s3.slide > sp.slide);
});

test('plank: a tile fills only while still on it; moving wipes it, leaving cancels it; the full bridge wins; the shove is post-integrate drift', () => {
  const sp = stageSpec('plank', 1);
  const { params: p, progress: p0 } = makePlank(sp);
  assert.equal(p.tiles.length, sp.tiles);
  for (let i = 1; i < p.tiles.length; i++) assert.ok(p.tiles[i].x >= p.tiles[i - 1].x + p.tiles[i - 1].w - 1e-6, 'tiles run left to right');
  const t0 = p.tiles[0];
  const c = { x: t0.x + t0.w / 2, y: t0.y + t0.h / 2 };
  let r = plankStep(p, p0, 1000, { ...c, vx: 0.1, vy: 0 });
  assert.equal(r.prog.since, 1000);
  assert.ok(Math.abs(plankFill(p, r.prog, 1000 + p.fillMs / 2) - 0.5) < 1e-6);
  r = plankStep(p, r.prog, 1500, { ...c, vx: p.deadband + 1, vy: 0 });
  assert.equal(r.event, 'wipe');
  assert.equal(r.prog.since, 0);
  r = plankStep(p, r.prog, 1600, { ...c, vx: 0, vy: 0 });
  r = plankStep(p, r.prog, 1700, { x: 0.1, y: 0.1, vx: 0, vy: 0 });
  assert.equal(r.event, 'cancel');
  r = plankStep(p, r.prog, 2000, { ...c, vx: 0, vy: 0 });
  r = plankStep(p, r.prog, 2000 + p.fillMs, { ...c, vx: 0, vy: 0 });
  assert.equal(r.event, 'tile');
  assert.equal(r.prog.next, 1);
  const lastT = p.tiles[p.tiles.length - 1];
  const w = plankStep(p, { next: p.tiles.length - 1, since: 100, wipes: 0 }, 100 + p.fillMs, { x: lastT.x + 0.1, y: lastT.y + 0.1, vx: 0, vy: 0 });
  assert.ok(w.won);
  const shoved = postIntegrate('plank', { ...p, shove: 0.5 }, { x: 5, y: 5, vx: 0, vy: 0 }, { x: 5, y: 5, vx: 0, vy: 0 }, 0.2, 1);
  assert.ok(Math.abs(shoved.y - 5.1) < 1e-9, 'shove drifts the cursor');
  const s3 = stageSpec('plank', 3);
  assert.ok(s3.tiles > sp.tiles && s3.deadband < sp.deadband && s3.shove > 0);
});

test('seesaw: the board follows cursor x, the ball rolls downhill, a slow ball in the pocket scores, off the end is a fault and a reset', () => {
  const sp = stageSpec('seesaw', 1);
  const { params: p, progress: p0 } = makeSeesaw(seeded(71), sp);
  assert.equal(p0.balls.length, sp.balls);
  const rand = seeded(2);
  // Cursor far right tilts the board positive; the ball rolls toward +s.
  let r = seesawStep(p, p0, 0.1, { x: WORLD_W, y: 5 }, rand);
  assert.ok(r.prog.angle > 0);
  for (let i = 0; i < 20; i++) r = seesawStep(p, r.prog, 0.1, { x: WORLD_W, y: 5 }, rand);
  assert.ok(r.prog.balls[0].s > 0 && r.prog.balls[0].v > 0, 'rolling downhill');
  // Keep tilting: eventually it falls off the end (a fault) and resets to the centre.
  let fell = false;
  for (let i = 0; i < 400 && !fell; i++) {
    r = seesawStep(p, r.prog, 0.1, { x: WORLD_W, y: 5 }, rand);
    if (r.events.some(e => e.kind === 'fall')) fell = true;
  }
  assert.ok(fell, 'ball falls off');
  assert.equal(r.prog.faults, 1);
  assert.equal(r.prog.balls[0].s, 0);
  // A slow ball inside the pocket scores and gets a fresh pocket on the other side.
  const b = r.prog.balls[0];
  const inPocket = { ...r.prog, angle: 0, balls: [{ s: b.pocket, v: 0.1, pocket: b.pocket }] };
  const sc = seesawStep(p, inPocket, 0.05, { x: WORLD_W / 2, y: 5 }, rand);
  assert.ok(sc.events.some(e => e.kind === 'pocket'));
  assert.equal(sc.prog.pockets, 1);
  assert.ok(Math.sign(sc.prog.balls[0].pocket) !== Math.sign(b.pocket));
  const fastThrough = seesawStep(p, { ...inPocket, balls: [{ s: b.pocket, v: 3, pocket: b.pocket }] }, 0.05, { x: WORLD_W / 2, y: 5 }, rand);
  assert.equal(fastThrough.prog.pockets, 0, 'too fast does not count');
  const win = seesawStep(p, { ...inPocket, pockets: p.target - 1 }, 0.05, { x: WORLD_W / 2, y: 5 }, rand);
  assert.ok(win.won);
  const s3 = stageSpec('seesaw', 3);
  assert.ok(s3.mass > sp.mass && s3.pocketW < sp.pocketW && s3.balls > sp.balls);
});

test('belts: a belt cell drags the cursor after integrate, hazards rewind to the last checkpoint and count a fault, the exit wins', () => {
  const sp = stageSpec('belts', 1);
  const { params: p, progress: p0 } = makeBelts(seeded(81), sp);
  assert.equal(p.tiles.length, p.cols * p.rows);
  assert.equal(beltCell(p, p.start.x, p.start.y), 'S');
  assert.ok([...p.tiles].filter(c => c === 'E').length >= 1);
  assert.ok([...p.tiles].filter(c => c === 'C').length >= 1, 'there is a checkpoint');
  const beltCols = new Set<number>();
  for (let i = 0; i < p.tiles.length; i++) if ('^v<>'.includes(p.tiles[i])) beltCols.add(i % p.cols);
  assert.equal(beltCols.size, sp.beltCols);
  // Drift on a belt.
  const bc = [...beltCols][0];
  const onBelt = { x: bc + 0.5, y: 4.5, vx: 0, vy: 0 };
  const d = beltDir(p, onBelt.x, onBelt.y, 1)!;
  assert.ok(d && Math.abs(d.y) === 1);
  const moved = postIntegrate('belts', p, onBelt, onBelt, 0.5, 1);
  assert.ok(Math.abs(moved.y - (onBelt.y + d.y * p.speed * 0.5)) < 1e-9, 'belt drags by speed*dt');
  assert.deepEqual(postIntegrate('belts', p, { x: 0.5, y: 4.5, vx: 0, vy: 0 }, { x: 0.5, y: 4.5, vx: 0, vy: 0 }, 0.5, 1), { x: 0.5, y: 4.5, vx: 0, vy: 0 }, 'floor does not drag');
  // Reverse timer flips the direction.
  const rev = { ...p, reverseS: 5 };
  const flipped = beltDir(rev, onBelt.x, onBelt.y, 6)!;
  assert.ok(flipped.x === -d.x && flipped.y === -d.y, 'reversed direction');
  assert.ok(beltsReversed(rev, 6) && !beltsReversed(rev, 2));
  // Hazard: rewind + fault; frozen briefly at the checkpoint.
  const hz = p.tiles.indexOf('X');
  const hazard = { x: (hz % p.cols) + 0.5, y: Math.floor(hz / p.cols) + 0.5, vx: 1, vy: 1 };
  let r = beltsStep(p, p0, 1000, hazard);
  assert.equal(r.event, 'hazard');
  assert.equal(r.prog.faults, 1);
  assert.deepEqual({ x: r.body.x, y: r.body.y }, p0.checkpoint);
  assert.equal(beltsStep(p, r.prog, 1100, hazard).body.x, p0.checkpoint.x, 'still frozen at the checkpoint');
  // Checkpoint moves the respawn point.
  const ci = p.tiles.indexOf('C');
  const cp = { x: (ci % p.cols) + 0.5, y: Math.floor(ci / p.cols) + 0.5, vx: 0, vy: 0 };
  r = beltsStep(p, p0, 1000, cp);
  assert.equal(r.event, 'checkpoint');
  assert.deepEqual(r.prog.checkpoint, { x: cp.x, y: cp.y });
  const ei = p.tiles.indexOf('E');
  assert.ok(beltsStep(p, p0, 1000, { x: (ei % p.cols) + 0.5, y: Math.floor(ei / p.cols) + 0.5, vx: 0, vy: 0 }).won);
  const s3 = stageSpec('belts', 3);
  assert.ok(s3.beltCols > sp.beltCols && s3.speed > sp.speed && s3.reverseS > 0);
});

test('needle: the gap rides a public sine; through the gap passes the wall, touching the wall rewinds and counts a fault', () => {
  const sp = stageSpec('needle', 1);
  const { params: p, progress: p0 } = makeNeedle(seeded(91), sp);
  assert.equal(p.walls.length, sp.walls);
  for (let i = 1; i < p.walls.length; i++) assert.ok(p.walls[i].x > p.walls[i - 1].x + 1, 'walls are spaced out');
  const w0 = p.walls[0];
  const t = 1.3;
  const gy = needleGapY(p, 0, t);
  assert.ok(gy - p.gapH / 2 >= NEEDLE_TOP && gy + p.gapH / 2 <= WORLD_H, 'gap stays on the field');
  // Through the gap: past the wall = pass.
  let r = needleStep(p, p0, 1000, t, { x: w0.x, y: gy, vx: 3, vy: 0 });
  assert.equal(r.event, null, 'inside the gap plane: no fault');
  r = needleStep(p, r.prog, 1066, t, { x: w0.x + 0.6, y: gy, vx: 3, vy: 0 });
  assert.equal(r.event, 'pass');
  assert.equal(r.prog.next, 1);
  // Into the wall: fault, rewind to just before it, frozen briefly.
  const w1 = p.walls[1];
  const gy1 = needleGapY(p, 1, t);
  const offGap = gy1 + p.gapH / 2 + 0.6 <= WORLD_H - 0.3 ? gy1 + p.gapH / 2 + 0.6 : gy1 - p.gapH / 2 - 0.6;
  r = needleStep(p, r.prog, 2000, t, { x: w1.x, y: offGap, vx: 3, vy: 0 });
  assert.equal(r.event, 'wall');
  assert.equal(r.prog.faults, 1);
  assert.ok(r.body.x < w1.x && r.body.vx === 0);
  assert.equal(r.prog.next, 1, 'same wall again');
  assert.ok(needleStep(p, r.prog, 2100, t, { x: w1.x + 1, y: gy1, vx: 0, vy: 0 }).body.x < w1.x, 'frozen: held before the wall');
  const last = { next: p.walls.length - 1, faults: 0, frozenUntil: 0 };
  const wl = p.walls[p.walls.length - 1];
  assert.ok(needleStep(p, last, 3000, t, { x: wl.x + 1, y: needleGapY(p, p.walls.length - 1, t), vx: 1, vy: 0 }).won);
  const s3 = stageSpec('needle', 3);
  assert.ok(s3.walls > sp.walls && s3.gapH < sp.gapH && s3.periodS < sp.periodS);
});

test('wires: the order is secret (public progress only names the next color), the right node advances, a wrong node is a strike', () => {
  const sp = stageSpec('wires', 1);
  const { params: p, progress: p0, secret } = makeWires(seeded(101), sp);
  assert.equal(p.nodes.length, sp.order + sp.decoys);
  assert.equal(secret.order.length, sp.order);
  assert.equal(new Set(p.nodes.map(n => n.color)).size, p.nodes.length, 'distinct colors');
  assert.ok(!('order' in p) && !('order' in p0), 'the order is not public');
  assert.equal(JSON.stringify(p0).includes('"order"'), false);
  assert.equal(p0.nextColor, p.nodes[secret.order[0]].color, 'only the next color is public');
  for (let i = 0; i < p.nodes.length; i++) for (let j = i + 1; j < p.nodes.length; j++) assert.ok(dist(p.nodes[i], p.nodes[j]) > 2 * p.r, 'nodes do not overlap');
  const right = p.nodes[secret.order[0]];
  const wrongIdx = secret.order[1];
  let r = wiresStep(p, p0, secret, 1000, right);
  assert.equal(r.prog.since, 1000);
  r = wiresStep(p, r.prog, secret, 1000 + p.dwellMs - 1, right);
  assert.equal(r.event, null);
  r = wiresStep(p, r.prog, secret, 1000 + p.dwellMs, right);
  assert.equal(r.event, 'wire');
  assert.equal(r.prog.pos, 1);
  assert.deepEqual(r.prog.done, [secret.order[0]]);
  assert.equal(r.prog.nextColor, p.nodes[secret.order[1]].color);
  // Wrong node (the third in the order, not asked for yet): strike after settling on it.
  const w3 = p.nodes[secret.order[2] ?? wrongIdx];
  const far = { x: 0.1, y: 0.1 };
  r = wiresStep(p, r.prog, secret, 2000, far);
  if (secret.order.length > 2) {
    r = wiresStep(p, r.prog, secret, 2100, w3);
    assert.equal(r.prog.wrongSince, 2100);
    r = wiresStep(p, r.prog, secret, 2100 + WRONG_MS, w3);
    assert.equal(r.event, 'strike');
    assert.equal(r.prog.strikes, 1);
    assert.equal(wiresStep(p, r.prog, secret, 5000, w3).prog, r.prog, 'staying does not stack strikes');
  }
  // Done nodes are harmless.
  r = wiresStep(p, r.prog, secret, 6000, far);
  assert.equal(wiresStep(p, r.prog, secret, 6100, right).prog.wrongSince, 0);
  // Finishing wins.
  const lastIdx = secret.order[secret.order.length - 1];
  const almost = { ...p0, pos: secret.order.length - 1, onNode: lastIdx, since: 100, done: secret.order.slice(0, -1) };
  const w = wiresStep(p, almost, secret, 100 + p.dwellMs, p.nodes[lastIdx]);
  assert.ok(w.won);
  assert.equal(w.prog.nextColor, -1);
  const s3 = stageSpec('wires', 3);
  assert.ok(s3.order > sp.order && s3.dwellMs < sp.dwellMs && s3.decoys > sp.decoys);
});

test('picker sampling: PICK_CARDS cards, never the game that just finished, laid out as given; a gap keeps the same cards; another picker can differ', () => {
  const cards = pickCards(seeded(5), 'maze');
  assert.equal(cards.length, PICK_CARDS);
  assert.equal(new Set(cards).size, PICK_CARDS, 'no duplicates');
  assert.ok(!cards.includes('maze'));
  assert.ok(cards.every(k => LEVEL_ROTATION.includes(k)));
  assert.ok(pickCards(seeded(5), undefined).length === PICK_CARDS);
  const layout = voteLayout(cards);
  assert.deepEqual(
    layout.map(c => c.kind),
    [...cards]
  );
  // A gap at the deadline: same cards, timer restarted.
  const prog = { endsAt: 10_000, restarts: 0 };
  const r = voteResolve({ cards: layout }, prog, VOTE_START.x, VOTE_START.y, 10_000);
  assert.ok(!('chosen' in r));
  if (!('chosen' in r)) assert.equal(r.prog.endsAt, 10_000 + VOTE_SECS * 1000);
  // Different draws differ (and over many draws every game shows up).
  const seen = new Set<string>();
  let differs = false;
  for (let s = 0; s < 60; s++) {
    const c = pickCards(seeded(100 + s), 'maze');
    c.forEach(k => seen.add(k));
    if (c.join() !== cards.join()) differs = true;
  }
  assert.ok(differs);
  assert.equal(seen.size, LEVEL_ROTATION.length - 1, 'every other game can come up');
});

test('stations: the numbers show for revealMs after play starts, then the crowd goes from memory; fewer stops by default', () => {
  const sp = stageSpec('stations', 1);
  const { params: p } = makeStations(seeded(14), sp);
  assert.equal(p.revealMs, sp.revealS * 1000);
  assert.ok(sp.revealS >= 3 && sp.stations <= 6);
  assert.ok(stationsRevealed(p, 0) && stationsRevealed(p, sp.revealS - 0.01));
  assert.ok(!stationsRevealed(p, sp.revealS) && !stationsRevealed(p, 60));
  assert.ok(stageSpec('stations', 3).revealS < sp.revealS, 'less time to memorize later');
});
