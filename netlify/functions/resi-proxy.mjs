/**
 * Server-side relay for Resi API cue commands.
 *
 * Why this exists: a browser-held API token is readable by anyone with the
 * dashboard open and by any script on the page. The token stays here, in the
 * function's environment, and the browser only ever names a path and a payload.
 *
 * Required environment variables (Netlify: Site settings -> Environment variables):
 *   RESI_API_BASE    e.g. https://api.resi.io   (no trailing slash)
 *   RESI_API_TOKEN   the API token / bearer credential
 * Optional:
 *   DASHBOARD_SHARED_SECRET  if set, callers must send a matching
 *                            X-Dashboard-Secret header. Strongly recommended:
 *                            without it the endpoint is reachable by anyone
 *                            who knows the URL.
 *
 * IMPORTANT: confirm the real Resi endpoint path, HTTP method, auth scheme and
 * body shape against current Resi API documentation before a live service. The
 * defaults here are placeholders.
 */

import { joinUrl, normaliseMethod, validateEndpoint } from "./lib/validate.mjs";

const UPSTREAM_TIMEOUT_MS = 8000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async (request) => {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const base = process.env.RESI_API_BASE;
  const token = process.env.RESI_API_TOKEN;
  if (!base || !token) {
    return json(500, { error: "Proxy is not configured: set RESI_API_BASE and RESI_API_TOKEN." });
  }

  // Optional shared secret, compared without early exit so a mismatch cannot be
  // discovered character by character through response timing.
  const expected = process.env.DASHBOARD_SHARED_SECRET;
  if (expected) {
    const provided = request.headers.get("x-dashboard-secret") ?? "";
    if (!timingSafeEqual(provided, expected)) {
      return json(401, { error: "Unauthorized" });
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Body must be JSON" });
  }

  const check = validateEndpoint(body?.endpoint);
  if (!check.ok) {
    return json(400, { error: `Invalid endpoint: ${check.reason}` });
  }

  const method = normaliseMethod(body?.method);
  if (method === null) {
    return json(400, { error: "Method must be POST or PUT" });
  }

  const target = joinUrl(base, check.path);

  // Never let a slow upstream hold the browser's request open indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body?.payload ?? {}),
      signal: controller.signal,
      redirect: "manual", // a redirect could carry the token to another host
    });

    const text = await upstream.text();
    return new Response(JSON.stringify({ status: upstream.status, body: text.slice(0, 2000) }), {
      // Surface upstream failures as 502 so the dashboard logs them as failed.
      status: upstream.ok ? 200 : 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return json(aborted ? 504 : 502, {
      error: aborted ? "Upstream timed out" : "Upstream request failed",
    });
  } finally {
    clearTimeout(timer);
  }
};

/** Length-independent comparison, so a mismatch cannot be found byte by byte. */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
