// Pure game math. No SpacetimeDB imports so it can be unit-tested in Node.

export const WORLD_W = 16;
export const WORLD_H = 9;

export type Rule = 'mean' | 'median' | 'activity' | 'tug' | 'dictator';
export const RULES: Rule[] = ['mean', 'median', 'activity', 'tug', 'dictator'];

export type LevelKind =
  | 'lobby'
  | 'targets'
  | 'maze'
  | 'minesweeper'
  | 'redlight'
  | 'balloon'
  | 'mole'
  | 'potato'
  | 'chairs'
  | 'keyboard'
  | 'hunt'
  | 'valves'
  | 'stations'
  | 'vote';
/** A minigame the mob can play (everything but the lobby and the picker). */
export type PlayKind = Exclude<LevelKind, 'lobby' | 'vote'>;
/** Every playable game; the picker shows one card per entry, in this order. */
export const LEVEL_ROTATION: PlayKind[] = [
  'targets',
  'maze',
  'minesweeper',
  'redlight',
  'balloon',
  'mole',
  'potato',
  'chairs',
  'keyboard',
  'hunt',
  'valves',
  'stations',
];
export const isPlayKind = (k: string | null | undefined): k is PlayKind => (LEVEL_ROTATION as string[]).includes(k ?? '');

/** Player palette. Index is sent in ghost_frame, so client and server share it. */
export const COLORS = [
  '#ff4d6d', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b',
  '#3bc9db', '#f783ac', '#a9e34b', '#9775fa', '#ffa8a8', '#74c0fc',
];

export type Pt = { id: string; x: number; y: number; w: number; team: number };
export type Vec = { x: number; y: number };

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** The room everyone lands in when the link has no room code. */
export const DEFAULT_ROOM_ID = 0;
export const DEFAULT_ROOM_CODE = 'LOBBY';
/** Codes avoid 0/O/1/I so they survive being read out loud in a loud room. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 4;
/** Hard ceilings (the config row holds the live limits, clamped to these). */
export const MAX_ROOMS_CEILING = 200;
export const MAX_PLAYERS_CEILING = 200;
/** Empty non-default rooms are deleted after this long. */
export const ROOM_IDLE_S = 20 * 60;

export function makeRoomCode(rand: Rand): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length];
  return s;
}
export const normalizeRoomCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

