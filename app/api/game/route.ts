import { ensureDatabase } from "@/db";
import {
  BOLT_CAPACITY,
  SORT_LEVELS,
  boltSortProgress,
  createBoltSortPuzzle,
  isBoltSortSolved,
  isValidBoltSortBoard,
  moveBoltSortNut,
  type BoltSortBoard,
  type BoltSortTierId,
} from "@/lib/bolt-sort";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "peg_rush_guest";
const ONLINE_WINDOW_MS = 25_000;
const INVITE_WINDOW_MS = 35_000;
const COUNTDOWN_MS = 3_000;
const MAX_BODY_BYTES = 4_096;
const PUZZLE_SEED_VERSION = "bolt-v1";
const GUEST_CREATE_WINDOW_MS = 60_000;
const GUEST_CREATE_PER_CLIENT_LIMIT = 48;
const GUEST_CREATE_GLOBAL_LIMIT = 240;
const MAX_GUEST_PLAYERS = 20_000;
const GUEST_RETENTION_MS = 31 * 24 * 60 * 60 * 1_000;
const HOUSEKEEPING_INTERVAL_MS = 10 * 60 * 1_000;

type PlayerRow = {
  id: string;
  token_hash: string;
  name: string;
  hue: number;
  status: string;
  active_match_id: string | null;
  wins: number;
  races: number;
  last_seen: number;
  created_at: number;
};

type InviteRow = {
  id: string;
  from_player_id: string;
  to_player_id: string;
  disk_count: number;
  status: string;
  created_at: number;
  responded_at: number | null;
};

type MatchRow = {
  id: string;
  player_one_id: string;
  player_two_id: string;
  disk_count: number;
  status: string;
  starts_at: number;
  winner_id: string | null;
  player_one_state: string;
  player_two_state: string;
  player_one_moves: number;
  player_two_moves: number;
  player_one_rematch: number;
  player_two_rematch: number;
  rematch_id: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
};

type GameRequest = {
  action?: string;
  name?: string;
  playerId?: string;
  inviteId?: string;
  matchId?: string;
  tier?: string;
  response?: string;
  from?: number;
  to?: number;
  expectedMoves?: number;
};

class GameError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "BAD_REQUEST",
  ) {
    super(message);
  }
}

function responseHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return headers;
}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(headers),
  });
}

function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new GameError("Cross-site requests are not allowed.", 403, "FORBIDDEN");
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new GameError("Request origin does not match.", 403, "FORBIDDEN");
  }
}

async function readPayload(request: Request): Promise<GameRequest> {
  const rawLength = request.headers.get("content-length");
  const length = rawLength === null ? null : Number(rawLength);
  if (
    length !== null &&
    (!Number.isSafeInteger(length) || length < 0)
  ) {
    throw new GameError("Content-Length is invalid.", 400, "INVALID_LENGTH");
  }
  if (length !== null && length > MAX_BODY_BYTES) {
    throw new GameError("Request is too large.", 413, "PAYLOAD_TOO_LARGE");
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new GameError("Send a valid JSON request.", 400, "INVALID_JSON");
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new GameError("Request is too large.", 413, "PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GameError("Send a valid JSON request.", 400, "INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GameError("Send a JSON object.", 400, "INVALID_REQUEST");
  }
  return value as GameRequest;
}

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies: Record<string, string> = {};
  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    if (!part) continue;
    const separator = part.indexOf("=");
    const rawKey = separator >= 0 ? part.slice(0, separator) : part;
    const rawValue = separator >= 0 ? part.slice(separator + 1) : "";
    try {
      cookies[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
    } catch {
      // Ignore malformed cookie pairs; one unrelated bad cookie must not turn a
      // recoverable guest session into a server error.
    }
  }
  return cookies;
}

