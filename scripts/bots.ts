// Headless bot swarm + load test using the real TypeScript SDK.
//
//   npx tsx scripts/bots.ts --bots 50 --seconds 60 [--host ws://127.0.0.1:3000] [--db mob-cursor]
//
// Each bot joins, then moves its pointer like a (badly coordinated) human:
// most drift toward a shared goal with noise, some troll in the opposite corner.
// Bots obey config.pointerHzEffective, the 1% dead-band and the 1 s heartbeat,
// exactly like the phone client. Prints call rates, reducer round-trip latency
// and tick stability as JSON at the end.
import { DbConnection, tables } from '../src/module_bindings/index.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const HOST = args.get('host') ?? process.env.STDB_HOST ?? 'ws://127.0.0.1:3000';
const DB = args.get('db') ?? process.env.STDB_DB ?? 'mob-cursor';
const N = Number(args.get('bots') ?? 20);
const SECONDS = Number(args.get('seconds') ?? 30);
const TROLLS = Number(args.get('trolls') ?? 0.15);
const CLICK_RATE = Number(args.get('clicks') ?? 0.3); // clicks per bot per second
const OBSERVER = args.get('observer') !== 'false';

type Bot = { conn: DbConnection; troll: boolean; x: number; y: number; lastSent: { x: number; y: number } | null; lastAt: number };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const lat: number[] = [];
let sent = 0;
let clicks = 0;
let errors = 0;

function connect(subscribe: (c: DbConnection) => unknown[]): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect(conn => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(conn))
          .onError(ctx => reject(ctx.event ?? new Error('subscription failed')))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .subscribe(subscribe(conn) as any);
      })
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

// Observer = a display: subscribes to pointer + cursor and measures tick cadence.
const tickGaps: number[] = [];
let pointerUpdates = 0;
let observer: DbConnection | null = null;
if (OBSERVER) {
  observer = await connect(() => [tables.cursor, tables.pointer, tables.config]);
  let lastTick = 0;
  observer.db.cursor.onUpdate(() => {
    const t = performance.now();
    if (lastTick) tickGaps.push(t - lastTick);
    lastTick = t;
  });
  observer.db.pointer.onUpdate(() => pointerUpdates++);
  observer.db.pointer.onInsert(() => pointerUpdates++);
}

const bots: Bot[] = [];
for (let i = 0; i < N; i++) {
  // Bots subscribe like phones: cursor + config only.
  const conn = await connect(() => [tables.cursor, tables.config]);
  await conn.reducers.join({ name: `bot${i}` });
  bots.push({ conn, troll: i < N * TROLLS, x: Math.random(), y: Math.random(), lastSent: null, lastAt: 0 });
  if (i % 10 === 9) console.error(`connected ${i + 1}/${N}`);
}

const t0 = performance.now();
let goal = { x: 0.2, y: 0.2 };
const goalTimer = setInterval(() => (goal = { x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.8 }), 4000);

async function runBot(b: Bot) {
  while (performance.now() - t0 < SECONDS * 1000) {
    const hz = b.conn.db.config.id.find(0)?.pointerHzEffective ?? 15;
    const g = b.troll ? { x: 1 - goal.x, y: 1 - goal.y } : goal;
    b.x += (g.x - b.x) * 0.15 + (Math.random() - 0.5) * 0.04;
    b.y += (g.y - b.y) * 0.15 + (Math.random() - 0.5) * 0.04;
    b.x = Math.min(1, Math.max(0, b.x));
    b.y = Math.min(1, Math.max(0, b.y));
    const now = performance.now();
    const moved = !b.lastSent || Math.hypot(b.x - b.lastSent.x, b.y - b.lastSent.y) > 0.01;
    if (moved || now - b.lastAt > 1000) {
      const s = performance.now();
      b.conn.reducers
        .setPointer({ x: b.x, y: b.y })
        .then(() => lat.push(performance.now() - s))
        .catch(() => errors++);
      b.lastSent = { x: b.x, y: b.y };
      b.lastAt = now;
      sent++;
    }
    if (Math.random() < CLICK_RATE / hz) {
      clicks++;
      b.conn.reducers.click({}).catch(() => errors++);
    }
    await sleep(1000 / Math.max(1, hz));
  }
}

const progress = setInterval(() => {
  const el = (performance.now() - t0) / 1000;
  console.error(`t=${el.toFixed(0)}s sent=${(sent / el).toFixed(0)}/s observed=${(pointerUpdates / el).toFixed(0)}/s`);
}, 5000);

await Promise.all(bots.map(runBot));
clearInterval(goalTimer);
clearInterval(progress);
await sleep(500);

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const el = (performance.now() - t0) / 1000;
const cfg = bots[0]?.conn.db.config.id.find(0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const result = {
  host: HOST,
  db: DB,
  bots: N,
  seconds: +el.toFixed(1),
  pointerHzEffective: cfg?.pointerHzEffective,
  tickHz: cfg?.tickHz,
  setPointerCallsPerSec: +(sent / el).toFixed(1),
  clickCallsPerSec: +(clicks / el).toFixed(1),
  observedPointerUpdatesPerSec: +(pointerUpdates / el).toFixed(1),
  reducerLatencyMs: { p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1) },
  tick: {
    observedHz: +(1000 / mean(tickGaps)).toFixed(2),
    gapP50Ms: +pct(tickGaps, 50).toFixed(1),
    gapP95Ms: +pct(tickGaps, 95).toFixed(1),
    gapMaxMs: +Math.max(0, ...tickGaps).toFixed(1),
  },
  errors,
};
const out = JSON.stringify(result, null, 2);
console.log(out);
if (args.get('out')) (await import('node:fs')).writeFileSync(args.get('out')!, out + '\n');
for (const b of bots) b.conn.disconnect();
observer?.disconnect();
process.exit(0);
