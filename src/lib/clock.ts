import type { DbConnection } from '../module_bindings';

// Estimates server time from the cursor row's lastTickAt (written every tick).
// offset = serverMs - localMs; we keep the max seen (least network delay),
// decaying slowly so clock drift is tracked. Local time is the monotonic
// performance clock (sub-ms, immune to NTP jumps) so prediction stays smooth.

/** Per-sample decay (ms). Small: a fast decay saw-tooths the estimate and jitters prediction. */
const DECAY_MS = 0.3;
/** A sample this far below the estimate means the local clock jumped (e.g. device sleep). */
const RESET_MS = 250;

let offsetMs: number | null = null;
let attached: DbConnection | null = null;

const localMs = () => performance.timeOrigin + performance.now();

export function observeClock(conn: DbConnection) {
  if (attached === conn) return;
  attached = conn;
  conn.db.cursor.onUpdate((_c, _o, row) => sampleServerTime(row.lastTickAt.microsSinceUnixEpoch));
  conn.db.cursor.onInsert((_c, row) => sampleServerTime(row.lastTickAt.microsSinceUnixEpoch));
}

/** Feed a server timestamp that was just received. Exported for tests. */
export function sampleServerTime(micros: bigint) {
  const off = Number(micros) / 1000 - localMs();
  offsetMs = offsetMs === null || off < offsetMs - RESET_MS ? off : Math.max(off, offsetMs - DECAY_MS);
}

export function serverNowMs(): number {
  return localMs() + (offsetMs ?? 0);
}
