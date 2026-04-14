import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchKeywordStrategy } from "../api";

export default function KeywordStrategyBuilder() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchKeywordStrategy(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Keyword Strategy Builder</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>AI-powered keyword strategy built from your crawl data. Includes priority keywords, content gaps, clusters, and a phased action plan.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Building keyword strategy...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}

      {data && !loading && (
        <>
          {/* Priority Keywords */}
          {(data.priorityKeywords ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 24, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Priority Keywords</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Keyword", "Priority", "Presence", "Opportunity", "Action"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                  <tbody>{(data.priorityKeywords ?? []).map((kw: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{kw.keyword}</td>
                      <td style={{ padding: "6px 10px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: kw.priority === "High" ? "#e53e3e20" : "#dd6b2020", color: kw.priority === "High" ? "#e53e3e" : "#dd6b20", fontWeight: 600 }}>{kw.priority}</span></td>
                      <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{kw.currentPresence}</td>
                      <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{kw.opportunity}</td>
                      <td style={{ padding: "6px 10px", fontSize: 12 }}>{kw.recommendedAction}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Content Gaps */}
          {(data.contentGaps ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Content Gaps</div>
              {(data.contentGaps ?? []).map((gap: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{gap.topic} <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 400 }}>({gap.contentType})</span></div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{gap.description}</div>
                  {gap.suggestedKeywords?.length > 0 && <div style={{ fontSize: 11, color: "#5a67d8", marginTop: 4 }}>Keywords: {gap.suggestedKeywords.join(", ")}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Topic Clusters */}
          {(data.clusters ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Topic Clusters</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {(data.clusters ?? []).map((c: any, i: number) => (
                  <div key={i} style={{ flex: "1 1 280px", padding: 16, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card, rgba(90,103,216,0.04))" }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{c.theme}</div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>Pillar: <strong>{c.pillarPage}</strong></div>
                    <div style={{ fontSize: 11, color: "#5a67d8", marginTop: 4 }}>{(c.keywords ?? []).join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Plan */}
          {(data.actionPlan ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Action Plan</div>
              {(data.actionPlan ?? []).map((phase: any, i: number) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#5a67d8", marginBottom: 6 }}>{phase.phase}</div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {(phase.actions ?? []).map((a: string, j: number) => <li key={j} style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>{a}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Competitive Insights */}
          {data.competitiveInsights && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Competitive Insights</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {[{ title: "Strengths", items: data.competitiveInsights.strengths, color: "#38a169" }, { title: "Weaknesses", items: data.competitiveInsights.weaknesses, color: "#e53e3e" }, { title: "Opportunities", items: data.competitiveInsights.opportunities, color: "#5a67d8" }].map(s => (
                  <div key={s.title} style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: s.color, marginBottom: 6 }}>{s.title}</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>{(s.items ?? []).map((item: string, j: number) => <li key={j} style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>{item}</li>)}</ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
