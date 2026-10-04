import { useEffect } from 'react';
import type { RowTypedQuery } from 'spacetimedb';
import { tables, type DbConnection } from '../module_bindings';
import { useConnState, useRows } from './stdb';

// Room-scoped subscriptions. Every route does the same two-step dance: the
// global config row + the room row for a code, then (once the room id is known)
// the per-room tables filtered by that id. Rooms never see each other's rows.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queries = Array<RowTypedQuery<any, any>>;

/** Hold a subscription for as long as `build` returns queries; re-subscribes when `deps` change. */
export function useSubscribe(build: (c: DbConnection) => Queries | null, deps: readonly unknown[]) {
  const { conn, status } = useConnState();
  useEffect(() => {
    if (!conn || status !== 'connected') return;
    const q = build(conn);
    if (!q) return;
    const sub = conn.subscriptionBuilder().subscribe(q);
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, status, ...deps]);
}

/** Subscribe to config + the room with this code. Returns the room row once it lands (undefined for an unknown code). */
export function useRoomByCode(code: string) {
  useSubscribe(() => [tables.config, tables.room.where(r => r.code.eq(code))], [code]);
  return useRows(c => c.db.room, 200).find(r => r.code === code);
}
