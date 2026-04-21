import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchFormTestSites, runFormTest, runAdHocFormTest, type FormTestSite, type AdHocFormTestResult } from "../api";
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

  // Ad-hoc URL test — paste a URL, we auto-detect + fill + submit.
  const [adHocUrl, setAdHocUrl] = useState("");
  const [adHocDryRun, setAdHocDryRun] = useState(false);
  const [adHocRunning, setAdHocRunning] = useState(false);
  const [adHocError, setAdHocError] = useState("");
  const [adHocResult, setAdHocResult] = useState<AdHocFormTestResult | null>(null);

  const runAdHoc = async () => {
    const u = adHocUrl.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) { setAdHocError("URL must start with http:// or https://"); return; }
    setAdHocError("");
    setAdHocResult(null);
    setAdHocRunning(true);
    try {
      const r = await runAdHocFormTest({ url: u, headless, dryRun: adHocDryRun });
      setAdHocResult(r);
    } catch (e) {
      setAdHocError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdHocRunning(false);
    }
  };

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
        Playwright-driven smoke tests. Use the <strong>Ad-hoc URL test</strong> below to paste any URL and let QA-Agent
        auto-discover and fill the form. Use the configured tests (from{" "}
        <code style={{ background: "var(--panel-soft)", padding: "2px 6px", borderRadius: 4 }}>config/sites.json</code>)
        for reliable, repeatable regressions against known selectors.
      </p>

      {/* ── Ad-hoc URL tester ─────────────────────────────────────────────── */}
      <div className="qa-panel" style={{ padding: 16, marginBottom: 20, border: "1px solid var(--accent-muted)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <div className="qa-panel-title">Ad-hoc URL test</div>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Auto-detects form fields · fills with obvious test data · submits · fuzzy success check</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="qa-input"
            type="url"
            placeholder="https://example.com/contact"
            value={adHocUrl}
            onChange={(e) => setAdHocUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !adHocRunning) void runAdHoc(); }}
            style={{ flex: 1, minWidth: 260, padding: "8px 12px" }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={adHocDryRun} onChange={(e) => setAdHocDryRun(e.target.checked)} />
            Dry run (fill only, don't submit)
          </label>
          <button
            className="qa-btn-primary"
            onClick={runAdHoc}
            disabled={adHocRunning || !adHocUrl.trim()}
            style={{ padding: "8px 18px", whiteSpace: "nowrap" }}
          >
            {adHocRunning ? "Testing…" : "Test this URL"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 8 }}>
          ⚠ Unless <strong>Dry run</strong> is checked, this <strong>will click submit and post real data</strong>.
          Only point this at URLs you control (staging / your own sites). Values used:
          <code style={{ marginLeft: 4 }}>qa-agent-test@example.com</code>, <code>QA-Agent Test</code>,
          <code style={{ marginLeft: 4 }}>"Automated smoke test — please disregard"</code>.
        </div>

        {adHocError && <ErrorBanner error={adHocError} />}

        {adHocResult && (
          <div className="qa-panel" style={{ marginTop: 12, padding: 12, background: "var(--glass2)" }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 4,
                background:
                  adHocResult.status === "passed" ? "var(--ok-bg)" :
                  adHocResult.status === "uncertain" ? "var(--warn-bg)" :
                  adHocResult.status === "skipped" ? "var(--info-bg)" : "var(--bad-bg)",
                color:
                  adHocResult.status === "passed" ? "var(--ok)" :
                  adHocResult.status === "uncertain" ? "var(--warn)" :
                  adHocResult.status === "skipped" ? "var(--info)" : "var(--bad)",
                border: "1px solid",
                borderColor:
                  adHocResult.status === "passed" ? "var(--ok-border)" :
                  adHocResult.status === "uncertain" ? "var(--warn-border)" :
                  adHocResult.status === "skipped" ? "var(--info-border)" : "var(--bad-border)",
              }}>
                {adHocResult.status.toUpperCase()}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{(adHocResult.durationMs / 1000).toFixed(1)}s</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {adHocResult.formsFound} form{adHocResult.formsFound === 1 ? "" : "s"} found · {adHocResult.filledFields.filter(f => f.action !== "skip").length} field{adHocResult.filledFields.filter(f => f.action !== "skip").length === 1 ? "" : "s"} filled
              </span>
              {adHocResult.submitted && <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>✓ submitted</span>}
            </div>
            {adHocResult.successSignal && (
              <div style={{ fontSize: 12.5, color: "var(--ok)", marginBottom: 6 }}>
                <strong>Success signal:</strong> {adHocResult.successSignal}
              </div>
            )}
            {adHocResult.finalUrl && adHocResult.finalUrl !== adHocResult.url && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                Redirected to: <a href={adHocResult.finalUrl} target="_blank" rel="noreferrer">{adHocResult.finalUrl}</a>
              </div>
            )}
            {adHocResult.errorMessage && (
              <div style={{ fontSize: 12.5, color: adHocResult.status === "passed" ? "var(--muted)" : "var(--bad)", marginBottom: 6 }}>
                {adHocResult.errorMessage}
              </div>
            )}
            {adHocResult.filledFields.length > 0 && (
              <details style={{ fontSize: 12, marginTop: 8 }}>
                <summary style={{ cursor: "pointer", color: "var(--muted)", fontWeight: 600 }}>
                  Field-by-field plan ({adHocResult.filledFields.length})
                </summary>
                <table className="qa-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Selector</th>
                      <th>Type</th>
                      <th>Action</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adHocResult.filledFields.map((f, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: "monospace", fontSize: 11 }}>{f.selector}</td>
                        <td style={{ fontSize: 11 }}>{f.type ?? "—"}</td>
                        <td style={{ fontSize: 11, color: f.action === "skip" ? "var(--muted)" : "var(--text)" }}>
                          {f.action}
                          {f.skippedReason && <span style={{ color: "var(--muted)", marginLeft: 6, fontStyle: "italic" }}>({f.skippedReason})</span>}
                        </td>
                        <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {f.value ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              Screenshot: <code>{adHocResult.screenshotPath}</code>
            </div>
          </div>
        )}
      </div>

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
