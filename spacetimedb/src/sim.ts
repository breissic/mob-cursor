// Pure game math. No SpacetimeDB imports so it can be unit-tested in Node.

export const WORLD_W = 16;
export const WORLD_H = 9;

export type Rule = 'mean' | 'median' | 'activity' | 'tug' | 'dictator';
export const RULES: Rule[] = ['mean', 'median', 'activity', 'tug', 'dictator'];

export type LevelKind = 'lobby' | 'targets' | 'maze' | 'minesweeper' | 'vote';
export const LEVEL_ROTATION: LevelKind[] = ['targets', 'maze', 'minesweeper'];

/** Player palette. Index is sent in ghost_frame, so client and server share it. */
export const COLORS = [
  '#ff4d6d', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b',
  '#3bc9db', '#f783ac', '#a9e34b', '#9775fa', '#ffa8a8', '#74c0fc',
];

export type Pt = { id: string; x: number; y: number; w: number; team: number };
export type Vec = { x: number; y: number };

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** Clip weights so no one exceeds `cap` of the total, then renormalize. */
export function capWeights(ws: number[], cap: number): number[] {
  const n = ws.length;
  if (n === 0) return ws;
  const c = Math.max(cap, 1 / n);
  let w = ws.map(v => (Number.isFinite(v) && v > 0 ? v : 0));
  let total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return w.map(() => 1 / n);
  w = w.map(v => v / total);
  for (let pass = 0; pass < 4; pass++) {
    let excess = 0;
    let freeTotal = 0;
    for (const v of w) {
      if (v > c) excess += v - c;
      else freeTotal += v;
    }
    if (excess <= 1e-9) break;
    w = w.map(v => (v > c ? c : freeTotal > 0 ? v + (excess * v) / freeTotal : v));
  }
  total = w.reduce((a, b) => a + b, 0);
  return w.map(v => v / total);
}

export function weightedMean(pts: Pt[], ws: number[]): Vec {
  let x = 0;
  let y = 0;
  for (let i = 0; i < pts.length; i++) {
    x += pts[i].x * ws[i];
    y += pts[i].y * ws[i];
  }
  return { x, y };
}

/** Weiszfeld geometric median: one troll far away barely moves it. */
export function geometricMedian(pts: Pt[]): Vec {
  let m = weightedMean(pts, pts.map(() => 1 / pts.length));
  for (let it = 0; it < 16; it++) {
    let nx = 0;
    let ny = 0;
    let den = 0;
    for (const p of pts) {
      const d = Math.max(Math.hypot(p.x - m.x, p.y - m.y), 1e-3);
      nx += p.x / d;
      ny += p.y / d;
      den += 1 / d;
    }
    const next = { x: nx / den, y: ny / den };
    if (Math.hypot(next.x - m.x, next.y - m.y) < 1e-4) return next;
    m = next;
  }
  return m;
}

/** Aggregate target for the crowd. `pts` are in world units. */
export function aggregate(
  rule: Rule,
  pts: Pt[],
  influenceCap: number,
  dictatorId: string
): Vec | null {
  if (pts.length === 0) return null;
  switch (rule) {
    case 'median':
      return geometricMedian(pts);
    case 'activity':
      return weightedMean(pts, capWeights(pts.map(p => p.w + 0.02), influenceCap));
    case 'tug': {
      const teams = [0, 1].map(t => pts.filter(p => p.team === t));
      const means = teams
        .filter(ts => ts.length > 0)
        .map(ts => weightedMean(ts, ts.map(() => 1 / ts.length)));
      // Each team pulls with equal force regardless of size.
      return {
        x: means.reduce((a, m) => a + m.x, 0) / means.length,
        y: means.reduce((a, m) => a + m.y, 0) / means.length,
      };
    }
    case 'dictator': {
      const d = pts.find(p => p.id === dictatorId);
      if (d) return { x: d.x, y: d.y };
      return weightedMean(pts, pts.map(() => 1 / pts.length));
    }
    case 'mean':
    default:
      return weightedMean(pts, capWeights(pts.map(() => 1), influenceCap));
  }
}

