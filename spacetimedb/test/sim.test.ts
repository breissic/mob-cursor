import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  capWeights,
  chaos,
  geometricMedian,
  ghostKey,
  integrate,
  makeMaze,
  makeMines,
  packGhosts,
  unpackGhosts,
  revealCell,
  sha256Hex,
  targetPos,
  STAGE_SPECS,
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

test('minesweeper: three mines loses', () => {
  const { params, progress, secret } = makeMines(seeded(3));
  let st = revealCell(params, progress, secret, 0, 0);
  const mines = [...st.secret].map((b, i) => (b === '1' ? i : -1)).filter(i => i >= 0);
  for (const i of mines.slice(0, 3)) st = revealCell(params, st.prog, st.secret, i % params.cols, Math.floor(i / params.cols));
  assert.equal(st.result, 'lost');
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