/** Per-room client pointer rate: the budget is per room so a full room cannot starve the others. */
export function pointerHzFor(pointerHz: number, pointerBudget: number, players: number): number {
  return Math.round(clamp(Math.min(pointerHz, pointerBudget / Math.max(1, players)), 1, 30) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Crowd aggregation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cursor physics
// ---------------------------------------------------------------------------

export type Body = { x: number; y: number; vx: number; vy: number };

/**
 * Damping values the admin slider may offer at a given tick rate. The
 * integrator below is exact for any damping, but past damping*dt = 2 the
 * velocity dies by >86% inside one tick, so the cursor just stops dead; keep
 * the slider in the range where damping still reads as "heavier".
 */
export const dampingMax = (tickHz: number) => Math.max(1, Math.round(2 * Math.max(1, tickHz)));
/** Spring gain the slider may offer: keeps the undamped period at least ~7 ticks so the motion stays readable. */
export const gainMax = (tickHz: number) => Math.max(1, Math.floor((3 * tickHz * tickHz) / 4));

/**
 * One axis of the damped oscillator u'' + d u' + g u = 0, solved in closed form
 * over `dt` (u = offset from the target). Exact for any step size, so damping
 * at or above critical (d >= 2*sqrt(g)) can never overshoot or reverse, and
 * under-damped springs decay exactly as physics says instead of blowing up.
 */
function springAxis(u: number, v: number, dt: number, g: number, d: number): { u: number; v: number } {
  if (g <= 0) {
    // No spring: pure exponential decay of velocity.
    const e = d > 0 ? Math.exp(-d * dt) : 1;
    const f = d > 0 ? (1 - e) / d : dt;
    return { u: u + v * f, v: v * e };
  }
  const disc = d * d - 4 * g;
  if (disc > 1e-9) {
    // Over-damped: two real decay rates.
    const s = Math.sqrt(disc);
    const r1 = (-d + s) / 2;
    const r2 = (-d - s) / 2;
    const B = (v - r1 * u) / (r2 - r1);
    const A = u - B;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    return { u: A * e1 + B * e2, v: A * r1 * e1 + B * r2 * e2 };
  }
  if (disc > -1e-9) {
    // Critically damped.
    const w = d / 2;
    const e = Math.exp(-w * dt);
    const c = v + w * u;
    return { u: (u + c * dt) * e, v: (c - w * (u + c * dt)) * e };
  }
  // Under-damped: decaying oscillation at wd.
  const wd = Math.sqrt(-disc) / 2;
  const a = d / 2;
  const e = Math.exp(-a * dt);
  const cos = Math.cos(wd * dt);
  const sin = Math.sin(wd * dt);
  const c2 = (v + a * u) / wd;
  const nu = e * (u * cos + c2 * sin);
  const du = e * (-u * wd * sin + c2 * wd * cos); // derivative of the bracket
  return { u: nu, v: du - a * nu };
}

/**
 * Mass-spring-damper toward target (unit mass), advanced `dt` seconds with the
 * exact solution per axis. The old explicit step, v += (-damping*v + ...)*dt,
 * flipped the velocity's sign once damping*dt > 1 and grew once it passed 2: at
 * a 15 Hz tick the admin slider's 30 sat right on that line, so "more damping"
 * made the cursor bounce. Here raising damping only ever makes the cursor
 * heavier; lowering it makes it looser.
 */
export function integrate(
  b: Body,
  target: Vec | null,
  dt: number,
  gain: number,
  damping: number,
  maxSpeed: number
): Body {
  const tx = target ? target.x : b.x;
  const ty = target ? target.y : b.y;
  const g = target ? gain : 0;
  const sx = springAxis(b.x - tx, b.vx, dt, g, damping);
  const sy = springAxis(b.y - ty, b.vy, dt, g, damping);
  let vx = sx.v;
  let vy = sy.v;
  let x = tx + sx.u;
  let y = ty + sy.u;
  const sp = Math.hypot(vx, vy);
  if (sp > maxSpeed) {
    // Speed cap: scale the velocity and move with the capped velocity instead of the exact arc.
    vx = (vx / sp) * maxSpeed;
    vy = (vy / sp) * maxSpeed;
    x = b.x + vx * dt;
    y = b.y + vy * dt;
  }
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

export type Spring = { gain: number; damping: number; maxSpeed: number };
/** Cursor strength multipliers during a vote. */
export const VOTE_GAIN = 2.5;
export const VOTE_DAMPING = 1.3;
export const VOTE_SPEED = 2;
/**
 * Spring the tick runs for the current running level kind. Shared with the
 * client so its cursor prediction always integrates the same physics.
 */
export function cursorPhysics(kind: string | null | undefined, cfg: Spring): Spring {
  return kind === 'vote'
    ? { gain: cfg.gain * VOTE_GAIN, damping: cfg.damping * VOTE_DAMPING, maxSpeed: cfg.maxSpeed * VOTE_SPEED }
    : { gain: cfg.gain, damping: cfg.damping, maxSpeed: cfg.maxSpeed };
}

// ---------------------------------------------------------------------------
// Stages and per-mode settings
// ---------------------------------------------------------------------------

export type Rand = () => number;

export const STAGES = 3;
/** Seconds of 3-2-1 countdown before a stage goes live (cursor held still). */
export const COUNTDOWN_S = 3;

/** Common fields merged into every level's params JSON. */
export type StageMeta = { stage: number; stages: number; playAt: number };

/** Every numeric knob of a mode. Stage 1 plays exactly these; stages 2-3 harden them (STAGE_RULES). */
export type ModeSettings = Record<string, number>;
export type SettingDef = {
  key: string;
  label: string;
  /** What raising this does, for the admin screen. */
  up: string;
  min: number;
  max: number;
  step: number;
  def: number;
};

const S = (key: string, label: string, up: string, def: number, min: number, max: number, step: number): SettingDef => ({ key, label, up, def, min, max, step });

/**
 * Party-length defaults: one stage is about a minute of real work (60-90 s
 * limits), so a 3-stage game fits in a few minutes and the picker comes back
 * around before anyone's phone locks. Admins can stretch any of these.
 */
export const MODE_SETTINGS: Record<PlayKind, SettingDef[]> = {
  targets: [
    S('n', 'Targets', 'more targets to hit, longer stage', 8, 3, 40, 1),
    S('r', 'Target radius', 'bigger, easier targets', 0.75, 0.3, 1.5, 0.05),
    S('move', 'Target wobble', 'targets drift further from their spot', 0, 0, 3, 0.1),
    S('strikes', 'Wrong-target strikes', 'more out-of-order touches allowed before the stage fails', 3, 1, 20, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 75, 30, 600, 5),
  ],
  maze: [
    S('cw', 'Maze width (cells)', 'wider maze, longer path, narrower corridors', 8, 4, 18, 1),
    S('ch', 'Maze height (cells)', 'taller maze, longer path, narrower corridors', 4, 3, 9, 1),
    S('bonks', 'Wall bonks allowed', 'more wall hits allowed before the stage fails', 5, 1, 50, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 90, 30, 600, 5),
  ],
  minesweeper: [
    S('cols', 'Columns', 'more cells to clear', 8, 5, 20, 1),
    S('rows', 'Rows', 'more cells to clear', 5, 3, 11, 1),
    S('mines', 'Mines', 'more bombs, more danger', 5, 1, 80, 1),
    S('autoMinS', 'Auto-click gap min (s)', 'longer quiet spell before the cursor clicks itself', 2, 0, 60, 1),
    S('autoMaxS', 'Auto-click gap max (s)', 'random clicks spread further apart', 12, 1, 120, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 90, 30, 600, 5),
  ],
  redlight: [
    S('lanes', 'Path lanes', 'longer walk for the doll', 2, 1, 4, 1),
    S('speed', 'Doll speed (u/s)', 'doll walks faster on green', 0.75, 0.2, 2, 0.05),
    S('leash', 'Leash radius', 'cursor may stray further from the doll and she still walks', 1.6, 0.4, 4, 0.1),
    S('greenMinS', 'Green window min (s)', 'longer green lights', 3, 0.5, 15, 0.5),
    S('greenMaxS', 'Green window max (s)', 'longer green lights', 5, 0.5, 20, 0.5),
    S('redMinS', 'Red window min (s)', 'longer freezes', 1.5, 0.5, 15, 0.5),
    S('redMaxS', 'Red window max (s)', 'longer freezes', 3, 0.5, 20, 0.5),
    S('fakeP', 'Fake-out chance', 'more greens that die immediately', 0.15, 0, 0.9, 0.05),
    S('deadband', 'Red dead-band', 'more wiggle allowed on red before it counts as moving', 0.35, 0.05, 2, 0.05),
    S('graceMs', 'Red grace (ms)', 'longer settle time after red before movement counts', 600, 0, 3000, 50),
    S('rewind', 'Rewind (units)', 'a fault sends the doll further back', 3, 0.5, 30, 0.5),
    S('faults', 'Fault cap', 'more faults allowed before the stage fails', 5, 1, 30, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 90, 30, 600, 5),
  ],
  balloon: [
    S('n', 'Balloons', 'more balloons in the air at once', 1, 1, 4, 1),
    S('gravity', 'Gravity', 'balloons fall faster', 1.5, 0.3, 6, 0.1),
    S('wind', 'Wind', 'balloons drift sideways harder', 0, 0, 4, 0.1),
    S('drops', 'Lives', 'more drops allowed before the stage fails', 3, 1, 10, 1),
    S('saves', 'Saves to win', 'more bops needed, longer stage', 20, 5, 200, 5),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 75, 30, 600, 5),
  ],
  mole: [
    S('holes', 'Holes', 'more holes to watch', 6, 2, 12, 1),
    S('upMs', 'Mole window (ms)', 'moles stay up longer, easier', 2000, 400, 6000, 100),
    S('gapMs', 'Gap between moles (ms)', 'longer breathers between moles', 600, 100, 3000, 100),
    S('target', 'Whacks to win', 'more hits needed, longer stage', 15, 3, 150, 1),
    S('misses', 'Miss cap', 'more misses allowed before the stage fails', 6, 1, 50, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 75, 30, 600, 5),
  ],
  potato: [
    S('rounds', 'Deliveries', 'more buckets to reach in a row, longer stage', 5, 1, 30, 1),
    S('fuseS', 'Fuse per delivery (s)', 'more time to reach each bucket', 12, 3, 60, 1),
    S('r', 'Bucket radius', 'bigger, easier bucket', 1.5, 0.4, 3, 0.05),
    S('move', 'Bucket wander', 'bucket drifts around more', 0, 0, 4, 0.1),
  ],
  chairs: [
    S('chairs', 'Chairs', 'more rounds (one chair goes per round), longer stage', 6, 2, 16, 1),
    S('w', 'Chair width', 'bigger, easier chairs', 2.0, 0.8, 4, 0.1),
    S('h', 'Chair height', 'bigger, easier chairs', 1.5, 0.6, 3, 0.1),
    S('musicMinS', 'Music min (s)', 'longer rounds of music', 5, 1, 40, 1),
    S('musicMaxS', 'Music max (s)', 'longer rounds of music', 9, 1, 60, 1),
    S('warnS', 'Stop warning (s)', 'longer "music stopping" warning', 2, 0, 6, 0.1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 90, 30, 600, 5),
  ],
  keyboard: [
    S('dwellMs', 'Key dwell (ms)', 'must hold each letter longer', 900, 200, 4000, 50),
    S('typos', 'Typo cap', 'more wrong keys allowed before the stage fails', 4, 1, 50, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 90, 30, 600, 5),
  ],
  hunt: [
    S('finds', 'Targets to find', 'more hidden targets, longer stage', 3, 1, 20, 1),
    S('radius', 'Find radius', 'bigger hot spot, easier to dwell on', 1.2, 0.3, 3, 0.05),
    S('dwellS', 'Dwell (s)', 'must sit on the target longer', 1.5, 0.5, 10, 0.5),
    S('noise', 'Meter noise', 'warmer/colder reading jitters more', 0.08, 0, 0.4, 0.01),
    S('decoys', 'Decoy traps', 'more fake warm spots that never get hot; sitting on one springs it', 2, 0, 8, 1),
    S('traps', 'Traps allowed', 'more sprung decoys allowed before the stage fails', 2, 1, 20, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 90, 30, 600, 5),
  ],
  valves: [
    S('valves', 'Valves', 'more valves to juggle', 3, 1, 8, 1),
    S('drift', 'Drift (per s)', 'unheld valves fall out of the zone faster', 0.02, 0.005, 0.2, 0.005),
    S('fill', 'Fill rate (per s)', 'a held valve rises faster', 0.35, 0.05, 2, 0.05),
    S('holdS', 'Hold to win (s)', 'all valves must stay in zone longer', 6, 2, 60, 1),
    S('blowCap', 'Blowout cap', 'more empty/overflow blowouts allowed before the stage fails', 3, 1, 20, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 90, 30, 600, 5),
  ],
  stations: [
    S('stations', 'Stations', 'more stops to visit in order, longer stage', 8, 2, 40, 1),
    S('dwellS', 'Dwell per station (s)', 'must sit on each station longer', 2, 0.5, 10, 0.1),
    S('r', 'Station radius', 'bigger, easier stations', 0.9, 0.3, 3, 0.05),
    S('skips', 'Early leaves allowed', 'more half-finished stops allowed before the stage fails', 3, 1, 50, 1),
    S('secs', 'Time limit (s)', 'more time before the stage fails', 75, 30, 600, 5),
  ],
};

type StageRule = { mul?: [number, number]; add?: [number, number] };
/** How stages 2 and 3 harden each knob on top of the (editable) stage-1 defaults. */
export const STAGE_RULES: Record<PlayKind, Record<string, StageRule>> = {
  targets: { n: { add: [4, 8] }, r: { mul: [0.8, 0.65] }, move: { add: [0.9, 1.6] }, strikes: { add: [0, -1] }, secs: { add: [15, 30] } },
  maze: { cw: { add: [3, 6] }, ch: { add: [2, 3] }, bonks: { add: [-1, -2] }, secs: { add: [15, 30] } },
  minesweeper: { cols: { add: [3, 5] }, rows: { add: [2, 3] }, mines: { mul: [2.2, 3.3] }, autoMaxS: { mul: [0.8, 0.65] }, secs: { add: [15, 30] } },
  redlight: {
    lanes: { add: [1, 1] },
    speed: { add: [0.05, 0.1] },
    leash: { mul: [0.8, 0.65] },
    greenMinS: { mul: [0.8, 0.65] },
    greenMaxS: { mul: [0.8, 0.65] },
    redMaxS: { add: [0.5, 1] },
    fakeP: { add: [0.1, 0.2] },
    deadband: { mul: [0.85, 0.7] },
    rewind: { add: [2, 4] },
    faults: { add: [-1, -2] },
    secs: { add: [15, 30] },
  },
  balloon: { n: { add: [0, 1] }, gravity: { add: [0.4, 0.7] }, wind: { add: [0.9, 1.3] }, saves: { add: [10, 20] }, secs: { add: [10, 20] } },
  mole: { holes: { add: [2, 4] }, upMs: { mul: [0.8, 0.63] }, target: { add: [5, 10] }, misses: { add: [-1, -2] }, secs: { add: [15, 30] } },
  potato: { rounds: { add: [2, 4] }, fuseS: { mul: [0.8, 0.65] }, r: { mul: [0.85, 0.7] }, move: { add: [1.8, 2.8] } },
  chairs: { chairs: { add: [2, 4] }, w: { mul: [0.85, 0.75] }, h: { mul: [0.85, 0.75] }, musicMinS: { mul: [0.9, 0.8] }, musicMaxS: { mul: [0.9, 0.8] }, warnS: { mul: [0.65, 0.4] }, secs: { add: [15, 30] } },
  keyboard: { dwellMs: { mul: [0.82, 0.68] }, typos: { add: [-1, -2] }, secs: { add: [15, 30] } },
  hunt: { finds: { add: [1, 2] }, radius: { mul: [0.83, 0.67] }, dwellS: { add: [0.5, 1] }, noise: { add: [0.04, 0.07] }, decoys: { add: [1, 2] }, traps: { add: [0, -1] }, secs: { add: [15, 30] } },
  valves: { valves: { add: [1, 2] }, drift: { add: [0.005, 0.008] }, holdS: { add: [2, 5] }, secs: { add: [15, 30] } },
  stations: { stations: { add: [2, 4] }, dwellS: { mul: [0.83, 0.73] }, r: { mul: [0.89, 0.78] }, skips: { add: [0, -1] }, secs: { add: [10, 20] } },
};

function snap(def: SettingDef, v: number) {
  const c = clamp(v, def.min, def.max);
  return def.step >= 1 ? Math.round(c) : Math.round(c / def.step) * def.step;
}

/** Stage-1 settings for a mode: shipped defaults overlaid with the admin's saved JSON (unknown keys ignored, values clamped). */
export function settingsFor(kind: PlayKind, savedJson?: string | null): ModeSettings {
  let saved: Record<string, unknown> = {};
  if (savedJson) {
    try {
      const parsed = JSON.parse(savedJson) as unknown;
      if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
    } catch {
      saved = {};
    }
  }
  const out: ModeSettings = {};
  for (const def of MODE_SETTINGS[kind]) {
    const v = saved[def.key];
    out[def.key] = typeof v === 'number' && Number.isFinite(v) ? snap(def, v) : def.def;
  }
  return out;
}

/** Settings json accepted by the server: only known keys, clamped; '' when nothing differs from the defaults. */
export function sanitizeSettings(kind: PlayKind, raw: Record<string, unknown>): ModeSettings {
  const out: ModeSettings = {};
  for (const def of MODE_SETTINGS[kind]) {
    const v = raw[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = snap(def, v);
  }
  return out;
}

/** The numbers a given stage actually plays: stage 1 = settings as saved; later stages harden them. */
export function stageSpec(kind: PlayKind, stage: number, base: ModeSettings = settingsFor(kind)): ModeSettings {
  const k = clamp(Math.round(stage), 1, STAGES) - 2; // -1 for stage 1, 0 / 1 for stages 2 / 3
  const out: ModeSettings = { ...base };
  if (k < 0) return out;
  const defs = new Map(MODE_SETTINGS[kind].map(d => [d.key, d]));
  for (const [key, rule] of Object.entries(STAGE_RULES[kind])) {
    const def = defs.get(key);
    if (!def || out[key] === undefined) continue;
    let v = out[key];
    if (rule.mul) v *= rule.mul[k];
    if (rule.add) v += rule.add[k];
    out[key] = snap(def, v);
  }
  // Keep min/max pairs sane whatever the admin saved.
  for (const [lo, hi] of [
    ['greenMinS', 'greenMaxS'],
    ['redMinS', 'redMaxS'],
    ['musicMinS', 'musicMaxS'],
    ['autoMinS', 'autoMaxS'],
  ])
    if (out[lo] !== undefined && out[hi] !== undefined && out[hi] < out[lo]) out[hi] = out[lo];
  return out;
}

/** Deadline for a stage in seconds: `secs` where the mode has one, else derived from its work. */
export function stageSeconds(kind: PlayKind, sp: ModeSettings): number {
  if (kind === 'potato') return sp.rounds * sp.fuseS + 2;
  return sp.secs;
}

export type Rect = { x: number; y: number; w: number; h: number };
export const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// ---------------------------------------------------------------------------
// Picker round: between games the mob parks the (extra strong) cursor on a card.
// ---------------------------------------------------------------------------

/** Seconds on the picker timer (after the 3-2-1 countdown, and after every restart). */
export const VOTE_SECS = 5;

export type VoteCard = Rect & { kind: string };
export type VoteParams = { cards: VoteCard[]; lastKind?: string };
/** endsAt: server unix ms when the timer hits zero (mirrors level.deadline so the display can draw it). */
export type VoteProgress = { endsAt: number; restarts: number; chosen?: string };

/** Top strip (title, timer, cursor start) is above this; cards fill the rest in up to two rows. */
const VOTE_TOP = 1.9;

/** Lay the cards out in a centered grid (one row up to 4 cards, else two rows), below the strip where the cursor starts. */
export function voteLayout(kinds: readonly string[]): VoteCard[] {
  const n = kinds.length;
  const cols = n <= 4 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / cols);
  const gap = 0.35;
  const w = Math.min(4.4, (WORLD_W - 0.6 - gap * (cols - 1)) / cols);
  const h = (WORLD_H - 0.3 - VOTE_TOP - gap * (rows - 1)) / rows;
  const out: VoteCard[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const x0 = (WORLD_W - (inRow * w + (inRow - 1) * gap)) / 2;
    for (let c = 0; c < inRow; c++) out.push({ kind: kinds[r * cols + c], x: x0 + c * (w + gap), y: VOTE_TOP + r * (h + gap), w, h });
  }
  return out;
}

/** The card whose rect contains the cursor, or null when the cursor is in a gap. Hover is purely geometric. */
export function voteHover(cards: VoteCard[], x: number, y: number): VoteCard | null {
  return cards.find(c => inRect(c, x, y)) ?? null;
}

/**
 * Timer hit zero: the hovered card is the next game. In a gap nothing is picked;
 * the picker stays up and the timer restarts for another VOTE_SECS.
 */
export function voteResolve(p: VoteParams, prog: VoteProgress, x: number, y: number, nowMs: number): { chosen: VoteCard } | { prog: VoteProgress } {
  const hover = voteHover(p.cards, x, y);
  if (hover) return { chosen: hover };
  return { prog: { ...prog, endsAt: nowMs + VOTE_SECS * 1000, restarts: prog.restarts + 1 } };
}

/** Where the cursor waits during the picker countdown: top middle, outside every card. */
export const VOTE_START = { x: WORLD_W / 2, y: 1.2 };

/**
 * Level deadlines and in-progress timers are wall-clock unix ms. When the tick
 * resumes after a pause, every known timer field moves with the level's playAt.
 */
const TIMER_KEYS = ['frozenUntil', 'flipAt', 'litAt', 'at', 'until', 'fuseAt', 'stopAt', 'safeUntil', 'since', 'endsAt', 'nextAutoAt', 'dwellSince', 'allInSince', 'barsAt'];
export function shiftLevelTimes<T extends Record<string, unknown>>(prog: T, dMs: number): T {
  const out: Record<string, unknown> = { ...prog };
  for (const k of TIMER_KEYS) {
    const v = out[k];
    if (typeof v === 'number' && v > 0) out[k] = v + dMs;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Clickfest
// ---------------------------------------------------------------------------

export type TargetsParams = {
  targets: { x: number; y: number; ph?: number }[];
  r: number;
  /** Wobble amplitude in world units (0 = static targets). */
  move?: number;
  /** Out-of-order touches allowed before the stage is lost. */
  strikeCap: number;
};
/** on: the wrong target the cursor is currently sitting on (-1 = none); it strikes once per entry. */
export type TargetsProgress = { next: number; strikes: number; on: number };

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

/**
 * `n` points, each at least `minHop` away from the previous one so the crowd has
 * to travel, and at least `minGap` away from every other one so "touch the wrong
 * one" rules are fair (nothing hides under something else).
 */
export function scatter(rand: Rand, n: number, minHop: number, margin: number, minGap = 0): { x: number; y: number; ph: number }[] {
  const out: { x: number; y: number; ph: number }[] = [];
  let guard = 0;
  let hop = minHop;
  let gap = minGap;
  while (out.length < n && guard++ < 4000) {
    if (guard % 200 === 0) {
      // Never spin forever on a tiny field.
      hop *= 0.8;
      gap *= 0.8;
    }
    const p = { x: margin + rand() * (WORLD_W - 2 * margin), y: margin + rand() * (WORLD_H - 2 * margin) };
    const prev = out[out.length - 1] ?? { x: WORLD_W / 2, y: WORLD_H / 2 };
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > hop && out.every(o => Math.hypot(p.x - o.x, p.y - o.y) > gap)) out.push({ ...p, ph: rand() * Math.PI * 2 });
  }
  return out;
}

export function makeTargets(rand: Rand, n = 6, r = 0.6, move = 0, strikeCap = 3): TargetsParams {
  return { targets: scatter(rand, n, 4.5, 1.2, 2 * r + 0.6), r, move, strikeCap };
}

/**
 * One tick. Touching the next target hits it; touching any other un-hit target
 * (while not on the right one) is a strike, once per visit. Returns the same
 * `prog` when nothing changed; `at` is where the hit/zap happened.
 */
export function targetsStep(p: TargetsParams, prog: TargetsProgress, t: number, cur: Vec): { prog: TargetsProgress; event: 'hit' | 'zap' | null; at: Vec | null; won: boolean } {
  const n = p.targets.length;
  if (prog.next >= n) return { prog, event: null, at: null, won: true };
  const tg = targetPos(p, prog.next, t);
  if (dist(cur, tg) <= p.r) {
    const next = prog.next + 1;
    return { prog: { next, strikes: prog.strikes, on: -1 }, event: 'hit', at: tg, won: next >= n };
  }
  // Wrong ones (a hair smaller than the real hit radius so grazing a rim is not a strike).
  let on = -1;
  let at: Vec | null = null;
  for (let i = prog.next + 1; i < n; i++) {
    const q = targetPos(p, i, t);
    if (dist(cur, q) <= p.r * 0.9) {
      on = i;
      at = q;
      break;
    }
  }
  if (on === prog.on) return { prog, event: null, at: null, won: false };
  if (on < 0) return { prog: { ...prog, on: -1 }, event: null, at: null, won: false };
  return { prog: { ...prog, strikes: prog.strikes + 1, on }, event: 'zap', at, won: false };
}

// ---------------------------------------------------------------------------
// Maze
// ---------------------------------------------------------------------------

export type MazeParams = {
  cols: number;
  rows: number;
  /** Row-major tiles, '#' wall, '.' floor. */
  tiles: string;
  start: { c: number; r: number };
  goal: { c: number; r: number };
  /** Wall hits allowed before the stage is lost. */
  bonkCap: number;
};
/** frozenUntil: unix ms; the cursor is held at the start after a bonk. */
export type MazeProgress = { hits: number; frozenUntil: number };

/** Recursive-backtracker maze on a (2w+1) x (2h+1) tile grid. */
export function makeMaze(rand: Rand, cw = 7, ch = 4, bonkCap = 5): MazeParams {
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
    bonkCap,
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

// ---------------------------------------------------------------------------
// Mob Sweeper
// ---------------------------------------------------------------------------

export type MinesParams = { cols: number; rows: number; mines: number; lives: number; autoMinS: number; autoMaxS: number };
export type MinesProgress = {
  cells: string;
  lives: number;
  firstDone: boolean;
  /** Unix ms when the server clicks the cell under the cursor (the only way a cell is ever revealed). */
  nextAutoAt?: number;
};

/** Random delay (ms) until the next auto-click. */
export function autoClickMs(p: { autoMinS: number; autoMaxS: number }, rand: Rand): number {
  const lo = Math.min(p.autoMinS, p.autoMaxS);
  const hi = Math.max(p.autoMinS, p.autoMaxS);
  return Math.round((lo + rand() * (hi - lo)) * 1000);
}

export function makeMines(rand: Rand, cols = 12, rows = 7, mines = 12, autoMinS = 2, autoMaxS = 25) {
  const n = cols * rows;
  mines = Math.min(mines, n - 2);
  const bits = new Array(n).fill('0');
  let placed = 0;
  while (placed < mines) {
    const i = Math.floor(rand() * n) % n;
    if (bits[i] === '0') {
      bits[i] = '1';
      placed++;
    }
  }
  // One life: a bomb ends the stage on the spot, like real Minesweeper.
  const params: MinesParams = { cols, rows, mines, lives: 1, autoMinS, autoMaxS };
  const progress: MinesProgress = { cells: '#'.repeat(n), lives: 1, firstDone: false };
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
    // Game over: show every other mine ('m') like classic Minesweeper.
    if (result === 'lost') bits.forEach((b, i) => b === '1' && cells[i] === '#' && (cells[i] = 'm'));
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

/** Same wobble as moving targets: a point that drifts around its anchor over time. */
function wobble(anchor: Vec, amp: number, t: number, ph: number, margin: number): Vec {
  if (!amp) return { x: anchor.x, y: anchor.y };
  return {
    x: clamp(anchor.x + amp * Math.sin(t * 0.9 + ph), margin, WORLD_W - margin),
    y: clamp(anchor.y + amp * 0.7 * Math.cos(t * 0.63 + ph * 1.7), margin, WORLD_H - margin),
  };
}

// ---------------------------------------------------------------------------
// Red Light, Green Light: a doll walks a long path. She only steps while the
// light is green AND the cursor is within the leash of her. Moving on red
// rewinds her and counts a fault.
// ---------------------------------------------------------------------------

/** Playfield strip reserved for the traffic light. */
export const REDLIGHT_TOP = 1.7;

export type RedlightParams = {
  /** Polyline the doll walks, start to finish. */
  path: Vec[];
  /** Total path length (units). */
  length: number;
  speed: number;
  leash: number;
  greenMinS: number;
  greenMaxS: number;
  redMinS: number;
  redMaxS: number;
  fakeP: number;
  deadband: number;
  graceMs: number;
  rewind: number;
  faultCap: number;
};
/**
 * s: doll distance along the path at time `at`; while `walking` she advances
 * `speed` units per second from there (client and server extrapolate alike, so
 * the row only changes on events). fake: this green dies after FAKE_MS.
 */
export type RedlightProgress = {
  light: 'green' | 'red';
  flipAt: number;
  litAt: number;
  fake: boolean;
  s: number;
  at: number;
  walking: boolean;
  faults: number;
  anchor: Vec | null;
};
/** How long a fake-out green stays lit. */
export const FAKE_MS = 450;

/** Serpentine path across the track: `lanes` horizontal runs joined by short vertical hops. */
export function redlightPath(lanes: number): Vec[] {
  const n = Math.max(1, Math.round(lanes));
  const x0 = 1;
  const x1 = WORLD_W - 1;
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const y = REDLIGHT_TOP + ((i + 0.5) / n) * (WORLD_H - REDLIGHT_TOP - 0.2) + 0.1;
    // Each lane starts where the previous one ended, so consecutive points also form the vertical hop.
    const [a, b] = i % 2 === 0 ? [x0, x1] : [x1, x0];
    pts.push({ x: a, y }, { x: b, y });
  }
  return pts;
}

export function pathLength(path: Vec[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += dist(path[i - 1], path[i]);
  return l;
}

/** Point `s` units along the polyline (clamped to its ends). */
export function pathPos(path: Vec[], s: number): Vec {
  if (path.length === 0) return { x: 0, y: 0 };
  if (s <= 0) return { ...path[0] };
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (s <= seg) {
      const f = seg > 0 ? s / seg : 0;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * f, y: path[i - 1].y + (path[i].y - path[i - 1].y) * f };
    }
    s -= seg;
  }
  return { ...path[path.length - 1] };
}

export function redlightWindowMs(p: RedlightParams, light: 'green' | 'red', rand: Rand) {
  const [lo, hi] = light === 'green' ? [p.greenMinS, p.greenMaxS] : [p.redMinS, p.redMaxS];
  return Math.round((lo + rand() * Math.max(0, hi - lo)) * 1000);
}

export function makeRedlight(rand: Rand, sp: ModeSettings, playAt: number): { params: RedlightParams; progress: RedlightProgress } {
  const path = redlightPath(sp.lanes);
  const params: RedlightParams = {
    path,
    length: pathLength(path),
    speed: sp.speed,
    leash: sp.leash,
    greenMinS: sp.greenMinS,
    greenMaxS: sp.greenMaxS,
    redMinS: sp.redMinS,
    redMaxS: sp.redMaxS,
    fakeP: sp.fakeP,
    deadband: sp.deadband,
    graceMs: sp.graceMs,
    rewind: sp.rewind,
    faultCap: sp.faults,
  };
  const progress: RedlightProgress = {
    light: 'green',
    flipAt: playAt + redlightWindowMs(params, 'green', rand),
    litAt: playAt,
    fake: false,
    s: 0,
    at: playAt,
    walking: false,
    faults: 0,
    anchor: null,
  };
  return { params, progress };
}

/** Doll distance along the path at `nowMs`. */
export function dollS(p: RedlightParams, prog: RedlightProgress, nowMs: number): number {
  const s = prog.walking ? prog.s + (p.speed * Math.max(0, nowMs - prog.at)) / 1000 : prog.s;
  return clamp(s, 0, p.length);
}
export const dollPos = (p: RedlightParams, prog: RedlightProgress, nowMs: number) => pathPos(p.path, dollS(p, prog, nowMs));

export type RedlightEvent = 'green' | 'red' | 'fake' | 'fault';

/**
 * One tick. Returns the same `prog` object when nothing changed. The doll
 * walks only while green (not a fake-out) and the cursor is inside the leash.
 * On red, once the grace period is over, cursor movement past the dead-band is
 * a fault: the doll rewinds `rewind` units and the cursor must freeze again.
 */
export function redlightStep(
  p: RedlightParams,
  prog: RedlightProgress,
  cur: Vec,
  nowMs: number,
  rand: Rand
): { prog: RedlightProgress; events: RedlightEvent[]; won: boolean } {
  const events: RedlightEvent[] = [];
  let out = prog;
  const sNow = dollS(p, prog, nowMs);
  const rebase = (patch: Partial<RedlightProgress>) => (out = { ...out, s: sNow, at: nowMs, ...patch });
  if (nowMs >= prog.flipAt) {
    if (prog.light === 'green') {
      rebase({ light: 'red', litAt: nowMs, flipAt: nowMs + redlightWindowMs(p, 'red', rand), fake: false, anchor: null, walking: false });
      events.push(prog.fake ? 'fake' : 'red');
    } else {
      const fake = rand() < p.fakeP;
      rebase({ light: 'green', litAt: nowMs, flipAt: fake ? nowMs + FAKE_MS : nowMs + redlightWindowMs(p, 'green', rand), fake, anchor: null });
      events.push('green');
    }
  }
  if (out.light === 'red' && nowMs >= out.litAt + p.graceMs) {
    if (!out.anchor) rebase({ anchor: { x: cur.x, y: cur.y } });
    else if (dist(cur, out.anchor) > p.deadband) {
      // Moved on red: rewind the doll (never below the start) and re-arm after the grace period.
      out = { ...out, s: Math.max(0, sNow - p.rewind), at: nowMs, walking: false, faults: out.faults + 1, anchor: null, litAt: nowMs };
      events.push('fault');
      return { prog: out, events, won: false };
    }
  }
  const doll = pathPos(p.path, dollS(p, out, nowMs));
  const shouldWalk = out.light === 'green' && !out.fake && dist(cur, doll) <= p.leash && sNow < p.length;
  if (shouldWalk !== out.walking) rebase({ walking: shouldWalk });
  return { prog: out, events, won: dollS(p, out, nowMs) >= p.length };
}

// ---------------------------------------------------------------------------
// Keep the Balloon Up
// ---------------------------------------------------------------------------

/** Ballistic state at BalloonProgress.at: position, velocity, horizontal (wind) acceleration. */
export type Balloon = { x: number; y: number; vx: number; vy: number; ax: number };
export type BalloonParams = { n: number; r: number; handR: number; gravity: number; wind: number; dropCap: number; saveTarget: number; bounce: number };
/**
 * Balloons are stored at time `at` and fly ballistically from there, so the
 * row only changes on an event (save, drop, wall) and both server and client
 * compute the same positions in between.
 */
export type BalloonProgress = { balloons: Balloon[]; at: number; drops: number; saves: number };

function spawnBalloon(p: BalloonParams, rand: Rand): Balloon {
  return { x: 2 + rand() * (WORLD_W - 4), y: 1.2, vx: (rand() - 0.5) * 1.5, vy: 0, ax: p.wind ? (rand() < 0.5 ? -p.wind : p.wind) : 0 };
}

export function makeBalloons(rand: Rand, sp: ModeSettings, playAt: number): { params: BalloonParams; progress: BalloonProgress } {
  const params: BalloonParams = { n: sp.n, r: 0.7, handR: 0.9, gravity: sp.gravity, wind: sp.wind, dropCap: sp.drops, saveTarget: sp.saves, bounce: 5 };
  const balloons = Array.from({ length: sp.n }, () => spawnBalloon(params, rand));
  // Spread several balloons out so they do not fall as one.
  balloons.forEach((b, i) => (b.x = ((i + 0.5) / sp.n) * (WORLD_W - 4) + 2));
  return { params, progress: { balloons, at: playAt, drops: 0, saves: 0 } };
}

/** Advance one balloon `dt` seconds under gravity `g` and its wind acceleration. */
export function balloonAt(b: Balloon, g: number, dt: number): Balloon {
  return {
    x: b.x + b.vx * dt + 0.5 * b.ax * dt * dt,
    y: b.y + b.vy * dt + 0.5 * g * dt * dt,
    vx: b.vx + b.ax * dt,
    vy: b.vy + g * dt,
    ax: b.ax,
  };
}

/** Every balloon's state at `nowMs`. */
export function balloonsNow(p: BalloonParams, prog: BalloonProgress, nowMs: number): Balloon[] {
  const dt = Math.max(0, (nowMs - prog.at) / 1000);
  return prog.balloons.map(b => balloonAt(b, p.gravity, dt));
}

export type BalloonEvent = { kind: 'save' | 'drop'; x: number; y: number };

/**
 * One tick: walls, floor (drop + respawn) and the hand (cursor under the
 * balloon and close enough pops it back up). Returns the same `prog` when
 * nothing happened.
 */
export function balloonStep(
  p: BalloonParams,
  prog: BalloonProgress,
  nowMs: number,
  hand: Vec,
  rand: Rand
): { prog: BalloonProgress; events: BalloonEvent[] } {
  const bs = balloonsNow(p, prog, nowMs);
  const events: BalloonEvent[] = [];
  let drops = prog.drops;
  let saves = prog.saves;
  let changed = false;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.x < p.r) {
      b.x = p.r;
      b.vx = Math.abs(b.vx);
      changed = true;
    } else if (b.x > WORLD_W - p.r) {
      b.x = WORLD_W - p.r;
      b.vx = -Math.abs(b.vx);
      changed = true;
    }
    if (b.y < p.r) {
      b.y = p.r;
      b.vy = Math.abs(b.vy) * 0.5;
      changed = true;
    }
    if (b.y + p.r >= WORLD_H) {
      drops += 1;
      events.push({ kind: 'drop', x: b.x, y: WORLD_H - p.r });
      bs[i] = spawnBalloon(p, rand);
      changed = true;
      continue;
    }
    const under = hand.y > b.y && Math.hypot(hand.x - b.x, hand.y - b.y) <= p.r + p.handR;
    if (under && b.vy > -0.5) {
      b.vy = -p.bounce;
      b.vx = clamp(b.vx + (b.x - hand.x) * 2.5 + (rand() - 0.5) * 0.8, -4, 4);
      b.ax = p.wind ? (rand() < 0.5 ? -p.wind : p.wind) : 0;
      saves += 1;
      events.push({ kind: 'save', x: b.x, y: b.y });
      changed = true;
    }
  }
  if (!changed) return { prog, events };
  return { prog: { balloons: bs, at: nowMs, drops, saves }, events };
}

// ---------------------------------------------------------------------------
// Whack-a-Mole
// ---------------------------------------------------------------------------

export type MoleParams = { holes: Vec[]; r: number; upMs: number; gapMs: number; target: number; missCap: number };
/** up: hole index with the mole, -1 while every mole is down. until: when that state ends. */
export type MoleProgress = { score: number; misses: number; up: number; last: number; until: number };

export function makeMoles(sp: ModeSettings, playAt: number): { params: MoleParams; progress: MoleProgress } {
  // Two rows of holes; the centre (where the cursor starts) stays clear.
  const n = Math.max(2, Math.round(sp.holes));
  const cols = Math.ceil(n / 2);
  const holes: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    holes.push({ x: ((c + 0.5) / cols) * WORLD_W, y: r === 0 ? 2.9 : 6.5 });
  }
  const params: MoleParams = { holes, r: Math.min(1.05, (WORLD_W / cols) * 0.42), upMs: sp.upMs, gapMs: sp.gapMs, target: sp.target, missCap: sp.misses };
  return { params, progress: { score: 0, misses: 0, up: -1, last: -1, until: playAt + params.gapMs } };
}

