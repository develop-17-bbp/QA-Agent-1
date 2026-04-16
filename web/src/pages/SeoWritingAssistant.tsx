import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchSeoWritingAssistant } from "../api";

const SCORE_COLOR = (s: number) => s >= 80 ? "#38a169" : s >= 60 ? "#dd6b20" : "#e53e3e";
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
        marginLeft: 8,
        verticalAlign: "middle",
      }}
    />
  );
}

function unwrap(dp: any): any {
  return dp && typeof dp === "object" && "value" in dp ? dp.value : dp;
}

export default function SeoWritingAssistant() {
  const [runId, setRunId] = useState("");
  const [url, setUrl] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (!runId || !url.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchSeoWritingAssistant(runId, url.trim())); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const scores = data?.scores ?? {};
  const recs = data?.recommendations ?? [];
  const dq = data?.dataQuality ?? { providersHit: [], providersFailed: [], missingFields: [] };
  const wordCount = unwrap(data?.wordCountEstimate);
  const wordCountMeta = data?.wordCountEstimate;
  const keywords: string[] = unwrap(data?.keywordsDetected) ?? [];
  const keywordsMeta = data?.keywordsDetected;

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">SEO Writing Assistant</h1>
      <p className="qa-page-desc">
        Deterministic scoring from real crawl fields (title/meta length, H1 count, canonical, lang, status, load time, body size).
        LLM is restricted to 1-sentence &quot;why this matters&quot; commentary per failed rule — it never invents scores.
      </p>
      <RunSelector value={runId} onChange={setRunId} label="Select run" />

      <div className="qa-panel" style={{ padding: 16, marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Enter page URL from crawl..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !runId || !url.trim()}>{loading ? "Analyzing..." : "Analyze"}</button>
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}
      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Analyzing content...</div>}

      {data && !loading && (
        <>
          {(dq.providersHit?.length > 0 || dq.providersFailed?.length > 0 || dq.missingFields?.length > 0) && (
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
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
            </div>
          )}

          {Object.keys(scores).length > 0 && (
            <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
              {Object.entries(scores).map(([key, val]: [string, any]) => {
                const numeric = unwrap(val);
                return (
                  <div key={key} className="qa-panel" style={{ flex: 1, minWidth: 100, padding: 16, textAlign: "center" }}>
                    <div className="qa-kicker" style={{ textTransform: "capitalize" }}>{key}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: SCORE_COLOR(numeric) }}>
                      {numeric}
                      <ConfidenceDot confidence={val?.confidence} source={val?.source} note={val?.note} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {data.readabilityLevel && <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 130 }}><div className="qa-kicker">Readability</div><div style={{ fontSize: 16, fontWeight: 600 }}>{data.readabilityLevel}</div></div>}
            {data.contentType && <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 130 }}><div className="qa-kicker">Content Type</div><div style={{ fontSize: 16, fontWeight: 600 }}>{data.contentType}</div></div>}
            {wordCount !== undefined && (
              <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 130 }}>
                <div className="qa-kicker">Est. Word Count</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {wordCount}
                  <ConfidenceDot confidence={wordCountMeta?.confidence} source={wordCountMeta?.source} note={wordCountMeta?.note} />
                </div>
              </div>
            )}
          </div>

          {keywords.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">
                Keywords Detected
                <ConfidenceDot confidence={keywordsMeta?.confidence} source={keywordsMeta?.source} note={keywordsMeta?.note} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {keywords.map((kw: string) => <span key={kw} style={{ padding: "4px 12px", borderRadius: 16, background: "#11111120", color: "#111111", fontSize: 12, fontWeight: 500 }}>{kw}</span>)}
              </div>
            </div>
          )}

          {recs.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Recommendations ({recs.length})</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                AI suggestion text — verify before applying. Rule evaluations are deterministic from crawl fields.
              </div>
              {recs.map((r: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: r.priority === "High" ? "#e53e3e20" : "#dd6b2020", color: r.priority === "High" ? "#e53e3e" : "#dd6b20", fontWeight: 600 }}>{r.priority}</span>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>{r.category}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>{r.issue}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{r.suggestion}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
