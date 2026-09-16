import { useMemo, useState } from "react";
import AdminPanel from "./components/AdminPanel";
import CuePanel from "./components/CuePanel";
import Scrubber from "./components/Scrubber";
import { useClock } from "./hooks/useClock";
import { useConfig } from "./hooks/useConfig";
import { useCueRunner } from "./hooks/useCueRunner";
import { validateConfig } from "./lib/cueEngine";
import { formatTimeOfDay } from "./lib/time";

type Tab = "show" | "align" | "admin";

const TABS: { id: Tab; label: string }[] = [
  { id: "show", label: "Run of show" },
  { id: "align", label: "Video alignment" },
  { id: "admin", label: "Admin" },
];

export default function App() {
  const cfg = useConfig();
  const now = useClock(100);
  const runner = useCueRunner(cfg.config, now);
  const [tab, setTab] = useState<Tab>("show");

  const errorCount = useMemo(
    () => validateConfig(cfg.config).filter((i) => i.level === "error").length,
    [cfg.config],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Resi Cue Dashboard</h1>
            <p className="brand-sub">Multi-site service cueing &amp; lag alignment</p>
          </div>
        </div>
        <div className="topbar-right">
          {runner.serviceRunning && <span className="live-chip">ON AIR</span>}
          <span className="wall-clock mono">{formatTimeOfDay(now)}</span>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={`tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "admin" && errorCount > 0 && (
              <span className="badge" title={`${errorCount} configuration errors`}>
                {errorCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="content"
      >
        {tab === "show" && <CuePanel config={cfg.config} runner={runner} now={now} />}
        {tab === "align" && (
          <Scrubber
            config={cfg.config}
            update={cfg.update}
            primaryStartEpochMs={runner.serviceStart}
            serviceRunning={runner.serviceRunning}
          />
        )}
        {tab === "admin" && <AdminPanel cfg={cfg} />}
      </main>

      <footer className="footer">
        <span>
          Mode: <strong>{cfg.config.transport.mode}</strong>
        </span>
        <span>Space = GO · Esc = disarm</span>
      </footer>
    </div>
  );
}