/** One tick: when a window ends, the cursor inside that hole scores, else it is a miss; then the next mole pops up. */
export function moleStep(
  p: MoleParams,
  prog: MoleProgress,
  nowMs: number,
  cur: Vec,
  rand: Rand
): { prog: MoleProgress; event: 'hit' | 'miss' | 'up' | null } {
  if (nowMs < prog.until) return { prog, event: null };
  if (prog.up >= 0) {
    const h = p.holes[prog.up];
    const hit = Math.hypot(cur.x - h.x, cur.y - h.y) <= p.r;
    return {
      prog: { ...prog, score: prog.score + (hit ? 1 : 0), misses: prog.misses + (hit ? 0 : 1), up: -1, last: prog.up, until: nowMs + p.gapMs },
      event: hit ? 'hit' : 'miss',
    };
  }
  let pick = Math.floor(rand() * p.holes.length) % p.holes.length;
  if (p.holes.length > 1 && pick === prog.last) pick = (pick + 1) % p.holes.length;
  return { prog: { ...prog, up: pick, until: nowMs + p.upMs }, event: 'up' };
}

// ---------------------------------------------------------------------------
// Hot Potato: a chain of deliveries. Each round a bucket appears somewhere else
// and the potato (the cursor) must be inside it when that round's fuse hits zero.
// ---------------------------------------------------------------------------

