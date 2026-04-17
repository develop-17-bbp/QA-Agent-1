import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchFormTestSites, runFormTest, type FormTestSite } from "../api";
import { ErrorBanner } from "../components/UI";

type SiteResult = {
  siteId: string;
  siteName: string;
  url: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  errorMessage?: string;
  screenshotPath?: string;
};

type RunSummary = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  results: SiteResult[];
};

export default function FormTests() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sites, setSites] = useState<FormTestSite[]>([]);
  const [loadError, setLoadError] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [headless, setHeadless] = useState(true);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [runError, setRunError] = useState("");

  const load = async () => {
    setLoadError("");
    try {
      const r = await fetchFormTestSites();
      setConfigured(!!r.configured);
      if (!r.configured) setLoadError(r.error ?? "");
      setSites(r.sites ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { void load(); }, []);

  const runOne = async (siteId?: string) => {
    setRunError("");
    setRunningId(siteId ?? "__all__");
    try {
      const summary = await runFormTest({ siteId, headless });
      setLastRun(summary);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Form & Flow Tests</h1>
      <p className="qa-page-desc" style={{ marginBottom: 16 }}>
        Playwright-driven smoke tests for contact forms, sign-ups, and chat handoffs configured in{" "}
        <code style={{ background: "var(--panel-soft)", padding: "2px 6px", borderRadius: 4 }}>config/sites.json</code>.
        Each test fills inputs, clicks submit, and asserts a success signal. Failures capture screenshots.
      </p>

      {loadError && <ErrorBanner error={loadError} />}

      {configured === false && (
        <div className="qa-panel" style={{ padding: 20, marginTop: 16 }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            To get started, copy <code>config/sites.example.json</code> → <code>config/sites.json</code> and edit with your sites and form selectors.
          </p>
        </div>
      )}

      {configured && (
        <>
          <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
              Run headless
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                (uncheck to see the browser — required for <code>pause_after_fields</code> CAPTCHA strategy)
              </span>
            </label>
            <button
              className="qa-btn-primary"
              onClick={() => runOne()}
              disabled={runningId !== null || sites.filter((s) => s.enabled).length === 0}
              style={{ padding: "8px 18px" }}
            >
              {runningId === "__all__" ? "Running…" : `Run all enabled (${sites.filter((s) => s.enabled).length})`}
            </button>
          </div>

          {runError && <ErrorBanner error={runError} />}

          <div className="qa-panel" style={{ padding: 0, overflow: "hidden" }}>
            <table className="qa-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>URL</th>
                  <th>Forms</th>
                  <th>Chat</th>
                  <th>CAPTCHA</th>
                  <th>Success check</th>
                  <th>Enabled</th>
                  <th>Last result</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const r = lastRun?.results.find((x) => x.siteId === s.id);
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td style={{ wordBreak: "break-all" }}>
                        <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                      </td>
                      <td>{s.forms}</td>
                      <td>{s.hasLiveAgent ? "Yes" : "—"}</td>
                      <td>{s.captcha ?? "none"}</td>
                      <td>{s.success}</td>
                      <td style={{ color: s.enabled ? "var(--ok)" : "var(--muted)" }}>{s.enabled ? "Yes" : "No"}</td>
                      <td>
                        {r ? (
                          <span style={{ color: r.status === "passed" ? "var(--ok)" : r.status === "failed" ? "var(--bad)" : "var(--muted)", fontWeight: 600 }}>
                            {r.status}
                            <span style={{ marginLeft: 6, fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>
                              {(r.durationMs / 1000).toFixed(1)}s
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                        {r?.errorMessage && (
                          <div style={{ fontSize: 12, color: "var(--bad)", marginTop: 4, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {r.errorMessage}
                          </div>
                        )}
                      </td>
                      <td>
                        <button
                          className="qa-btn-ghost"
                          onClick={() => runOne(s.id)}
                          disabled={runningId !== null || !s.enabled}
                          style={{ padding: "4px 12px", fontSize: 12 }}
                        >
                          {runningId === s.id ? "Running…" : "Run"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {lastRun && (
            <p className="qa-footnote" style={{ marginTop: 16 }}>
              Run <code>{lastRun.runId}</code> · {new Date(lastRun.finishedAt).toLocaleString()} · {lastRun.results.length} site{lastRun.results.length === 1 ? "" : "s"} ·
              artifacts in <code>artifacts/form-tests/{lastRun.runId}/</code>
            </p>
          )}
        </>
      )}
    </motion.div>
  );
}
