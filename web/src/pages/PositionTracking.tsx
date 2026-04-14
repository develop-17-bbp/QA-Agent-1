import { useState } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchPositionTracking } from "../api";

const COLORS = ["#38a169", "#5a67d8", "#dd6b20", "#e53e3e"];

export default function PositionTracking() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchPositionTracking(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const distData = data?.distribution ? [
    { name: "Excellent (80+)", value: data.distribution.excellent, color: COLORS[0] },
    { name: "Good (60-79)", value: data.distribution.good, color: COLORS[1] },
    { name: "Needs Work (40-59)", value: data.distribution.needsWork, color: COLORS[2] },
    { name: "Poor (<40)", value: data.distribution.poor, color: COLORS[3] },
  ].filter(d => d.value > 0) : [];

  const hostData = data?.hostStats ?? [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Position Tracking</h1>
      <p className="qa-page-desc">Track keyword SEO optimization scores across your crawled pages.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Analyzing positions...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Total Keywords", val: data.summary?.totalKeywords ?? 0 }, { label: "Avg SEO Score", val: data.summary?.avgSeoScore ?? 0, color: (data.summary?.avgSeoScore ?? 0) >= 70 ? "#38a169" : "#dd6b20" }, { label: "Top Performers", val: data.summary?.topPerformers ?? 0, color: "#38a169" }, { label: "Needs Improvement", val: data.summary?.needsImprovement ?? 0, color: "#e53e3e" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {distData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 280 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Score Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={distData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {distData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", fontSize: 11 }}>
                  {distData.map(d => <span key={d.name} style={{ color: d.color }}>{d.name}: {d.value}</span>)}
                </div>
              </div>
            )}
            {hostData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Average Score by Host</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hostData}><XAxis dataKey="hostname" fontSize={11} /><YAxis domain={[0, 100]} fontSize={11} /><Tooltip /><Bar dataKey="avgScore" fill="#5a67d8" radius={[4,4,0,0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Keyword Positions ({(data.keywords ?? []).length})</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                {["Keyword", "URL", "SEO Score", "Title", "Meta", "H1", "Canonical", "Load Time"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: h === "Keyword" || h === "URL" ? "left" : "center", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(data.keywords ?? []).map((kw: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{kw.keyword}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={kw.url}>{kw.url}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, color: kw.seoScore >= 80 ? "#38a169" : kw.seoScore >= 60 ? "#dd6b20" : "#e53e3e" }}>{kw.seoScore}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.titlePresent ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.metaPresent ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.h1Present ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.canonicalSet ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: "var(--text-secondary)" }}>{kw.loadTimeMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </motion.div>
  );
}
