import { useMemo, useRef, useState } from "react";
import type { Cue, CueType, DashboardConfig, TransportMode } from "../types";
import type { UseConfigResult } from "../hooks/useConfig";
import { validateConfig } from "../lib/cueEngine";
import { newId } from "../lib/storage";
import TimeField from "./TimeField";

interface Props {
  cfg: UseConfigResult;
}

const CUE_TYPES: CueType[] = ["video-start", "video-stop", "marker", "custom"];

const MODE_HELP: Record<TransportMode, string> = {
  simulate: "Nothing leaves the browser. Use this for rehearsal and training.",
  webhook: "POSTs the cue payload to any URL — Bitfocus Companion, ProPresenter, automation.",
  resi: "Sends through a serverless proxy that holds the Resi API token server-side.",
};

export default function AdminPanel({ cfg }: Props) {
  const { config, update, reset, importJson, exportJson, storageOk } = cfg;
  const issues = useMemo(() => validateConfig(config), [config]);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const patch = (fn: (draft: DashboardConfig) => void) =>
    update((draft) => {
      fn(draft);
      return draft;
    });

  const download = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.serviceName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "cue"}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel" aria-labelledby="admin-heading">
      <header className="panel-head">
        <h2 id="admin-heading">Administration</h2>
        <p className="panel-sub">
          Settings live in this browser only. Export a file to move them to another machine.
        </p>
      </header>

      {!storageOk && (
        <div className="alert warn" role="status">
          Could not write to local storage — changes will be lost on reload. Private browsing?
        </div>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <div className={`alert ${errors.length ? "error" : "warn"}`} role="status">
          <strong>
            {errors.length} error{errors.length === 1 ? "" : "s"}, {warnings.length} warning
            {warnings.length === 1 ? "" : "s"}
          </strong>
          <ul className="issue-list">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={`${issue.field}-${i}`} className={`issue-${issue.level}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {errors.length === 0 && warnings.length === 0 && (
        <div className="alert ok" role="status">
          Configuration valid.
        </div>
      )}

      {/* ---------------- Service ---------------- */}
      <h3 className="sub-heading">Service</h3>
      <div className="grid-2">
        <label className="field" htmlFor="svc-name">
          <span className="field-label">Service name</span>
          <input
            id="svc-name"
            className="input"
            value={config.serviceName}
            onChange={(e) => {
              const v = e.currentTarget.value;
              patch((d) => {
                d.serviceName = v;
              });
            }}
          />
        </label>
        <label className="check standalone">
          <input
            type="checkbox"
            checked={config.confirmBeforeFire}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              patch((d) => {
                d.confirmBeforeFire = v;
              });
            }}
          />
          Require a confirming second press before any live cue
        </label>
      </div>

      {/* ---------------- Sites ---------------- */}
      <div className="row between">
        <h3 className="sub-heading">Sites</h3>
        <button
          type="button"
          className="btn tiny"
          onClick={() =>
            patch((d) => {
              d.sites.push({
                id: newId("site"),
                name: `Campus ${d.sites.length + 1}`,
                role: "lag",
                venueId: "",
                channelId: "",
                lagSeconds: 1800,
                trimMs: 0,
                enabled: true,
              });
            })
          }
        >
          + Add site
        </button>
      </div>

      {config.sites.map((site, index) => (
        <fieldset className="card" key={site.id}>
          <legend>
            {site.name || "Untitled site"}
            <span className={`role-chip role-${site.role}`}>{site.role}</span>
          </legend>
          <div className="grid-2">
            <label className="field" htmlFor={`name-${site.id}`}>
              <span className="field-label">Name</span>
              <input
                id={`name-${site.id}`}
                className="input"
                value={site.name}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  patch((d) => {
                    const s = d.sites[index];
                    if (s) s.name = v;
                  });
                }}
              />
            </label>
            <label className="field" htmlFor={`role-${site.id}`}>
              <span className="field-label">Role</span>
              <select
                id={`role-${site.id}`}
                className="input"
                value={site.role}
                onChange={(e) => {
                  const v = e.currentTarget.value === "primary" ? "primary" : "lag";
                  patch((d) => {
                    const s = d.sites[index];
                    if (!s) return;
                    s.role = v;
                    // The primary defines t=0, so it can never carry a lag.
                    if (v === "primary") s.lagSeconds = 0;
                  });
                }}
              >
                <option value="primary">primary (live reference)</option>
                <option value="lag">lag (delayed)</option>
              </select>
            </label>
            <label className="field" htmlFor={`venue-${site.id}`}>
              <span className="field-label">Resi venue id</span>
              <input
                id={`venue-${site.id}`}
                className="input mono"
                value={site.venueId}
                placeholder="from studio.resi.io"
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  patch((d) => {
                    const s = d.sites[index];
                    if (s) s.venueId = v;
                  });
                }}
              />
            </label>
            <label className="field" htmlFor={`chan-${site.id}`}>
              <span className="field-label">Resi channel / decoder id</span>
              <input
                id={`chan-${site.id}`}
                className="input mono"
                value={site.channelId}
                placeholder="from studio.resi.io"
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  patch((d) => {
                    const s = d.sites[index];
                    if (s) s.channelId = v;
                  });
                }}
              />
            </label>
            {site.role === "lag" && (
              <TimeField
                id={`lag-${site.id}`}
                label="Lag behind primary"
                value={site.lagSeconds}
                onChange={(v) =>
                  patch((d) => {
                    const s = d.sites[index];
                    if (s) s.lagSeconds = v;
                  })
                }
              />
            )}
            <label className="field" htmlFor={`trim-${site.id}`}>
              <span className="field-label">Trim (ms, ± fine correction)</span>
              <input
                id={`trim-${site.id}`}
                className="input mono"
                type="number"
                step={10}
                value={site.trimMs}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  patch((d) => {
                    const s = d.sites[index];
                    if (s) s.trimMs = Number.isFinite(v) ? v : 0;
                  });
                }}
              />
            </label>
          </div>
          <div className="row between">
            <label className="check">
              <input
                type="checkbox"
                checked={site.enabled}
                onChange={(e) => {
                  const v = e.currentTarget.checked;
                  patch((d) => {
                    const s = d.sites[index];
                    if (s) s.enabled = v;
                  });
                }}
              />
              Enabled
            </label>
            <button
              type="button"
              className="btn tiny danger ghost"
              onClick={() =>
                patch((d) => {
                  d.sites.splice(index, 1);
                  // Drop dangling references so cues cannot target a ghost site.
                  for (const c of d.cues) {
                    c.targetSiteIds = c.targetSiteIds.filter((id) => id !== site.id);
                  }
                })
              }
            >
              Remove site
            </button>
          </div>
        </fieldset>
      ))}

      {/* ---------------- Cues ---------------- */}
      <div className="row between">
        <h3 className="sub-heading">Cues</h3>
        <button
          type="button"
          className="btn tiny"
          onClick={() =>
            patch((d) => {
              const cue: Cue = {
                id: newId("cue"),
                label: `Cue ${d.cues.length + 1}`,
                type: "custom",
                programTimeSec: 0,
                targetSiteIds: [],
                notes: "",
                enabled: true,
              };
              d.cues.push(cue);
            })
          }
        >
          + Add cue
        </button>
      </div>

      {config.cues.length === 0 && <p className="hint">No cues yet.</p>}

      {config.cues.map((cue, index) => (
        <fieldset className="card" key={cue.id}>
          <legend>{cue.label || "Untitled cue"}</legend>
          <div className="grid-2">
            <label className="field" htmlFor={`label-${cue.id}`}>
              <span className="field-label">Label</span>
              <input
                id={`label-${cue.id}`}
                className="input"
                value={cue.label}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  patch((d) => {
                    const c = d.cues[index];
                    if (c) c.label = v;
                  });
                }}
              />
            </label>
            <label className="field" htmlFor={`type-${cue.id}`}>
              <span className="field-label">Type</span>
              <select
                id={`type-${cue.id}`}
                className="input"
                value={cue.type}
                onChange={(e) => {
                  const v = e.currentTarget.value as CueType;
                  patch((d) => {
                    const c = d.cues[index];
                    if (c) c.type = CUE_TYPES.includes(v) ? v : "custom";
                  });
                }}
              >
                {CUE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <TimeField
              id={`pt-${cue.id}`}
              label="Program time (from service start)"
              value={cue.programTimeSec}
              onChange={(v) =>
                patch((d) => {
                  const c = d.cues[index];
                  if (c) c.programTimeSec = v;
                })
              }
            />
            <label className="field" htmlFor={`notes-${cue.id}`}>
              <span className="field-label">Notes</span>
              <input
                id={`notes-${cue.id}`}
                className="input"
                value={cue.notes}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  patch((d) => {
                    const c = d.cues[index];
                    if (c) c.notes = v;
                  });
                }}
              />
            </label>
          </div>

          <fieldset className="targets">
            <legend className="field-label">Targets (none checked = all enabled sites)</legend>
            {config.sites.map((site) => (
              <label className="check" key={site.id}>
                <input
                  type="checkbox"
                  checked={cue.targetSiteIds.includes(site.id)}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    patch((d) => {
                      const c = d.cues[index];
                      if (!c) return;
                      c.targetSiteIds = checked
                        ? [...c.targetSiteIds, site.id]
                        : c.targetSiteIds.filter((id) => id !== site.id);
                    });
                  }}
                />
                {site.name}
              </label>
            ))}
          </fieldset>

          <div className="row between">
            <label className="check">
              <input
                type="checkbox"
                checked={cue.enabled}
                onChange={(e) => {
                  const v = e.currentTarget.checked;
                  patch((d) => {
                    const c = d.cues[index];
                    if (c) c.enabled = v;
                  });
                }}
              />
              Enabled
            </label>
            <button
              type="button"
              className="btn tiny danger ghost"
              onClick={() =>
                patch((d) => {
                  d.cues.splice(index, 1);
                })
              }
            >
              Remove cue
            </button>
          </div>
        </fieldset>
      ))}

      {/* ---------------- Transport ---------------- */}
      <h3 className="sub-heading">Cue delivery</h3>
      <fieldset className="card">
        <legend>Transport</legend>
        <div className="mode-picker" role="radiogroup" aria-label="Transport mode">
          {(Object.keys(MODE_HELP) as TransportMode[]).map((mode) => (
            <label key={mode} className={`mode-option${config.transport.mode === mode ? " on" : ""}`}>
              <input
                type="radio"
                name="transport-mode"
                value={mode}
                checked={config.transport.mode === mode}
                onChange={() =>
                  patch((d) => {
                    d.transport.mode = mode;
                  })
                }
              />
              <strong>{mode}</strong>
              <small>{MODE_HELP[mode]}</small>
            </label>
          ))}
        </div>

        {config.transport.mode === "webhook" && (
          <label className="field" htmlFor="webhook-url">
            <span className="field-label">Webhook URL (HTTPS)</span>
            <input
              id="webhook-url"
              className="input mono"
              value={config.transport.webhookUrl}
              placeholder="https://..."
              onChange={(e) => {
                const v = e.currentTarget.value;
                patch((d) => {
                  d.transport.webhookUrl = v;
                });
              }}
            />
          </label>
        )}

        {config.transport.mode === "resi" && (
          <>
            <div className="alert warn">
              Verify <code>endpoint template</code> against current Resi API documentation before a
              live service. The path below is a placeholder, not a confirmed Resi endpoint.
            </div>
            <div className="grid-2">
              <label className="field" htmlFor="proxy-path">
                <span className="field-label">Proxy path</span>
                <input
                  id="proxy-path"
                  className="input mono"
                  value={config.transport.proxyPath}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    patch((d) => {
                      d.transport.proxyPath = v;
                    });
                  }}
                />
              </label>
              <label className="field" htmlFor="endpoint-tpl">
                <span className="field-label">Endpoint template</span>
                <input
                  id="endpoint-tpl"
                  className="input mono"
                  value={config.transport.endpointTemplate}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    patch((d) => {
                      d.transport.endpointTemplate = v;
                    });
                  }}
                />
              </label>
            </div>
            <p className="hint">
              Placeholders: <code>{"{venueId}"}</code>, <code>{"{channelId}"}</code>,{" "}
              <code>{"{cueType}"}</code>. The API token lives in a server environment variable and
              is never sent to the browser.
            </p>
          </>
        )}

        <div className="grid-2">
          <label className="field" htmlFor="preroll">
            <span className="field-label">Pre-roll (ms before air)</span>
            <input
              id="preroll"
              className="input mono"
              type="number"
              min={0}
              step={100}
              value={config.transport.preRollMs}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                patch((d) => {
                  d.transport.preRollMs = Number.isFinite(v) ? Math.max(0, v) : 0;
                });
              }}
            />
          </label>
          <label className="field" htmlFor="timeout">
            <span className="field-label">Request timeout (ms)</span>
            <input
              id="timeout"
              className="input mono"
              type="number"
              min={500}
              step={500}
              value={config.transport.timeoutMs}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                patch((d) => {
                  d.transport.timeoutMs = Number.isFinite(v) ? Math.max(500, v) : 8000;
                });
              }}
            />
          </label>
        </div>
      </fieldset>

      {/* ---------------- Timeline ---------------- */}
      <h3 className="sub-heading">Program timeline</h3>
      <fieldset className="card">
        <legend>Scrubber</legend>
        <div className="grid-2">
          <TimeField
            id="duration"
            label="Program duration"
            value={config.scrubber.durationSec}
            onChange={(v) =>
              patch((d) => {
                d.scrubber.durationSec = Math.max(1, v);
                if (d.scrubber.videoStartSec > d.scrubber.durationSec) {
                  d.scrubber.videoStartSec = d.scrubber.durationSec;
                }
              })
            }
          />
          <label className="field" htmlFor="fps">
            <span className="field-label">Frame rate</span>
            <select
              id="fps"
              className="input"
              value={config.scrubber.fps}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                patch((d) => {
                  d.scrubber.fps = Number.isFinite(v) && v > 0 ? v : 30;
                });
              }}
            >
              {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field wide" htmlFor="preview-url">
            <span className="field-label">Preview media URL (optional)</span>
            <input
              id="preview-url"
              className="input mono"
              value={config.scrubber.previewUrl}
              placeholder="https://… (must allow cross-origin playback)"
              onChange={(e) => {
                const v = e.currentTarget.value;
                patch((d) => {
                  d.scrubber.previewUrl = v;
                });
              }}
            />
          </label>
        </div>
      </fieldset>

      {/* ---------------- Backup ---------------- */}
      <h3 className="sub-heading">Backup &amp; restore</h3>
      <div className="row gap wrap">
        <button type="button" className="btn" onClick={download}>
          Export config
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import config
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            const result = importJson(await file.text());
            setImportError(result.ok ? null : (result.error ?? "Import failed"));
          }}
        />
        <button
          type="button"
          className="btn danger ghost"
          onClick={() => {
            if (window.confirm("Reset all settings to defaults? This cannot be undone.")) reset();
          }}
        >
          Reset to defaults
        </button>
      </div>
      {importError && <p className="alert error">Import failed: {importError}</p>}
    </section>
  );
}
