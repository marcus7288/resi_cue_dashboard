/**
 * Config persistence.
 *
 * Everything that comes back out of localStorage is treated as untrusted input:
 * a hand-edited or corrupted blob must never be able to crash the dashboard
 * mid-service, so each field is coerced back into range and anything
 * unrecognised is dropped.
 */

import type {
  Cue,
  CueType,
  DashboardConfig,
  ScrubberConfig,
  Site,
  TransportConfig,
  TransportMode,
} from "../types";

export const STORAGE_KEY = "resi-cue-dashboard.config.v1";
export const CONFIG_VERSION = 1;

export function defaultConfig(): DashboardConfig {
  return {
    version: CONFIG_VERSION,
    serviceName: "Sunday Morning",
    sites: [
      {
        id: "site-primary",
        name: "Broadcast Campus",
        role: "primary",
        venueId: "",
        channelId: "",
        lagSeconds: 0,
        trimMs: 0,
        enabled: true,
      },
      {
        id: "site-lag-1",
        name: "North Campus (lag)",
        role: "lag",
        venueId: "",
        channelId: "",
        lagSeconds: 1800,
        trimMs: 0,
        enabled: true,
      },
    ],
    cues: [
      {
        id: "cue-countdown",
        label: "Countdown ends / Service top",
        type: "marker",
        programTimeSec: 0,
        targetSiteIds: [],
        notes: "Reference point. Everything else is measured from here.",
        enabled: true,
      },
      {
        id: "cue-video-start",
        label: "Roll sermon video",
        type: "video-start",
        programTimeSec: 1500,
        targetSiteIds: [],
        notes: "The cue the lag site has to hit seamlessly.",
        enabled: true,
      },
      {
        id: "cue-video-stop",
        label: "Video out / back to live",
        type: "video-stop",
        programTimeSec: 3600,
        targetSiteIds: [],
        notes: "",
        enabled: true,
      },
    ],
    transport: {
      mode: "simulate",
      webhookUrl: "",
      proxyPath: "/.netlify/functions/resi-proxy",
      endpointTemplate: "/v1/venues/{venueId}/channels/{channelId}/cue",
      httpMethod: "POST",
      preRollMs: 1500,
      timeoutMs: 8000,
    },
    scrubber: {
      durationSec: 4500,
      fps: 30,
      videoStartSec: 1500,
      previewUrl: "",
    },
    confirmBeforeFire: true,
  };
}

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const str = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const CUE_TYPES: CueType[] = ["video-start", "video-stop", "marker", "custom"];
const MODES: TransportMode[] = ["simulate", "webhook", "resi"];

function coerceSite(raw: unknown, index: number): Site | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const role = r["role"] === "primary" ? "primary" : "lag";
  return {
    id: str(r["id"], `site-${index}`),
    name: str(r["name"], `Site ${index + 1}`),
    role,
    venueId: str(r["venueId"], ""),
    channelId: str(r["channelId"], ""),
    // A primary site is the reference, so its lag is 0 by definition.
    lagSeconds: role === "primary" ? 0 : Math.max(0, num(r["lagSeconds"], 0)),
    trimMs: num(r["trimMs"], 0),
    enabled: bool(r["enabled"], true),
  };
}

function coerceCue(raw: unknown, index: number): Cue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const type = CUE_TYPES.includes(r["type"] as CueType) ? (r["type"] as CueType) : "custom";
  const targets = Array.isArray(r["targetSiteIds"])
    ? r["targetSiteIds"].filter((v): v is string => typeof v === "string")
    : [];
  return {
    id: str(r["id"], `cue-${index}`),
    label: str(r["label"], `Cue ${index + 1}`),
    type,
    programTimeSec: Math.max(0, num(r["programTimeSec"], 0)),
    targetSiteIds: targets,
    notes: str(r["notes"], ""),
    enabled: bool(r["enabled"], true),
  };
}

function coerceTransport(raw: unknown, fallback: TransportConfig): TransportConfig {
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  return {
    mode: MODES.includes(r["mode"] as TransportMode) ? (r["mode"] as TransportMode) : fallback.mode,
    webhookUrl: str(r["webhookUrl"], fallback.webhookUrl),
    proxyPath: str(r["proxyPath"], fallback.proxyPath),
    endpointTemplate: str(r["endpointTemplate"], fallback.endpointTemplate),
    httpMethod: r["httpMethod"] === "PUT" ? "PUT" : "POST",
    preRollMs: Math.max(0, num(r["preRollMs"], fallback.preRollMs)),
    timeoutMs: Math.max(500, num(r["timeoutMs"], fallback.timeoutMs)),
  };
}

function coerceScrubber(raw: unknown, fallback: ScrubberConfig): ScrubberConfig {
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const durationSec = Math.max(1, num(r["durationSec"], fallback.durationSec));
  return {
    durationSec,
    fps: Math.max(1, num(r["fps"], fallback.fps)),
    videoStartSec: Math.min(durationSec, Math.max(0, num(r["videoStartSec"], fallback.videoStartSec))),
    previewUrl: str(r["previewUrl"], fallback.previewUrl),
  };
}

/** Coerce any parsed JSON into a usable config, falling back field by field. */
export function coerceConfig(raw: unknown): DashboardConfig {
  const base = defaultConfig();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;

  const sites = Array.isArray(r["sites"])
    ? r["sites"].map(coerceSite).filter((s): s is Site => s !== null)
    : base.sites;
  const cues = Array.isArray(r["cues"])
    ? r["cues"].map(coerceCue).filter((c): c is Cue => c !== null)
    : base.cues;

  return {
    version: CONFIG_VERSION,
    serviceName: str(r["serviceName"], base.serviceName),
    sites: sites.length > 0 ? sites : base.sites,
    cues,
    transport: coerceTransport(r["transport"], base.transport),
    scrubber: coerceScrubber(r["scrubber"], base.scrubber),
    confirmBeforeFire: bool(r["confirmBeforeFire"], base.confirmBeforeFire),
  };
}

export function loadConfig(): DashboardConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    return coerceConfig(JSON.parse(raw));
  } catch {
    // Private browsing, disabled storage or corrupt JSON: start clean rather than fail.
    return defaultConfig();
  }
}

export function saveConfig(config: DashboardConfig): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

/** Stable-ish unique id for new sites and cues. */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}
