import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CueLogEntry, DashboardConfig, ScheduledCue } from "../types";
import { buildSchedule, missedEntries, nextDue } from "../lib/cueEngine";
import { sendCue } from "../lib/transport";
import { newId } from "../lib/storage";

export interface CueRunner {
  serviceStart: number | null;
  serviceRunning: boolean;
  schedule: ScheduledCue[];
  handled: Set<string>;
  statusOf: (key: string) => "pending" | "fired" | "failed" | "skipped";
  log: CueLogEntry[];
  autoFire: boolean;
  setAutoFire: (value: boolean) => void;
  upcoming: ScheduledCue | null;
  missed: ScheduledCue[];
  startService: (atEpochMs?: number) => void;
  stopService: () => void;
  fire: (item: ScheduledCue) => Promise<void>;
  fireNext: () => Promise<void>;
  skip: (item: ScheduledCue) => void;
  clearLog: () => void;
  busyKey: string | null;
}

export function useCueRunner(config: DashboardConfig, now: number): CueRunner {
  const [serviceStart, setServiceStart] = useState<number | null>(null);
  const [fired, setFired] = useState<Record<string, "fired" | "failed" | "skipped">>({});
  const [log, setLog] = useState<CueLogEntry[]>([]);
  const [autoFire, setAutoFire] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Guards against a second send for the same cue while one is in flight —
  // state updates are async, so a ref is the only reliable latch here.
  const inFlight = useRef<Set<string>>(new Set());

  const schedule = useMemo(
    () => (serviceStart === null ? [] : buildSchedule(config, serviceStart)),
    [config, serviceStart],
  );

  const handled = useMemo(() => new Set(Object.keys(fired)), [fired]);

  const appendLog = useCallback((entry: Omit<CueLogEntry, "id">) => {
    setLog((current) => [{ ...entry, id: newId("log") }, ...current].slice(0, 200));
  }, []);

  const fire = useCallback(
    async (item: ScheduledCue) => {
      if (inFlight.current.has(item.key)) return;
      inFlight.current.add(item.key);
      setBusyKey(item.key);
      try {
        const result = await sendCue(config.transport, item.cue, item.site, item.airEpochMs);
        setFired((current) => ({ ...current, [item.key]: result.ok ? "fired" : "failed" }));
        appendLog({
          atEpochMs: Date.now(),
          cueLabel: item.cue.label,
          siteName: item.site.name,
          status: result.ok ? "fired" : "failed",
          detail: result.detail,
        });
      } finally {
        inFlight.current.delete(item.key);
        setBusyKey((current) => (current === item.key ? null : current));
      }
    },
    [config.transport, appendLog],
  );

  const upcoming = useMemo(
    () => (serviceStart === null ? null : nextDue(schedule, now, handled)),
    [schedule, now, handled, serviceStart],
  );

  const missed = useMemo(
    () => (serviceStart === null ? [] : missedEntries(schedule, now, handled)),
    [schedule, now, handled, serviceStart],
  );

  const fireNext = useCallback(async () => {
    // Manual GO fires whatever is next in line, including an entry whose
    // moment has already slipped past — the operator is the authority.
    const target = upcoming ?? schedule.find((s) => !handled.has(s.key)) ?? null;
    if (target) await fire(target);
  }, [upcoming, schedule, handled, fire]);

  const skip = useCallback(
    (item: ScheduledCue) => {
      setFired((current) => ({ ...current, [item.key]: "skipped" }));
      appendLog({
        atEpochMs: Date.now(),
        cueLabel: item.cue.label,
        siteName: item.site.name,
        status: "skipped",
        detail: "Skipped by operator",
      });
    },
    [appendLog],
  );

  // Auto-fire: send anything whose moment has arrived. Runs off the ticking
  // clock rather than a timer per cue, so edits to the config take effect
  // immediately and a slow tick can never drop a cue entirely.
  useEffect(() => {
    if (!autoFire || serviceStart === null) return;
    for (const item of schedule) {
      if (handled.has(item.key) || inFlight.current.has(item.key)) continue;
      if (item.sendEpochMs <= now) {
        void fire(item);
        break; // one per tick keeps the log readable and ordering intact
      }
    }
  }, [autoFire, serviceStart, schedule, handled, now, fire]);

  const startService = useCallback((atEpochMs?: number) => {
    setServiceStart(atEpochMs ?? Date.now());
    setFired({});
    inFlight.current.clear();
  }, []);

  const stopService = useCallback(() => {
    setServiceStart(null);
    setAutoFire(false);
    inFlight.current.clear();
  }, []);

  const statusOf = useCallback(
    (key: string) => fired[key] ?? "pending",
    [fired],
  );

  return {
    serviceStart,
    serviceRunning: serviceStart !== null,
    schedule,
    handled,
    statusOf,
    log,
    autoFire,
    setAutoFire,
    upcoming,
    missed,
    startService,
    stopService,
    fire,
    fireNext,
    skip,
    clearLog: useCallback(() => setLog([]), []),
    busyKey,
  };
}