function sessionCookie(request: Request, id: string, secret: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(`${id}.${secret}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function hueFromId(id: string): number {
  return Array.from(id).reduce((total, character) => {
    return (total * 31 + character.charCodeAt(0)) % 360;
  }, 17);
}

const NAME_LEFT = [
  "Brisk",
  "Clever",
  "Cosmic",
  "Dizzy",
  "Lucky",
  "Mighty",
  "Quick",
  "Sunny",
];
const NAME_RIGHT = [
  "Badger",
  "Gecko",
  "Koala",
  "Otter",
  "Panda",
  "Robin",
  "Tiger",
  "Yak",
];

function guestName(hue: number): string {
  const left = NAME_LEFT[hue % NAME_LEFT.length];
  const right = NAME_RIGHT[Math.floor(hue / 7) % NAME_RIGHT.length];
  return `${left} ${right}`;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18)
    .trim();
  return clean.length >= 2 ? clean : null;
}

function parseTier(value: unknown): BoltSortTierId | null {
  if (typeof value !== "string") return null;
  return Object.prototype.hasOwnProperty.call(SORT_LEVELS, value)
    ? (value as BoltSortTierId)
    : null;
}

function tierForColorCount(colorCount: number): BoltSortTierId {
  const entry = (Object.entries(SORT_LEVELS) as Array<
    [BoltSortTierId, (typeof SORT_LEVELS)[BoltSortTierId]]
  >).find(([, config]) => config.colorCount === colorCount);
  if (!entry) {
    throw new GameError(
      "Stored match difficulty is invalid.",
      500,
      "INVALID_MATCH_STATE",
    );
  }
  return entry[0];
}

function puzzleSeed(matchId: string): string {
  return `${PUZZLE_SEED_VERSION}:${matchId}`;
}

function changed(result: { meta?: { changes?: number } } | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

async function playerFromSession(
  database: D1Database,
  request: Request,
  now: number,
): Promise<PlayerRow | null> {
  const rawSession = parseCookies(request)[COOKIE_NAME];
  if (!rawSession) return null;
  const separator = rawSession.indexOf(".");
  if (separator < 1) return null;

  const id = rawSession.slice(0, separator);
  const secret = rawSession.slice(separator + 1);
  if (id.length > 64 || secret.length < 32 || secret.length > 128) return null;

  const player = await database
    .prepare("SELECT * FROM players WHERE id = ?")
    .bind(id)
    .first<PlayerRow>();
  if (!player) return null;
  if (player.last_seen < now - GUEST_RETENTION_MS) return null;

  const tokenHash = await hashSecret(secret);
  return tokenHash === player.token_hash ? player : null;
}

async function requirePlayer(
  database: D1Database,
  request: Request,
  now: number,
): Promise<PlayerRow> {
  const player = await playerFromSession(database, request, now);
  if (!player) {
    throw new GameError(
      "Your guest session has expired. Refresh to rejoin the lounge.",
      401,
      "SESSION_EXPIRED",
    );
  }

  await database
    .prepare("UPDATE players SET last_seen = ? WHERE id = ?")
    .bind(now, player.id)
    .run();
  return { ...player, last_seen: now };
}

async function expireInvites(database: D1Database, now: number) {
  const cutoff = now - INVITE_WINDOW_MS;
  await database.batch([
    database
      .prepare(
        "UPDATE invites SET status = 'expired', responded_at = ? WHERE status = 'pending' AND created_at < ?",
      )
      .bind(now, cutoff),
    database.prepare(
      `DELETE FROM active_slots
       WHERE game_id IN (
         SELECT i.id FROM invites i
         WHERE i.status = 'expired'
           AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = i.id)
       )`,
    ),
  ]);
}

async function cleanupStaleGuests(database: D1Database, now: number) {
  const claimId = crypto.randomUUID();
  const lease = await database.batch([
    database.prepare(
      "INSERT OR IGNORE INTO maintenance_leases (key, run_after, claim_id) VALUES ('guest_cleanup', 0, '')",
    ),
    database
      .prepare(
        `UPDATE maintenance_leases SET run_after = ?, claim_id = ?
         WHERE key = 'guest_cleanup' AND run_after <= ?`,
      )
      .bind(now + HOUSEKEEPING_INTERVAL_MS, claimId, now),
  ]);
  if (changed(lease[1]) !== 1) return;

  const cutoff = now - GUEST_RETENTION_MS;
  await database.batch([
    database
      .prepare("DELETE FROM guest_session_creations WHERE created_at < ?")
      .bind(now - GUEST_CREATE_WINDOW_MS),
    database
      .prepare(
        `UPDATE matches SET status = 'abandoned', winner_id = NULL,
           finished_at = COALESCE(finished_at, ?), updated_at = ?
         WHERE created_at < ? AND status IN ('countdown', 'playing')
           AND NOT EXISTS (
             SELECT 1 FROM players p
             WHERE p.id IN (matches.player_one_id, matches.player_two_id)
               AND p.last_seen >= ?
           )`,
      )
      .bind(now, now, cutoff, cutoff),
    database
      .prepare(
        `UPDATE players SET active_match_id = NULL, status = 'online'
         WHERE active_match_id IN (
           SELECT m.id FROM matches m
           WHERE m.created_at < ? AND m.status IN ('finished', 'abandoned')
             AND NOT EXISTS (
               SELECT 1 FROM players active
               WHERE active.id IN (m.player_one_id, m.player_two_id)
                 AND active.last_seen >= ?
             )
         )`,
      )
      .bind(cutoff, cutoff),
    database
      .prepare(
        `DELETE FROM active_slots
         WHERE game_id IN (
           SELECT m.id FROM matches m
           WHERE m.created_at < ? AND m.status IN ('finished', 'abandoned')
             AND NOT EXISTS (
               SELECT 1 FROM players active
               WHERE active.id IN (m.player_one_id, m.player_two_id)
                 AND active.last_seen >= ?
             )
         )`,
      )
      .bind(cutoff, cutoff),
    database
      .prepare(
        `DELETE FROM matches WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM players p WHERE p.active_match_id = matches.id)
           AND NOT EXISTS (SELECT 1 FROM active_slots s WHERE s.game_id = matches.id)`,
      )
      .bind(cutoff),
    database.prepare(
      `DELETE FROM match_results
       WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = match_results.match_id)`,
    ),
    database
      .prepare(
        `DELETE FROM invites WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = invites.id)
           AND NOT EXISTS (SELECT 1 FROM active_slots s WHERE s.game_id = invites.id)`,
      )
      .bind(cutoff),
    database
      .prepare(
        `DELETE FROM players WHERE last_seen < ? AND active_match_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM active_slots s WHERE s.player_id = players.id)
           AND NOT EXISTS (
             SELECT 1 FROM matches m
             WHERE players.id IN (m.player_one_id, m.player_two_id)
           )
           AND NOT EXISTS (
             SELECT 1 FROM invites i
             WHERE players.id IN (i.from_player_id, i.to_player_id)
           )`,
      )
      .bind(cutoff),
  ]);
}

async function guestClientKey(request: Request): Promise<string> {
  const address =
    request.headers.get("cf-connecting-ip")?.trim().slice(0, 64) || "direct";
  const userAgent = request.headers.get("user-agent")?.slice(0, 256) || "unknown";
  const language = request.headers.get("accept-language")?.slice(0, 64) || "";
  return hashSecret(`guest-v1\n${address}\n${userAgent}\n${language}`);
}

function parseBoard(serialized: string, colorCount: number): BoltSortBoard {
  try {
    const board = JSON.parse(serialized) as unknown;
    if (isValidBoltSortBoard(board, colorCount)) return board;
  } catch {
    // The caller receives a safe server error below.
  }
  throw new GameError("Stored match state is invalid.", 500, "INVALID_MATCH_STATE");
}

async function buildSnapshot(
  database: D1Database,
  playerId: string,
  now: number,
) {
  await expireInvites(database, now);

  let player = await database
    .prepare("SELECT * FROM players WHERE id = ?")
    .bind(playerId)
    .first<PlayerRow>();
  if (!player) {
    throw new GameError("Player was not found.", 404, "PLAYER_NOT_FOUND");
  }

  let matchPayload = null;
  if (player.active_match_id) {
    const activeMatchId = player.active_match_id;
    let match = await database
      .prepare("SELECT * FROM matches WHERE id = ?")
      .bind(activeMatchId)
      .first<MatchRow>();

    if (!match) {
      const cleanup = await database.batch([
        database
          .prepare(
            "UPDATE players SET active_match_id = NULL, status = 'online' WHERE id = ? AND active_match_id = ?",
          )
          .bind(player.id, activeMatchId),
        database
          .prepare(
            "DELETE FROM active_slots WHERE player_id = ? AND game_id = ?",
          )
          .bind(player.id, activeMatchId),
      ]);
      if (changed(cleanup[0]) === 0) {
        return buildSnapshot(database, playerId, now);
      }
      player = { ...player, active_match_id: null, status: "online" };
    } else {
      if (match.status === "countdown" && now >= match.starts_at) {
        const transition = await database
          .prepare(
            "UPDATE matches SET status = 'playing', updated_at = ? WHERE id = ? AND status = 'countdown'",
          )
          .bind(now, match.id)
          .run();
        if (changed(transition) === 1) {
          match = { ...match, status: "playing", updated_at: now };
        } else {
          const latest = await database
            .prepare("SELECT * FROM matches WHERE id = ?")
            .bind(match.id)
            .first<MatchRow>();
          if (!latest) return buildSnapshot(database, playerId, now);
          match = latest;
        }
      }

      const isPlayerOne = match.player_one_id === player.id;
      if (!isPlayerOne && match.player_two_id !== player.id) {
        throw new GameError("You are not in this match.", 403, "FORBIDDEN");
      }

      const opponentId = isPlayerOne
        ? match.player_two_id
        : match.player_one_id;
      const opponent = await database
        .prepare("SELECT * FROM players WHERE id = ?")
        .bind(opponentId)
        .first<PlayerRow>();
      if (!opponent) {
        throw new GameError("Opponent was not found.", 500, "OPPONENT_NOT_FOUND");
      }

      const tier = tierForColorCount(match.disk_count);
      const myBoard = parseBoard(
        isPlayerOne ? match.player_one_state : match.player_two_state,
        match.disk_count,
      );
      const opponentBoard = parseBoard(
        isPlayerOne ? match.player_two_state : match.player_one_state,
        match.disk_count,
      );

      matchPayload = {
        id: match.id,
        status: match.status,
        tier,
        colorCount: match.disk_count,
        capacity: BOLT_CAPACITY,
        startsAt: match.starts_at,
        finishedAt: match.finished_at,
        winnerId: match.winner_id,
        myBoard,
        opponentBoard,
        myProgress: boltSortProgress(myBoard, match.disk_count),
        opponentProgress: boltSortProgress(opponentBoard, match.disk_count),
        myMoves: isPlayerOne
          ? match.player_one_moves
          : match.player_two_moves,
        opponentMoves: isPlayerOne
          ? match.player_two_moves
          : match.player_one_moves,
        myRematch: Boolean(
          isPlayerOne ? match.player_one_rematch : match.player_two_rematch,
        ),
        opponentRematch: Boolean(
          isPlayerOne ? match.player_two_rematch : match.player_one_rematch,
        ),
        canRematch: match.status === "finished",
        opponent: {
          id: opponent.id,
          name: opponent.name,
          hue: opponent.hue,
          wins: opponent.wins,
          races: opponent.races,
          online: opponent.last_seen >= now - ONLINE_WINDOW_MS,
        },
      };
    }
  }

  const onlineResult = await database
    .prepare(
      `SELECT p.id, p.name, p.hue, p.wins, p.races, p.last_seen,
        CASE WHEN s.player_id IS NULL THEN 1 ELSE 0 END AS available
       FROM players p
       LEFT JOIN active_slots s ON s.player_id = p.id
       WHERE p.id <> ? AND p.last_seen >= ?
       ORDER BY available DESC, p.last_seen DESC, p.wins DESC
       LIMIT 30`,
    )
    .bind(player.id, now - ONLINE_WINDOW_MS)
    .all<{
      id: string;
      name: string;
      hue: number;
      wins: number;
      races: number;
      last_seen: number;
      available: number;
    }>();

  const incomingResult = await database
    .prepare(
      `SELECT i.id, i.disk_count, i.created_at, p.id AS player_id,
        p.name, p.hue, p.wins, p.races
       FROM invites i
       JOIN players p ON p.id = i.from_player_id
       WHERE i.to_player_id = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC
       LIMIT 3`,
    )
    .bind(player.id)
    .all<{
      id: string;
      disk_count: number;
      created_at: number;
      player_id: string;
      name: string;
      hue: number;
      wins: number;
      races: number;
    }>();

  const outgoingResult = await database
    .prepare(
      `SELECT i.id, i.disk_count, i.created_at, p.id AS player_id,
        p.name, p.hue, p.wins, p.races
       FROM invites i
       JOIN players p ON p.id = i.to_player_id
       WHERE i.from_player_id = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC
       LIMIT 1`,
    )
    .bind(player.id)
    .all<{
      id: string;
      disk_count: number;
      created_at: number;
      player_id: string;
      name: string;
      hue: number;
      wins: number;
      races: number;
    }>();

  const mapInvite = (invite: (typeof incomingResult.results)[number]) => ({
    id: invite.id,
    tier: tierForColorCount(invite.disk_count),
    colorCount: invite.disk_count,
    createdAt: invite.created_at,
    player: {
      id: invite.player_id,
      name: invite.name,
      hue: invite.hue,
      wins: invite.wins,
      races: invite.races,
    },
  });

  return {
    serverNow: now,
    player: {
      id: player.id,
      name: player.name,
      hue: player.hue,
      wins: player.wins,
      races: player.races,
    },
    online: onlineResult.results.map((other) => ({
      id: other.id,
      name: other.name,
      hue: other.hue,
      wins: other.wins,
      races: other.races,
      available: Boolean(other.available),
    })),
    incoming: incomingResult.results.map(mapInvite),
    outgoing: outgoingResult.results.map(mapInvite),
    match: matchPayload,
  };
}

async function createSession(
  database: D1Database,
  request: Request,
  payload: GameRequest,
  now: number,
) {
  const existing = await playerFromSession(database, request, now);
  if (existing) {
    const requestedName = normalizeName(payload.name);
    const name = requestedName ?? existing.name;
    await database
      .prepare("UPDATE players SET name = ?, last_seen = ? WHERE id = ?")
      .bind(name, now, existing.id)
      .run();
    return json({
      ok: true,
      snapshot: await buildSnapshot(database, existing.id, now),
    });
  }

  const id = crypto.randomUUID();
  const secret = randomSecret();
  const tokenHash = await hashSecret(secret);
  const hue = hueFromId(id);
  const name = normalizeName(payload.name) ?? guestName(hue);
  await cleanupStaleGuests(database, now);

  const nonce = crypto.randomUUID();
  const clientKey = await guestClientKey(request);
  const windowStart = now - GUEST_CREATE_WINDOW_MS;
  const created = await database.batch([
    database
      .prepare(
        `INSERT INTO guest_session_creations (nonce, client_key_hash, created_at)
         SELECT ?, ?, ?
         WHERE (
           SELECT COUNT(*) FROM guest_session_creations WHERE created_at >= ?
         ) < ?
           AND (
             SELECT COUNT(*) FROM guest_session_creations
             WHERE client_key_hash = ? AND created_at >= ?
           ) < ?
           AND (SELECT COUNT(*) FROM players) < ?`,
      )
      .bind(
        nonce,
        clientKey,
        now,
        windowStart,
        GUEST_CREATE_GLOBAL_LIMIT,
        clientKey,
        windowStart,
        GUEST_CREATE_PER_CLIENT_LIMIT,
        MAX_GUEST_PLAYERS,
      ),
    database
      .prepare(
        `INSERT INTO players
         (id, token_hash, name, hue, status, active_match_id, wins, races, last_seen, created_at)
         SELECT ?, ?, ?, ?, 'online', NULL, 0, 0, ?, ?
         WHERE EXISTS (SELECT 1 FROM guest_session_creations WHERE nonce = ?)`,
      )
      .bind(id, tokenHash, name, hue, now, now, nonce),
  ]);
  if (changed(created[0]) !== 1) {
    throw new GameError(
      "The lounge is handling lots of new guests. Try again in a minute.",
      429,
      "SESSION_RATE_LIMITED",
    );
  }
  if (changed(created[1]) !== 1) {
    throw new GameError(
      "The guest session could not be created safely.",
      500,
      "SESSION_INVARIANT_FAILED",
    );
  }

  return json(
    { ok: true, snapshot: await buildSnapshot(database, id, now) },
    201,
    { "Set-Cookie": sessionCookie(request, id, secret) },
  );
}

async function challengePlayer(
  database: D1Database,
  player: PlayerRow,
  payload: GameRequest,
  now: number,
) {
  const targetId = typeof payload.playerId === "string" ? payload.playerId : "";
  const tier = parseTier(payload.tier);
  if (!targetId || targetId === player.id) {
    throw new GameError("Choose another online player.", 400, "INVALID_PLAYER");
  }
  if (!tier) {
    throw new GameError(
      "Choose a valid race tier.",
      400,
      "INVALID_DIFFICULTY",
    );
  }

  const target = await database
    .prepare("SELECT * FROM players WHERE id = ?")
    .bind(targetId)
    .first<PlayerRow>();
  if (!target || target.last_seen < now - ONLINE_WINDOW_MS) {
    throw new GameError("That player just went offline.", 409, "PLAYER_OFFLINE");
  }
  if (player.active_match_id || target.active_match_id) {
    throw new GameError(
      "One of you is already answering another challenge.",
      409,
      "PLAYER_BUSY",
    );
  }

  const recentInvite = await database
    .prepare(
      "SELECT id FROM invites WHERE from_player_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(player.id, now - 1_000)
    .first<{ id: string }>();
  if (recentInvite) {
    throw new GameError("Give them a moment to answer.", 429, "SLOW_DOWN");
  }

  const inviteId = crypto.randomUUID();
  const colorCount = SORT_LEVELS[tier].colorCount;
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO invites
           (id, from_player_id, to_player_id, disk_count, status, created_at, responded_at)
           VALUES (?, ?, ?, ?, 'pending', ?, NULL)`,
        )
        .bind(inviteId, player.id, target.id, colorCount, now),
      database
        .prepare(
          "INSERT INTO active_slots (player_id, game_id, role, created_at) VALUES (?, ?, 'one', ?)",
        )
        .bind(player.id, inviteId, now),
      database
        .prepare(
          "INSERT INTO active_slots (player_id, game_id, role, created_at) VALUES (?, ?, 'two', ?)",
        )
        .bind(target.id, inviteId, now),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("constraint")) {
      throw new GameError(
        "One of you is already answering another challenge.",
        409,
        "PLAYER_BUSY",
      );
    }
    throw error;
  }

  return buildSnapshot(database, player.id, now);
}

