// Quick end-to-end check: two clients, one moves, both observe the shared cursor.
import { DbConnection, tables } from '../src/module_bindings/index.ts';

const HOST = process.env.STDB_HOST ?? 'ws://127.0.0.1:3000';
const DB = process.env.STDB_DB ?? 'mob-cursor';

function connect(label: string): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect(conn => {
        conn.subscriptionBuilder()
          .onApplied(() => resolve(conn))
          .onError((_c, e) => reject(e))
          .subscribe([tables.cursor, tables.player, tables.pointer, tables.config]);
      })
      .onConnectError((_c, e) => reject(e))
      .build();
    void label;
  });
}

const a = await connect('a');
const b = await connect('b');
await a.reducers.join({ name: 'Alice' });
await b.reducers.join({ name: 'Bob' });
for (let i = 0; i < 20; i++) {
  await a.reducers.setPointer({ x: 0.95, y: 0.1 });
  await new Promise(r => setTimeout(r, 150));
}
const ca = a.db.cursor.id.find(0)!;
const cb = b.db.cursor.id.find(0)!;
console.log('A sees', ca.x.toFixed(2), ca.y.toFixed(2), 'tick', ca.tick, 'active', ca.active);
console.log('B sees', cb.x.toFixed(2), cb.y.toFixed(2), 'tick', cb.tick);
console.log('players', [...b.db.player.iter()].map(p => `${p.name}:${p.connected}`).join(', '));
console.log('pointers seen by B', b.db.pointer.count());
a.disconnect();
b.disconnect();
process.exit(0);
