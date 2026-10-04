// Where the SpacetimeDB database lives. Build-time env vars, overridable at
// runtime with ?host=...&db=... (handy for load tests and throwaway databases).
const params = new URLSearchParams(location.search);

export const SPACETIMEDB_HOST: string =
  params.get('host') ?? import.meta.env.VITE_SPACETIMEDB_HOST ?? 'https://maincloud.spacetimedb.com';

export const SPACETIMEDB_DB: string =
  params.get('db') ?? import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'mob-cursor-live';

import { DEFAULT_ROOM_CODE, normalizeRoomCode } from '../spacetimedb/src/sim';

/** Room code from `?room=CODE`, read live (the URL changes without a reload); the shared lobby when absent or malformed. */
export function roomCodeFromUrl(): string {
  return normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '') || DEFAULT_ROOM_CODE;
}

/** Query string with `room` replaced (keeps `host`/`db` overrides). The default room has no param. */
function withRoom(code: string): string {
  const q = new URLSearchParams(location.search);
  const c = normalizeRoomCode(code);
  if (c && c !== DEFAULT_ROOM_CODE) q.set('room', c);
  else q.delete('room');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Point the address bar at `code` without reloading (hash route and other params kept). */
export function setRoomInUrl(code: string): void {
  const next = `${location.pathname}${withRoom(code)}${location.hash}`;
  if (`${location.pathname}${location.search}${location.hash}` !== next) history.replaceState(history.state, '', next);
}

/** URL phones open from the QR code (same build, #/play route, same db overrides, this room's code). */
export function playUrl(code = roomCodeFromUrl()): string {
  const base = import.meta.env.VITE_PUBLIC_URL || `${location.origin}${location.pathname}`;
  return `${base}${withRoom(code)}#/play`;
}

/** Projector URL for a room (what a host opens on the big screen). */
export function displayUrl(code: string): string {
  const base = import.meta.env.VITE_PUBLIC_URL || `${location.origin}${location.pathname}`;
  return `${base}${withRoom(code)}#/display`;
}
