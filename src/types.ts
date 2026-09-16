/** Shared domain types for the cue dashboard. */

export type SiteRole = "primary" | "lag";

export interface Site {
  id: string;
  name: string;
  role: SiteRole;
  /** Resi venue / destination identifier (from studio.resi.io). */
  venueId: string;
  /** Resi channel or decoder identifier. */
  channelId: string;
  /**
   * Control-surface reference for this site, used by {siteRef} in a webhook
   * template. For Bitfocus Companion this is normally the button page number.
   */
  ref: string;
  /** Seconds this site runs behind the primary. Always 0 for the primary site. */
  lagSeconds: number;
  /** Operator-measured signal-chain correction, in milliseconds. May be negative. */
  trimMs: number;
  enabled: boolean;
}

export type CueType = "video-start" | "video-stop" | "marker" | "custom";

export interface Cue {
  id: string;
  label: string;
  type: CueType;
  /** Position along the service program, in seconds from service start. */
  programTimeSec: number;
  /**
   * Control-surface reference for this cue, used by {cueRef} in a webhook
   * template. For Bitfocus Companion this is normally "row/column".
   */
  ref: string;
  /** Site ids this cue fires at. Empty means "every enabled site". */
  targetSiteIds: string[];
  /** Free-form note shown to the operator in the run-of-show. */
  notes: string;
  enabled: boolean;
}

/** How the dashboard actually delivers a cue. */
export type TransportMode = "simulate" | "webhook" | "resi";

export interface TransportConfig {
  mode: TransportMode;
  /**
   * Webhook mode: URL template that receives a POST with the cue payload.
   * Supports {siteRef}, {cueRef}, {cueType}, {cueId}, {siteId}, {venueId},
   * {channelId} — so one setting can address a different control per cue.
   */
  webhookUrl: string;
  /**
   * Resi mode: path of the serverless proxy that holds the API token.
   * The browser never sees the token.
   */
  proxyPath: string;
  /**
   * Resi mode: endpoint template invoked through the proxy. Supports the
   * placeholders {venueId}, {channelId}, {cueType}.
   * VERIFY the real path against Resi's API documentation before going live.
   */
  endpointTemplate: string;
  httpMethod: "POST" | "PUT";
  /** Milliseconds a command takes to reach air. Subtracted from each air time. */
  preRollMs: number;
  /** Abort an in-flight command after this many milliseconds. */
  timeoutMs: number;
}

export interface ScrubberConfig {
  /** Total length of the video program being aligned, in seconds. */
  durationSec: number;
  /** Frame rate used for snapping and frame readout. */
  fps: number;
  /** Program position where the video portion should begin. */
  videoStartSec: number;
  /** Optional preview media URL. Local file or a same-origin/CORS-enabled URL. */
  previewUrl: string;
}

export interface DashboardConfig {
  version: number;
  serviceName: string;
  sites: Site[];
  cues: Cue[];
  transport: TransportConfig;
  scrubber: ScrubberConfig;
  /** Require a second confirming click before any live cue is sent. */
  confirmBeforeFire: boolean;
}

export type CueStatus =
  | "pending"
  | "armed"
  | "sending"
  | "fired"
  | "failed"
  | "missed"
  | "skipped";

/** One cue resolved against one site, with its computed timings. */
export interface ScheduledCue {
  key: string;
  cue: Cue;
  site: Site;
  /** Wall-clock moment the action should be on air at this site. */
  airEpochMs: number;
  /** Wall-clock moment the command must be sent to hit that air time. */
  sendEpochMs: number;
}

export interface CueLogEntry {
  id: string;
  atEpochMs: number;
  cueLabel: string;
  siteName: string;
  status: CueStatus;
  detail: string;
}

export interface TransportResult {
  ok: boolean;
  detail: string;
}
