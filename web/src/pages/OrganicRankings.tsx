import { useState } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchOrganicRankings } from "../api";

export default function OrganicRankings() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "title">("score");

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true); setError("");
    try { setData(await fetchOrganicRankings(rid)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const rankings = data?.rankings ?? [];
  const sorted = [...rankings].sort((a: any, b: any) => sortBy === "score" ? b.score - a.score : (a.title ?? "").localeCompare(b.title ?? ""));
  const dist = data?.distribution ?? {};
  const distData = [
    { name: "Excellent (80+)", value: dist.excellent ?? 0, fill: "#38a169" },
    { name: "Good (60-79)", value: dist.good ?? 0, fill: "#3182ce" },
    { name: "Average (40-59)", value: dist.average ?? 0, fill: "#dd6b20" },
    { name: "Poor (<40)", value: dist.poor ?? 0, fill: "#e53e3e" },
  ];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">Organic Rankings</h1>
      <p className="qa-page-desc">Pages ranked by organic SEO value score based on on-page signals.</p>
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
          <div className="qa-panel" style={{ marginTop: 16 }}>
            <div className="qa-panel-head">
              <div className="qa-panel-title">Score Distribution</div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={distData}><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Bar dataKey="value" radius={[4,4,0,0]}>{distData.map((d, i) => <Bar key={i} dataKey="value" fill={d.fill} />)}</Bar></BarChart>
            </ResponsiveContainer>
          </div>
          <div className="qa-panel" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="qa-panel-title">Rankings ({sorted.length} pages)</div>
              <select className="qa-select" value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={{ width: 140 }}>
                <option value="score">By Score</option>
                <option value="title">By Title</option>
              </select>
            </div>
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              <table className="qa-table">
                <thead><tr>
                  <th>#</th>
                  <th>URL</th>
                  <th>Title</th>
                  <th style={{ textAlign: "right" }}>Score</th>
                </tr></thead>
                <tbody>{sorted.slice(0, 100).map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={{ color: "var(--text-secondary)" }}>{i + 1}</td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.url}</td>
                    <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</td>
                    <td style={{ textAlign: "right" }}><span style={{ fontWeight: 600, color: r.score >= 80 ? "#38a169" : r.score >= 60 ? "#3182ce" : r.score >= 40 ? "#dd6b20" : "#e53e3e" }}>{r.score}</span></td>
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
