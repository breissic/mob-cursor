import { integrate, WORLD_H, WORLD_W, type Body, type MazeProgress } from '../../spacetimedb/src/sim';
import { serverNowMs } from './clock';

type CursorRow = Body & {
  tx: number;
  ty: number;
  active: number;
  lastTickAt: { microsSinceUnixEpoch: bigint };
};
type Physics = { gain: number; damping: number; maxSpeed: number; tickHz: number };

/** Larger jumps than this (maze respawn) snap instead of easing. */
const TELEPORT = 3;

/**
 * Server ms until which the tick pins the cursor for this running level: the
 * pre-play countdown, and the maze respawn freeze. Prediction must not move it.
 */
export function cursorHoldUntilMs(level: { kind: string; progress: unknown; playAt: number }): number {
  const frozen = level.kind === 'maze' ? ((level.progress as Partial<MazeProgress>).frozenUntil ?? 0) : 0;
  return Math.max(level.playAt, frozen);
}

/** Advance a snapshot to server time `nowUs` the way the tick would. */
function predict(snap: CursorRow, nowUs: number, phys: Physics, held: boolean): Body {
  const tick = 1 / Math.max(1, phys.tickHz);
  // Never predict more than ~2.5 ticks ahead: past that the tick is late, not lost.
  const maxAge = Math.min(0.25, 2.5 * tick);
  const age = held ? 0 : Math.min(maxAge, Math.max(0, (nowUs - Number(snap.lastTickAt.microsSinceUnixEpoch)) / 1e6));
  const target = snap.active > 0 ? { x: snap.tx, y: snap.ty } : null;
  // Step exactly like the server (whole ticks) so the next snapshot matches the
  // prediction, and interpolate linearly inside the current tick.
  let b: Body = { x: snap.x, y: snap.y, vx: snap.vx, vy: snap.vy };
  let left = age;
  for (; left >= tick; left -= tick) b = integrate(b, target, tick, phys.gain, phys.damping, phys.maxSpeed);
  if (left > 0) {
    const nb = integrate(b, target, tick, phys.gain, phys.damping, phys.maxSpeed);
    const f = left / tick;
    b = { x: b.x + (nb.x - b.x) * f, y: b.y + (nb.y - b.y) * f, vx: nb.vx, vy: nb.vy };
  }
  return b;
}

/**
 * Renders the shared cursor between server ticks. Each snapshot is advanced to
 * "now" with the same spring physics the tick runs (dead reckoning), timed with
 * the server clock estimate (see clock.ts) so network jitter does not wobble it.
 * When a new snapshot disagrees with the prediction, the difference decays away
 * instead of popping, so steady motion has no added lag.
 */
export function createCursorSmoother() {
  let snap: CursorRow | null = null;
  // Snapshot that was being drawn before the latest push, until the next step.
  let prev: CursorRow | null = null;
  const pos = { x: WORLD_W / 2, y: WORLD_H / 2 };
  const err = { x: 0, y: 0 };

  return {
    /** Feed every cursor row update. */
    push(row: CursorRow) {
      prev ??= snap;
      snap = row;
    },

    /**
     * Advance by one frame of `dt` seconds; returns the position to draw.
     * `holdUntilMs` (server ms, see cursorHoldUntilMs) disables prediction while
     * the server pins the cursor.
     */
    step(dt: number, phys: Physics, holdUntilMs = 0) {
      if (!snap) return pos;
      const nowMs = serverNowMs();
      const nowUs = nowMs * 1000;
      const held = nowMs < holdUntilMs;
      const b = predict(snap, nowUs, phys, held);
      // ~100 ms to absorb a correction: tuned against simulated 30-90 ms network jitter.
      const decay = Math.exp(-dt * 10);
      err.x *= decay;
      err.y *= decay;
      if (prev) {
        // New snapshot: compare both predictions for this same instant and bleed
        // the difference off, so a correction never pops or stalls the cursor.
        const a = predict(prev, nowUs, phys, held);
        err.x += a.x - b.x;
        err.y += a.y - b.y;
        if (Math.hypot(err.x, err.y) > TELEPORT) err.x = err.y = 0;
        prev = null;
      }
      pos.x = b.x + err.x;
      pos.y = b.y + err.y;
      return pos;
    },
  };
}
