import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchBrandMonitoring } from "../api";

const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

const SOURCE_COLORS: Record<string, string> = {
  "crawl": "#38a169",
  "duckduckgo-serp": "#111111",
  "common-crawl": "#9f7aea",
  "urlscan": "#ed8936",
};

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

export default function BrandMonitoring() {
  const [runId, setRunId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (!runId || !brandName.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchBrandMonitoring(brandName.trim(), runId)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const dq = data?.dataQuality ?? { providersHit: [], providersFailed: [], missingFields: [] };
  const mentions: any[] = data?.mentions ?? [];

  const counts = [
    { key: "crawlMentions", label: "Crawl" },
    { key: "webMentions", label: "DDG SERP" },
    { key: "commonCrawlHits", label: "Common Crawl" },
    { key: "urlscanHits", label: "URLScan" },
    { key: "totalUniqueMentions", label: "Total unique" },
  ];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Brand Monitoring</h1>
      <p className="qa-page-desc">
        Mentions come from <strong>real sources only</strong>: your run's crawl pages, DuckDuckGo SERP,
        Common Crawl CDX index, and URLScan. No sentiment scores, visibility percentages, or "brand
        strength" metrics — those were LLM fabrications. The LLM is restricted to a 2-sentence qualitative
        summary of the real findings.
      </p>

      <RunSelector value={runId} onChange={setRunId} label="Select run" />
      <div className="qa-panel" style={{ padding: 16, marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={brandName} onChange={e => setBrandName(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Enter brand name or domain..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !runId || !brandName.trim()}>{loading ? "Analyzing..." : "Monitor Brand"}</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
        Tip: enter a domain form (e.g. <code>acme.com</code>) to enable Common Crawl + URLScan lookups.
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}
      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Monitoring brand across real providers...</div>}

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
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(229,62,62,0.1)", color: "#e53e3e", fontWeight: 600, border: "1px solid rgba(229,62,62,0.3)" }} title="Provider failed or unavailable">
                  ✕ {p}
                </span>
              ))}
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
              {data.meta?.urlscanConfigured === false && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }}>
                  URLScan key unset — falls back to anonymous (medium confidence)
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {counts.map(({ key, label }) => {
              const meta = data[key];
              const val = unwrap(meta);
              return (
                <div key={key} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                  <div className="qa-kicker">{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>
                    {val ?? 0}
                    <ConfidenceDot confidence={meta?.confidence} source={meta?.source} note={meta?.note} />
                  </div>
                </div>
              );
            })}
          </div>

          {data.summary && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Qualitative Summary</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                AI-generated ≤2-sentence interpretation of the real findings. No numeric claims.
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>{data.summary}</div>
            </div>
          )}

          {mentions.length > 0 ? (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Mentions ({mentions.length})</div>
              <div style={{ overflowX: "auto" }}>
                <table className="qa-table">
                  <thead><tr><th>Source</th><th>Title / URL</th><th>Snippet</th><th>Time</th></tr></thead>
                  <tbody>
                    {mentions.map((m: any, i: number) => (
                      <tr key={i}>
                        <td>
                          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: (SOURCE_COLORS[m.source] ?? "#888") + "20", color: SOURCE_COLORS[m.source] ?? "#888", fontWeight: 600, whiteSpace: "nowrap" }}>{m.source}</span>
                        </td>
                        <td style={{ maxWidth: 300 }}>
                          {m.title && <div style={{ fontSize: 13, fontWeight: 500 }}>{m.title}</div>}
                          <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#111111", wordBreak: "break-all" }}>{m.url}</a>
                        </td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)", maxWidth: 300 }}>{m.snippet ?? "—"}</td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{m.time ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, textAlign: "center", color: "var(--text-secondary)" }}>
              <div style={{ fontSize: 13 }}>No mentions found in any real source.</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Try a broader brand spelling, or enter a domain form for Common Crawl + URLScan lookups.</div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
