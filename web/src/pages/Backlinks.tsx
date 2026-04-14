import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchBacklinks } from "../api";

export default function Backlinks() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchBacklinks(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const healthData = data?.healthDistribution ? [
    { name: "Healthy", value: data.healthDistribution.healthy, color: "#38a169" },
    { name: "Broken", value: data.healthDistribution.broken, color: "#e53e3e" },
    { name: "Redirected", value: data.healthDistribution.redirected, color: "#dd6b20" },
  ].filter(d => d.value > 0) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Backlinks</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Analyze your internal and external link structure from crawl data.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing backlinks...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Total Links", val: data.totalLinks }, { label: "Internal", val: data.internalLinks }, { label: "External", val: data.externalLinks }, { label: "Orphan Pages", val: data.summary?.orphanPageCount ?? 0, color: "#e53e3e" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {healthData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Link Health</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={healthData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {healthData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {(data.topLinked ?? []).length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Most Linked Pages</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={(data.topLinked ?? []).slice(0, 10)} layout="vertical"><XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="url" width={180} fontSize={10} tickFormatter={(v: string) => v.length > 30 ? v.slice(0, 27) + "..." : v} /><Tooltip /><Bar dataKey="inboundLinks" fill="#5a67d8" radius={[0,4,4,0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {(data.orphanPages ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "#e53e3e" }}>Orphan Pages ({data.orphanPages.length})</div>
              {data.orphanPages.slice(0, 15).map((p: any) => <div key={p.url} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--border)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || p.url}</div>)}
            </div>
          )}

          {(data.brokenLinks ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "#e53e3e" }}>Broken Links ({data.brokenLinks.length})</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Source", "Target", "Status", "Error"].map(h => <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                <tbody>{(data.brokenLinks ?? []).slice(0, 20).map((bl: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bl.source}>{bl.source}</td>
                    <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bl.target}>{bl.target}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#e53e3e" }}>{bl.status}</td>
                    <td style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-secondary)" }}>{bl.error}</td>
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
