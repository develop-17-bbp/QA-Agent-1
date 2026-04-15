import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchContentAudit } from "../api";

const CLASS_COLORS: Record<string, string> = { good: "#38a169", "needs-improvement": "#dd6b20", poor: "#e53e3e" };

const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

function ConfidenceDot({ confidence, source, note }: { confidence?: string; source?: string; note?: string }) {
  const c = confidence ?? "low";
  const label = CONFIDENCE_LABELS[c] ?? c;
  const title = `${label} · ${source ?? "unknown"}${note ? ` · ${note}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: CONFIDENCE_COLORS[c] ?? "#9ca3af",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function unwrap(dp: any): any {
  return dp && typeof dp === "object" && "value" in dp ? dp.value : dp;
}

export default function ContentAudit() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchContentAudit(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const pages = data?.pages ?? [];
  const filtered = filter === "all" ? pages : pages.filter((p: any) => p.classification === filter);
  const dq = data?.dataQuality ?? { realDataFields: [], providersHit: [], providersFailed: [], missingFields: [] };

  const summary = data?.summary;
  const totalPages = unwrap(summary?.totalPages) ?? 0;
  const avgScore = unwrap(summary?.avgScore) ?? 0;
  const good = unwrap(summary?.good) ?? 0;
  const needsImprovement = unwrap(summary?.needsImprovement) ?? 0;
  const poor = unwrap(summary?.poor) ?? 0;
  const duplicateTitles = unwrap(summary?.duplicateTitles) ?? 0;

  const qualityData = summary ? [
    { name: "Good", value: good, color: CLASS_COLORS.good },
    { name: "Needs Work", value: needsImprovement, color: CLASS_COLORS["needs-improvement"] },
    { name: "Poor", value: poor, color: CLASS_COLORS.poor },
  ].filter(d => d.value > 0) : [];

  const issueData = (data?.issueBreakdown ?? []).slice(0, 8);

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Content Audit</h1>
      <p className="qa-page-desc">
        Every quality score comes from <strong>deterministic rules over real crawl fields</strong>
        (title, meta description length, h1 count, body bytes, canonical, lang, load time, status).
        The LLM is restricted to a single qualitative comment about why the top issues matter —
        it never invents pages, counts, or scores.
      </p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Auditing content...</div>}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

      {data && !loading && (
        <>
          {(dq.realDataFields?.length > 0 || dq.providersHit?.length > 0 || dq.providersFailed?.length > 0) && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="qa-kicker" style={{ fontSize: 11 }}>Data sources:</span>
              {(dq.providersHit ?? []).map((p: string) => (
                <span key={`hit-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(56,161,105,0.15)", color: "#38a169", fontWeight: 600, border: "1px solid rgba(56,161,105,0.3)" }} title="Real provider hit">
                  ● {p}
                </span>
              ))}
              {(dq.providersFailed ?? []).map((p: string) => (
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(229,62,62,0.1)", color: "#e53e3e", fontWeight: 600, border: "1px solid rgba(229,62,62,0.3)" }} title="Provider failed">
                  ✕ {p}
                </span>
              ))}
              {(dq.realDataFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Crawl fields used: ${dq.realDataFields.join(", ")}`}>
                  {dq.realDataFields.length} crawl fields scored
                </span>
              )}
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[
              { label: "Total Pages", val: totalPages, meta: summary?.totalPages },
              { label: "Avg Score", val: avgScore, meta: summary?.avgScore, color: avgScore >= 70 ? "#38a169" : "#dd6b20" },
              { label: "Good", val: good, meta: summary?.good, color: "#38a169" },
              { label: "Poor", val: poor, meta: summary?.poor, color: "#e53e3e" },
              { label: "Dup. titles", val: duplicateTitles, meta: summary?.duplicateTitles, color: duplicateTitles > 0 ? "#dd6b20" : "var(--text-primary)" },
            ].map((s: any) => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div className="qa-kicker">{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color ?? "var(--text-primary)" }}>
                  {s.val}
                  <ConfidenceDot confidence={s.meta?.confidence} source={s.meta?.source} note={s.meta?.note} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {qualityData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div className="qa-panel-title">Quality Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={qualityData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {qualityData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {issueData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div className="qa-panel-title">Top Issues (deterministic)</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={issueData} layout="vertical"><XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="issue" width={160} fontSize={10} /><Tooltip /><Bar dataKey="count" fill="#e53e3e" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {data.commentary && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">AI Commentary</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                ≤3 sentences. Qualitative explanation of the top issues above. No invented pages or counts — verify before acting.
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>{data.commentary}</div>
            </div>
          )}

          <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="qa-panel-title">Pages ({filtered.length})</div>
              <select className="qa-select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 160 }}>
                <option value="all">All</option>
                <option value="good">Good</option>
                <option value="needs-improvement">Needs Work</option>
                <option value="poor">Poor</option>
              </select>
            </div>
            <table className="qa-table">
              <thead><tr>{["URL", "Quality", "Score", "Est. words", "Issues"].map(h => <th key={h} style={{ textAlign: h === "URL" || h === "Issues" ? "left" : "center" }}>{h}</th>)}</tr></thead>
              <tbody>{filtered.slice(0, 30).map((p: any, i: number) => {
                const scoreMeta = p.qualityScore;
                const scoreVal = unwrap(scoreMeta);
                const wordMeta = p.estimatedWordCount;
                const wordVal = unwrap(wordMeta);
                const srcTitle = `Scored from crawl fields: ${(p.sourcedFields ?? []).join(", ") || "none"}`;
                return (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 12, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${p.url}\n${srcTitle}`}>{p.title || p.url}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (CLASS_COLORS[p.classification] ?? "#888") + "20", color: CLASS_COLORS[p.classification] ?? "#888", fontWeight: 600 }}>{p.classification}</span>
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, color: scoreVal >= 70 ? "#38a169" : scoreVal >= 50 ? "#dd6b20" : "#e53e3e" }} title={srcTitle}>
                      {scoreVal}
                      <ConfidenceDot confidence={scoreMeta?.confidence} source={scoreMeta?.source} note={scoreMeta?.note} />
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: "var(--text-secondary)" }}>
                      ~{wordVal}
                      <ConfidenceDot confidence={wordMeta?.confidence} source={wordMeta?.source} note={wordMeta?.note} />
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-secondary)" }}>{(p.issues ?? []).join(", ")}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}
    </motion.div>
  );
}
