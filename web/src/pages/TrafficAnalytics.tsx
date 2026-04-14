import { useState } from "react";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchTrafficAnalytics } from "../api";

const SOURCE_COLORS: Record<string, string> = { organic: "#38a169", direct: "#5a67d8", referral: "#dd6b20", social: "#d53f8c", paid: "#e53e3e" };

export default function TrafficAnalytics() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchTrafficAnalytics(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const sourceData = data?.trafficSources ? Object.entries(data.trafficSources).map(([key, val]) => ({ name: key, value: val as number, color: SOURCE_COLORS[key] ?? "#888" })).filter(d => d.value > 0) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Traffic Analytics</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>AI-estimated traffic analysis based on crawl data signals and site structure.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing traffic...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Est. Monthly Traffic</div><div style={{ fontSize: 22, fontWeight: 700 }}>{data.monthlyTrafficEstimate}</div></div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Pages Crawled</div><div style={{ fontSize: 22, fontWeight: 700 }}>{data.crawlStats?.totalPages ?? 0}</div></div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Avg Load Time</div><div style={{ fontSize: 22, fontWeight: 700 }}>{data.crawlStats?.avgLoadTime ?? 0}ms</div></div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {(data.trafficTrend ?? []).length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 2, minWidth: 300 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Traffic Trend</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.trafficTrend}><XAxis dataKey="month" fontSize={12} /><YAxis fontSize={12} /><Tooltip /><Line type="monotone" dataKey="estimated" stroke="#5a67d8" strokeWidth={2} dot={{ r: 4 }} /></LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {sourceData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Traffic Sources</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={sourceData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {sourceData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", fontSize: 11 }}>
                  {sourceData.map(d => <span key={d.name} style={{ color: d.color, textTransform: "capitalize" }}>{d.name}: {d.value}%</span>)}
                </div>
              </div>
            )}
          </div>

          {(data.topLandingPages ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Top Landing Pages</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["URL", "Title", "Organic Potential", "Load Time"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: h === "URL" || h === "Title" ? "left" : "center", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                <tbody>{data.topLandingPages.map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>{p.url}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{p.title}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, color: p.organicPotential >= 70 ? "#38a169" : "#dd6b20" }}>{p.organicPotential}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: "var(--text-secondary)" }}>{p.loadTimeMs}ms</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {(data.insights ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Insights</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{data.insights.map((ins: string, i: number) => <li key={i} style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>{ins}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
