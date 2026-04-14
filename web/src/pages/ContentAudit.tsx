import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchContentAudit } from "../api";

const CLASS_COLORS: Record<string, string> = { good: "#38a169", "needs-improvement": "#dd6b20", poor: "#e53e3e" };

export default function ContentAudit() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchContentAudit(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const pages = data?.pages ?? [];
  const filtered = filter === "all" ? pages : pages.filter((p: any) => p.classification === filter);

  const qualityData = data?.summary ? [
    { name: "Good", value: data.summary.good, color: CLASS_COLORS.good },
    { name: "Needs Work", value: data.summary.needsImprovement, color: CLASS_COLORS["needs-improvement"] },
    { name: "Poor", value: data.summary.poor, color: CLASS_COLORS.poor },
  ].filter(d => d.value > 0) : [];

  const issueData = (data?.issueBreakdown ?? []).slice(0, 8);

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Content Audit</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Evaluate content quality across all crawled pages with AI-powered recommendations.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Auditing content...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Total Pages", val: data.summary?.totalPages ?? 0 }, { label: "Avg Score", val: data.summary?.avgScore ?? 0, color: (data.summary?.avgScore ?? 0) >= 70 ? "#38a169" : "#dd6b20" }, { label: "Good", val: data.summary?.good ?? 0, color: "#38a169" }, { label: "Poor", val: data.summary?.poor ?? 0, color: "#e53e3e" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {qualityData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Quality Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={qualityData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {qualityData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {issueData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Top Issues</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={issueData} layout="vertical"><XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="issue" width={150} fontSize={10} /><Tooltip /><Bar dataKey="count" fill="#e53e3e" radius={[0,4,4,0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {(data.recommendations ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>AI Recommendations</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{data.recommendations.map((r: string, i: number) => <li key={i} style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>{r}</li>)}</ul>
            </div>
          )}

          <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Pages ({filtered.length})</div>
              <select className="qa-select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 160 }}>
                <option value="all">All</option>
                <option value="good">Good</option>
                <option value="needs-improvement">Needs Work</option>
                <option value="poor">Poor</option>
              </select>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["URL", "Quality", "Score", "Issues"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: h === "URL" || h === "Issues" ? "left" : "center", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
              <tbody>{filtered.slice(0, 30).map((p: any, i: number) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 10px", fontSize: 12, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>{p.title || p.url}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (CLASS_COLORS[p.classification] ?? "#888") + "20", color: CLASS_COLORS[p.classification] ?? "#888", fontWeight: 600 }}>{p.classification}</span></td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, color: p.qualityScore >= 70 ? "#38a169" : p.qualityScore >= 50 ? "#dd6b20" : "#e53e3e" }}>{p.qualityScore}</td>
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-secondary)" }}>{(p.issues ?? []).join(", ")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </motion.div>
  );
}