async function declineInvite(
  database: D1Database,
  player: PlayerRow,
  invite: InviteRow,
  now: number,
) {
  const results = await database.batch([
    database
      .prepare(
        `UPDATE invites SET status = 'declined', responded_at = ?
         WHERE id = ? AND to_player_id = ? AND status = 'pending'`,
      )
      .bind(now, invite.id, player.id),
    database
      .prepare(
        `DELETE FROM active_slots
         WHERE game_id = ?
           AND EXISTS (SELECT 1 FROM invites WHERE id = ? AND status = 'declined')
           AND NOT EXISTS (SELECT 1 FROM matches WHERE id = ?)`,
      )
      .bind(invite.id, invite.id, invite.id),
  ]);
  if (changed(results[0]) !== 1) {
    throw new GameError("That invite is no longer active.", 409, "INVITE_CLOSED");
  }
  return buildSnapshot(database, player.id, now);
}

async function respondToInvite(
  database: D1Database,
  player: PlayerRow,
  payload: GameRequest,
  now: number,
) {
  const inviteId = typeof payload.inviteId === "string" ? payload.inviteId : "";
  if (!inviteId) {
    throw new GameError("Invite is required.", 400, "INVALID_INVITE");
  }

  const invite = await database
    .prepare("SELECT * FROM invites WHERE id = ?")
    .bind(inviteId)
    .first<InviteRow>();
  if (!invite || invite.to_player_id !== player.id) {
    throw new GameError("Invite was not found.", 404, "INVITE_NOT_FOUND");
  }

  if (payload.response === "decline") {
    if (invite.status !== "pending") {
      throw new GameError("That invite is no longer active.", 409, "INVITE_CLOSED");
    }
    return declineInvite(database, player, invite, now);
  }
  if (payload.response !== "accept") {
    throw new GameError("Accept or decline the invite.", 400, "INVALID_RESPONSE");
  }

  if (invite.status !== "pending") {
    const existingMatch = await database
      .prepare("SELECT id FROM matches WHERE id = ?")
      .bind(invite.id)
      .first<{ id: string }>();
    if (invite.status === "accepted" && existingMatch) {
      return buildSnapshot(database, player.id, now);
    }
    throw new GameError("That invite is no longer active.", 409, "INVITE_CLOSED");
  }

  const tier = tierForColorCount(invite.disk_count);
  const board = JSON.stringify(
    createBoltSortPuzzle(tier, puzzleSeed(invite.id)).board,
  );
  const startsAt = now + COUNTDOWN_MS;
  const results = await database.batch([
    database
      .prepare(
        `UPDATE invites SET status = 'accepted', responded_at = ?
         WHERE id = ? AND to_player_id = ? AND status = 'pending'
           AND created_at >= ?
           AND EXISTS (
             SELECT 1 FROM players p
             WHERE p.id = invites.from_player_id
               AND p.last_seen >= ? AND p.active_match_id IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM players p
             WHERE p.id = invites.to_player_id AND p.active_match_id IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM active_slots s
             WHERE s.player_id = invites.from_player_id AND s.game_id = invites.id
           )
           AND EXISTS (
             SELECT 1 FROM active_slots s
             WHERE s.player_id = invites.to_player_id AND s.game_id = invites.id
           )`,
      )
      .bind(
        now,
        invite.id,
        player.id,
        now - INVITE_WINDOW_MS,
        now - ONLINE_WINDOW_MS,
      ),
    database
      .prepare(
        `INSERT INTO matches
         (id, player_one_id, player_two_id, disk_count, status, starts_at,
          winner_id, player_one_state, player_two_state, player_one_moves,
          player_two_moves, player_one_rematch, player_two_rematch, rematch_id,
          created_at, updated_at, finished_at)
         SELECT i.id, i.from_player_id, i.to_player_id, i.disk_count,
          'countdown', ?, NULL, ?, ?, 0, 0, 0, 0, NULL, ?, ?, NULL
         FROM invites i
         WHERE i.id = ? AND i.status = 'accepted' AND i.responded_at = ?
           AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = i.id)`,
      )
      .bind(startsAt, board, board, now, now, invite.id, now),
    database
      .prepare(
        `UPDATE players SET active_match_id = ?, status = 'playing'
         WHERE id IN (?, ?) AND active_match_id IS NULL
           AND EXISTS (SELECT 1 FROM matches WHERE id = ?)`,
      )
      .bind(invite.id, invite.from_player_id, invite.to_player_id, invite.id),
  ]);

  if (changed(results[0]) !== 1) {
    const existingMatch = await database
      .prepare("SELECT id FROM matches WHERE id = ?")
      .bind(invite.id)
      .first<{ id: string }>();
    if (existingMatch) return buildSnapshot(database, player.id, now);

    const offlineClose = await database.batch([
      database
        .prepare(
          `UPDATE invites SET status = 'expired', responded_at = ?
           WHERE id = ? AND status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM players p
               WHERE p.id = invites.from_player_id AND p.last_seen >= ?
             )`,
        )
        .bind(now, invite.id, now - ONLINE_WINDOW_MS),
      database
        .prepare(
          `DELETE FROM active_slots
           WHERE game_id = ?
             AND EXISTS (SELECT 1 FROM invites WHERE id = ? AND status = 'expired')
             AND NOT EXISTS (SELECT 1 FROM matches WHERE id = ?)`,
        )
        .bind(invite.id, invite.id, invite.id),
    ]);
    if (changed(offlineClose[0]) === 1) {
      throw new GameError("The challenger went offline.", 409, "PLAYER_OFFLINE");
    }
    throw new GameError("That invite is no longer active.", 409, "INVITE_CLOSED");
  }

  if (changed(results[1]) !== 1 || changed(results[2]) !== 2) {
    throw new GameError(
      "The match could not be started safely.",
      500,
      "MATCH_INVARIANT_FAILED",
    );
  }

  return buildSnapshot(database, player.id, now);
}

