import { env } from "cloudflare:workers";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL
  )`,
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
    game_mode TEXT DEFAULT 'sort' NOT NULL,
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
    game_mode TEXT DEFAULT 'sort' NOT NULL,
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
  `CREATE TABLE IF NOT EXISTS match_results (
    match_id TEXT PRIMARY KEY NOT NULL,
    winner_id TEXT NOT NULL,
    loser_id TEXT NOT NULL,
    claim_id TEXT UNIQUE NOT NULL,
    applied INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS guest_session_creations (
    nonce TEXT PRIMARY KEY NOT NULL,
    client_key_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_guest_session_creations_created
    ON guest_session_creations (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_guest_session_creations_client
    ON guest_session_creations (client_key_hash, created_at)`,
  `CREATE TABLE IF NOT EXISTS maintenance_leases (
    key TEXT PRIMARY KEY NOT NULL,
    run_after INTEGER NOT NULL,
    claim_id TEXT NOT NULL
  )`,
];

const BOLT_SORT_MIGRATION = "0001_bolt_sort_state_and_result_ledger";
const DUAL_MODE_MIGRATION = "0002_dual_game_modes";

async function applyMigrations(database: D1Database): Promise<void> {
  const applied = await database
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .bind(BOLT_SORT_MIGRATION)
    .first<{ id: string }>();
  if (!applied) {
    const now = Date.now();
    await database.batch([
    // Earlier development builds created this trigger dynamically. Removing it
    // makes result accounting compatible with both the old application update
    // path and the transaction-local match_results ledger.
    database.prepare("DROP TRIGGER IF EXISTS trg_record_match_result"),
    database
      .prepare(
        `UPDATE matches
         SET status = 'abandoned', winner_id = NULL,
           finished_at = COALESCE(finished_at, ?), updated_at = ?
         WHERE disk_count NOT IN (6, 9, 12, 15)
           AND status IN ('countdown', 'playing')`,
      )
      .bind(now, now),
    database
      .prepare(
        `UPDATE invites SET status = 'expired', responded_at = ?
         WHERE disk_count NOT IN (6, 9, 12, 15) AND status = 'pending'`,
      )
      .bind(now),
    database.prepare(
      `UPDATE players SET active_match_id = NULL, status = 'online'
       WHERE active_match_id IN (
         SELECT id FROM matches WHERE disk_count NOT IN (6, 9, 12, 15)
       )`,
    ),
    database.prepare(
      `DELETE FROM active_slots
       WHERE game_id IN (
         SELECT id FROM matches WHERE disk_count NOT IN (6, 9, 12, 15)
         UNION
         SELECT id FROM invites WHERE disk_count NOT IN (6, 9, 12, 15)
       )`,
    ),
    database
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
      )
      .bind(BOLT_SORT_MIGRATION, now),
    ]);
  }

  const dualModeApplied = await database
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .bind(DUAL_MODE_MIGRATION)
    .first<{ id: string }>();
  if (dualModeApplied) return;

  const inviteColumns = await database.prepare("PRAGMA table_info(invites)").all<{ name: string }>();
  const matchColumns = await database.prepare("PRAGMA table_info(matches)").all<{ name: string }>();
  if (!inviteColumns.results.some((column) => column.name === "game_mode")) {
    await database.prepare("ALTER TABLE invites ADD COLUMN game_mode TEXT DEFAULT 'sort' NOT NULL").run();
  }
  if (!matchColumns.results.some((column) => column.name === "game_mode")) {
    await database.prepare("ALTER TABLE matches ADD COLUMN game_mode TEXT DEFAULT 'sort' NOT NULL").run();
  }
  await database
    .prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
    .bind(DUAL_MODE_MIGRATION, Date.now())
    .run();
}

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
    const pending = database
      .batch(SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)))
      .then(async () => {
        await applyMigrations(database);
        await database.prepare("PRAGMA optimize").run();
      });
    schemaPromise = pending;
    void pending.catch(() => {
      if (schemaPromise === pending) schemaPromise = null;
    });
  }

  await schemaPromise;
  return database;
}
