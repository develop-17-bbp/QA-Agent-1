import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchSiteAudit } from "../api";

const SEV_COLORS = { critical: "#e53e3e", warning: "#dd6b20", info: "#3182ce" };
const CAT_LABELS: Record<string, string> = { seo: "SEO", technical: "Technical", performance: "Performance", content: "Content", links: "Links" };

const SEV_LOZENGE: Record<string, string> = {
  critical: "qa-lozenge qa-lozenge--danger",
  warning: "qa-lozenge qa-lozenge--neutral",
  info: "qa-lozenge qa-lozenge--neutral",
};

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 80 ? "#38a169" : score >= 60 ? "#dd6b20" : "#e53e3e";
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={10} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={10} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" fontSize={size*0.3} fontWeight={700} fill="var(--text-primary)">{score}</text>
    </svg>
  );
}

export default function SiteAudit() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true); setError("");
    try { setData(await fetchSiteAudit(rid)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const issues = data?.issues ?? [];
  const filtered = severityFilter === "all" ? issues : issues.filter((i: any) => i.severity === severityFilter);

  const pieData = [
    { name: "Critical", value: data?.summary?.criticalIssues ?? 0, color: SEV_COLORS.critical },
    { name: "Warning", value: data?.summary?.warnings ?? 0, color: SEV_COLORS.warning },
    { name: "Info", value: data?.summary?.info ?? 0, color: SEV_COLORS.info },
  ].filter(d => d.value > 0);

  const catData = data?.categories ? Object.entries(data.categories).map(([k, v]: [string, any]) => ({ name: CAT_LABELS[k] ?? k, score: v.score })) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">Site Audit</h1>
      <p className="qa-page-desc">Comprehensive technical SEO and health analysis of your crawled site.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && (
        <div className="qa-panel qa-loading-panel" style={{ marginTop: 20 }}>
          <span className="qa-spinner" />
          <span>Analyzing...</span>
        </div>
      )}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 24, marginTop: 24, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ textAlign: "center", minWidth: 160 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>Health Score</div>
              <ScoreRing score={data.score} />
            </div>
            <div className="qa-panel" style={{ flex: 1, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
              {catData.map((c: any) => (
                <div key={c.name} style={{ textAlign: "center", minWidth: 100 }}>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>{c.name}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: c.score >= 80 ? "#38a169" : c.score >= 60 ? "#dd6b20" : "#e53e3e" }}>{c.score}</div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--border)", marginTop: 6 }}>
                    <div style={{ height: 6, borderRadius: 3, width: `${c.score}%`, background: c.score >= 80 ? "#38a169" : c.score >= 60 ? "#dd6b20" : "#e53e3e" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[{ label: "Total Pages", val: data.summary.totalPages }, { label: "OK Pages", val: data.summary.okPages }, { label: "Critical", val: data.summary.criticalIssues, color: "#e53e3e" }, { label: "Warnings", val: data.summary.warnings, color: "#dd6b20" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {pieData.length > 0 && (
              <div className="qa-panel" style={{ width: 260 }}>
                <div className="qa-panel-head">
                  <div className="qa-panel-title">Issue Distribution</div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", fontSize: 12 }}>
                  {pieData.map(d => <span key={d.name} style={{ color: d.color }}>{d.name}: {d.value}</span>)}
                </div>
              </div>
            )}
            {catData.length > 0 && (
              <div className="qa-panel" style={{ flex: 1 }}>
                <div className="qa-panel-head">
                  <div className="qa-panel-title">Category Scores</div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={catData}><XAxis dataKey="name" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip /><Bar dataKey="score" fill="#111111" radius={[4,4,0,0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="qa-panel" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="qa-panel-title">Issues ({filtered.length})</div>
              <select className="qa-select" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} style={{ width: 140 }}>
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              {filtered.map((issue: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={SEV_LOZENGE[issue.severity] ?? "qa-lozenge qa-lozenge--neutral"}>{issue.severity.toUpperCase()}</span>
                    <span className="qa-kicker">{issue.category}</span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{issue.title}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{issue.description}</div>
                  {issue.affectedUrls?.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                      {issue.affectedUrls.slice(0, 5).map((u: string) => <div key={u} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</div>)}
                      {issue.affectedUrls.length > 5 && <div>...and {issue.affectedUrls.length - 5} more</div>}
                    </div>
                  )}
                </div>
              ))}
              {filtered.length === 0 && <div className="qa-empty">No issues found</div>}
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
