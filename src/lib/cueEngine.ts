/** Pure scheduling logic: turn config + a service start time into a firing schedule. */

import type { Cue, DashboardConfig, ScheduledCue, Site } from "../types";
import { airTimeForProgramPosition, sendTimeForAirTime } from "./time";

/** Sites a cue targets: its explicit list, or every enabled site when empty. */
export function resolveTargets(cue: Cue, sites: Site[]): Site[] {
  const enabled = sites.filter((s) => s.enabled);
  if (cue.targetSiteIds.length === 0) return enabled;
  return enabled.filter((s) => cue.targetSiteIds.includes(s.id));
}

/**
 * Expand every enabled cue across its target sites and compute timings.
 * Result is sorted by send time so the operator sees the true firing order —
 * which is NOT cue order, because lag sites interleave with the primary.
 */
export function buildSchedule(
  config: DashboardConfig,
  primaryStartEpochMs: number,
): ScheduledCue[] {
  const out: ScheduledCue[] = [];
  for (const cue of config.cues) {
    if (!cue.enabled) continue;
    for (const site of resolveTargets(cue, config.sites)) {
      const lag = site.role === "primary" ? 0 : site.lagSeconds;
      const airEpochMs = airTimeForProgramPosition(
        primaryStartEpochMs,
        cue.programTimeSec,
        lag,
        site.trimMs,
      );
      out.push({
        key: `${cue.id}:${site.id}`,
        cue,
        site,
        airEpochMs,
        sendEpochMs: sendTimeForAirTime(airEpochMs, config.transport.preRollMs),
      });
    }
  }
  out.sort((a, b) => a.sendEpochMs - b.sendEpochMs || a.key.localeCompare(b.key));
  return out;
}

/**
 * The next entry due to be sent, ignoring anything already handled.
 * `handledKeys` holds keys that fired, failed or were skipped.
 */
export function nextDue(
  schedule: ScheduledCue[],
  nowEpochMs: number,
  handledKeys: ReadonlySet<string>,
): ScheduledCue | null {
  for (const item of schedule) {
    if (handledKeys.has(item.key)) continue;
    if (item.sendEpochMs >= nowEpochMs) return item;
  }
  return null;
}

/**
 * Entries whose send moment has passed but which were never handled.
 * `graceMs` keeps an entry out of this list until it is clearly missed.
 */
export function missedEntries(
  schedule: ScheduledCue[],
  nowEpochMs: number,
  handledKeys: ReadonlySet<string>,
  graceMs = 2000,
): ScheduledCue[] {
  return schedule.filter(
    (item) => !handledKeys.has(item.key) && item.sendEpochMs + graceMs < nowEpochMs,
  );
}

/**
 * Wall-clock start time for a lag site's video portion — the number the
 * operator at that site actually needs.
 */
export function lagVideoStart(
  config: DashboardConfig,
  site: Site,
  primaryStartEpochMs: number,
): number {
  const lag = site.role === "primary" ? 0 : site.lagSeconds;
  return airTimeForProgramPosition(
    primaryStartEpochMs,
    config.scrubber.videoStartSec,
    lag,
    site.trimMs,
  );
}

/** Validation issue surfaced in the admin panel. */
export interface ConfigIssue {
  level: "error" | "warning";
  field: string;
  message: string;
}

/**
 * Check a config for the mistakes that actually bite on a Sunday morning:
 * no primary, zero lag on a lag site, cues past the program end, and so on.
 */
export function validateConfig(config: DashboardConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const enabled = config.sites.filter((s) => s.enabled);
  const primaries = enabled.filter((s) => s.role === "primary");

  if (enabled.length === 0) {
    issues.push({ level: "error", field: "sites", message: "No enabled sites." });
  }
  if (primaries.length === 0) {
    issues.push({
      level: "error",
      field: "sites",
      message: "No enabled primary site — lag times have nothing to reference.",
    });
  }
  if (primaries.length > 1) {
    issues.push({
      level: "error",
      field: "sites",
      message: `${primaries.length} primary sites enabled. Exactly one is required.`,
    });
  }

  const seenIds = new Set<string>();
  for (const site of config.sites) {
    if (seenIds.has(site.id)) {
      issues.push({ level: "error", field: `site:${site.id}`, message: "Duplicate site id." });
    }
    seenIds.add(site.id);

    if (site.name.trim() === "") {
      issues.push({ level: "error", field: `site:${site.id}`, message: "Site name is empty." });
    }
    if (site.role === "lag" && site.enabled && site.lagSeconds <= 0) {
      issues.push({
        level: "warning",
        field: `site:${site.id}`,
        message: `"${site.name}" is a lag site but its lag is ${site.lagSeconds}s — it will fire with the primary.`,
      });
    }
    if (Math.abs(site.trimMs) > 5000) {
      issues.push({
        level: "warning",
        field: `site:${site.id}`,
        message: `"${site.name}" trim is ${site.trimMs}ms. Trims beyond ±5s usually mean the lag value is wrong.`,
      });
    }
    if (config.transport.mode === "resi" && site.enabled && site.channelId.trim() === "") {
      issues.push({
        level: "error",
        field: `site:${site.id}`,
        message: `"${site.name}" has no channel id, required in Resi API mode.`,
      });
    }
  }

  if (config.cues.filter((c) => c.enabled).length === 0) {
    issues.push({ level: "warning", field: "cues", message: "No enabled cues in the run of show." });
  }
  for (const cue of config.cues) {
    if (cue.programTimeSec < 0) {
      issues.push({
        level: "error",
        field: `cue:${cue.id}`,
        message: `"${cue.label}" has a negative program time.`,
      });
    }
    if (cue.programTimeSec > config.scrubber.durationSec) {
      issues.push({
        level: "warning",
        field: `cue:${cue.id}`,
        message: `"${cue.label}" sits past the end of the program timeline.`,
      });
    }
    for (const id of cue.targetSiteIds) {
      if (!seenIds.has(id)) {
        issues.push({
          level: "error",
          field: `cue:${cue.id}`,
          message: `"${cue.label}" targets a site that no longer exists.`,
        });
      }
    }
  }

  const t = config.transport;
  if (t.mode === "webhook" && !/^https:\/\//i.test(t.webhookUrl)) {
    issues.push({
      level: t.webhookUrl.trim() === "" ? "error" : "warning",
      field: "transport",
      message:
        t.webhookUrl.trim() === ""
          ? "Webhook mode selected but no URL is set."
          : "Webhook URL is not HTTPS — cue traffic would be sent in the clear.",
    });
  }
  if (t.mode === "resi" && t.proxyPath.trim() === "") {
    issues.push({ level: "error", field: "transport", message: "Resi mode needs a proxy path." });
  }
  if (t.preRollMs < 0) {
    issues.push({ level: "error", field: "transport", message: "Pre-roll cannot be negative." });
  }
  if (t.preRollMs > 10000) {
    issues.push({
      level: "warning",
      field: "transport",
      message: "Pre-roll over 10s — commands will be sent very far ahead of air.",
    });
  }

  const s = config.scrubber;
  if (s.durationSec <= 0) {
    issues.push({ level: "error", field: "scrubber", message: "Program duration must be positive." });
  }
  if (s.fps <= 0) {
    issues.push({ level: "error", field: "scrubber", message: "Frame rate must be positive." });
  }
  if (s.videoStartSec < 0 || s.videoStartSec > s.durationSec) {
    issues.push({
      level: "error",
      field: "scrubber",
      message: "Video start point is outside the program timeline.",
    });
  }
  return issues;
}
