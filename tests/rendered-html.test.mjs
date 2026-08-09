import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Stack Rush product shell and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Stack Rush — Live Multiplayer Puzzle Races<\/title>/i);
  assert.match(html, /STACK RUSH/);
  assert.match(html, /ENTERING THE LOUNGE/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Starter Project/i);
});

test("starter preview assets and dependencies are fully removed", async () => {
  const [page, layout, gameApp, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/GameApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<GameApp \/>/);
  assert.match(layout, /Stack Rush/);
  assert.match(gameApp, /NUTS &amp; BOLTS/);
  assert.match(gameApp, /TOWER OF HANOI/);
  assert.match(gameApp, /PRACTICE SOLO/);
  assert.match(gameApp, /matching top group/);
  assert.match(gameApp, />RESET</);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