async function cancelInvite(
  database: D1Database,
  player: PlayerRow,
  payload: GameRequest,
  now: number,
) {
  const inviteId = typeof payload.inviteId === "string" ? payload.inviteId : "";
  if (!inviteId) {
    throw new GameError("Invite is required.", 400, "INVALID_INVITE");
  }

  const results = await database.batch([
    database
      .prepare(
        `UPDATE invites SET status = 'cancelled', responded_at = ?
         WHERE id = ? AND from_player_id = ? AND status = 'pending'`,
      )
      .bind(now, inviteId, player.id),
    database
      .prepare(
        `DELETE FROM active_slots
         WHERE game_id = ?
           AND EXISTS (SELECT 1 FROM invites WHERE id = ? AND status = 'cancelled')
           AND NOT EXISTS (SELECT 1 FROM matches WHERE id = ?)`,
      )
      .bind(inviteId, inviteId, inviteId),
  ]);
  if (changed(results[0]) !== 1) {
    throw new GameError("Invite is no longer active.", 409, "INVITE_CLOSED");
  }
  return buildSnapshot(database, player.id, now);
}

async function makeMove(
  database: D1Database,
  player: PlayerRow,
  payload: GameRequest,
  now: number,
) {
  const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
  if (!matchId || player.active_match_id !== matchId) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  if (
    !Number.isSafeInteger(payload.from) ||
    !Number.isSafeInteger(payload.to) ||
    !Number.isSafeInteger(payload.expectedMoves) ||
    payload.expectedMoves! < 0
  ) {
    throw new GameError("Move details are invalid.", 400, "INVALID_MOVE");
  }

  const match = await database
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(matchId)
    .first<MatchRow>();
  if (!match) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  if (match.status !== "countdown" && match.status !== "playing") {
    throw new GameError("This race is already over.", 409, "MATCH_OVER");
  }
  if (now < match.starts_at) {
    throw new GameError("Wait for GO!", 409, "MATCH_NOT_STARTED");
  }

  const isPlayerOne = match.player_one_id === player.id;
  if (!isPlayerOne && match.player_two_id !== player.id) {
    throw new GameError("You are not in this match.", 403, "FORBIDDEN");
  }

  const moves = isPlayerOne ? match.player_one_moves : match.player_two_moves;
  if (payload.expectedMoves !== moves) {
    throw new GameError("Your board changed. Try that move again.", 409, "STALE_MOVE");
  }

  tierForColorCount(match.disk_count);
  const board = parseBoard(
    isPlayerOne ? match.player_one_state : match.player_two_state,
    match.disk_count,
  );
  const result = moveBoltSortNut(
    board,
    payload.from!,
    payload.to!,
    match.disk_count,
  );
  if (!result.ok) {
    throw new GameError(result.message, 409, "ILLEGAL_MOVE");
  }

  const won = isBoltSortSolved(result.board, match.disk_count);
  const nextMoves = moves + 1;
  const stateColumn = isPlayerOne ? "player_one_state" : "player_two_state";
  const movesColumn = isPlayerOne ? "player_one_moves" : "player_two_moves";

  let updateChanges = 0;
  if (won) {
    const opponentId = isPlayerOne ? match.player_two_id : match.player_one_id;
    const claimId = crypto.randomUUID();
    const terminal = await database.batch([
      database
        .prepare(
          `INSERT INTO match_results
           (match_id, winner_id, loser_id, claim_id, applied, created_at, applied_at)
           SELECT id, ?, ?, ?, 0, ?, NULL FROM matches
           WHERE id = ? AND ${movesColumn} = ?
             AND status IN ('countdown', 'playing') AND winner_id IS NULL
             AND EXISTS (SELECT 1 FROM players WHERE id = ?)
             AND EXISTS (SELECT 1 FROM players WHERE id = ?)
             AND NOT EXISTS (SELECT 1 FROM match_results WHERE match_id = matches.id)`,
        )
        .bind(
          player.id,
          opponentId,
          claimId,
          now,
          match.id,
          moves,
          player.id,
          opponentId,
        ),
      database
        .prepare(
          `UPDATE matches SET ${stateColumn} = ?, ${movesColumn} = ?,
             status = 'finished', winner_id = ?, finished_at = ?, updated_at = ?
           WHERE id = ? AND ${movesColumn} = ?
             AND status IN ('countdown', 'playing') AND winner_id IS NULL
             AND EXISTS (
               SELECT 1 FROM match_results r
               WHERE r.match_id = matches.id AND r.claim_id = ? AND r.applied = 0
             )`,
        )
        .bind(
          JSON.stringify(result.board),
          nextMoves,
          player.id,
          now,
          now,
          match.id,
          moves,
          claimId,
        ),
      database
        .prepare(
          `UPDATE players SET wins = wins + 1, races = races + 1, status = 'result'
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM match_results
             WHERE match_id = ? AND claim_id = ? AND applied = 0
           )`,
        )
        .bind(player.id, match.id, claimId),
      database
        .prepare(
          `UPDATE players SET races = races + 1, status = 'result'
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM match_results
             WHERE match_id = ? AND claim_id = ? AND applied = 0
           )`,
        )
        .bind(opponentId, match.id, claimId),
      database
        .prepare(
          `UPDATE match_results SET applied = 1, applied_at = ?
           WHERE match_id = ? AND claim_id = ? AND applied = 0`,
        )
        .bind(now, match.id, claimId),
    ]);
    updateChanges = changed(terminal[1]);
    if (
      changed(terminal[0]) === 1 &&
      (updateChanges !== 1 ||
        changed(terminal[2]) !== 1 ||
        changed(terminal[3]) !== 1 ||
        changed(terminal[4]) !== 1)
    ) {
      throw new GameError(
        "The race result could not be recorded safely.",
        500,
        "RESULT_INVARIANT_FAILED",
      );
    }
  } else {
    const update = await database
      .prepare(
        `UPDATE matches SET ${stateColumn} = ?, ${movesColumn} = ?,
           status = 'playing', updated_at = ?
         WHERE id = ? AND ${movesColumn} = ?
           AND status IN ('countdown', 'playing') AND winner_id IS NULL`,
      )
      .bind(JSON.stringify(result.board), nextMoves, now, match.id, moves)
      .run();
    updateChanges = changed(update);
  }

  if (updateChanges === 0) {
    const latest = await database
      .prepare("SELECT status, winner_id FROM matches WHERE id = ?")
      .bind(match.id)
      .first<{ status: string; winner_id: string | null }>();
    if (latest && (latest.winner_id || !["countdown", "playing"].includes(latest.status))) {
      throw new GameError("This race is already over.", 409, "MATCH_OVER");
    }
    throw new GameError("The race state changed. Try again.", 409, "STALE_MOVE");
  }

  return buildSnapshot(database, player.id, now);
}

