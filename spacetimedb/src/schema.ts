import { schema, table, t } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Public tables (clients may subscribe; each route subscribes to a subset)
//
// Rooms: every row a client sees is scoped by a room id (`roomId`, or `id` for
// the single-row-per-room tables) and clients subscribe with a room filter.
// Room 0 is the default shared lobby everyone lands in without a code.
// ---------------------------------------------------------------------------

/** One row per room. Phones find a room by `code`; the display uses the same code. */
export const room = table(
  { public: true },
  {
    id: t.u32().primaryKey(),
    /** Short join code (DEFAULT_ROOM_CODE for the default room). */
    code: t.string().unique(),
    name: t.string(),
    /** Identity that created the room; may run the room's host controls. */
    host: t.identity(),
    /** Connected players right now. */
    players: t.u32(),
    /** What this room's clients must obey: min(pointerHz, pointerBudget / players). */
    pointerHzEffective: t.f64(),
    /** Current (newest) level row, 0 when the room has never run one. */
    levelId: t.u64(),
    createdAt: t.timestamp(),
    lastActiveAt: t.timestamp(),
  }
);

/** One row per person who has ever joined; `roomId` is the room they are in. */
export const player = table(
  { public: true },
  {
    identity: t.identity().primaryKey(),
    roomId: t.u32().index(),
    name: t.string(),
    color: t.string(),
    team: t.u8(),
    score: t.i32(),
    connected: t.bool(),
    joinedAt: t.timestamp(),
  }
);

/**
 * Latest pad position per connected player (normalized 0..1). Never a history.
 * Only the display/admin routes subscribe to this table (filtered by room).
 */
export const pointer = table(
  { public: true },
  {
    identity: t.identity().primaryKey(),
    roomId: t.u32().index(),
    x: t.f32(),
    y: t.f32(),
    /** Exponentially decayed recent movement, drives the activity-weighted rule. */
    activity: t.f32(),
    updatedAt: t.timestamp(),
  }
);

/** One row per room (id = room id): the shared cursor, written once per tick. World units 16 x 9. */
export const cursor = table(
  { public: true },
  {
    id: t.u32().primaryKey(),
    x: t.f64(),
    y: t.f64(),
    vx: t.f64(),
    vy: t.f64(),
    /** Aggregate target the crowd is pulling toward. */
    tx: t.f64(),
    ty: t.f64(),
    chaos: t.f64(),
    active: t.u32(),
    tick: t.u64(),
    lastTickAt: t.timestamp(),
    /** Hex identity of the current dictator, '' when none. */
    dictator: t.string(),
    dictatorUntil: t.timestamp(),
  }
);

/**
 * One row per room (id = room id), ~5 Hz: every fresh pointer packed as 6 bytes
 * so phones can draw all ghosts from ONE row update instead of N pointer rows.
 */
export const ghostFrame = table(
  { public: true },
  {
    id: t.u32().primaryKey(),
    data: t.byteArray(),
  }
);

/** Level history per room; room.levelId points at the current one. */
export const level = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u32().index(),
    kind: t.string(),
    /** 'running' | 'won' | 'lost' | 'skipped' */
    state: t.string(),
    /** JSON, public layout (targets, maze tiles, grid size). Never contains secrets. */
    params: t.string(),
    /** JSON, public progress (next target, revealed cells, wall hits...). */
    progress: t.string(),
    startedAt: t.timestamp(),
    deadline: t.timestamp(),
    endedAt: t.timestamp().optional(),
    score: t.i32(),
    /** Running sum of chaos per tick, for the cooperation score. */
    chaosSum: t.f64(),
    ticks: t.u32(),
  }
);

/** Single row (id = 0): live-tunable global cursor + energy config and room limits. */
export const config = table(
  { public: true },
  {
    id: t.u32().primaryKey(),
    /** 'mean' | 'median' | 'activity' | 'tug' | 'dictator' */
    rule: t.string(),
    /** Max pointer send rate per client (Hz). */
    pointerHz: t.f64(),
    /** Pointer calls/sec budget PER ROOM (room.pointerHzEffective = min(pointerHz, budget / players)). */
    pointerBudget: t.f64(),
    tickHz: t.u32(),
    gain: t.f64(),
    damping: t.f64(),
    maxSpeed: t.f64(),
    /** Max share of total weight any one player can have (weighted rules). */
    influenceCap: t.f64(),
    /** Players per room (hard ceiling MAX_PLAYERS_CEILING). */
    maxPlayers: t.u32(),
    /** Rooms at once (hard ceiling MAX_ROOMS_CEILING). */
    maxRooms: t.u32(),
    freshMs: t.u32(),
    dictatorSecs: t.f64(),
    autoAdvance: t.bool(),
    paused: t.bool(),
  }
);

