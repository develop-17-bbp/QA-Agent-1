import { useState } from "react";
import { motion } from "framer-motion";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchDomainOverview } from "../api";

export default function DomainOverview() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true); setError("");
    try { setData(await fetchDomainOverview(rid)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Domain Overview</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Comprehensive domain health analysis across SEO, performance, content, technical, and link dimensions.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />
      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}
      {data && !loading && (data.sites ?? []).map((site: any) => {
        const radarData = Object.entries(site.scores).filter(([k]) => k !== "overall").map(([k, v]) => ({ dim: k.charAt(0).toUpperCase() + k.slice(1), score: v as number, fullMark: 100 }));
        return (
          <div key={site.hostname} className="qa-panel" style={{ marginTop: 16, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{site.hostname}</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{site.pageCount} pages crawled | Avg load: {site.avgLoadMs}ms</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 42, fontWeight: 700, color: site.scores.overall >= 70 ? "#38a169" : site.scores.overall >= 50 ? "#dd6b20" : "#e53e3e" }}>{site.scores.overall}</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Overall Score</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div style={{ width: 300, height: 250 }}>
                <ResponsiveContainer>
                  <RadarChart data={radarData}><PolarGrid /><PolarAngleAxis dataKey="dim" fontSize={12} /><PolarRadiusAxis domain={[0, 100]} tick={false} /><Radar dataKey="score" stroke="#5a67d8" fill="#5a67d8" fillOpacity={0.3} /><Tooltip /></RadarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Object.entries(site.scores).map(([k, v]) => (
                  <div key={k} style={{ minWidth: 100, textAlign: "center", padding: 12, background: "var(--bg-app)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "capitalize" }}>{k}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: (v as number) >= 70 ? "#38a169" : (v as number) >= 50 ? "#dd6b20" : "#e53e3e" }}>{v as number}</div>
                  </div>
                ))}
              </div>
            </div>
            {site.issues.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Issues:</div>
                {site.issues.map((issue: string, i: number) => <div key={i} style={{ fontSize: 13, color: "#e53e3e", padding: "2px 0" }}>{issue}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </motion.div>
  );
}