/** 0 = everyone pulls the same way, 1 = perfectly cancelling. */
export function chaos(pts: Pt[], cx: number, cy: number): number {
  if (pts.length < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 0.25) {
      sx += dx / d;
      sy += dy / d;
    }
  }
  return clamp(1 - Math.hypot(sx, sy) / pts.length, 0, 1);
}

export type Body = { x: number; y: number; vx: number; vy: number };

/** Mass-spring-damper toward target (unit mass). */
export function integrate(
  b: Body,
  target: Vec | null,
  dt: number,
  gain: number,
  damping: number,
  maxSpeed: number
): Body {
  let ax = -damping * b.vx;
  let ay = -damping * b.vy;
  if (target) {
    ax += gain * (target.x - b.x);
    ay += gain * (target.y - b.y);
  }
  let vx = b.vx + ax * dt;
  let vy = b.vy + ay * dt;
  const sp = Math.hypot(vx, vy);
  if (sp > maxSpeed) {
    vx = (vx / sp) * maxSpeed;
    vy = (vy / sp) * maxSpeed;
  }
  let x = b.x + vx * dt;
  let y = b.y + vy * dt;
  if (x < 0 || x > WORLD_W) {
    x = clamp(x, 0, WORLD_W);
    vx = -vx * 0.3;
  }
  if (y < 0 || y > WORLD_H) {
    y = clamp(y, 0, WORLD_H);
    vy = -vy * 0.3;
  }
  return { x, y, vx, vy };
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export type Rand = () => number;

// ---------------------------------------------------------------------------
// Stages: every minigame runs STAGES stages of rising difficulty.
// ---------------------------------------------------------------------------

export const STAGES = 3;
/** Seconds of 3-2-1 countdown before a stage goes live (cursor held still). */
export const COUNTDOWN_S = 3;

/** Common fields merged into every level's params JSON. */
export type StageMeta = { stage: number; stages: number; playAt: number };

export const STAGE_SPECS = {
  targets: [
    { n: 5, r: 0.75, move: 0, secs: 60 },
    { n: 7, r: 0.6, move: 0.9, secs: 60 },
    { n: 8, r: 0.5, move: 1.6, secs: 70 },
  ],
  maze: [
    { cw: 6, ch: 3, secs: 90 },
    { cw: 8, ch: 4, secs: 110 },
    { cw: 10, ch: 5, secs: 130 },
  ],
  minesweeper: [
    { cols: 9, rows: 5, mines: 6, secs: 150 },
    { cols: 12, rows: 7, mines: 13, secs: 180 },
    { cols: 14, rows: 8, mines: 20, secs: 210 },
  ],
} as const;

// ---------------------------------------------------------------------------
// Vote round: between games the mob parks the (extra strong) cursor on a card.
// ---------------------------------------------------------------------------

/** Seconds of voting after the 3-2-1 countdown. */
export const VOTE_SECS = 7;
/** Cursor strength multipliers during a vote. */
export const VOTE_GAIN = 2.5;
export const VOTE_SPEED = 2;

export type VoteCard = { kind: string; x: number; y: number; w: number; h: number };
export type VoteParams = { cards: VoteCard[]; lastKind?: string };
export type VoteProgress = { chosen?: string };

/** Lay the cards out side by side, centered, below a strip where the cursor starts. */
export function voteLayout(kinds: readonly string[]): VoteCard[] {
  const n = kinds.length;
  const gap = 0.5;
  const w = Math.min(4.4, (WORLD_W - 1 - gap * (n - 1)) / n);
  const h = 5.6;
  const total = n * w + (n - 1) * gap;
  const x0 = (WORLD_W - total) / 2;
  return kinds.map((kind, i) => ({ kind, x: x0 + i * (w + gap), y: 2.4, w, h }));
}

/** Card under the cursor, else the nearest card (someone always wins). */
export function voteWinner(cards: VoteCard[], x: number, y: number): VoteCard {
  const inside = cards.find(c => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
  if (inside) return inside;
  let best = cards[0];
  let bd = Infinity;
  for (const c of cards) {
    const d = Math.hypot(clamp(x, c.x, c.x + c.w) - x, clamp(y, c.y, c.y + c.h) - y);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Where the cursor waits during the vote countdown: top middle, outside every card. */
export const VOTE_START = { x: WORLD_W / 2, y: 1.2 };

/** Minesweeper auto-click fires after a random delay in this range (ms). */
export const AUTO_CLICK_MIN_MS = 2000;
export const AUTO_CLICK_MAX_MS = 30000;

export type TargetsParams = {
  targets: { x: number; y: number; ph?: number }[];
  r: number;
  /** Wobble amplitude in world units (0 = static targets). */
  move?: number;
};
export type TargetsProgress = { next: number };

/** Target position at `t` seconds after play starts (same math on server and client). */
export function targetPos(p: TargetsParams, i: number, t: number): Vec {
  const tg = p.targets[i];
  const a = p.move ?? 0;
  if (!a) return { x: tg.x, y: tg.y };
  const ph = tg.ph ?? 0;
  return {
    x: clamp(tg.x + a * Math.sin(t * 0.9 + ph), 0.6, WORLD_W - 0.6),
    y: clamp(tg.y + a * 0.7 * Math.cos(t * 0.63 + ph * 1.7), 0.6, WORLD_H - 0.6),
  };
}

export function makeTargets(rand: Rand, n = 6, r = 0.6, move = 0): TargetsParams {
  const targets: { x: number; y: number; ph: number }[] = [];
  let guard = 0;
  while (targets.length < n && guard++ < 500) {
    const p = { x: 1.2 + rand() * (WORLD_W - 2.4), y: 1.2 + rand() * (WORLD_H - 2.4) };
    const prev = targets[targets.length - 1] ?? { x: WORLD_W / 2, y: WORLD_H / 2 };
    // Far from the previous one so the crowd has to travel.
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > 4.5) targets.push({ ...p, ph: rand() * Math.PI * 2 });
  }
  return { targets, r, move };
}

export type MazeParams = {
  cols: number;
  rows: number;
  /** Row-major tiles, '#' wall, '.' floor. */
  tiles: string;
  start: { c: number; r: number };
  goal: { c: number; r: number };
};
/** frozenUntil: unix ms; the cursor is held at the start after a bonk. */
export type MazeProgress = { hits: number; frozenUntil: number };

/** Recursive-backtracker maze on a (2w+1) x (2h+1) tile grid. */
export function makeMaze(rand: Rand, cw = 7, ch = 4): MazeParams {
  const cols = cw * 2 + 1;
  const rows = ch * 2 + 1;
  const g: string[] = new Array(cols * rows).fill('#');
  const seen = new Array(cw * ch).fill(false);
  const stack: [number, number][] = [[0, 0]];
  seen[0] = true;
  g[1 * cols + 1] = '.';
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nbrs: [number, number][] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny * cw + nx]) nbrs.push([nx, ny]);
    }
    if (!nbrs.length) {
      stack.pop();
      continue;
    }
    const [nx, ny] = nbrs[Math.floor(rand() * nbrs.length) % nbrs.length];
    seen[ny * cw + nx] = true;
    g[(cy * 2 + 1 + (ny - cy)) * cols + (cx * 2 + 1 + (nx - cx))] = '.';
    g[(ny * 2 + 1) * cols + (nx * 2 + 1)] = '.';
    stack.push([nx, ny]);
  }
  // A few extra openings so there is more than one way through (crowd mercy).
  for (let i = 0; i < 4; i++) {
    const c = 1 + Math.floor(rand() * (cols - 2));
    const r = 1 + Math.floor(rand() * (rows - 2));
    if ((c % 2 === 0) !== (r % 2 === 0)) g[r * cols + c] = '.';
  }
  return {
    cols,
    rows,
    tiles: g.join(''),
    start: { c: 1, r: 1 },
    goal: { c: cols - 2, r: rows - 2 },
  };
}

