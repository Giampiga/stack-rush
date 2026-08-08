import { ensureDatabase } from "@/db";
import {
  createHanoiBoard,
  isHanoiSolved,
  isValidHanoiBoard,
  moveHanoiDisk,
  type HanoiBoard,
} from "@/lib/hanoi";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "peg_rush_guest";
const ONLINE_WINDOW_MS = 25_000;
const INVITE_WINDOW_MS = 35_000;
const COUNTDOWN_MS = 3_000;
const MAX_BODY_BYTES = 4_096;

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
  diskCount?: number;
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
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    throw new GameError("Request is too large.", 413, "PAYLOAD_TOO_LARGE");
  }

  try {
    return (await request.json()) as GameRequest;
  } catch {
    throw new GameError("Send a valid JSON request.", 400, "INVALID_JSON");
  }
}

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        const key = separator >= 0 ? part.slice(0, separator) : part;
        const value = separator >= 0 ? part.slice(separator + 1) : "";
        return [decodeURIComponent(key), decodeURIComponent(value)];
      }),
  );
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

async function playerFromSession(
  database: D1Database,
  request: Request,
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

  const tokenHash = await hashSecret(secret);
  return tokenHash === player.token_hash ? player : null;
}

async function requirePlayer(
  database: D1Database,
  request: Request,
  now: number,
): Promise<PlayerRow> {
  const player = await playerFromSession(database, request);
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
    database
      .prepare(
        "DELETE FROM active_slots WHERE game_id IN (SELECT id FROM invites WHERE status = 'expired' AND responded_at = ?)",
      )
      .bind(now),
  ]);
}

