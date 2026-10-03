// LLM sports commentator for Mob Cursor ("useless AI" track).
//
// Subscribes to the event log, batches what the mob just did, asks Claude for
// one line of overexcited play-by-play, and writes it back via post_commentary.
// The API key lives only in this process's environment.
//
//   ANTHROPIC_API_KEY=...            (omit for DRY_RUN canned lines)
//   STDB_HOST=https://maincloud.spacetimedb.com STDB_DB=mob-cursor-live
//   ADMIN_PASSPHRASE=...             (the one set with admin_set_passphrase)
//   npm start
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { DbConnection, tables } from '../../src/module_bindings/index.ts';

const HOST = process.env.STDB_HOST ?? 'https://maincloud.spacetimedb.com';
const DB = process.env.STDB_DB ?? 'mob-cursor-live';
const PASSPHRASE = process.env.ADMIN_PASSPHRASE ?? '';
const TOKEN_FILE = new URL(`../.stdb-token-${DB}`, import.meta.url);
const MIN_GAP_MS = Number(process.env.MIN_GAP_MS ?? 7000); // cost + readability cap
const IDLE_GAP_MS = Number(process.env.IDLE_GAP_MS ?? 15000);
const DRY_RUN = !process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-opus-5-5';

const anthropic = DRY_RUN ? null : new Anthropic();

const SYSTEM = `You are the play-by-play announcer for "Mob Cursor", a party game projected in a room:
one shared mouse cursor is dragged around by everyone's phones at once, and the crowd must hit targets,
escape mazes and play Minesweeper together. They mostly disagree.

Write ONE line of commentary (max 160 characters) in the voice of an overexcited sports announcer
reacting to the most recent events. Be funny and specific: use player names and numbers from the events.
Gently roast the crowd's teamwork; never be mean about anything but their cursor skills.
No hashtags, no emoji spam (one emoji max), no quotation marks around the line. Output only the line.`;

type Ev = { kind: string; who: string; payload: string; at: number };

const tokenFromDisk = () => {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
};

const conn: DbConnection = await new Promise((resolve, reject) => {
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB)
    .withToken(tokenFromDisk())
    .onConnect((c, identity, token) => {
      fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
      console.log(`commentator connected as ${identity.toHexString().slice(0, 12)}… (${DRY_RUN ? 'DRY RUN' : MODEL})`);
      c.subscriptionBuilder()
        .onApplied(() => resolve(c))
        .onError(ctx => reject(ctx.event ?? new Error('subscription failed')))
        .subscribe([
          tables.amIAdmin,
          tables.eventLog.where(r => r.kind.ne('sample')),
          tables.level,
          tables.player,
          tables.cursor,
          tables.config,
        ]);
    })
    .onConnectError((_ctx, e) => reject(e))
    .onDisconnect(() => {
      console.error('disconnected; exiting so a supervisor can restart us');
      process.exit(1);
    })
    .build();
});

if (conn.db.amIAdmin.count() === 0n) {
  if (!PASSPHRASE) throw new Error('worker identity is not an admin: set ADMIN_PASSPHRASE');
  await conn.reducers.adminClaim({ passphrase: PASSPHRASE });
  console.log('claimed admin');
}

const nameOf = (hex: string) => {
  for (const p of conn.db.player.iter()) if (p.identity.toHexString() === hex) return p.name;
  return hex ? 'someone' : '';
};

const pending: Ev[] = [];
let lastSpoke = 0;
let urgent = false;
const URGENT = new Set(['level_end', 'mine', 'round_reset', 'dictator', 'level_start']);

// Only react to events that happen after we start (rows from the initial subscription are history).
conn.db.eventLog.onInsert((ctx, row) => {
  if (ctx.event.tag === 'SubscribeApplied') return;
  pending.push({ kind: row.kind, who: nameOf(row.who), payload: row.payload, at: Date.now() });
  if (pending.length > 60) pending.splice(0, pending.length - 60);
  if (URGENT.has(row.kind)) urgent = true;
});

function situation() {
  let lvl = null as ReturnType<typeof conn.db.level.id.find>;
  for (const l of conn.db.level.iter()) if (!lvl || l.id > lvl.id) lvl = l;
  const cur = conn.db.cursor.id.find(0);
  const online = [...conn.db.player.iter()].filter(p => p.connected);
  return {
    level: lvl ? { kind: lvl.kind, state: lvl.state, progress: JSON.parse(lvl.progress) } : null,
    rule: conn.db.config.id.find(0)?.rule,
    chaos: cur ? +cur.chaos.toFixed(2) : 0,
    playersOnline: online.length,
    topScorers: online.sort((a, b) => b.score - a.score).slice(0, 3).map(p => `${p.name} (${p.score})`),
  };
}

const CANNED = [
  'AND THE MOB GOES LEFT! No, right! No, it is simply vibrating in place, folks!',
  'I have never seen forty people so confidently disagree about where a mouse should be.',
  'The cursor is moving with all the grace of a shopping cart with one broken wheel!',
  'Somebody in the back is pulling the opposite way and I think they know exactly what they are doing.',
];

async function speak() {
  const batch = pending.splice(0);
  let line: string;
  if (!anthropic) {
    line = CANNED[Math.floor(Math.random() * CANNED.length)];
  } else {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      // Server-side refusal fallback (routes by refusal category).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ situation: situation(), recentEvents: batch.map(e => ({ kind: e.kind, who: e.who, ...JSON.parse(e.payload) })) }),
        },
      ],
    });
    if (response.stop_reason === 'refusal') return;
    line = response.content
      .flatMap(b => (b.type === 'text' ? [b.text] : []))
      .join(' ')
      .trim();
  }
  if (!line) return;
  await conn.reducers.postCommentary({ text: line.slice(0, 280) });
  console.log(`🎙 ${line}`);
}

setInterval(() => {
  const now = Date.now();
  const gap = now - lastSpoke;
  if (pending.length === 0) return;
  if (gap < MIN_GAP_MS) return;
  if (!urgent && gap < IDLE_GAP_MS) return;
  lastSpoke = now;
  urgent = false;
  speak().catch(err => {
    if (err instanceof Anthropic.RateLimitError) console.error('rate limited; skipping this beat');
    else if (err instanceof Anthropic.APIError) console.error(`Claude API error ${err.status}: ${err.message}`);
    else console.error(err);
  });
}, 1000);
