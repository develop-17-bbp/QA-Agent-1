import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchTopPages } from "../api";

export default function TopPages() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true); setError("");
    try { setData(await fetchTopPages(rid)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const summary = data?.summary ?? {};
  const pages = data?.pages ?? [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">Top Pages</h1>
      <p className="qa-page-desc">Pages ranked by composite SEO + performance score.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />
      {loading && (
        <div className="qa-panel qa-loading-panel" style={{ marginTop: 20 }}>
          <span className="qa-spinner" />
          <span>Analyzing...</span>
        </div>
      )}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}
      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[{ label: "Total Pages", val: summary.totalPages ?? 0 }, { label: "Avg Score", val: summary.avgScore ?? 0 }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{s.val}</div>
              </div>
            ))}
          </div>
          <div className="qa-panel" style={{ marginTop: 16 }}>
            <div className="qa-panel-head">
              <div className="qa-panel-title">Pages by Score</div>
            </div>
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              <table className="qa-table">
                <thead><tr>
                  <th>#</th>
                  <th>URL</th>
                  <th>Title</th>
                  <th style={{ textAlign: "right" }}>Score</th>
                  <th style={{ textAlign: "right" }}>Load</th>
                </tr></thead>
                <tbody>{pages.slice(0, 100).map((p: any, i: number) => (
                  <tr key={i}>
                    <td style={{ color: "var(--text-secondary)" }}>{i + 1}</td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.url}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: p.score >= 80 ? "#38a169" : p.score >= 60 ? "#dd6b20" : "#e53e3e" }}>{p.score}</td>
                    <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{(p.loadMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