/** Saved stage-1 defaults per mode (JSON of numeric settings; see MODE_SETTINGS in sim.ts). */
export const modeSettings = table(
  { public: true },
  {
    kind: t.string().primaryKey(),
    json: t.string(),
    updatedAt: t.timestamp(),
  }
);

/** Append-only log per room; powers replay, heatmap, awards and the commentator. */
export const eventLog = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u32().index(),
    at: t.timestamp(),
    kind: t.string().index(),
    levelId: t.u64(),
    who: t.string(),
    payload: t.string(),
  }
);

/** LLM commentator output, written by the worker via post_commentary. */
export const commentary = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u32().index(),
    at: t.timestamp(),
    levelId: t.u64(),
    text: t.string(),
  }
);

/** End-of-level awards. */
export const award = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u32().index(),
    levelId: t.u64().index(),
    title: t.string(),
    who: t.string(),
    name: t.string(),
    detail: t.string(),
  }
);

/** Transient effects (target hits, wall bonks, wins...). Event table: never stored. */
export const fx = table(
  { public: true, event: true },
  {
    roomId: t.u32(),
    kind: t.string(),
    x: t.f64(),
    y: t.f64(),
    who: t.string(),
  }
);

// ---------------------------------------------------------------------------
// Private tables (module only)
// ---------------------------------------------------------------------------

/** Identities allowed to call every admin_* reducer. Owner is inserted in init. */
export const admin = table(
  {},
  {
    identity: t.identity().primaryKey(),
    grantedAt: t.timestamp(),
  }
);

/** Single row (id = 0): salted SHA-256 of the admin passphrase. */
export const adminSecret = table(
  {},
  {
    id: t.u32().primaryKey(),
    salt: t.string(),
    hash: t.string(),
  }
);

/** One row per live WebSocket connection; player.connected derives from this. */
export const session = table(
  {},
  {
    connectionId: t.connectionId().primaryKey(),
    identity: t.identity().index(),
  }
);

/**
 * set_pointer rate limiter state (GCRA): the theoretical arrival time of the next
 * call. Lets network-bunched packets through instead of dropping the newest one.
 */
export const pointerRate = table(
  {},
  {
    identity: t.identity().primaryKey(),
    tatUs: t.u64(),
  }
);

/**
 * Players with no live pointer, and since when. A phone that locks without a
 * clean disconnect stays "connected" forever; after IDLE_AWAY_S here the tick
 * marks the player as gone (they auto-rejoin when the phone wakes up).
 */
export const idle = table(
  {},
  {
    identity: t.identity().primaryKey(),
    since: t.timestamp(),
  }
);

/** Kicked identities and when they may rejoin. */
export const banned = table(
  {},
  {
    identity: t.identity().primaryKey(),
    until: t.timestamp(),
  }
);

/** Per-level behaviour stats, sampled at 1 Hz by the tick; used for awards. */
export const playerStats = table(
  {},
  {
    identity: t.identity().primaryKey(),
    roomId: t.u32().index(),
    samples: t.u32(),
    activeSamples: t.u32(),
    agree: t.u32(),
    disagree: t.u32(),
    distSum: t.f64(),
    activitySum: t.f64(),
  }
);

/** Hidden level state (mine positions, the hunt target...). */
export const levelSecret = table(
  {},
  {
    levelId: t.u64().primaryKey(),
    data: t.string(),
  }
);

/** Interval schedule driving the game tick (all rooms). Present only while players are online. */
export const tickSchedule = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

/** One-shot schedule: auto-advance a room to the next level after a win/loss (or its first game). */
export const advanceSchedule = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    roomId: t.u32(),
    afterLevelId: t.u64(),
  }
);

const spacetimedb = schema({
  room,
  player,
  pointer,
  cursor,
  ghostFrame,
  level,
  config,
  modeSettings,
  eventLog,
  commentary,
  award,
  fx,
  admin,
  adminSecret,
  session,
  pointerRate,
  idle,
  banned,
  playerStats,
  levelSecret,
  tickSchedule,
  advanceSchedule,
});
export default spacetimedb;
