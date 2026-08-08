const baseUrl = process.env.PEG_RUSH_BASE_URL ?? "http://localhost:3000";
let cookie = "";

async function post(action, payload = {}) {
  const response = await fetch(`${baseUrl}/api/game`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.snapshot;
}

await post("session", { name: "QA Rival" });
console.log("QA Rival is ready");

const startedAt = Date.now();
const targetName = process.env.QA_TARGET_NAME;
let challenged = false;
while (Date.now() - startedAt < 90_000) {
  const snapshot = await post("sync");
  if (!snapshot.match && snapshot.incoming[0]) {
    await post("respond", {
      inviteId: snapshot.incoming[0].id,
      response: "accept",
    });
    console.log("Challenge accepted");
  }
  if (!snapshot.match && targetName && !challenged && !snapshot.outgoing.length) {
    const target = snapshot.online.find(
      (player) => player.name === targetName && player.available,
    );
    if (target) {
      await post("challenge", { playerId: target.id, tier: "endurance" });
      challenged = true;
      console.log(`Challenge sent to ${targetName}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 550));
}
