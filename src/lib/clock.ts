import type { DbConnection } from '../module_bindings';

// Estimates server time from the cursor row's lastTickAt (written every tick).
// offset = serverMs - localMs; we keep the max seen (least network delay),
// decaying slowly so clock drift is tracked.

let offsetMs: number | null = null;
let attached: DbConnection | null = null;

export function observeClock(conn: DbConnection) {
  if (attached === conn) return;
  attached = conn;
  conn.db.cursor.onUpdate((_c, _o, row) => sample(row.lastTickAt.microsSinceUnixEpoch));
  conn.db.cursor.onInsert((_c, row) => sample(row.lastTickAt.microsSinceUnixEpoch));
}

function sample(micros: bigint) {
  const off = Number(micros / 1000n) - Date.now();
  offsetMs = offsetMs === null ? off : Math.max(off, offsetMs - 2);
}

export function serverNowMs(): number {
  return Date.now() + (offsetMs ?? 0);
}