export type PotatoParams = { buckets: Vec[]; r: number; move: number; fuseS: number; ph: number; rounds: number };
/** round: delivery in progress (0-based). fuseAt: unix ms when this round's potato goes off. */
export type PotatoProgress = { round: number; fuseAt: number };

export function makePotato(rand: Rand, sp: ModeSettings, playAt: number): { params: PotatoParams; progress: PotatoProgress } {
  const rounds = Math.max(1, Math.round(sp.rounds));
  // Every bucket is a real trip from the previous one (the first from the centre, where the cursor starts).
  const buckets = scatter(rand, rounds, 4, 1.8).map(b => ({ x: b.x, y: b.y }));
  const params: PotatoParams = { buckets, r: sp.r, move: sp.move, fuseS: sp.fuseS, ph: rand() * Math.PI * 2, rounds };
  return { params, progress: { round: 0, fuseAt: playAt + sp.fuseS * 1000 } };
}

/** Centre of the bucket for `round`, `t` seconds after play starts (same math on server and client). */
export function bucketPos(p: PotatoParams, round: number, t: number): Vec {
  const b = p.buckets[clamp(round, 0, p.buckets.length - 1)];
  return wobble(b, p.move, t, p.ph + round, p.r + 0.3);
}

export function potatoInBucket(p: PotatoParams, round: number, t: number, x: number, y: number): boolean {
  const b = bucketPos(p, round, t);
  return Math.hypot(x - b.x, y - b.y) <= p.r;
}

