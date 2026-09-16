/**
 * Booth server — for running the dashboard on the same network as Bitfocus
 * Companion (or any other LAN control system).
 *
 * Why this exists. A dashboard served from Netlify over HTTPS cannot talk to
 * Companion on the local network, for two independent reasons:
 *
 *   1. Mixed content. A page loaded over HTTPS is not allowed to fetch
 *      http://companion.local:8000. Browsers block it outright.
 *   2. CORS. A cross-origin POST with a JSON body triggers a preflight, and
 *      the request never leaves the browser unless Companion answers that
 *      preflight with Access-Control-Allow-Origin.
 *
 * This server removes both by making everything same-origin: it serves the
 * built dashboard AND forwards /api/* to Companion from the same host and
 * port. The browser sees one origin, so there is no preflight and no mixed
 * content, and the webhook URL in Admin becomes a plain relative path:
 *
 *     /api/location/{siteRef}/{cueRef}/press
 *
 * Usage:
 *     npm run build
 *     npm run booth                       # Companion assumed at 127.0.0.1:8000
 *     COMPANION_URL=http://10.0.0.50:8000 PORT=3000 npm run booth
 *
 * No dependencies. Node 18+.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT ?? 3000);
const COMPANION_URL = (process.env.COMPANION_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const UPSTREAM_TIMEOUT_MS = Number(process.env.COMPANION_TIMEOUT_MS ?? 5000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

if (!fs.existsSync(ROOT)) {
  console.error(`No build found at ${ROOT}\nRun "npm run build" first.`);
  process.exit(1);
}

/** Forward a cue to Companion and mirror its status back to the dashboard. */
async function proxyToCompanion(req, res) {
  const target = COMPANION_URL + req.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "Content-Type": req.headers["content-type"] ?? "application/json" },
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await upstream.text();
    console.log(`  -> ${req.method} ${req.url} => ${upstream.status}`);
    res.writeHead(upstream.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: upstream.status, body: text.slice(0, 2000) }));
  } catch (err) {
    const aborted = err?.name === "AbortError";
    // A cue that cannot reach Companion must surface as a failure in the
    // dashboard log, never as a silent success.
    console.error(`  !! ${req.method} ${req.url} => ${aborted ? "timeout" : err?.message}`);
    res.writeHead(aborted ? 504 : 502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: aborted
          ? `Companion did not respond within ${UPSTREAM_TIMEOUT_MS}ms`
          : `Cannot reach Companion at ${COMPANION_URL}: ${err?.message}`,
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  // Resolve inside ROOT only; a crafted path must not escape the build folder.
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const candidate = path.resolve(ROOT, "." + urlPath);
  const safe = candidate.startsWith(ROOT) ? candidate : ROOT;

  let file = safe;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, "index.html"); // SPA fallback
  }

  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if ((req.url ?? "").startsWith("/api/")) {
    void proxyToCompanion(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Resi Cue Dashboard (booth mode)`);
  console.log(`  dashboard : http://localhost:${PORT}`);
  console.log(`  companion : ${COMPANION_URL} (proxied at /api/*)`);
  console.log(`\nSet the webhook URL in Admin to:`);
  console.log(`  /api/location/{siteRef}/{cueRef}/press\n`);
});
