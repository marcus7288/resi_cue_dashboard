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
  siteId: string;
  siteName: string;
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
    siteId: site.id,
    siteName: site.name,
    venueId: site.venueId,
    channelId: site.channelId,
    airTime: new Date(airEpochMs).toISOString(),
    programTimeSec: cue.programTimeSec,
    sentAt: new Date().toISOString(),
  };
}

/**
 * Fill {venueId} / {channelId} / {cueType} in an endpoint template.
 * Values are URI-encoded so an id containing a slash cannot rewrite the path.
 */
export function renderEndpoint(template: string, payload: CuePayload): string {
  return template
    .replace(/\{venueId\}/g, encodeURIComponent(payload.venueId))
    .replace(/\{channelId\}/g, encodeURIComponent(payload.channelId))
    .replace(/\{cueType\}/g, encodeURIComponent(payload.cueType));
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
      const res = await fetchWithTimeout(
        transport.webhookUrl,
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
    const res = await fetchWithTimeout(
      transport.proxyPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: renderEndpoint(transport.endpointTemplate, payload),
          method: transport.httpMethod,
          payload,
        }),
      },
      transport.timeoutMs,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, detail: `Proxy ${res.status}: ${text.slice(0, 180)}` };
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