/** At fuseAt: inside the bucket delivers (next round or win), outside explodes (lose). */
export function potatoStep(p: PotatoParams, prog: PotatoProgress, nowMs: number, t: number, cur: Vec): { prog: PotatoProgress; event: 'splash' | 'boom' | 'won' | null } {
  if (nowMs < prog.fuseAt) return { prog, event: null };
  if (!potatoInBucket(p, prog.round, t, cur.x, cur.y)) return { prog, event: 'boom' };
  const round = prog.round + 1;
  if (round >= p.rounds) return { prog: { ...prog, round }, event: 'won' };
  return { prog: { round, fuseAt: nowMs + p.fuseS * 1000 }, event: 'splash' };
}

// ---------------------------------------------------------------------------
// Musical Chairs
// ---------------------------------------------------------------------------

export type ChairsParams = { chairs: Rect[]; musicMinS: number; musicMaxS: number; warnS: number; pauseMs: number };
/** left: indices of chairs still on the floor. stopAt: when the music stops. sat: chair taken last round (removed). */
export type ChairsProgress = { left: number[]; stopAt: number; round: number; sat: number; safeUntil: number };

export function chairsMusicMs(p: { musicMinS: number; musicMaxS: number }, rand: Rand) {
  return Math.round((p.musicMinS + rand() * Math.max(0, p.musicMaxS - p.musicMinS)) * 1000);
}

