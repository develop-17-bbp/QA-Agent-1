import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchPostTracking } from "../api";

export default function PostTracking() {
  const [runId, setRunId] = useState("");
  const [baselineRunId, setBaselineRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const track = async () => {
    if (!runId) return;
    setLoading(true); setError("");
    try { setData(await fetchPostTracking(runId, baselineRunId || undefined)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const changes = data?.changes ?? [];
  const trends = data?.trends ?? {};

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Post Tracking</h1>
      <p className="qa-page-desc">Track content changes and performance across crawl runs. Compare current vs. baseline to detect modifications.</p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}><RunSelector value={runId} onChange={setRunId} label="Current run" /></div>
        <div style={{ flex: 1, minWidth: 200 }}><RunSelector value={baselineRunId} onChange={setBaselineRunId} label="Baseline (optional)" /></div>
        <button className="qa-btn-primary" onClick={track} disabled={loading || !runId} style={{ alignSelf: "flex-end" }}>{loading ? "Tracking..." : "Track Changes"}</button>
      </div>

      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 16 }}>{error}</div>}
      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Tracking posts...</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Total Pages", val: (data.posts ?? []).length }, { label: "New Pages", val: trends.newPages ?? 0, color: "#38a169" }, { label: "Removed", val: trends.removedPages ?? 0, color: "#e53e3e" }, { label: "Modified", val: trends.modifiedPages ?? 0, color: "#dd6b20" }, { label: "Avg Performance", val: trends.avgPerformance ?? 0, color: (trends.avgPerformance ?? 0) >= 70 ? "#38a169" : "#dd6b20" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 110, padding: 16, textAlign: "center" }}>
                <div className="qa-kicker">{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          {!trends.hasBaseline && (
            <div className="qa-empty" style={{ marginTop: 16 }}>No baseline run selected. Select a baseline to see content changes between runs.</div>
          )}

          {changes.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
              <div className="qa-panel-title">Content Changes ({changes.length})</div>
              <table className="qa-table">
                <thead><tr>{["URL", "Status", "Change Type", "Performance"].map(h => <th key={h} style={{ textAlign: h === "URL" ? "left" : "center" }}>{h}</th>)}</tr></thead>
                <tbody>{changes.map((p: any, i: number) => {
                  const changeType = p.changes.isNew ? "New" : p.changes.isRemoved ? "Removed" : p.changes.titleChanged ? "Title Changed" : "Content Modified";
                  const changeColor = p.changes.isNew ? "#38a169" : p.changes.isRemoved ? "#e53e3e" : "#dd6b20";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 10px", fontSize: 12, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>{p.title || p.url}</td>
                      <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12 }}>{p.status}</td>
                      <td style={{ padding: "6px 10px", textAlign: "center" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: changeColor + "20", color: changeColor, fontWeight: 600 }}>{changeType}</span></td>
                      <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, color: p.performanceScore >= 70 ? "#38a169" : p.performanceScore >= 50 ? "#dd6b20" : "#e53e3e" }}>{p.performanceScore}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
