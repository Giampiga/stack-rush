import assert from "node:assert/strict";
import test from "node:test";
import {
  BOLT_CAPACITY,
  SORT_LEVELS,
  createBoltSortPuzzle,
  isBoltSortSolved,
  isValidBoltSortBoard,
  listLegalBoltMoves,
  moveBoltSortNut,
} from "../lib/bolt-sort.ts";
import {
  HANOI_LEVELS,
  isHanoiSolved,
  isValidHanoiBoard,
} from "../lib/hanoi.ts";

const baseUrl = process.env.PEG_RUSH_BASE_URL ?? "http://localhost:3000";

class GuestAgent {
  cookie = "";
  userAgent;

  constructor(userAgent = `PegRushTest/${crypto.randomUUID()}`) {
    this.userAgent = userAgent;
  }

  async post(action, payload = {}) {
    const response = await fetch(`${baseUrl}/api/game`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";", 1)[0];
    return { status: response.status, data: await response.json() };
  }

  async ok(action, payload = {}) {
    const result = await this.post(action, payload);
    assert.ok(
      result.status >= 200 && result.status < 300,
      JSON.stringify(result.data),
    );
    assert.equal(result.data.ok, true);
    return result.data.snapshot;
  }
}

async function rawPost(body, headers = {}) {
  const response = await fetch(`${baseUrl}/api/game`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
  return { status: response.status, data: await response.json() };
}

function uniqueName(prefix) {
  const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 4)}`;
  return `${prefix} ${suffix}`.slice(0, 18);
}

async function waitForStart(match) {
  const waitMs = Math.max(0, match.startsAt - Date.now() + 80);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function startMatch(tier = "quick") {
  const alice = new GuestAgent();
  const bob = new GuestAgent();
  const aliceSession = await alice.ok("session", { name: uniqueName("Alice") });
  const bobSession = await bob.ok("session", { name: uniqueName("Bob") });

  await alice.ok("challenge", {
    playerId: bobSession.player.id,
    tier,
  });
  const invitation = await bob.ok("sync");
  assert.equal(invitation.incoming.length, 1);
  assert.equal(invitation.incoming[0].tier, tier);

  const accepted = await bob.ok("respond", {
    inviteId: invitation.incoming[0].id,
    response: "accept",
  });
  assert.equal(accepted.match.status, "countdown");
  assert.equal(accepted.match.tier, tier);
  assert.equal(accepted.match.capacity, BOLT_CAPACITY);
  assert.equal(accepted.match.colorCount, SORT_LEVELS[tier].colorCount);
  assert.equal(
    isValidBoltSortBoard(
      accepted.match.myBoard,
      SORT_LEVELS[tier].colorCount,
    ),
    true,
  );

  const expected = createBoltSortPuzzle(
    tier,
    `bolt-v1:${accepted.match.id}`,
  );
  assert.deepEqual(accepted.match.myBoard, expected.board);

  return { alice, bob, aliceSession, bobSession, accepted, puzzle: expected };
}

async function playMoves(agent, matchId, moves, expectedStart = 0) {
  let snapshot;
  for (const [offset, move] of moves.entries()) {
    snapshot = await agent.ok("move", {
      matchId,
      from: move.from,
      to: move.to,
      expectedMoves: expectedStart + offset,
    });
  }
  return snapshot;
}

function findDeadlockPath(initialBoard, colorCount) {
  const queue = [{ board: initialBoard, path: [] }];
  const seen = new Set([JSON.stringify(initialBoard)]);

  for (let head = 0; head < queue.length && queue.length < 10_000; head += 1) {
    const current = queue[head];
    const moves = listLegalBoltMoves(current.board, colorCount);
    if (
      moves.length === 0 &&
      !isBoltSortSolved(current.board, colorCount)
    ) {
      return current.path;
    }
    if (current.path.length >= 6) continue;

    for (const move of moves) {
      const result = moveBoltSortNut(
        current.board,
        move.from,
        move.to,
        colorCount,
      );
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      const signature = JSON.stringify(result.board);
      if (seen.has(signature)) continue;
      seen.add(signature);
      queue.push({ board: result.board, path: [...current.path, move] });
    }
  }

  throw new Error("Expected the generated quick board to have a short deadlock path");
}

test("two guests solve, rematch, forfeit, and receive exactly-once records", async () => {
  const { alice, bob, aliceSession, accepted, puzzle } = await startMatch();
  const firstMove = puzzle.solution[0];

  const earlyMove = await alice.post("move", {
    matchId: accepted.match.id,
    from: firstMove.from,
    to: firstMove.to,
    expectedMoves: 0,
  });
  assert.equal(earlyMove.status, 409);
  assert.equal(earlyMove.data.code, "MATCH_NOT_STARTED");

  await waitForStart(accepted.match);
  const finished = await playMoves(
    alice,
    accepted.match.id,
    puzzle.solution,
  );
  assert.equal(finished.match.status, "finished");
  assert.equal(finished.match.winnerId, aliceSession.player.id);
  assert.equal(finished.match.myMoves, puzzle.solution.length);
  assert.equal(finished.match.myProgress, 100);
  assert.equal(finished.player.wins, 1);
  assert.equal(finished.player.races, 1);

  const bobResult = await bob.ok("sync");
  assert.equal(bobResult.player.wins, 0);
  assert.equal(bobResult.player.races, 1);
  assert.equal(bobResult.match.opponentProgress, 100);
  assert.equal(bobResult.match.canRematch, true);

  const rematchVotes = await Promise.all([
    alice.post("rematch", { matchId: accepted.match.id }),
    bob.post("rematch", { matchId: accepted.match.id }),
  ]);
  assert.ok(rematchVotes.every((result) => result.status === 200));
  const [aliceRematch, bobRematch] = await Promise.all([
    alice.ok("sync"),
    bob.ok("sync"),
  ]);
  assert.notEqual(aliceRematch.match.id, accepted.match.id);
  assert.equal(aliceRematch.match.id, bobRematch.match.id);
  assert.equal(aliceRematch.match.status, "countdown");
  const rematchId = aliceRematch.match.id;

  const staleLeave = await alice.post("leave-match", {
    matchId: accepted.match.id,
  });
  assert.equal(staleLeave.status, 409);
  assert.equal(staleLeave.data.code, "MATCH_CHANGED");
  assert.equal((await alice.ok("sync")).match.id, rematchId);

  const bobLeave = await bob.ok("leave-match", { matchId: rematchId });
  assert.equal(bobLeave.match, null);
  assert.equal(bobLeave.player.races, 2);

  const aliceForfeitWin = await alice.ok("sync");
  assert.equal(aliceForfeitWin.match.status, "abandoned");
  assert.equal(aliceForfeitWin.match.winnerId, aliceSession.player.id);
  assert.equal(aliceForfeitWin.match.canRematch, false);
  assert.equal(aliceForfeitWin.player.wins, 2);
  assert.equal(aliceForfeitWin.player.races, 2);

  const abandonedRematch = await alice.post("rematch", {
    matchId: rematchId,
  });
  assert.equal(abandonedRematch.status, 409);
  assert.equal(abandonedRematch.data.code, "REMATCH_UNAVAILABLE");

  const duplicateLeave = await bob.post("leave-match", { matchId: rematchId });
  assert.equal(duplicateLeave.status, 404);
  assert.equal((await bob.ok("sync")).player.races, 2);
  await alice.ok("leave-match", { matchId: rematchId });
});

test("two guests can race a server-authoritative Hanoi match", async () => {
  const alice = new GuestAgent();
  const bob = new GuestAgent();
  const aliceSession = await alice.ok("session", { name: uniqueName("Tower") });
  const bobSession = await bob.ok("session", { name: uniqueName("Ring") });
  await alice.ok("challenge", { playerId: bobSession.player.id, mode: "hanoi", tier: "quick" });
  const invitation = await bob.ok("sync");
  assert.equal(invitation.incoming[0].mode, "hanoi");
  assert.equal(invitation.incoming[0].diskCount, HANOI_LEVELS.quick.diskCount);
  const accepted = await bob.ok("respond", { inviteId: invitation.incoming[0].id, response: "accept" });
  assert.equal(accepted.match.mode, "hanoi");
  assert.equal(accepted.match.colorCount, null);
  assert.equal(accepted.match.diskCount, 3);
  assert.equal(accepted.match.par, 7);
  assert.equal(isValidHanoiBoard(accepted.match.myBoard, 3), true);
  assert.deepEqual(accepted.match.myBoard, [[3, 2, 1], [], []]);

  const early = await alice.post("move", { matchId: accepted.match.id, from: 0, to: 2, expectedMoves: 0 });
  assert.equal(early.data.code, "MATCH_NOT_STARTED");
  await waitForStart(accepted.match);
  const solution = [[0, 2], [0, 1], [2, 1], [0, 2], [1, 0], [1, 2], [0, 2]];
  let finished;
  for (const [expectedMoves, [from, to]] of solution.entries()) {
    finished = await alice.ok("move", { matchId: accepted.match.id, from, to, expectedMoves });
  }
  assert.equal(finished.match.status, "finished");
  assert.equal(finished.match.winnerId, aliceSession.player.id);
  assert.equal(isHanoiSolved(finished.match.myBoard, 3), true);
  assert.equal(finished.match.myMoves, 7);
  await alice.ok("leave-match", { matchId: accepted.match.id });
  await bob.ok("leave-match", { matchId: accepted.match.id });
});

test("optimistic concurrency accepts only one duplicate move", async () => {
  const { alice, bob, accepted, puzzle } = await startMatch();
  await waitForStart(accepted.match);
  const move = puzzle.solution[0];
  const payload = {
    matchId: accepted.match.id,
    from: move.from,
    to: move.to,
    expectedMoves: 0,
  };

  const results = await Promise.all([
    alice.post("move", payload),
    alice.post("move", payload),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort((a, b) => a - b),
    [200, 409],
  );
  const failure = results.find((result) => result.status === 409);
  assert.equal(failure.data.code, "STALE_MOVE");
  assert.equal((await alice.ok("sync")).match.myMoves, 1);

  await alice.ok("leave-match", { matchId: accepted.match.id });
  await bob.ok("leave-match", { matchId: accepted.match.id });
});

test("reset recovers a legal deadlock and races moves through the same CAS", async () => {
  const { alice, bob, accepted, puzzle } = await startMatch();
  const earlyReset = await alice.post("reset", {
    matchId: accepted.match.id,
    expectedMoves: 0,
  });
  assert.equal(earlyReset.status, 409);
  assert.equal(earlyReset.data.code, "MATCH_NOT_STARTED");

  await waitForStart(accepted.match);
  const deadlockPath = findDeadlockPath(
    puzzle.board,
    accepted.match.colorCount,
  );
  assert.ok(deadlockPath.length > 0);
  const deadlocked = await playMoves(
    alice,
    accepted.match.id,
    deadlockPath,
  );
  assert.equal(
    listLegalBoltMoves(
      deadlocked.match.myBoard,
      accepted.match.colorCount,
    ).length,
    0,
  );
  assert.equal(
    isBoltSortSolved(
      deadlocked.match.myBoard,
      accepted.match.colorCount,
    ),
    false,
  );

  const reset = await alice.ok("reset", {
    matchId: accepted.match.id,
    expectedMoves: deadlockPath.length,
  });
  assert.deepEqual(reset.match.myBoard, puzzle.board);
  assert.equal(reset.match.myMoves, deadlockPath.length + 1);

  const firstSolutionMove = puzzle.solution[0];
  const recovered = await alice.ok("move", {
    matchId: accepted.match.id,
    from: firstSolutionMove.from,
    to: firstSolutionMove.to,
    expectedMoves: reset.match.myMoves,
  });
  assert.equal(recovered.match.myMoves, deadlockPath.length + 2);

  const secondSolutionMove = puzzle.solution[1];
  const expectedMoves = recovered.match.myMoves;
  const [resetRace, moveRace] = await Promise.all([
    alice.post("reset", {
      matchId: accepted.match.id,
      expectedMoves,
    }),
    alice.post("move", {
      matchId: accepted.match.id,
      from: secondSolutionMove.from,
      to: secondSolutionMove.to,
      expectedMoves,
    }),
  ]);
  assert.deepEqual(
    [resetRace.status, moveRace.status].sort((a, b) => a - b),
    [200, 409],
  );
  const stale = [resetRace, moveRace].find((result) => result.status === 409);
  assert.equal(stale.data.code, "STALE_MOVE");
  assert.equal((await alice.ok("sync")).match.myMoves, expectedMoves + 1);

  await alice.ok("leave-match", { matchId: accepted.match.id });
  await bob.ok("leave-match", { matchId: accepted.match.id });
});

test("accept and cancel racing cannot produce a match plus released slots", async () => {
  const challenger = new GuestAgent();
  const invitee = new GuestAgent();
  const challengerSession = await challenger.ok("session", {
    name: uniqueName("Casey"),
  });
  const inviteeSession = await invitee.ok("session", {
    name: uniqueName("Riley"),
  });

  const challenged = await challenger.ok("challenge", {
    playerId: inviteeSession.player.id,
    tier: "classic",
  });
  const inviteId = challenged.outgoing[0].id;
  const [accepted, cancelled] = await Promise.all([
    invitee.post("respond", { inviteId, response: "accept" }),
    challenger.post("cancel-invite", { inviteId }),
  ]);
  assert.equal(
    [accepted, cancelled].filter((result) => result.status < 300).length,
    1,
  );

  const challengerState = await challenger.ok("sync");
  const inviteeState = await invitee.ok("sync");
  if (challengerState.match || inviteeState.match) {
    assert.ok(challengerState.match);
    assert.ok(inviteeState.match);
    assert.equal(challengerState.match.id, inviteeState.match.id);
    await challenger.ok("leave-match", {
      matchId: challengerState.match.id,
    });
    await invitee.ok("leave-match", { matchId: inviteeState.match.id });
  } else {
    assert.equal(challengerState.outgoing.length, 0);
    assert.equal(inviteeState.incoming.length, 0);
    assert.equal(
      challengerState.online.find(
        (player) => player.id === inviteeSession.player.id,
      )?.available,
      true,
    );
    assert.equal(
      inviteeState.online.find(
        (player) => player.id === challengerSession.player.id,
      )?.available,
      true,
    );
  }
});

test("simultaneous solutions choose one winner and account one race", async () => {
  const { alice, bob, aliceSession, bobSession, accepted, puzzle } =
    await startMatch();
  await waitForStart(accepted.match);
  const setupMoves = puzzle.solution.slice(0, -1);
  await playMoves(alice, accepted.match.id, setupMoves);
  await playMoves(bob, accepted.match.id, setupMoves);

  const finalMove = puzzle.solution.at(-1);
  assert.ok(finalMove);
  const payload = {
    matchId: accepted.match.id,
    from: finalMove.from,
    to: finalMove.to,
    expectedMoves: setupMoves.length,
  };
  const [aliceFinish, bobFinish] = await Promise.all([
    alice.post("move", payload),
    bob.post("move", payload),
  ]);
  assert.deepEqual(
    [aliceFinish.status, bobFinish.status].sort((a, b) => a - b),
    [200, 409],
  );

  const aliceState = await alice.ok("sync");
  const bobState = await bob.ok("sync");
  assert.equal(aliceState.match.id, bobState.match.id);
  assert.ok(
    [aliceSession.player.id, bobSession.player.id].includes(
      aliceState.match.winnerId,
    ),
  );
  assert.equal(aliceState.player.races, 1);
  assert.equal(bobState.player.races, 1);
  assert.equal(aliceState.player.wins + bobState.player.wins, 1);

  const winner = aliceState.player.wins === 1 ? alice : bob;
  const retry = await winner.post("move", payload);
  assert.equal(retry.status, 409);
  assert.equal(retry.data.code, "MATCH_OVER");
  const afterRetryAlice = await alice.ok("sync");
  const afterRetryBob = await bob.ok("sync");
  assert.equal(afterRetryAlice.player.races, 1);
  assert.equal(afterRetryBob.player.races, 1);
  assert.equal(afterRetryAlice.player.wins + afterRetryBob.player.wins, 1);

  const aliceVote = await alice.ok("rematch", {
    matchId: accepted.match.id,
  });
  assert.equal(aliceVote.match.myRematch, true);
  await bob.ok("leave-match", { matchId: accepted.match.id });

  const noLongerWaiting = await alice.ok("sync");
  assert.equal(noLongerWaiting.match.status, "abandoned");
  assert.equal(noLongerWaiting.match.winnerId, aliceState.match.winnerId);
  assert.equal(noLongerWaiting.match.canRematch, false);
  assert.equal(noLongerWaiting.player.races, 1);
  assert.equal((await bob.ok("sync")).player.races, 1);

  const blockedRematch = await alice.post("rematch", {
    matchId: accepted.match.id,
  });
  assert.equal(blockedRematch.status, 409);
  assert.equal(blockedRematch.data.code, "REMATCH_UNAVAILABLE");
  await alice.ok("leave-match", { matchId: accepted.match.id });
});

test("the API exposes dense endurance boards and rejects the retired contract", async () => {
  const challenger = new GuestAgent();
  const rival = new GuestAgent();
  await challenger.ok("session", { name: uniqueName("Max") });
  const rivalSession = await rival.ok("session", { name: uniqueName("Rex") });

  const retired = await challenger.post("challenge", {
    playerId: rivalSession.player.id,
    diskCount: 7,
  });
  assert.equal(retired.status, 400);
  assert.equal(retired.data.code, "INVALID_DIFFICULTY");

  await challenger.ok("challenge", {
    playerId: rivalSession.player.id,
    tier: "endurance",
  });
  const invitation = await rival.ok("sync");
  assert.equal(invitation.incoming[0].tier, "endurance");
  assert.equal(invitation.incoming[0].colorCount, 15);

  const accepted = await rival.ok("respond", {
    inviteId: invitation.incoming[0].id,
    response: "accept",
  });
  assert.equal(accepted.match.colorCount, 15);
  assert.equal(accepted.match.myBoard.length, 17);
  assert.equal(accepted.match.myBoard.filter((bolt) => bolt.length === 0).length, 2);

  await challenger.ok("leave-match", { matchId: accepted.match.id });
  await rival.ok("leave-match", { matchId: accepted.match.id });
});

test("request parsing rejects non-objects and oversized chunked bodies without 500s", async () => {
  for (const body of ["null", "[]", '"session"']) {
    const result = await rawPost(body);
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "INVALID_REQUEST");
  }

  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          JSON.stringify({ action: "session", padding: "x".repeat(5_000) }),
        ),
      );
      controller.close();
    },
  });
  const tooLarge = await rawPost(oversized);
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.data.code, "PAYLOAD_TOO_LARGE");

  const malformedCookie = await rawPost(JSON.stringify({ action: "session" }), {
    Cookie: "broken=%E0%A4%A; unrelated=ok",
    "User-Agent": `PegRushMalformedCookie/${crypto.randomUUID()}`,
  });
  assert.equal(malformedCookie.status, 201);
  assert.equal(malformedCookie.data.ok, true);

  const anonymousSync = await rawPost(JSON.stringify({ action: "sync" }), {
    "User-Agent": `PegRushNoSession/${crypto.randomUUID()}`,
  });
  assert.equal(anonymousSync.status, 401);
  assert.equal(anonymousSync.data.code, "SESSION_EXPIRED");
});

test("anonymous session creation is capped atomically per derived client", async () => {
  const userAgent = `PegRushLimiter/${crypto.randomUUID()}`;
  const statuses = [];
  for (let attempt = 0; attempt < 49; attempt += 1) {
    const result = await rawPost(JSON.stringify({ action: "session" }), {
      "User-Agent": userAgent,
    });
    statuses.push(result.status);
  }

  assert.deepEqual(statuses.slice(0, 48), Array(48).fill(201));
  assert.equal(statuses[48], 429);
});