function parseBoard(serialized: string, diskCount: number): HanoiBoard {
  try {
    const board = JSON.parse(serialized) as unknown;
    if (isValidHanoiBoard(board, diskCount)) return board;
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
    let match = await database
      .prepare("SELECT * FROM matches WHERE id = ?")
      .bind(player.active_match_id)
      .first<MatchRow>();

    if (!match) {
      await database.batch([
        database
          .prepare(
            "UPDATE players SET active_match_id = NULL, status = 'online' WHERE id = ?",
          )
          .bind(player.id),
        database
          .prepare("DELETE FROM active_slots WHERE player_id = ?")
          .bind(player.id),
      ]);
      player = { ...player, active_match_id: null, status: "online" };
    } else {
      if (match.status === "countdown" && now >= match.starts_at) {
        await database
          .prepare(
            "UPDATE matches SET status = 'playing', updated_at = ? WHERE id = ? AND status = 'countdown'",
          )
          .bind(now, match.id)
          .run();
        match = { ...match, status: "playing", updated_at: now };
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

      matchPayload = {
        id: match.id,
        status: match.status,
        diskCount: match.disk_count,
        startsAt: match.starts_at,
        finishedAt: match.finished_at,
        winnerId: match.winner_id,
        myBoard: parseBoard(
          isPlayerOne ? match.player_one_state : match.player_two_state,
          match.disk_count,
        ),
        opponentBoard: parseBoard(
          isPlayerOne ? match.player_two_state : match.player_one_state,
          match.disk_count,
        ),
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
    incoming: incomingResult.results.map((invite) => ({
      id: invite.id,
      diskCount: invite.disk_count,
      createdAt: invite.created_at,
      player: {
        id: invite.player_id,
        name: invite.name,
        hue: invite.hue,
        wins: invite.wins,
        races: invite.races,
      },
    })),
    outgoing: outgoingResult.results.map((invite) => ({
      id: invite.id,
      diskCount: invite.disk_count,
      createdAt: invite.created_at,
      player: {
        id: invite.player_id,
        name: invite.name,
        hue: invite.hue,
        wins: invite.wins,
        races: invite.races,
      },
    })),
    match: matchPayload,
  };
}

async function createSession(
  database: D1Database,
  request: Request,
  payload: GameRequest,
  now: number,
) {
  const existing = await playerFromSession(database, request);
  if (existing) {
    const requestedName = normalizeName(payload.name);
    const name = requestedName ?? existing.name;
    await database
      .prepare("UPDATE players SET name = ?, last_seen = ? WHERE id = ?")
      .bind(name, now, existing.id)
      .run();
    return json({ ok: true, snapshot: await buildSnapshot(database, existing.id, now) });
  }

  const id = crypto.randomUUID();
  const secret = randomSecret();
  const tokenHash = await hashSecret(secret);
  const hue = hueFromId(id);
  const name = normalizeName(payload.name) ?? guestName(hue);
  await database
    .prepare(
      `INSERT INTO players
       (id, token_hash, name, hue, status, active_match_id, wins, races, last_seen, created_at)
       VALUES (?, ?, ?, ?, 'online', NULL, 0, 0, ?, ?)`,
    )
    .bind(id, tokenHash, name, hue, now, now)
    .run();

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
  const diskCount = payload.diskCount;
  if (!targetId || targetId === player.id) {
    throw new GameError("Choose another online player.", 400, "INVALID_PLAYER");
  }
  if (!Number.isInteger(diskCount) || diskCount! < 3 || diskCount! > 5) {
    throw new GameError("Choose 3, 4, or 5 rings.", 400, "INVALID_DIFFICULTY");
  }

  const target = await database
    .prepare("SELECT * FROM players WHERE id = ?")
    .bind(targetId)
    .first<PlayerRow>();
  if (!target || target.last_seen < now - ONLINE_WINDOW_MS) {
    throw new GameError("That player just went offline.", 409, "PLAYER_OFFLINE");
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
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO invites
           (id, from_player_id, to_player_id, disk_count, status, created_at, responded_at)
           VALUES (?, ?, ?, ?, 'pending', ?, NULL)`,
        )
        .bind(inviteId, player.id, target.id, diskCount, now),
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
  if (invite.status !== "pending") {
    throw new GameError("That invite is no longer active.", 409, "INVITE_CLOSED");
  }
  if (invite.created_at < now - INVITE_WINDOW_MS) {
    await expireInvites(database, now);
    throw new GameError("That invite expired.", 410, "INVITE_EXPIRED");
  }

  if (payload.response === "decline") {
    await database.batch([
      database
        .prepare(
          "UPDATE invites SET status = 'declined', responded_at = ? WHERE id = ? AND status = 'pending'",
        )
        .bind(now, invite.id),
      database
        .prepare("DELETE FROM active_slots WHERE game_id = ?")
        .bind(invite.id),
    ]);
    return buildSnapshot(database, player.id, now);
  }

  if (payload.response !== "accept") {
    throw new GameError("Accept or decline the invite.", 400, "INVALID_RESPONSE");
  }

  const inviter = await database
    .prepare("SELECT * FROM players WHERE id = ?")
    .bind(invite.from_player_id)
    .first<PlayerRow>();
  if (!inviter || inviter.last_seen < now - ONLINE_WINDOW_MS) {
    await database.batch([
      database
        .prepare(
          "UPDATE invites SET status = 'expired', responded_at = ? WHERE id = ?",
        )
        .bind(now, invite.id),
      database
        .prepare("DELETE FROM active_slots WHERE game_id = ?")
        .bind(invite.id),
    ]);
    throw new GameError("The challenger went offline.", 409, "PLAYER_OFFLINE");
  }

  const slotCount = await database
    .prepare("SELECT COUNT(*) AS count FROM active_slots WHERE game_id = ?")
    .bind(invite.id)
    .first<{ count: number }>();
  if (Number(slotCount?.count ?? 0) !== 2) {
    throw new GameError("One player is no longer available.", 409, "PLAYER_BUSY");
  }

  const board = JSON.stringify(createHanoiBoard(invite.disk_count));
  const startsAt = now + COUNTDOWN_MS;
  try {
    await database.batch([
      database
        .prepare(
          "UPDATE invites SET status = 'accepted', responded_at = ? WHERE id = ? AND status = 'pending'",
        )
        .bind(now, invite.id),
      database
        .prepare(
          `INSERT INTO matches
           (id, player_one_id, player_two_id, disk_count, status, starts_at,
            winner_id, player_one_state, player_two_state, player_one_moves,
            player_two_moves, player_one_rematch, player_two_rematch, rematch_id,
            created_at, updated_at, finished_at)
           VALUES (?, ?, ?, ?, 'countdown', ?, NULL, ?, ?, 0, 0, 0, 0, NULL, ?, ?, NULL)`,
        )
        .bind(
          invite.id,
          invite.from_player_id,
          invite.to_player_id,
          invite.disk_count,
          startsAt,
          board,
          board,
          now,
          now,
        ),
      database
        .prepare(
          "UPDATE players SET active_match_id = ?, status = 'playing' WHERE id IN (?, ?)",
        )
        .bind(invite.id, invite.from_player_id, invite.to_player_id),
    ]);
  } catch {
    throw new GameError("The race was already started.", 409, "INVITE_CLOSED");
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
  const invite = inviteId
    ? await database
        .prepare("SELECT * FROM invites WHERE id = ?")
        .bind(inviteId)
        .first<InviteRow>()
    : null;
  if (!invite || invite.from_player_id !== player.id || invite.status !== "pending") {
    throw new GameError("Invite is no longer active.", 409, "INVITE_CLOSED");
  }

  await database.batch([
    database
      .prepare(
        "UPDATE invites SET status = 'cancelled', responded_at = ? WHERE id = ? AND status = 'pending'",
      )
      .bind(now, invite.id),
    database
      .prepare("DELETE FROM active_slots WHERE game_id = ?")
      .bind(invite.id),
  ]);
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
    !Number.isInteger(payload.from) ||
    !Number.isInteger(payload.to) ||
    !Number.isInteger(payload.expectedMoves)
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

  const board = parseBoard(
    isPlayerOne ? match.player_one_state : match.player_two_state,
    match.disk_count,
  );
  const result = moveHanoiDisk(
    board,
    payload.from!,
    payload.to!,
    match.disk_count,
  );
  if (!result.ok) {
    throw new GameError(result.reason, 409, "ILLEGAL_MOVE");
  }

  const won = isHanoiSolved(result.board, match.disk_count);
  const nextMoves = moves + 1;
  const sql = isPlayerOne
    ? `UPDATE matches SET player_one_state = ?, player_one_moves = ?, status = ?,
         winner_id = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND player_one_moves = ?
         AND status IN ('countdown', 'playing') AND winner_id IS NULL`
    : `UPDATE matches SET player_two_state = ?, player_two_moves = ?, status = ?,
         winner_id = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND player_two_moves = ?
         AND status IN ('countdown', 'playing') AND winner_id IS NULL`;
  const update = await database
    .prepare(sql)
    .bind(
      JSON.stringify(result.board),
      nextMoves,
      won ? "finished" : "playing",
      won ? player.id : null,
      won ? now : null,
      now,
      match.id,
      moves,
    )
    .run();

  if (Number(update.meta.changes ?? 0) !== 1) {
    throw new GameError("The race state changed. Try again.", 409, "STALE_MOVE");
  }

  if (won) {
    const opponentId = isPlayerOne ? match.player_two_id : match.player_one_id;
    await database.batch([
      database
        .prepare("UPDATE players SET wins = wins + 1, races = races + 1, status = 'result' WHERE id = ?")
        .bind(player.id),
      database
        .prepare("UPDATE players SET races = races + 1, status = 'result' WHERE id = ?")
        .bind(opponentId),
    ]);
  }

  return buildSnapshot(database, player.id, now);
}

async function leaveMatch(
  database: D1Database,
  player: PlayerRow,
  now: number,
) {
  if (!player.active_match_id) return buildSnapshot(database, player.id, now);
  const match = await database
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(player.active_match_id)
    .first<MatchRow>();

  if (match && (match.status === "countdown" || match.status === "playing")) {
    const opponentId =
      match.player_one_id === player.id
        ? match.player_two_id
        : match.player_one_id;
    const result = await database
      .prepare(
        `UPDATE matches SET status = 'abandoned', winner_id = ?, finished_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('countdown', 'playing') AND winner_id IS NULL`,
      )
      .bind(opponentId, now, now, match.id)
      .run();
    if (Number(result.meta.changes ?? 0) === 1) {
      await database.batch([
        database
          .prepare("UPDATE players SET wins = wins + 1, races = races + 1, status = 'result' WHERE id = ?")
          .bind(opponentId),
        database
          .prepare("UPDATE players SET races = races + 1 WHERE id = ?")
          .bind(player.id),
      ]);
    }
  }

  await database.batch([
    database
      .prepare(
        "UPDATE players SET active_match_id = NULL, status = 'online' WHERE id = ?",
      )
      .bind(player.id),
    database
      .prepare("DELETE FROM active_slots WHERE player_id = ?")
      .bind(player.id),
  ]);
  return buildSnapshot(database, player.id, now);
}

async function requestRematch(
  database: D1Database,
  player: PlayerRow,
  now: number,
) {
  if (!player.active_match_id) {
    throw new GameError("Match was not found.", 404, "MATCH_NOT_FOUND");
  }
  let match = await database
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(player.active_match_id)
    .first<MatchRow>();
  if (!match || (match.status !== "finished" && match.status !== "abandoned")) {
    throw new GameError("Finish this race before requesting a rematch.", 409, "MATCH_ACTIVE");
  }

  const isPlayerOne = match.player_one_id === player.id;
  if (!isPlayerOne && match.player_two_id !== player.id) {
    throw new GameError("You are not in this match.", 403, "FORBIDDEN");
  }
  const voteColumn = isPlayerOne ? "player_one_rematch" : "player_two_rematch";
  await database
    .prepare(`UPDATE matches SET ${voteColumn} = 1, updated_at = ? WHERE id = ?`)
    .bind(now, match.id)
    .run();
  match = (await database
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(match.id)
    .first<MatchRow>())!;

  if (match.player_one_rematch && match.player_two_rematch && !match.rematch_id) {
    const slots = await database
      .prepare("SELECT COUNT(*) AS count FROM active_slots WHERE game_id = ?")
      .bind(match.id)
      .first<{ count: number }>();
    if (Number(slots?.count ?? 0) === 2) {
      const rematchId = crypto.randomUUID();
      const claimed = await database
        .prepare("UPDATE matches SET rematch_id = ? WHERE id = ? AND rematch_id IS NULL")
        .bind(rematchId, match.id)
        .run();
      if (Number(claimed.meta.changes ?? 0) === 1) {
        const board = JSON.stringify(createHanoiBoard(match.disk_count));
        const startsAt = now + COUNTDOWN_MS;
        await database.batch([
          database
            .prepare(
              `INSERT INTO matches
               (id, player_one_id, player_two_id, disk_count, status, starts_at,
                winner_id, player_one_state, player_two_state, player_one_moves,
                player_two_moves, player_one_rematch, player_two_rematch, rematch_id,
                created_at, updated_at, finished_at)
               VALUES (?, ?, ?, ?, 'countdown', ?, NULL, ?, ?, 0, 0, 0, 0, NULL, ?, ?, NULL)`,
            )
            .bind(
              rematchId,
              match.player_one_id,
              match.player_two_id,
              match.disk_count,
              startsAt,
              board,
              board,
              now,
              now,
            ),
          database
            .prepare(
              "UPDATE players SET active_match_id = ?, status = 'playing' WHERE id IN (?, ?)",
            )
            .bind(rematchId, match.player_one_id, match.player_two_id),
          database
            .prepare("UPDATE active_slots SET game_id = ? WHERE game_id = ?")
            .bind(rematchId, match.id),
        ]);
      }
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
      return createSession(database, request, payload, now);
    }

    const player = await requirePlayer(database, request, now);
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
      case "leave-match":
        snapshot = await leaveMatch(database, player, now);
        break;
      case "rematch":
        snapshot = await requestRematch(database, player, now);
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
      { ok: false, error: "The game server hit a snag. Try again.", code: "SERVER_ERROR" },
      500,
    );
  }
}