export function tileAt(m: MazeParams, x: number, y: number): { c: number; r: number } {
  return {
    c: clamp(Math.floor((x / WORLD_W) * m.cols), 0, m.cols - 1),
    r: clamp(Math.floor((y / WORLD_H) * m.rows), 0, m.rows - 1),
  };
}

export function tileCenter(m: { cols: number; rows: number }, c: number, r: number): Vec {
  return { x: ((c + 0.5) / m.cols) * WORLD_W, y: ((r + 0.5) / m.rows) * WORLD_H };
}

/** True if the segment a->b passes through a wall tile. */
export function mazeHit(m: MazeParams, a: Vec, b: Vec): boolean {
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    const { c, r } = tileAt(m, x, y);
    if (m.tiles[r * m.cols + c] === '#') return true;
  }
  return false;
}

export type MinesParams = { cols: number; rows: number; mines: number; lives: number };
export type MinesProgress = {
  cells: string;
  lives: number;
  firstDone: boolean;
  /** Unix ms when the server auto-clicks wherever the cursor is. */
  nextAutoAt?: number;
};

export function makeMines(rand: Rand, cols = 12, rows = 7, mines = 12) {
  const n = cols * rows;
  const bits = new Array(n).fill('0');
  let placed = 0;
  while (placed < mines) {
    const i = Math.floor(rand() * n) % n;
    if (bits[i] === '0') {
      bits[i] = '1';
      placed++;
    }
  }
  const params: MinesParams = { cols, rows, mines, lives: 3 };
  const progress: MinesProgress = { cells: '#'.repeat(n), lives: 3, firstDone: false };
  return { params, progress, secret: bits.join('') };
}

