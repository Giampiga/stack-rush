import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const schemaMigrations = sqliteTable("schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
});

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    name: text("name").notNull(),
    hue: integer("hue").notNull(),
    status: text("status").notNull().default("online"),
    activeMatchId: text("active_match_id"),
    wins: integer("wins").notNull().default(0),
    races: integer("races").notNull().default(0),
    lastSeen: integer("last_seen").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_players_presence").on(table.activeMatchId, table.lastSeen),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    fromPlayerId: text("from_player_id").notNull(),
    toPlayerId: text("to_player_id").notNull(),
    gameMode: text("game_mode").notNull().default("sort"),
    colorCount: integer("disk_count").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
    respondedAt: integer("responded_at"),
  },
  (table) => [
    index("idx_invites_incoming").on(
      table.toPlayerId,
      table.status,
      table.createdAt,
    ),
    index("idx_invites_outgoing").on(
      table.fromPlayerId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const activeSlots = sqliteTable(
  "active_slots",
  {
    playerId: text("player_id").primaryKey(),
    gameId: text("game_id").notNull(),
    role: text("role").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_active_slots_game").on(table.gameId)],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    playerOneId: text("player_one_id").notNull(),
    playerTwoId: text("player_two_id").notNull(),
    gameMode: text("game_mode").notNull().default("sort"),
    colorCount: integer("disk_count").notNull(),
    status: text("status").notNull().default("countdown"),
    startsAt: integer("starts_at").notNull(),
    winnerId: text("winner_id"),
    playerOneState: text("player_one_state").notNull(),
    playerTwoState: text("player_two_state").notNull(),
    playerOneMoves: integer("player_one_moves").notNull().default(0),
    playerTwoMoves: integer("player_two_moves").notNull().default(0),
    playerOneRematch: integer("player_one_rematch").notNull().default(0),
    playerTwoRematch: integer("player_two_rematch").notNull().default(0),
    rematchId: text("rematch_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("idx_matches_player_one").on(table.playerOneId, table.updatedAt),
    index("idx_matches_player_two").on(table.playerTwoId, table.updatedAt),
  ],
);

export const matchResults = sqliteTable("match_results", {
  matchId: text("match_id").primaryKey(),
  winnerId: text("winner_id").notNull(),
  loserId: text("loser_id").notNull(),
  claimId: text("claim_id").notNull().unique(),
  applied: integer("applied").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  appliedAt: integer("applied_at"),
});

export const guestSessionCreations = sqliteTable(
  "guest_session_creations",
  {
    nonce: text("nonce").primaryKey(),
    clientKeyHash: text("client_key_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_guest_session_creations_created").on(table.createdAt),
    index("idx_guest_session_creations_client").on(
      table.clientKeyHash,
      table.createdAt,
    ),
  ],
);

export const maintenanceLeases = sqliteTable("maintenance_leases", {
  key: text("key").primaryKey(),
  runAfter: integer("run_after").notNull(),
  claimId: text("claim_id").notNull(),
});
