import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchOnPageSeoChecker } from "../api";

const STATUS_COLORS: Record<string, string> = { pass: "#38a169", warning: "#dd6b20", fail: "#e53e3e" };
const STATUS_LABELS: Record<string, string> = { pass: "PASS", warning: "WARN", fail: "FAIL" };

const STATUS_LOZENGE: Record<string, string> = {
  pass: "qa-lozenge qa-lozenge--success",
  warning: "qa-lozenge qa-lozenge--neutral",
  fail: "qa-lozenge qa-lozenge--danger",
};

const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

function ConfidenceDot({ confidence, source, note }: { confidence?: string; source?: string; note?: string }) {
  const c = confidence ?? "low";
  const label = CONFIDENCE_LABELS[c] ?? c;
  const title = `${label} · ${source ?? "unknown"}${note ? ` · ${note}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: CONFIDENCE_COLORS[c] ?? "#9ca3af",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function unwrap(dp: any): any {
  return dp && typeof dp === "object" && "value" in dp ? dp.value : dp;
}

export default function OnPageSeoChecker() {
  const [runId, setRunId] = useState("");
  const [url, setUrl] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openFix, setOpenFix] = useState<number | null>(null);

  const analyze = async () => {
    if (!runId) return;
    setLoading(true); setError(""); setData(null); setOpenFix(null);
    try { setData(await fetchOnPageSeoChecker(runId, url)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const overallScoreMeta = data?.overallScore;
  const overallScore = unwrap(overallScoreMeta) ?? 0;
  const checks: any[] = data?.checks ?? [];
  const dq = data?.dataQuality ?? { realDataFields: [], providersHit: [], providersFailed: [], missingFields: [] };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">On-Page SEO Checker</h1>
      <p className="qa-page-desc">
        Every rule reads directly from <strong>real crawl fields</strong>
        (title, meta description length, h1 count, canonical, lang, load time, body bytes, status).
        The deterministic recommendation is always safe. The LLM only adds an optional one-line
        "AI fix suggestion" on flagged rules — verify before applying.
      </p>
      <RunSelector value={runId} onChange={setRunId} label="Select run" />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input className="qa-input" placeholder="Enter URL to check (or leave empty for first page)" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !runId}>{loading ? "Analyzing..." : "Check"}</button>
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}
      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Checking page against real crawl fields...</div>}

      {data && !loading && (
        <>
          {(dq.realDataFields?.length > 0 || dq.providersHit?.length > 0 || dq.providersFailed?.length > 0) && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="qa-kicker" style={{ fontSize: 11 }}>Data sources:</span>
              {(dq.providersHit ?? []).map((p: string) => (
                <span key={`hit-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(56,161,105,0.15)", color: "#38a169", fontWeight: 600, border: "1px solid rgba(56,161,105,0.3)" }} title="Real provider hit">
                  ● {p}
                </span>
              ))}
              {(dq.providersFailed ?? []).map((p: string) => (
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(229,62,62,0.1)", color: "#e53e3e", fontWeight: 600, border: "1px solid rgba(229,62,62,0.3)" }} title="Provider failed">
                  ✕ {p}
                </span>
              ))}
              {(dq.realDataFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Crawl fields used: ${dq.realDataFields.join(", ")}`}>
                  {dq.realDataFields.length} crawl fields checked
                </span>
              )}
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ textAlign: "center", minWidth: 140, padding: 16 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>Overall Score</div>
              <div style={{ fontSize: 48, fontWeight: 700, color: overallScore >= 80 ? "#38a169" : overallScore >= 60 ? "#dd6b20" : "#e53e3e" }}>
                {overallScore}
                <ConfidenceDot confidence={overallScoreMeta?.confidence} source={overallScoreMeta?.source} note={overallScoreMeta?.note} />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>/100</div>
            </div>
            <div className="qa-panel" style={{ flex: 1, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>URL: <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>{data.url}</span></div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {checks.filter((c: any) => c.status === "pass").length > 0 && <span style={{ fontSize: 13, color: "#38a169" }}>{checks.filter((c: any) => c.status === "pass").length} passed</span>}
                {checks.filter((c: any) => c.status === "warning").length > 0 && <span style={{ fontSize: 13, color: "#dd6b20" }}>{checks.filter((c: any) => c.status === "warning").length} warnings</span>}
                {checks.filter((c: any) => c.status === "fail").length > 0 && <span style={{ fontSize: 13, color: "#e53e3e" }}>{checks.filter((c: any) => c.status === "fail").length} failed</span>}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, marginTop: 16 }}>
            {checks.map((check: any, i: number) => {
              const scoreMeta = check.score;
              const scoreVal = unwrap(scoreMeta);
              const isOpen = openFix === i;
              const srcTitle = `Crawl fields: ${(check.sourcedFields ?? []).join(", ")}`;
              return (
                <div key={i} className="qa-panel" style={{ padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }} title={srcTitle}>{check.element}</span>
                    <span className={STATUS_LOZENGE[check.status] ?? "qa-lozenge qa-lozenge--neutral"}>{STATUS_LABELS[check.status]}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLORS[check.status] }}>
                    {scoreVal}/100
                    <ConfidenceDot confidence={scoreMeta?.confidence} source={scoreMeta?.source} note={scoreMeta?.note} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{check.value}</div>
                  <div style={{ fontSize: 12, marginTop: 6, color: "var(--text-primary)", lineHeight: 1.4 }}>{check.recommendation}</div>
                  {check.fixSuggestion && (
                    <>
                      <button
                        onClick={() => setOpenFix(isOpen ? null : i)}
                        style={{ marginTop: 8, fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", color: "var(--text-secondary)", whiteSpace: "nowrap" }}
                      >
                        {isOpen ? "Hide AI fix" : "Show AI fix"}
                      </button>
                      {isOpen && (
                        <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(90,103,216,0.08)", borderRadius: 6, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          <strong style={{ color: "#111111" }}>AI suggestion — verify before applying:</strong> {check.fixSuggestion}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </motion.div>
  );
}