/** Chair centres spaced evenly (by distance, not angle) around a rectangle ring, so none overlap. */
export function chairRing(n: number, w: number, h: number, a0: number): Vec[] {
  const hx = WORLD_W / 2 - w / 2 - 0.5;
  const hy = WORLD_H / 2 - h / 2 - 0.5;
  const per = 4 * (hx + hy);
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    let d = ((((a0 + i / n) % 1) + 1) % 1) * per;
    let x: number;
    let y: number;
    if (d < 2 * hx) {
      x = -hx + d;
      y = -hy;
    } else if ((d -= 2 * hx) < 2 * hy) {
      x = hx;
      y = -hy + d;
    } else if ((d -= 2 * hy) < 2 * hx) {
      x = hx - d;
      y = hy;
    } else {
      d -= 2 * hx;
      x = -hx;
      y = hy - d;
    }
    out.push({ x: WORLD_W / 2 + x, y: WORLD_H / 2 + y });
  }
  return out;
}

export function makeChairs(rand: Rand, sp: ModeSettings, playAt: number): { params: ChairsParams; progress: ChairsProgress } {
  const n = Math.max(2, Math.round(sp.chairs));
  const chairs: Rect[] = chairRing(n, sp.w, sp.h, rand()).map(c => ({ x: c.x - sp.w / 2, y: c.y - sp.h / 2, w: sp.w, h: sp.h }));
  const params: ChairsParams = { chairs, musicMinS: sp.musicMinS, musicMaxS: sp.musicMaxS, warnS: sp.warnS, pauseMs: 1500 };
  return {
    params,
    progress: { left: chairs.map((_, i) => i), stopAt: playAt + chairsMusicMs(params, rand), round: 1, sat: -1, safeUntil: 0 },
  };
}

/**
 * At stopAt the cursor must be inside a remaining chair. That chair is then
 * removed and the music restarts; sitting on the last chair wins.
 */
export function chairsStep(
  p: ChairsParams,
  prog: ChairsProgress,
  nowMs: number,
  cur: Vec,
  rand: Rand
): { prog: ChairsProgress; event: 'safe' | 'won' | 'lost' | null } {
  if (nowMs < prog.stopAt) return { prog, event: null };
  const sat = prog.left.find(i => inRect(p.chairs[i], cur.x, cur.y));
  if (sat === undefined) return { prog, event: 'lost' };
  if (prog.left.length === 1) return { prog: { ...prog, sat }, event: 'won' };
  return {
    prog: {
      left: prog.left.filter(i => i !== sat),
      stopAt: nowMs + p.pauseMs + chairsMusicMs(p, rand),
      round: prog.round + 1,
      sat,
      safeUntil: nowMs + p.pauseMs,
    },
    event: 'safe',
  };
}

// ---------------------------------------------------------------------------
// Giant Keyboard
// ---------------------------------------------------------------------------

export type Key = Rect & { ch: string };
/** typoCap: wrong-key buzzes allowed before the stage is lost. */
export type KeyboardParams = { word: string; keys: Key[]; dwellMs: number; typoCap: number };
/** onKey: key under the cursor ('' in a gap); since: when it got there; pressed: that key already fired (needs a re-entry). */
export type KeyboardProgress = { next: number; onKey: string; since: number; pressed: boolean; buzzes: number };

export const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
/** Word strip is above this; the three key rows fill the rest. */
export const KEYBOARD_TOP = 2.4;

/** Phrases per stage; spaces are free (skipped automatically). */
export const KEYBOARD_PHRASES: readonly (readonly string[])[] = [
  ['THE MOB RULES THE CURSOR', 'ONE MOUSE MANY HANDS', 'DRAG IT TO THE LEFT NOW', 'EVERYBODY STOP MOVING', 'PIXEL PERFECT TEAMWORK'],
  ['NOBODY AGREES WHERE TO CLICK', 'DEMOCRACY HAS FAILED THE MOB', 'WHO IS PULLING THE OTHER WAY', 'THE CURSOR WANTS TO GO HOME', 'TOO MANY COOKS ONE MOUSE'],
  ['FORTY PEOPLE CANNOT SPELL A WORD', 'PLEASE STOP WIGGLING THE MOUSE', 'THIS IS WHY WE CANNOT HAVE NICE THINGS', 'SOMEBODY IN THE BACK IS TROLLING', 'HOLD STILL FOR ONE SECOND PLEASE'],
];