export function cellAt(p: { cols: number; rows: number }, x: number, y: number) {
  return {
    c: clamp(Math.floor((x / WORLD_W) * p.cols), 0, p.cols - 1),
    r: clamp(Math.floor((y / WORLD_H) * p.rows), 0, p.rows - 1),
  };
}

/**
 * Reveal a cell. Returns the new secret (first click is always safe; the mine
 * is moved), the new progress and what happened.
 */
export function revealCell(
  p: MinesParams,
  prog: MinesProgress,
  secret: string,
  c: number,
  r: number
): { secret: string; prog: MinesProgress; result: 'noop' | 'safe' | 'mine' | 'won' | 'lost' } {
  const { cols, rows } = p;
  const idx = r * cols + c;
  const cells = prog.cells.split('');
  if (cells[idx] !== '#') return { secret, prog, result: 'noop' };
  let bits = secret.split('');
  if (!prog.firstDone && bits[idx] === '1') {
    bits[idx] = '0';
    const free = bits.findIndex((b, i) => b === '0' && i !== idx);
    bits[free] = '1';
  }
  bits = bits.slice();
  const count = (cc: number, rr: number) => {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = cc + dx;
        const y = rr + dy;
        if ((dx || dy) && x >= 0 && y >= 0 && x < cols && y < rows && bits[y * cols + x] === '1') k++;
      }
    return k;
  };
  let lives = prog.lives;
  let result: 'safe' | 'mine' | 'won' | 'lost' = 'safe';
  if (bits[idx] === '1') {
    cells[idx] = '*';
    lives -= 1;
    result = lives <= 0 ? 'lost' : 'mine';
  } else {
    const q: number[] = [idx];
    while (q.length) {
      const i = q.pop()!;
      if (cells[i] !== '#') continue;
      const cc = i % cols;
      const rr = Math.floor(i / cols);
      const k = count(cc, rr);
      cells[i] = String(k);
      if (k === 0)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = cc + dx;
            const y = rr + dy;
            if (x >= 0 && y >= 0 && x < cols && y < rows && bits[y * cols + x] !== '1') q.push(y * cols + x);
          }
    }
    const hidden = cells.filter((ch, i) => ch === '#' && bits[i] !== '1').length;
    if (hidden === 0) result = 'won';
  }
  return {
    secret: bits.join(''),
    prog: { ...prog, cells: cells.join(''), lives, firstDone: true },
    result,
  };
}

// ---------------------------------------------------------------------------
// SHA-256 (for the salted admin passphrase hash). Small, deterministic, no deps.
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** UTF-8 encode without relying on TextEncoder being present in the module runtime. */
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63)
      );
  }
  return Uint8Array.from(out);
}

export function sha256Hex(msg: string): string {
  const bytes = utf8(msg);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, x => x.toString(16).padStart(8, '0')).join('');
}
