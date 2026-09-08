import { writeFile } from "node:fs/promises";
import worker from "../dist/server/index.js";

// The only page is a client game; reuse its existing server renderer at build time.
const origin = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "localhost"}`;
const response = await worker.fetch(
  new Request(origin, { headers: { accept: "text/html" } }),
  { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  { waitUntil() {}, passThroughOnException() {} },
);
if (!response.ok) throw new Error(`Could not render homepage: ${response.status}`);
const html = (await response.text()).replaceAll("https://peg-rush-hanoi.gga.chatgpt.site", origin);
await writeFile(new URL("../dist/client/index.html", import.meta.url), html);
