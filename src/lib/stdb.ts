import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Identity } from 'spacetimedb';
import { DbConnection } from '../module_bindings';
import { SPACETIMEDB_DB, SPACETIMEDB_HOST } from '../config';

// One connection per page. Canvas code reads conn.db directly every frame;
// React only re-renders for chrome via useRows/useConnState below.

const TOKEN_KEY = `${SPACETIMEDB_HOST}/${SPACETIMEDB_DB}/auth_token`;

type ConnState = {
  conn: DbConnection | null;
  identity: Identity | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
};

let state: ConnState = { conn: null, identity: null, status: 'connecting' };
const listeners = new Set<() => void>();
const set = (patch: Partial<ConnState>) => {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
};

let started = false;
let readyResolve: (c: DbConnection) => void;
export const ready: Promise<DbConnection> = new Promise(r => (readyResolve = r));

export function connect(): Promise<DbConnection> {
  if (started) return ready;
  started = true;
  let token: string | undefined;
  try {
    token = localStorage.getItem(TOKEN_KEY) || undefined;
  } catch {
    token = undefined;
  }
  const conn = DbConnection.builder()
    .withUri(SPACETIMEDB_HOST)
    .withDatabaseName(SPACETIMEDB_DB)
    .withToken(token)
    .onConnect((c, identity, tok) => {
      try {
        localStorage.setItem(TOKEN_KEY, tok);
      } catch {
        /* private mode */
      }
      set({ conn: c, identity, status: 'connected' });
      readyResolve(c);
    })
    .onDisconnect(() => set({ status: 'disconnected' }))
    .onConnectError((_ctx, err) => set({ status: 'error', error: err.message }))
    .build();
  set({ conn });
  return ready;
}

export function useConnState(): ConnState {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

type AnyTable<Row> = {
  iter(): Iterable<Row>;
  onInsert(cb: (ctx: unknown, row: Row) => void): void;
  removeOnInsert(cb: (ctx: unknown, row: Row) => void): void;
  onDelete?(cb: (ctx: unknown, row: Row) => void): void;
  removeOnDelete?(cb: (ctx: unknown, row: Row) => void): void;
  onUpdate?(cb: (ctx: unknown, oldRow: Row, newRow: Row) => void): void;
  removeOnUpdate?(cb: (ctx: unknown, oldRow: Row, newRow: Row) => void): void;
};

/**
 * Re-render when a table changes, coalesced to at most once per `minMs`.
 * Never use this for high-frequency tables (cursor, pointer) on the display.
 */
export function useRows<Row>(
  pick: (c: DbConnection) => AnyTable<Row>,
  minMs = 100
): Row[] {
  const { conn } = useConnState();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!conn) return;
    const tbl = pick(conn);
    let timer: number | null = null;
    const bump = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        setVersion(v => v + 1);
      }, minMs);
    };
    tbl.onInsert(bump);
    tbl.onDelete?.(bump);
    tbl.onUpdate?.(bump);
    bump();
    return () => {
      tbl.removeOnInsert(bump);
      tbl.removeOnDelete?.(bump);
      tbl.removeOnUpdate?.(bump);
      if (timer !== null) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);
  return useMemo(() => (conn ? [...pick(conn).iter()] : []), [conn, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Poll a value at a low rate (for HUD numbers derived from per-frame data). */
export function usePoll<T>(fn: () => T, ms: number): T {
  const [v, setV] = useState(fn);
  useEffect(() => {
    const id = window.setInterval(() => setV(fn()), ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
  return v;
}
