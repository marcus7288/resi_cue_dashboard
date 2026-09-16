/**
 * Cue delivery.
 *
 * Three modes, chosen in Admin:
 *   simulate  nothing leaves the browser. Safe for rehearsal and training.
 *   webhook   POST to any URL — Bitfocus Companion, ProPresenter, an automation hook.
 *   resi      POST through a server-side proxy that holds the Resi API token.
 *
 * The browser never holds an API token in any mode. In `resi` mode the proxy
 * injects credentials server-side; see netlify/functions/resi-proxy.mjs.
 */

import type { Cue, Site, TransportConfig, TransportResult } from "../types";

export interface CuePayload {
  cueId: string;
  cueLabel: string;
  cueType: string;
  cueRef: string;
  siteId: string;
  siteName: string;
  siteRef: string;
  venueId: string;
  channelId: string;
  /** Wall-clock moment this action should be on air, ISO-8601. */
  airTime: string;
  /** Program position in seconds. */
  programTimeSec: number;
  sentAt: string;
}

export function buildPayload(cue: Cue, site: Site, airEpochMs: number): CuePayload {
  return {
    cueId: cue.id,
    cueLabel: cue.label,
    cueType: cue.type,
    cueRef: cue.ref,
    siteId: site.id,
    siteName: site.name,
    siteRef: site.ref,
    venueId: site.venueId,
    channelId: site.channelId,
    airTime: new Date(airEpochMs).toISOString(),
    programTimeSec: cue.programTimeSec,
    sentAt: new Date().toISOString(),
  };
}

/**
 * Strip a control reference down to characters that are safe inside a URL path.
 *
 * Refs keep their slashes on purpose: Bitfocus Companion addresses a button as
 * `page/row/column`, so that structure IS the value. Everything that could
 * change the shape of the request — query, fragment, userinfo, scheme, dot
 * segments, whitespace — is removed rather than escaped.
 */
export function sanitizeRef(ref: string): string {
  return ref
    .replace(/\.\.+/g, "")
    .replace(/[^A-Za-z0-9/_-]/g, "")
    .replace(/\/{2,}/g, "/");
}

/**
 * Fill placeholders in a URL or endpoint template.
 *
 * Two escaping rules, deliberately different:
 *   - Opaque identifiers ({venueId}, {channelId}, {cueType}, {cueId}, {siteId})
 *     are URI-encoded, so an id containing a slash cannot escape its path segment.
 *   - Control refs ({cueRef}, {siteRef}) are sanitised instead of encoded,
 *     because their slashes are meaningful path structure.
 */
export function renderTemplate(template: string, payload: CuePayload): string {
  const encoded: Record<string, string> = {
    venueId: payload.venueId,
    channelId: payload.channelId,
    cueType: payload.cueType,
    cueId: payload.cueId,
    siteId: payload.siteId,
  };
  const refs: Record<string, string> = {
    cueRef: payload.cueRef,
    siteRef: payload.siteRef,
  };

  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (key in encoded) return encodeURIComponent(encoded[key] ?? "");
    if (key in refs) return sanitizeRef(refs[key] ?? "");
    return match; // unknown placeholder is left verbatim so the mistake is visible
  });
}

/** Retained name for the Resi endpoint path; same rules as renderTemplate. */
export const renderEndpoint = renderTemplate;

/**
 * Optional shared secret for the Resi proxy, injected at BUILD time.
 *
 * This is not access control. A static site ships its bundle to the browser, so
 * anything baked in here is readable by anyone who can load the page. It exists
 * only to stop opportunistic scanning of a public function URL. Real access
 * control belongs in front of the whole site (see INTEGRATION.md).
 *
 * It is read from the environment rather than the saved config on purpose, so
 * it never lands in localStorage or in an exported config file.
 */
function sharedSecret(): string | null {
  try {
    const value = import.meta.env?.VITE_DASHBOARD_SECRET;
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

/** fetch() with a hard timeout, so a hung request cannot stall the next cue. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendCue(
  transport: TransportConfig,
  cue: Cue,
  site: Site,
  airEpochMs: number,
): Promise<TransportResult> {
  const payload = buildPayload(cue, site, airEpochMs);

  if (transport.mode === "simulate") {
    return { ok: true, detail: `Simulated → ${site.name}` };
  }

  try {
    if (transport.mode === "webhook") {
      if (!transport.webhookUrl.trim()) {
        return { ok: false, detail: "No webhook URL configured." };
      }
      // The URL is a template so one setting can address a different control
      // per cue and per site — Companion needs a distinct button for each.
      const url = renderTemplate(transport.webhookUrl, payload);
      const res = await fetchWithTimeout(
        url,
        {
          method: transport.httpMethod,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        transport.timeoutMs,
      );
      return res.ok
        ? { ok: true, detail: `Webhook ${res.status}` }
        : { ok: false, detail: `Webhook failed: ${res.status} ${res.statusText}` };
    }

    // resi mode — the proxy adds the Authorization header server-side.
    const secret = sharedSecret();
    const res = await fetchWithTimeout(
      transport.proxyPath,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "X-Dashboard-Secret": secret } : {}),
        },
        body: JSON.stringify({
          endpoint: renderTemplate(transport.endpointTemplate, payload),
          method: transport.httpMethod,
          payload,
        }),
      },
      transport.timeoutMs,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const hint =
        res.status === 401
          ? " (proxy rejected the shared secret — is VITE_DASHBOARD_SECRET set at build time?)"
          : "";
      return { ok: false, detail: `Proxy ${res.status}: ${text.slice(0, 180)}${hint}` };
    }
    return { ok: true, detail: `Resi accepted (${res.status})` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes("abort")
      ? `Timed out after ${transport.timeoutMs}ms`
      : message;
    return { ok: false, detail };
  }
}
