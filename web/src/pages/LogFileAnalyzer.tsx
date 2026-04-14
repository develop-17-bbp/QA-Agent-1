import { useState } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { fetchLogAnalysis } from "../api";

export default function LogFileAnalyzer() {
  const [logContent, setLogContent] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (!logContent.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchLogAnalysis(logContent)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setLogContent(text);
  };

  const statusData = data?.statusDistribution ? Object.entries(data.statusDistribution).map(([code, count]) => {
    const c = parseInt(code);
    const color = c < 300 ? "#38a169" : c < 400 ? "#d69e2e" : c < 500 ? "#dd6b20" : "#e53e3e";
    return { name: code, value: count as number, color };
  }).filter(d => d.value > 0) : [];

  const botData = data?.botTraffic ? Object.entries(data.botTraffic).map(([bot, hits]) => ({ bot, hits: hits as number })).sort((a, b) => b.hits - a.hits) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Log File Analyzer</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Upload or paste server log files to analyze traffic patterns, bot activity, and SEO insights.</p>

      <div className="qa-panel" style={{ padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Upload log file: <input type="file" accept=".log,.txt,.gz" onChange={handleFile} style={{ marginLeft: 8 }} />
          </label>
        </div>
        <textarea className="qa-input" value={logContent} onChange={e => setLogContent(e.target.value)} placeholder="Or paste log content here (Apache/Nginx combined format)..." style={{ width: "100%", padding: "8px 12px", minHeight: 120, resize: "vertical", fontFamily: "monospace", fontSize: 11 }} />
        <button className="qa-btn" onClick={analyze} disabled={loading || !logContent.trim()} style={{ marginTop: 8, padding: "8px 24px" }}>{loading ? "Analyzing..." : "Analyze Logs"}</button>
      </div>

      {error && <div className="qa-panel" style={{ marginTop: 16, color: "#e53e3e", padding: 16 }}>{error}</div>}
      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing log file...</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Total Requests", val: data.totalRequests }, { label: "Unique URLs", val: data.summary?.uniqueUrls ?? 0 }, { label: "Error Rate", val: `${data.summary?.errorRate ?? 0}%`, color: (data.summary?.errorRate ?? 0) > 5 ? "#e53e3e" : "#38a169" }, { label: "Bot Traffic", val: `${data.summary?.botPercent ?? 0}%` }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {statusData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Status Codes</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={statusData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {botData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Bot Traffic</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={botData.slice(0, 8)} layout="vertical"><XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="bot" width={120} fontSize={11} /><Tooltip /><Bar dataKey="hits" fill="#5a67d8" radius={[0,4,4,0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {(data.urlHits ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Top URLs</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["URL", "Hits"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: h === "URL" ? "left" : "center", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                <tbody>{data.urlHits.map((u: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: "monospace" }}>{u.url}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 600 }}>{u.hits}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {(data.seoInsights ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>SEO Insights</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{data.seoInsights.map((ins: string, i: number) => <li key={i} style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>{ins}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