export function keyboardLayout(): Key[] {
  const gap = 0.12;
  const w = (WORLD_W - 0.3 - gap * 9) / 10;
  const h = (WORLD_H - 0.25 - KEYBOARD_TOP - gap * 2) / 3;
  const keys: Key[] = [];
  KEY_ROWS.forEach((row, r) => {
    const x0 = (WORLD_W - (row.length * w + (row.length - 1) * gap)) / 2;
    [...row].forEach((ch, c) => keys.push({ ch, x: x0 + c * (w + gap), y: KEYBOARD_TOP + r * (h + gap), w, h }));
  });
  return keys;
}

export function makeKeyboard(rand: Rand, sp: ModeSettings, stage: number): { params: KeyboardParams; progress: KeyboardProgress } {
  const list = KEYBOARD_PHRASES[clamp(Math.round(stage), 1, KEYBOARD_PHRASES.length) - 1];
  const word = list[Math.floor(rand() * list.length) % list.length];
  return { params: { word, keys: keyboardLayout(), dwellMs: sp.dwellMs, typoCap: sp.typos }, progress: { next: 0, onKey: '', since: 0, pressed: false, buzzes: 0 } };
}

export function keyAt(keys: Key[], x: number, y: number): Key | null {
  return keys.find(k => inRect(k, x, y)) ?? null;
}

/** Index of the next letter to type at or after `i` (spaces are free). */
function nextLetter(word: string, i: number) {
  while (i < word.length && word[i] === ' ') i++;
  return i;
}

/**
 * One tick: dwelling on the next letter for dwellMs types it; dwelling on any
 * other key buzzes once (until the cursor leaves it). Returns the same `prog`
 * when nothing changed.
 */
export function keyboardStep(
  p: KeyboardParams,
  prog: KeyboardProgress,
  nowMs: number,
  cur: Vec
): { prog: KeyboardProgress; event: 'key' | 'buzz' | null; won: boolean } {
  const ch = keyAt(p.keys, cur.x, cur.y)?.ch ?? '';
  let out = prog;
  if (ch !== prog.onKey) out = { ...prog, onKey: ch, since: nowMs, pressed: false };
  const want = p.word[nextLetter(p.word, out.next)] ?? '';
  // A fired key stays quiet until the cursor leaves, unless the same letter is wanted again (double letters).
  if (!ch || (out.pressed && ch !== want) || nowMs - out.since < p.dwellMs) return { prog: out, event: null, won: false };
  if (ch === want) {
    out = { ...out, next: nextLetter(p.word, nextLetter(p.word, out.next) + 1), since: nowMs, pressed: true };
    return { prog: out, event: 'key', won: out.next >= p.word.length };
  }
  return { prog: { ...out, since: nowMs, pressed: true, buzzes: out.buzzes + 1 }, event: 'buzz', won: false };
}

// ---------------------------------------------------------------------------
// Hunt: a hidden target; the room only sees a noisy warmer/colder meter and must
// dwell on the spot. The target lives in the private level secret.
// ---------------------------------------------------------------------------

/** trapCap: decoys the mob may sit on (and spring) before the stage is lost. */
export type HuntParams = { finds: number; radius: number; dwellS: number; noise: number; decoys: number; trapCap: number };
/**
 * found: revealed positions of targets already found. bars: 0..HUNT_BARS meter
 * reading (noisy, updated every HUNT_METER_MS). sprung: decoys the mob sat on
 * for the dwell (revealed as traps); trapSince: when it started sitting on one.
 */
export type HuntProgress = { found: Vec[]; bars: number; barsAt: number; dwellSince: number; sprung: Vec[]; traps: number; trapSince: number };
export type HuntSecret = { target: Vec; decoys: Vec[] };
export const HUNT_BARS = 10;
export const HUNT_METER_MS = 400;
/** Distance at which the true meter reads cold. */
const HUNT_RANGE = 7;
/** A decoy can look this warm at most, never hot. */
const HUNT_DECOY_MAX = 0.72;

function huntSpot(rand: Rand, avoid: Vec[], minGap: number): Vec {
  let p = { x: WORLD_W / 2, y: WORLD_H / 2 };
  for (let guard = 0; guard < 200; guard++) {
    p = { x: 1 + rand() * (WORLD_W - 2), y: 1.2 + rand() * (WORLD_H - 2.4) };
    if (avoid.every(a => dist(a, p) >= minGap)) break;
  }
  return p;
}

export function makeHunt(rand: Rand, sp: ModeSettings, playAt: number): { params: HuntParams; progress: HuntProgress; secret: HuntSecret } {
  const params: HuntParams = { finds: sp.finds, radius: sp.radius, dwellS: sp.dwellS, noise: sp.noise, decoys: sp.decoys, trapCap: sp.traps };
  const secret = huntSecret(rand, params, [{ x: WORLD_W / 2, y: WORLD_H / 2 }]);
  return { params, progress: { found: [], bars: 0, barsAt: playAt, dwellSince: 0, sprung: [], traps: 0, trapSince: 0 }, secret };
}

/** A fresh target (away from `avoid`) plus decoys well away from it. */
export function huntSecret(rand: Rand, p: HuntParams, avoid: Vec[]): HuntSecret {
  const target = huntSpot(rand, avoid, 3.5);
  const decoys: Vec[] = [];
  for (let i = 0; i < p.decoys; i++) decoys.push(huntSpot(rand, [target, ...decoys], 3));
  return { target, decoys };
}

/** Noiseless 0..1 warmth of a point: the true target reaches 1, decoys cap below hot. */
export function huntHeat(p: HuntParams, s: HuntSecret, cur: Vec): number {
  const real = clamp(1 - (dist(cur, s.target) - p.radius) / HUNT_RANGE, 0, 1);
  let decoy = 0;
  for (const d of s.decoys) decoy = Math.max(decoy, HUNT_DECOY_MAX * clamp(1 - dist(cur, d) / 4, 0, 1));
  return Math.max(real, decoy);
}

export type HuntEvent = 'found' | 'reset' | 'trap' | null;

/**
 * One tick. Dwelling inside the radius for dwellS finds the target (a new one
 * is generated, the old one revealed); leaving early resets the dwell. The
 * meter is re-read (with noise) every HUNT_METER_MS. Returns the same `prog`
 * when nothing changed.
 */
export function huntStep(
  p: HuntParams,
  prog: HuntProgress,
  secret: HuntSecret,
  nowMs: number,
  cur: Vec,
  rand: Rand
): { prog: HuntProgress; secret: HuntSecret; event: HuntEvent; won: boolean } {
  let out = prog;
  let sec = secret;
  let event: HuntEvent = null;
  const inside = dist(cur, secret.target) <= p.radius;
  if (inside) {
    if (!prog.dwellSince) out = { ...out, dwellSince: nowMs };
    else if (nowMs - prog.dwellSince >= p.dwellS * 1000) {
      const found = [...prog.found, { x: +secret.target.x.toFixed(2), y: +secret.target.y.toFixed(2) }];
      out = { ...out, found, dwellSince: 0, trapSince: 0, bars: 0, barsAt: nowMs };
      sec = huntSecret(rand, p, [secret.target, cur]);
      event = 'found';
      return { prog: out, secret: sec, event, won: found.length >= p.finds };
    }
  } else if (prog.dwellSince) {
    out = { ...out, dwellSince: 0 };
    event = 'reset';
  }
  // Decoys read warm but never boil; sitting on one for the dwell springs the trap.
  const trapIdx = inside ? -1 : secret.decoys.findIndex(d => dist(cur, d) <= p.radius);
  if (trapIdx >= 0) {
    if (!prog.trapSince) out = { ...out, trapSince: nowMs };
    else if (nowMs - prog.trapSince >= p.dwellS * 1000) {
      const d = secret.decoys[trapIdx];
      const sprung = [...prog.sprung, { x: +d.x.toFixed(2), y: +d.y.toFixed(2) }];
      // The sprung decoy is replaced elsewhere so the field stays as treacherous.
      const decoys = secret.decoys.filter((_, i) => i !== trapIdx);
      decoys.push(huntSpot(rand, [secret.target, cur, ...decoys, ...sprung], 3));
      sec = { ...secret, decoys };
      out = { ...out, sprung, traps: prog.traps + 1, trapSince: 0 };
      return { prog: out, secret: sec, event: 'trap', won: false };
    }
  } else if (prog.trapSince) out = { ...out, trapSince: 0 };
  if (nowMs - prog.barsAt >= HUNT_METER_MS) {
    const heat = clamp(huntHeat(p, secret, cur) + (rand() - 0.5) * 2 * p.noise, 0, 1);
    const bars = Math.round(heat * HUNT_BARS);
    out = { ...out, bars, barsAt: nowMs };
  }
  return { prog: out, secret: sec, event, won: false };
}

