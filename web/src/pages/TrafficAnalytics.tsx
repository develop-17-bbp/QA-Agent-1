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
      <p className="qa-page-desc">Real domain traffic data from Tranco, Cloudflare Radar, and OpenPageRank — with your own crawl metrics layered on top.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Querying real traffic providers…</div>}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

      {data?.dataQuality && !loading && (
        <div className="qa-panel" style={{ padding: 12, marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="qa-kicker">Data sources:</span>
          {(data.dataQuality.providersHit ?? []).map((p: string) => (
            <span key={p} className="qa-lozenge" style={{ background: "#ecfdf5", color: "#047857", fontSize: 11 }}>{p}</span>
          ))}
          {(data.dataQuality.providersFailed ?? []).map((p: string) => (
            <span key={p} className="qa-lozenge" style={{ background: "#fef3c7", color: "#b45309", fontSize: 11 }}>{p} unavailable</span>
          ))}
          {(data.dataQuality.missingFields ?? []).length > 0 && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>• Missing (no free source): {(data.dataQuality.missingFields ?? []).join(", ")}</span>
          )}
        </div>
      )}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div className="qa-kicker">Est. Monthly Traffic</div><div style={{ fontSize: 22, fontWeight: 700 }}>{data.monthlyTrafficEstimate}</div></div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div className="qa-kicker">Pages Crawled</div><div style={{ fontSize: 22, fontWeight: 700 }}>{data.crawlStats?.totalPages ?? 0}</div></div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div className="qa-kicker">Avg Load Time</div><div style={{ fontSize: 22, fontWeight: 700 }}>{data.crawlStats?.avgLoadTime ?? 0}ms</div></div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {(data.trafficTrend ?? []).length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 2, minWidth: 300 }}>
                <div className="qa-panel-title">Traffic Trend</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.trafficTrend}><XAxis dataKey="month" fontSize={12} /><YAxis fontSize={12} /><Tooltip /><Line type="monotone" dataKey="estimated" stroke="#5a67d8" strokeWidth={2} dot={{ r: 4 }} /></LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {sourceData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 240 }}>
                <div className="qa-panel-title">Traffic Sources</div>
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
              <div className="qa-panel-title">Top Landing Pages</div>
              <table className="qa-table">
                <thead><tr>{["URL", "Title", "Organic Potential", "Load Time"].map(h => <th key={h} style={{ textAlign: h === "URL" || h === "Title" ? "left" : "center" }}>{h}</th>)}</tr></thead>
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
              <div className="qa-panel-title">Insights</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{data.insights.map((ins: string, i: number) => <li key={i} style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>{ins}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
