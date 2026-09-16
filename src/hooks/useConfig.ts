import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardConfig } from "../types";
import { coerceConfig, defaultConfig, loadConfig, saveConfig } from "../lib/storage";

export interface UseConfigResult {
  config: DashboardConfig;
  update: (patch: (draft: DashboardConfig) => DashboardConfig) => void;
  replace: (next: DashboardConfig) => void;
  reset: () => void;
  importJson: (text: string) => { ok: boolean; error?: string };
  exportJson: () => string;
  storageOk: boolean;
}

/** Config state backed by localStorage, written back on every change. */
export function useConfig(): UseConfigResult {
  const [config, setConfig] = useState<DashboardConfig>(() => loadConfig());
  const [storageOk, setStorageOk] = useState(true);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setStorageOk(saveConfig(config));
  }, [config]);

  const update = useCallback((patch: (draft: DashboardConfig) => DashboardConfig) => {
    setConfig((current) => patch(structuredClone(current)));
  }, []);

  const replace = useCallback((next: DashboardConfig) => setConfig(next), []);
  const reset = useCallback(() => setConfig(defaultConfig()), []);

  const importJson = useCallback((text: string) => {
    try {
      const parsed: unknown = JSON.parse(text);
      setConfig(coerceConfig(parsed));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" };
    }
  }, []);

  const exportJson = useCallback(() => JSON.stringify(config, null, 2), [config]);

  return { config, update, replace, reset, importJson, exportJson, storageOk };
}