async function resetBoard(
  database: D1Database,
  player: PlayerRow,
  payload: GameRequest,
  now: number,
) {
  const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
  if (!matchId || player.active_match_id !== matchId) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  if (
    !Number.isSafeInteger(payload.expectedMoves) ||
    payload.expectedMoves! < 0
  ) {
    throw new GameError("Reset details are invalid.", 400, "INVALID_RESET");
  }

  const match = await database
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(matchId)
    .first<MatchRow>();
  if (!match) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  if (match.status !== "countdown" && match.status !== "playing") {
    throw new GameError("This race is already over.", 409, "MATCH_OVER");
  }
  if (now < match.starts_at) {
    throw new GameError("Wait for GO!", 409, "MATCH_NOT_STARTED");
  }

  const isPlayerOne = match.player_one_id === player.id;
  if (!isPlayerOne && match.player_two_id !== player.id) {
    throw new GameError("You are not in this match.", 403, "FORBIDDEN");
  }

  const moves = isPlayerOne ? match.player_one_moves : match.player_two_moves;
  if (payload.expectedMoves !== moves) {
    throw new GameError("Your board changed. Try again.", 409, "STALE_MOVE");
  }

  const tier = tierForColorCount(match.disk_count);
  const initialBoard = createBoltSortPuzzle(tier, puzzleSeed(match.id)).board;
  const nextMoves = moves + 1;
  const sql = isPlayerOne
    ? `UPDATE matches SET player_one_state = ?, player_one_moves = ?,
         status = 'playing', updated_at = ?
       WHERE id = ? AND player_one_moves = ? AND starts_at <= ?
         AND status IN ('countdown', 'playing') AND winner_id IS NULL`
    : `UPDATE matches SET player_two_state = ?, player_two_moves = ?,
         status = 'playing', updated_at = ?
       WHERE id = ? AND player_two_moves = ? AND starts_at <= ?
         AND status IN ('countdown', 'playing') AND winner_id IS NULL`;
  const update = await database
    .prepare(sql)
    .bind(
      JSON.stringify(initialBoard),
      nextMoves,
      now,
      match.id,
      moves,
      now,
    )
    .run();

  if (changed(update) === 0) {
    const latest = await database
      .prepare("SELECT status, winner_id FROM matches WHERE id = ?")
      .bind(match.id)
      .first<{ status: string; winner_id: string | null }>();
    if (latest && (latest.winner_id || !["countdown", "playing"].includes(latest.status))) {
      throw new GameError("This race is already over.", 409, "MATCH_OVER");
    }
    throw new GameError("The race state changed. Try again.", 409, "STALE_MOVE");
  }

  return buildSnapshot(database, player.id, now);
}

