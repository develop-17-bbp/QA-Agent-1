import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchReferringDomains } from "../api";

const AUTH_COLORS = { high: "#38a169", medium: "#dd6b20", low: "#e53e3e" };

export default function ReferringDomains() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchReferringDomains(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const authData = data?.authorityDistribution ? [
    { name: "High (80+)", value: data.authorityDistribution.high, color: AUTH_COLORS.high },
    { name: "Medium (50-79)", value: data.authorityDistribution.medium, color: AUTH_COLORS.medium },
    { name: "Low (<50)", value: data.authorityDistribution.low, color: AUTH_COLORS.low },
  ].filter(d => d.value > 0) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Referring Domains</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Analyze external domains linking to your sites.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing domains...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Total Domains</div><div style={{ fontSize: 24, fontWeight: 700 }}>{data.totalDomains}</div></div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Avg Trust Score</div><div style={{ fontSize: 24, fontWeight: 700, color: (data.summary?.avgTrustScore ?? 0) >= 70 ? "#38a169" : "#dd6b20" }}>{data.summary?.avgTrustScore ?? 0}</div></div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {authData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Authority Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={authData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {authData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", fontSize: 11 }}>
                  {authData.map(d => <span key={d.name} style={{ color: d.color }}>{d.name}: {d.value}</span>)}
                </div>
              </div>
            )}
          </div>

          <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Referring Domains ({(data.sections ?? []).length})</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Domain", "Total Links", "Healthy", "Broken", "Trust Score"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: h === "Domain" ? "left" : "center", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
              <tbody>{(data.sections ?? []).map((s: any) => (
                <tr key={s.domain} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{s.domain}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13 }}>{s.totalLinks}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, color: "#38a169" }}>{s.healthyLinks}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, color: "#e53e3e" }}>{s.brokenLinks}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, color: s.trustScore >= 80 ? "#38a169" : s.trustScore >= 50 ? "#dd6b20" : "#e53e3e" }}>{s.trustScore}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </motion.div>
  );
}