// ---------------------------------------------------------------------------
// Valves: every gauge must sit in the green zone at once for a long hold. The
// cursor holds one valve (fills it); the rest leak.
// ---------------------------------------------------------------------------

export type ValvesParams = { valves: Vec[]; r: number; zone: [number, number]; fill: number; drift: number[]; holdS: number; blowCap: number };
/**
 * levels at time `at`; valve `held` rises at `fill`, the others fall at their
 * drift, so both ends extrapolate identically between events. allInSince: when
 * every valve entered the zone (0 = not all in).
 */
export type ValvesProgress = { levels: number[]; at: number; held: number; allInSince: number; blowouts: number };
export const VALVE_ZONE: [number, number] = [0.35, 0.65];

export function makeValves(rand: Rand, sp: ModeSettings, playAt: number): { params: ValvesParams; progress: ValvesProgress } {
  const n = Math.max(1, Math.round(sp.valves));
  // Spread along a wide arc below the gauges strip, centre first so the start is a short hop.
  const valves: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    valves.push({ x: 1.6 + f * (WORLD_W - 3.2), y: 5.2 + Math.sin(f * Math.PI) * 1.6 });
  }
  const drift = valves.map(() => sp.drift * (0.85 + rand() * 0.3));
  const params: ValvesParams = { valves, r: Math.min(1.1, (WORLD_W / n) * 0.3), zone: VALVE_ZONE, fill: sp.fill, drift, holdS: sp.holdS, blowCap: sp.blowCap };
  // Half the valves start low (work to do), the rest just inside the zone.
  const levels = valves.map((_, i) => (i % 2 === 0 ? 0.22 : 0.42));
  return { params, progress: { levels, at: playAt, held: -1, allInSince: 0, blowouts: 0 } };
}

/** Every gauge at `nowMs`. */
export function valveLevelsNow(p: ValvesParams, prog: ValvesProgress, nowMs: number): number[] {
  const dt = Math.max(0, (nowMs - prog.at) / 1000);
  return prog.levels.map((l, i) => clamp(l + (i === prog.held ? p.fill : -p.drift[i]) * dt, 0, 1));
}
export const valveInZone = (p: ValvesParams, l: number) => l >= p.zone[0] && l <= p.zone[1];
/** Index of the valve under the cursor (-1 when none). */
export function valveAt(p: ValvesParams, cur: Vec): number {
  let best = -1;
  let bd = Infinity;
  p.valves.forEach((v, i) => {
    const d = dist(v, cur);
    if (d <= p.r && d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export type ValvesEvent = { kind: 'grab' | 'blow' | 'all_in' | 'slip'; i: number } | null;

/** One tick. Returns the same `prog` when nothing changed. */
export function valvesStep(p: ValvesParams, prog: ValvesProgress, nowMs: number, cur: Vec): { prog: ValvesProgress; event: ValvesEvent; won: boolean } {
  const levels = valveLevelsNow(p, prog, nowMs);
  const held = valveAt(p, cur);
  let event: ValvesEvent = null;
  let changed = held !== prog.held;
  if (changed && held >= 0) event = { kind: 'grab', i: held };
  let blowouts = prog.blowouts;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] <= 0 || levels[i] >= 1) {
      // Ran dry or burst: back to half, one blowout.
      levels[i] = 0.5;
      blowouts += 1;
      event = { kind: 'blow', i };
      changed = true;
    }
  }
  const allIn = levels.every(l => valveInZone(p, l));
  let allInSince = prog.allInSince;
  if (allIn && !allInSince) {
    allInSince = nowMs;
    changed = true;
    event ??= { kind: 'all_in', i: -1 };
  } else if (!allIn && allInSince) {
    allInSince = 0;
    changed = true;
    event ??= { kind: 'slip', i: levels.findIndex(l => !valveInZone(p, l)) };
  }
  const won = allIn && allInSince > 0 && nowMs - allInSince >= p.holdS * 1000;
  if (!changed) return { prog, event, won };
  return { prog: { levels: levels.map(l => +l.toFixed(4)), at: nowMs, held, allInSince, blowouts }, event, won };
}

// ---------------------------------------------------------------------------
// Stations: visit the numbered stops in order, dwelling on each.
// ---------------------------------------------------------------------------

/** skipCap: early leaves allowed before the stage is lost. */
export type StationsParams = { stations: Vec[]; r: number; dwellS: number; skipCap: number };
/** next: station to visit. since: when the cursor entered it (0 = not on it). */
export type StationsProgress = { next: number; since: number; cancels: number };
/** A started dwell survives drifting this far past the rim; beyond it the stop is cancelled. */
export const STATION_SLACK = 1.5;

export function makeStations(rand: Rand, sp: ModeSettings): { params: StationsParams; progress: StationsProgress } {
  const stations = scatter(rand, Math.max(1, Math.round(sp.stations)), 3.5, 1.1, 2 * sp.r + 0.4).map(s => ({ x: s.x, y: s.y }));
  return { params: { stations, r: sp.r, dwellS: sp.dwellS, skipCap: sp.skips }, progress: { next: 0, since: 0, cancels: 0 } };
}

/**
 * One tick. Leaving before the dwell completes cancels that station (a strike).
 * Jittering on the rim is forgiven: a started dwell only cancels once the cursor
 * is clearly off the station (STATION_SLACK x r). Returns the same `prog` when
 * nothing changed.
 */
export function stationsStep(p: StationsParams, prog: StationsProgress, nowMs: number, cur: Vec): { prog: StationsProgress; event: 'visit' | 'cancel' | null; won: boolean } {
  const st = p.stations[prog.next];
  if (!st) return { prog, event: null, won: true };
  const d = dist(cur, st);
  if (d <= p.r || (prog.since && d <= p.r * STATION_SLACK)) {
    if (!prog.since) return { prog: { ...prog, since: nowMs }, event: null, won: false };
    if (nowMs - prog.since >= p.dwellS * 1000) {
      const next = prog.next + 1;
      return { prog: { ...prog, next, since: 0 }, event: 'visit', won: next >= p.stations.length };
    }
    return { prog, event: null, won: false };
  }
  if (prog.since) return { prog: { ...prog, since: 0, cancels: prog.cancels + 1 }, event: 'cancel', won: false };
  return { prog, event: null, won: false };
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

// ---------------------------------------------------------------------------
// Ghost frame: every fresh pointer packed into one row so phones can draw the
// whole mob without subscribing to the pointer table.
// ---------------------------------------------------------------------------

/** Format tag in byte 0 so clients can ignore frames in a format they don't know. */
export const GHOST_FRAME_V = 2;
const GHOST_REC = 6;

/** One ghost. `key` is stable per player across frames; x/y are normalized 0..1. */
export type GhostRec = { key: number; color: number; team: number; dictator: boolean; x: number; y: number };

/**
 * Stable 16-bit key for an identity (FNV-1a over its hex), so clients can match
 * ghosts between frames and smooth them. A collision only costs smoothing.
 */
export function ghostKey(identityHex: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < identityHex.length; i++) {
    h ^= identityHex.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h ^ (h >>> 16)) & 0xffff;
}

/** [version] then 6 bytes per ghost: [keyHi, keyLo, color, flags, x, y]; flags bit0 = team blue, bit1 = dictator. */
export function packGhosts(gs: GhostRec[]): Uint8Array {
  const data = new Uint8Array(1 + gs.length * GHOST_REC);
  data[0] = GHOST_FRAME_V;
  gs.forEach((g, i) => {
    const o = 1 + i * GHOST_REC;
    data[o] = g.key >> 8;
    data[o + 1] = g.key & 0xff;
    data[o + 2] = g.color;
    data[o + 3] = (g.team & 1) | (g.dictator ? 2 : 0);
    data[o + 4] = Math.round(clamp(g.x, 0, 1) * 255);
    data[o + 5] = Math.round(clamp(g.y, 0, 1) * 255);
  });
  return data;
}

export function unpackGhosts(data: Uint8Array): GhostRec[] {
  if (data.length < 1 || data[0] !== GHOST_FRAME_V || (data.length - 1) % GHOST_REC !== 0) return [];
  const out: GhostRec[] = [];
  for (let o = 1; o < data.length; o += GHOST_REC) {
    out.push({
      key: (data[o] << 8) | data[o + 1],
      color: data[o + 2],
      team: data[o + 3] & 1,
      dictator: (data[o + 3] & 2) !== 0,
      x: data[o + 4] / 255,
      y: data[o + 5] / 255,
    });
  }
  return out;
}
