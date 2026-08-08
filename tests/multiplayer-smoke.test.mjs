import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.PEG_RUSH_BASE_URL ?? "http://localhost:3000";

class GuestAgent {
  cookie = "";

  async post(action, payload = {}) {
    const response = await fetch(`${baseUrl}/api/game`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data));
    assert.equal(result.data.ok, true);
    return result.data.snapshot;
  }
}

test("two anonymous guests can race, finish, rematch, and forfeit", async () => {
  const suffix = Date.now().toString(36).slice(-5);
  const alice = new GuestAgent();
  const bob = new GuestAgent();

  const aliceSession = await alice.ok("session", { name: `Alice ${suffix}` });
  const bobSession = await bob.ok("session", { name: `Bob ${suffix}` });
  assert.notEqual(aliceSession.player.id, bobSession.player.id);
  assert.match(alice.cookie, /^peg_rush_guest=/);

  const aliceLobby = await alice.ok("sync");
  assert.ok(aliceLobby.online.some((player) => player.id === bobSession.player.id));

  const challenged = await alice.ok("challenge", {
    playerId: bobSession.player.id,
    diskCount: 3,
  });
  assert.equal(challenged.outgoing.length, 1);

  const bobInvited = await bob.ok("sync");
  assert.equal(bobInvited.incoming.length, 1);
  assert.equal(bobInvited.incoming[0].player.id, aliceSession.player.id);

  const accepted = await bob.ok("respond", {
    inviteId: bobInvited.incoming[0].id,
    response: "accept",
  });
  assert.equal(accepted.match.status, "countdown");
  assert.deepEqual(accepted.match.myBoard, [[3, 2, 1], [], []]);

  const earlyMove = await alice.post("move", {
    matchId: accepted.match.id,
    from: 0,
    to: 2,
    expectedMoves: 0,
  });
  assert.equal(earlyMove.status, 409);
  assert.equal(earlyMove.data.code, "MATCH_NOT_STARTED");

  const waitMs = Math.max(0, accepted.match.startsAt - Date.now() + 80);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const solution = [
    [0, 2],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 0],
    [1, 2],
    [0, 2],
  ];
  let aliceMatch;
  for (let index = 0; index < solution.length; index += 1) {
    const [from, to] = solution[index];
    const state = await alice.ok("move", {
      matchId: accepted.match.id,
      from,
      to,
      expectedMoves: index,
    });
    aliceMatch = state.match;
  }

  assert.equal(aliceMatch.status, "finished");
  assert.equal(aliceMatch.winnerId, aliceSession.player.id);
  assert.equal(aliceMatch.myMoves, 7);
  assert.deepEqual(aliceMatch.myBoard, [[], [], [3, 2, 1]]);

  const bobResult = await bob.ok("sync");
  assert.equal(bobResult.match.winnerId, aliceSession.player.id);
  assert.deepEqual(bobResult.match.opponentBoard, [[], [], [3, 2, 1]]);

  const afterFinish = await bob.post("move", {
    matchId: accepted.match.id,
    from: 0,
    to: 2,
    expectedMoves: 0,
  });
  assert.equal(afterFinish.status, 409);
  assert.equal(afterFinish.data.code, "MATCH_OVER");

  const aliceVote = await alice.ok("rematch");
  assert.equal(aliceVote.match.myRematch, true);
  const bobVote = await bob.ok("rematch");
  assert.notEqual(bobVote.match.id, accepted.match.id);
  assert.equal(bobVote.match.status, "countdown");
  assert.equal(bobVote.match.myMoves, 0);

  await bob.ok("leave-match");
  const aliceForfeitWin = await alice.ok("sync");
  assert.equal(aliceForfeitWin.match.status, "abandoned");
  assert.equal(aliceForfeitWin.match.winnerId, aliceSession.player.id);
  await alice.ok("leave-match");
});
