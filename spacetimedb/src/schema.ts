import { schema, table, t } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Public tables (clients may subscribe; each route subscribes to a subset)
// ---------------------------------------------------------------------------

/** One row per person who has ever joined this round. */
export const player = table(
  { public: true },
  {
    identity: t.identity().primaryKey(),
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
 * Only the display/admin routes subscribe to this table.
 */
export const pointer = table(
  { public: true },
  {
    identity: t.identity().primaryKey(),
    x: t.f32(),
    y: t.f32(),
    /** Exponentially decayed recent movement, drives the activity-weighted rule. */
    activity: t.f32(),
    updatedAt: t.timestamp(),
  }
);

/** Single row (id = 0): the shared cursor, written once per tick. World units 16 x 9. */
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
 * Single row (id = 0), ~5 Hz: every fresh pointer packed as 4 bytes so phones
 * can draw all ghosts from ONE row update instead of N pointer rows.
 */
export const ghostFrame = table(
  { public: true },
  {
    id: t.u32().primaryKey(),
    data: t.byteArray(),
  }
);

/** Level history; the newest row is the current level. */
export const level = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
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

/** Single row (id = 0): live-tunable game + energy config. */
export const config = table(
  { public: true },
  {
    id: t.u32().primaryKey(),
    /** 'mean' | 'median' | 'activity' | 'tug' | 'dictator' */
    rule: t.string(),
    /** Max pointer send rate per client (Hz). */
    pointerHz: t.f64(),
    /** Total pointer calls/sec budget across all players. */
    pointerBudget: t.f64(),
    /** What clients must actually obey: min(pointerHz, pointerBudget / players). */
    pointerHzEffective: t.f64(),
    tickHz: t.u32(),
    gain: t.f64(),
    damping: t.f64(),
    maxSpeed: t.f64(),
    /** Max share of total weight any one player can have (weighted rules). */
    influenceCap: t.f64(),
    quorumMin: t.u32(),
    quorumFrac: t.f64(),
    quorumRadius: t.f64(),
    quorumWindowMs: t.u32(),
    maxPlayers: t.u32(),
    freshMs: t.u32(),
    dictatorSecs: t.f64(),
    autoAdvance: t.bool(),
    paused: t.bool(),
  }
);

/** Append-only log; powers replay, heatmap, awards and the commentator. */
export const eventLog = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
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
    levelId: t.u64().index(),
    title: t.string(),
    who: t.string(),
    name: t.string(),
    detail: t.string(),
  }
);

/** Transient effects (votes, target hits, wall bonks, wins). Event table: never stored. */
export const fx = table(
  { public: true, event: true },
  {
    kind: t.string(),
    x: t.f64(),
    y: t.f64(),
    who: t.string(),
  }
);

// ---------------------------------------------------------------------------
// Private tables (module only)
// ---------------------------------------------------------------------------

/** Identities allowed to call admin_* reducers. Owner is inserted in init. */
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

/** Latest click vote per player for the quorum check. */
export const clickVote = table(
  {},
  {
    identity: t.identity().primaryKey(),
    x: t.f64(),
    y: t.f64(),
    at: t.timestamp(),
  }
);

/** Per-level behaviour stats, sampled at 1 Hz by the tick; used for awards. */
export const playerStats = table(
  {},
  {
    identity: t.identity().primaryKey(),
    samples: t.u32(),
    activeSamples: t.u32(),
    agree: t.u32(),
    disagree: t.u32(),
    distSum: t.f64(),
    activitySum: t.f64(),
    clicks: t.u32(),
  }
);

/** Hidden level state (e.g. mine positions). */
export const levelSecret = table(
  {},
  {
    levelId: t.u64().primaryKey(),
    data: t.string(),
  }
);

/** Interval schedule driving the game tick. Present only while players are online. */
export const tickSchedule = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

/** One-shot schedule: auto-advance to the next level after a win/loss. */
export const advanceSchedule = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    afterLevelId: t.u64(),
  }
);

const spacetimedb = schema({
  player,
  pointer,
  cursor,
  ghostFrame,
  level,
  config,
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
  clickVote,
  playerStats,
  levelSecret,
  tickSchedule,
  advanceSchedule,
});
export default spacetimedb;
