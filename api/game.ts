const upstreamOrigin = "https://peg-rush-hanoi.gga.chatgpt.site";

function failure(status: number, code: string, error: string) {
  return Response.json({ ok: false, code, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return failure(405, "METHOD_NOT_ALLOWED", "Use POST.");
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
      return failure(403, "FORBIDDEN", "Cross-site requests are not allowed.");
    }
    // Read incrementally so chunked requests cannot bypass the game's 4 KiB limit.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) { await reader.cancel(); return failure(413, "PAYLOAD_TOO_LARGE", "Request is too large."); }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const headers = new Headers({ "Content-Type": "application/json", Origin: upstreamOrigin });
    for (const name of ["cookie", "user-agent", "accept-language"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // ponytail: guest creation limits share proxy egress; use authenticated client-IP forwarding if traffic requires it.
    try {
      const upstream = await fetch(`${upstreamOrigin}/api/game`, {
        method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(9000),
      });
      if (!upstream.headers.get("content-type")?.includes("application/json")) {
        return failure(502, "SERVICE_UNAVAILABLE", "The game service is reconnecting. Try again shortly.");
      }
      const responseHeaders = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
      const cookie = upstream.headers.get("set-cookie");
      if (cookie) responseHeaders.set("Set-Cookie", cookie);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      return failure(502, "SERVICE_UNAVAILABLE", "The game service is reconnecting. Try again shortly.");
    }
  },
};