async function leaveMatch(
  database: D1Database,
  player: PlayerRow,
  payload: GameRequest,
  now: number,
) {
  const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
  if (!matchId) {
    throw new GameError("Match is required.", 400, "INVALID_MATCH");
  }
  if (!player.active_match_id) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  if (player.active_match_id !== matchId) {
    throw new GameError("The active match changed.", 409, "MATCH_CHANGED");
  }

  const match = await database
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(matchId)
    .first<MatchRow>();
  if (!match) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  const isPlayerOne = match.player_one_id === player.id;
  if (!isPlayerOne && match.player_two_id !== player.id) {
    throw new GameError("You are not in this match.", 403, "FORBIDDEN");
  }
  const opponentId = isPlayerOne ? match.player_two_id : match.player_one_id;
  const claimId = crypto.randomUUID();

  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO match_results
         (match_id, winner_id, loser_id, claim_id, applied, created_at, applied_at)
         SELECT id, ?, ?, ?, 0, ?, NULL FROM matches
         WHERE id = ? AND status IN ('countdown', 'playing') AND winner_id IS NULL
           AND EXISTS (SELECT 1 FROM players WHERE id = ?)
           AND EXISTS (SELECT 1 FROM players WHERE id = ?)
           AND NOT EXISTS (SELECT 1 FROM match_results WHERE match_id = matches.id)`,
      )
      .bind(
        opponentId,
        player.id,
        claimId,
        now,
        match.id,
        opponentId,
        player.id,
      ),
    database
      .prepare(
        `UPDATE matches SET
           status = 'abandoned',
           winner_id = CASE
             WHEN status IN ('countdown', 'playing') THEN ?
             ELSE winner_id
           END,
           finished_at = CASE
             WHEN status IN ('countdown', 'playing') THEN ?
             ELSE finished_at
           END,
           updated_at = ?
         WHERE id = ?
           AND (
             (status IN ('countdown', 'playing') AND winner_id IS NULL
               AND EXISTS (
                 SELECT 1 FROM match_results r
                 WHERE r.match_id = matches.id AND r.claim_id = ? AND r.applied = 0
               ))
             OR (status = 'finished' AND rematch_id IS NULL)
           )`,
      )
      .bind(opponentId, now, now, match.id, claimId),
    database
      .prepare(
        `UPDATE players SET wins = wins + 1, races = races + 1, status = 'result'
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM match_results
           WHERE match_id = ? AND claim_id = ? AND applied = 0
         )`,
      )
      .bind(opponentId, match.id, claimId),
    database
      .prepare(
        `UPDATE players SET races = races + 1, status = 'result'
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM match_results
           WHERE match_id = ? AND claim_id = ? AND applied = 0
         )`,
      )
      .bind(player.id, match.id, claimId),
    database
      .prepare(
        `UPDATE match_results SET applied = 1, applied_at = ?
         WHERE match_id = ? AND claim_id = ? AND applied = 0`,
      )
      .bind(now, match.id, claimId),
    database
      .prepare(
        `UPDATE players SET active_match_id = NULL, status = 'online'
         WHERE id = ? AND active_match_id = ?`,
      )
      .bind(player.id, match.id),
    database
      .prepare(
        "DELETE FROM active_slots WHERE player_id = ? AND game_id = ?",
      )
      .bind(player.id, match.id),
  ]);

  if (
    changed(results[0]) === 1 &&
    (changed(results[1]) !== 1 ||
      changed(results[2]) !== 1 ||
      changed(results[3]) !== 1 ||
      changed(results[4]) !== 1)
  ) {
    throw new GameError(
      "The forfeit result could not be recorded safely.",
      500,
      "RESULT_INVARIANT_FAILED",
    );
  }

  if (changed(results[5]) !== 1) {
    const latestPlayer = await database
      .prepare("SELECT active_match_id FROM players WHERE id = ?")
      .bind(player.id)
      .first<{ active_match_id: string | null }>();
    if (latestPlayer?.active_match_id && latestPlayer.active_match_id !== match.id) {
      throw new GameError("The active match changed.", 409, "MATCH_CHANGED");
    }
  }

  return buildSnapshot(database, player.id, now);
}

async function requestRematch(
  database: D1Database,
  player: PlayerRow,
  payload: GameRequest,
  now: number,
) {
  const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
  if (!matchId) {
    throw new GameError("Match is required.", 400, "INVALID_MATCH");
  }
  if (!player.active_match_id) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  if (player.active_match_id !== matchId) {
    throw new GameError("The active match changed.", 409, "MATCH_CHANGED");
  }

  const match = await database
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(matchId)
    .first<MatchRow>();
  if (!match) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  if (match.status === "abandoned") {
    throw new GameError(
      "A forfeited race cannot be rematched.",
      409,
      "REMATCH_UNAVAILABLE",
    );
  }
  if (match.status !== "finished") {
    throw new GameError(
      "Finish this race before requesting a rematch.",
      409,
      "MATCH_ACTIVE",
    );
  }

  const isPlayerOne = match.player_one_id === player.id;
  if (!isPlayerOne && match.player_two_id !== player.id) {
    throw new GameError("You are not in this match.", 403, "FORBIDDEN");
  }
  const voteColumn = isPlayerOne ? "player_one_rematch" : "player_two_rematch";
  const rematchId = crypto.randomUUID();
  const tier = tierForColorCount(match.disk_count);
  const board = JSON.stringify(
    createBoltSortPuzzle(tier, puzzleSeed(rematchId)).board,
  );
  const startsAt = now + COUNTDOWN_MS;

  const results = await database.batch([
    database
      .prepare(
        `UPDATE matches SET ${voteColumn} = 1, updated_at = ?
         WHERE id = ? AND status = 'finished' AND rematch_id IS NULL
           AND EXISTS (
             SELECT 1 FROM players p
             WHERE p.id = ? AND p.active_match_id = matches.id
           )
           AND EXISTS (
             SELECT 1 FROM active_slots s
             WHERE s.player_id = ? AND s.game_id = matches.id
           )`,
      )
      .bind(now, match.id, player.id, player.id),
    database
      .prepare(
        `UPDATE matches SET rematch_id = ?, updated_at = ?
         WHERE id = ? AND status = 'finished' AND rematch_id IS NULL
           AND player_one_rematch = 1 AND player_two_rematch = 1
           AND EXISTS (
             SELECT 1 FROM players p
             WHERE p.id = matches.player_one_id AND p.active_match_id = matches.id
           )
           AND EXISTS (
             SELECT 1 FROM players p
             WHERE p.id = matches.player_two_id AND p.active_match_id = matches.id
           )
           AND EXISTS (
             SELECT 1 FROM active_slots s
             WHERE s.player_id = matches.player_one_id AND s.game_id = matches.id
           )
           AND EXISTS (
             SELECT 1 FROM active_slots s
             WHERE s.player_id = matches.player_two_id AND s.game_id = matches.id
           )`,
      )
      .bind(rematchId, now, match.id),
    database
      .prepare(
        `INSERT INTO matches
         (id, player_one_id, player_two_id, disk_count, status, starts_at,
          winner_id, player_one_state, player_two_state, player_one_moves,
          player_two_moves, player_one_rematch, player_two_rematch, rematch_id,
          created_at, updated_at, finished_at)
         SELECT ?, m.player_one_id, m.player_two_id, m.disk_count,
          'countdown', ?, NULL, ?, ?, 0, 0, 0, 0, NULL, ?, ?, NULL
         FROM matches m
         WHERE m.id = ? AND m.rematch_id = ?
           AND NOT EXISTS (SELECT 1 FROM matches n WHERE n.id = ?)`,
      )
      .bind(
        rematchId,
        startsAt,
        board,
        board,
        now,
        now,
        match.id,
        rematchId,
        rematchId,
      ),
    database
      .prepare(
        `UPDATE players SET active_match_id = ?, status = 'playing'
         WHERE id IN (?, ?) AND active_match_id = ?
           AND EXISTS (SELECT 1 FROM matches WHERE id = ? AND rematch_id = ?)`,
      )
      .bind(
        rematchId,
        match.player_one_id,
        match.player_two_id,
        match.id,
        match.id,
        rematchId,
      ),
    database
      .prepare(
        `UPDATE active_slots SET game_id = ?, created_at = ?
         WHERE game_id = ? AND player_id IN (?, ?)
           AND EXISTS (SELECT 1 FROM matches WHERE id = ? AND rematch_id = ?)`,
      )
      .bind(
        rematchId,
        now,
        match.id,
        match.player_one_id,
        match.player_two_id,
        match.id,
        rematchId,
      ),
  ]);

  if (changed(results[1]) === 1) {
    if (
      changed(results[2]) !== 1 ||
      changed(results[3]) !== 2 ||
      changed(results[4]) !== 2
    ) {
      throw new GameError(
        "The rematch could not be started safely.",
        500,
        "MATCH_INVARIANT_FAILED",
      );
    }
  }

  return buildSnapshot(database, player.id, now);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = await readPayload(request);
    const action = payload.action ?? "sync";
    const database = await ensureDatabase();
    const now = Date.now();

    if (action === "session") {
      return await createSession(database, request, payload, now);
    }

    const player = await requirePlayer(database, request, now);
    await expireInvites(database, now);
    let snapshot;
    switch (action) {
      case "sync":
        snapshot = await buildSnapshot(database, player.id, now);
        break;
      case "rename": {
        const name = normalizeName(payload.name);
        if (!name) {
          throw new GameError("Use 2–18 letters or numbers.", 400, "INVALID_NAME");
        }
        await database
          .prepare("UPDATE players SET name = ? WHERE id = ?")
          .bind(name, player.id)
          .run();
        snapshot = await buildSnapshot(database, player.id, now);
        break;
      }
      case "challenge":
        snapshot = await challengePlayer(database, player, payload, now);
        break;
      case "respond":
        snapshot = await respondToInvite(database, player, payload, now);
        break;
      case "cancel-invite":
        snapshot = await cancelInvite(database, player, payload, now);
        break;
      case "move":
        snapshot = await makeMove(database, player, payload, now);
        break;
      case "reset":
        snapshot = await resetBoard(database, player, payload, now);
        break;
      case "leave-match":
        snapshot = await leaveMatch(database, player, payload, now);
        break;
      case "rematch":
        snapshot = await requestRematch(database, player, payload, now);
        break;
      default:
        throw new GameError("Unknown game action.", 400, "UNKNOWN_ACTION");
    }

    return json({ ok: true, snapshot });
  } catch (error) {
    if (error instanceof GameError) {
      return json(
        { ok: false, error: error.message, code: error.code },
        error.status,
      );
    }
    console.error("game api error", error);
    return json(
      {
        ok: false,
        error: "The game server hit a snag. Try again.",
        code: "SERVER_ERROR",
      },
      500,
    );
  }
}
