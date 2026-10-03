// Where the SpacetimeDB database lives. Build-time env vars, overridable at
// runtime with ?host=...&db=... (handy for load tests and throwaway databases).
const params = new URLSearchParams(location.search);

export const SPACETIMEDB_HOST: string =
  params.get('host') ?? import.meta.env.VITE_SPACETIMEDB_HOST ?? 'https://maincloud.spacetimedb.com';

export const SPACETIMEDB_DB: string =
  params.get('db') ?? import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'mob-cursor-live';

/** URL phones open from the QR code (same build, #/play route, same db overrides). */
export function playUrl(): string {
  const base = import.meta.env.VITE_PUBLIC_URL || `${location.origin}${location.pathname}`;
  return `${base}${location.search}#/play`;
}
