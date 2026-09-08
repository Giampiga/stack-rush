import assert from "node:assert/strict";
import test from "node:test";
import proxy from "../api/game.ts";

test("Vercel bridge protects origins and size, forwards guest cookies, and handles outages", async () => {
  const originalFetch = globalThis.fetch;
  const request = (headers: Record<string, string> = {}, body = '{"action":"sync"}') =>
    new Request("https://stack-rush.vercel.app/api/game", { method: "POST", headers, body });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://peg-rush-hanoi.gga.chatgpt.site/api/game");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("origin"), "https://peg-rush-hanoi.gga.chatgpt.site");
    assert.equal(headers.get("cookie"), "guest=test");
    return Response.json({ ok: true }, { headers: { "Set-Cookie": "guest=new; Path=/; HttpOnly; SameSite=Lax; Secure" } });
  };
  try {
    assert.equal((await proxy.fetch(request({ Origin: "https://other.example" }))).status, 403);
    assert.equal((await proxy.fetch(request({ "Sec-Fetch-Site": "cross-site" }))).status, 403);
    assert.equal((await proxy.fetch(request({}, "x".repeat(4097)))).status, 413);
    assert.equal(calls, 0);
    const result = await proxy.fetch(request({ Origin: "https://stack-rush.vercel.app", Cookie: "guest=test" }));
    assert.equal(result.status, 200);
    assert.match(result.headers.get("set-cookie")!, /guest=new/);
    assert.equal(result.headers.get("cache-control"), "no-store");
    globalThis.fetch = async () => new Response("Service unavailable", { status: 500 });
    assert.equal((await proxy.fetch(request())).status, 502);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal((await proxy.fetch(request())).status, 502);
  } finally { globalThis.fetch = originalFetch; }
});
