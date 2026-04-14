import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchBacklinkAudit } from "../api";

const HEALTH_COLORS: Record<string, string> = { broken: "#e53e3e", "server-error": "#9b2c2c", "client-error": "#dd6b20", redirect: "#d69e2e" };

export default function BacklinkAudit() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchBacklinkAudit(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const statusData = data?.statusDistribution ? [
    { name: "2xx (OK)", value: data.statusDistribution["2xx"] ?? 0, color: "#38a169" },
    { name: "3xx (Redirect)", value: data.statusDistribution["3xx"] ?? 0, color: "#d69e2e" },
    { name: "4xx (Client Error)", value: data.statusDistribution["4xx"] ?? 0, color: "#dd6b20" },
    { name: "5xx (Server Error)", value: data.statusDistribution["5xx"] ?? 0, color: "#e53e3e" },
  ].filter(d => d.value > 0) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Backlink Audit</h1>
      <p className="qa-page-desc">Audit your link profile health and identify toxic or broken links.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Auditing backlinks...</div>}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Overall Score", val: data.overallScore, color: data.overallScore >= 80 ? "#38a169" : data.overallScore >= 60 ? "#dd6b20" : "#e53e3e" }, { label: "Total Checked", val: data.summary?.totalChecked ?? 0 }, { label: "Healthy", val: data.healthy, color: "#38a169" }, { label: "Broken", val: data.broken, color: "#e53e3e" }, { label: "Toxic %", val: `${data.toxicPercent}%`, color: data.toxicPercent > 10 ? "#e53e3e" : "#dd6b20" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 110, padding: 16, textAlign: "center" }}>
                <div className="qa-kicker">{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          {statusData.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div className="qa-panel-title">Status Distribution</div>
                <ResponsiveContainer width={240} height={200}>
                  <PieChart><Pie data={statusData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {statusData.map(d => <span key={d.name} style={{ fontSize: 12, color: d.color, fontWeight: 500 }}>{d.name}: {d.value}</span>)}
              </div>
            </div>
          )}

          {(data.links ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
              <div className="qa-panel-title">Issues Found ({data.links.length})</div>
              <table className="qa-table">
                <thead><tr>{["URL", "Status", "Health", "Reason"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{data.links.map((l: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.url}>{l.url}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>{l.status}</td>
                    <td style={{ padding: "4px 10px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (HEALTH_COLORS[l.health] ?? "#888") + "20", color: HEALTH_COLORS[l.health] ?? "#888", fontWeight: 600 }}>{l.health}</span></td>
                    <td style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-secondary)" }}>{l.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
