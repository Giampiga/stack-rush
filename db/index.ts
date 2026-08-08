import { env } from "cloudflare:workers";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    hue INTEGER NOT NULL,
    status TEXT DEFAULT 'online' NOT NULL,
    active_match_id TEXT,
    wins INTEGER DEFAULT 0 NOT NULL,
    races INTEGER DEFAULT 0 NOT NULL,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_players_presence
    ON players (active_match_id, last_seen)`,
  `CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY NOT NULL,
    from_player_id TEXT NOT NULL,
    to_player_id TEXT NOT NULL,
    disk_count INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    created_at INTEGER NOT NULL,
    responded_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invites_incoming
    ON invites (to_player_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_invites_outgoing
    ON invites (from_player_id, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS active_slots (
    player_id TEXT PRIMARY KEY NOT NULL,
    game_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_active_slots_game
    ON active_slots (game_id)`,
  `CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY NOT NULL,
    player_one_id TEXT NOT NULL,
    player_two_id TEXT NOT NULL,
    disk_count INTEGER NOT NULL,
    status TEXT DEFAULT 'countdown' NOT NULL,
    starts_at INTEGER NOT NULL,
    winner_id TEXT,
    player_one_state TEXT NOT NULL,
    player_two_state TEXT NOT NULL,
    player_one_moves INTEGER DEFAULT 0 NOT NULL,
    player_two_moves INTEGER DEFAULT 0 NOT NULL,
    player_one_rematch INTEGER DEFAULT 0 NOT NULL,
    player_two_rematch INTEGER DEFAULT 0 NOT NULL,
    rematch_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_matches_player_one
    ON matches (player_one_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_player_two
    ON matches (player_two_id, updated_at)`,
];

let readyForDatabase: D1Database | null = null;
let schemaPromise: Promise<void> | null = null;

export function getD1(): D1Database {
  const database = (env as { DB?: D1Database }).DB;
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set `d1` to `DB` in .openai/hosting.json.",
    );
  }
  return database;
}

export async function ensureDatabase(): Promise<D1Database> {
  const database = getD1();

  if (readyForDatabase !== database || !schemaPromise) {
    readyForDatabase = database;
    schemaPromise = database
      .batch(SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)))
      .then(async () => {
        await database.prepare("PRAGMA optimize").run();
      });
  }

  await schemaPromise;
  return database;
}
