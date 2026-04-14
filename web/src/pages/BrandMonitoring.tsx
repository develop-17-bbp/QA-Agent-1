import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchBrandMonitoring } from "../api";

const SENT_COLORS = { positive: "#38a169", neutral: "#5a67d8", negative: "#e53e3e" };

export default function BrandMonitoring() {
  const [runId, setRunId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (!runId || !brandName.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchBrandMonitoring(brandName.trim(), runId)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const sentData = data?.sentimentBreakdown ? Object.entries(data.sentimentBreakdown).map(([key, val]) => ({ name: key, value: val as number, color: SENT_COLORS[key as keyof typeof SENT_COLORS] ?? "#888" })).filter(d => d.value > 0) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Brand Monitoring</h1>
      <p className="qa-page-desc">Monitor brand presence, sentiment, and visibility across crawled pages using AI analysis.</p>

      <RunSelector value={runId} onChange={setRunId} label="Select run" />
      <div className="qa-panel" style={{ padding: 16, marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={brandName} onChange={e => setBrandName(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Enter brand name..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !runId || !brandName.trim()}>{loading ? "Analyzing..." : "Monitor Brand"}</button>
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}
      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Monitoring brand presence...</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Visibility Score", val: data.visibilityScore, color: data.visibilityScore >= 70 ? "#38a169" : "#dd6b20" }, { label: "Mentions", val: data.mentionCount }, { label: "Title Mentions", val: data.titleMentions }, { label: "URL Mentions", val: data.urlMentions }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div className="qa-kicker">{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {sentData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div className="qa-panel-title">Sentiment</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={sentData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {sentData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", fontSize: 11 }}>
                  {sentData.map(d => <span key={d.name} style={{ color: d.color, textTransform: "capitalize" }}>{d.name}: {d.value}%</span>)}
                </div>
              </div>
            )}

            {data.brandStrength && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div className="qa-panel-title">Brand Strength</div>
                {Object.entries(data.brandStrength).map(([key, val]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, width: 90, textTransform: "capitalize", color: "var(--text-secondary)" }}>{key}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--border)" }}>
                      <div style={{ height: 8, borderRadius: 4, width: `${val as number}%`, background: (val as number) >= 70 ? "#38a169" : (val as number) >= 50 ? "#dd6b20" : "#e53e3e" }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, width: 30 }}>{val as number}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(data.recommendations ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Recommendations</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{data.recommendations.map((r: string, i: number) => <li key={i} style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>{r}</li>)}</ul>
            </div>
          )}

          {(data.alerts ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, borderLeft: "3px solid #e53e3e" }}>
              <div className="qa-panel-title" style={{ color: "#e53e3e" }}>Alerts</div>
              {data.alerts.map((a: string, i: number) => <div key={i} style={{ fontSize: 13, padding: "4px 0", color: "var(--text-secondary)" }}>{a}</div>)}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
