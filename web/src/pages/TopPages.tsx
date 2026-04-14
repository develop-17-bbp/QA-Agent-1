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
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Top Pages</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Pages ranked by composite SEO + performance score.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />
      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}
      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[{ label: "Total Pages", val: summary.totalPages ?? 0 }, { label: "Avg Score", val: summary.avgScore ?? 0 }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{s.val}</div>
              </div>
            ))}
          </div>
          <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Pages by Score</div>
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: 8 }}>#</th>
                  <th style={{ textAlign: "left", padding: 8 }}>URL</th>
                  <th style={{ textAlign: "left", padding: 8 }}>Title</th>
                  <th style={{ textAlign: "right", padding: 8 }}>Score</th>
                  <th style={{ textAlign: "right", padding: 8 }}>Load</th>
                </tr></thead>
                <tbody>{pages.slice(0, 100).map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: 8, color: "var(--text-secondary)" }}>{i + 1}</td>
                    <td style={{ padding: 8, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.url}</td>
                    <td style={{ padding: 8, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || "—"}</td>
                    <td style={{ padding: 8, textAlign: "right", fontWeight: 600, color: p.score >= 80 ? "#38a169" : p.score >= 60 ? "#dd6b20" : "#e53e3e" }}>{p.score}</td>
                    <td style={{ padding: 8, textAlign: "right", color: "var(--text-secondary)" }}>{(p.loadMs / 1000).toFixed(1)}s</td>
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
