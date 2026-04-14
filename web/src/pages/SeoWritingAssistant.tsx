import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchSeoWritingAssistant } from "../api";

const SCORE_COLOR = (s: number) => s >= 80 ? "#38a169" : s >= 60 ? "#dd6b20" : "#e53e3e";

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

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">SEO Writing Assistant</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Analyze any crawled page for content quality, SEO optimization, and readability.</p>
      <RunSelector value={runId} onChange={setRunId} label="Select run" />

      <div className="qa-panel" style={{ padding: 16, marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Enter page URL from crawl..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn" onClick={analyze} disabled={loading || !runId || !url.trim()} style={{ padding: "8px 24px" }}>{loading ? "Analyzing..." : "Analyze"}</button>
      </div>

      {error && <div className="qa-panel" style={{ marginTop: 16, color: "#e53e3e", padding: 16 }}>{error}</div>}
      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing content...</div>}

      {data && !loading && (
        <>
          {scores.overall !== undefined && (
            <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
              {Object.entries(scores).map(([key, val]) => (
                <div key={key} className="qa-panel" style={{ flex: 1, minWidth: 100, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", textTransform: "capitalize" }}>{key}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: SCORE_COLOR(val as number) }}>{val as number}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {data.readabilityLevel && <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 130 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Readability</div><div style={{ fontSize: 16, fontWeight: 600 }}>{data.readabilityLevel}</div></div>}
            {data.contentType && <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 130 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Content Type</div><div style={{ fontSize: 16, fontWeight: 600 }}>{data.contentType}</div></div>}
            {data.wordCountEstimate && <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 130 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Est. Word Count</div><div style={{ fontSize: 16, fontWeight: 600 }}>{data.wordCountEstimate}</div></div>}
          </div>

          {(data.keywordsDetected ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Keywords Detected</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {data.keywordsDetected.map((kw: string) => <span key={kw} style={{ padding: "4px 12px", borderRadius: 16, background: "#5a67d820", color: "#5a67d8", fontSize: 12, fontWeight: 500 }}>{kw}</span>)}
              </div>
            </div>
          )}

          {recs.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Recommendations ({recs.length})</div>
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
