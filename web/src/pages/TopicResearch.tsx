import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchTopicResearch } from "../api";

export default function TopicResearch() {
  const [topic, setTopic] = useState("");
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const research = async () => {
    if (!topic.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchTopicResearch(topic.trim(), runId || undefined)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Topic Research</h1>
      <p className="qa-page-desc">Discover subtopics, questions, content angles, and a content calendar for any topic.</p>

      <div style={{ marginBottom: 12 }}><RunSelector value={runId} onChange={setRunId} label="Context run (optional)" /></div>
      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === "Enter" && research()} placeholder="Enter topic to research..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={research} disabled={loading || !topic.trim()}>{loading ? "Researching..." : "Research"}</button>
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}
      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Researching topic...</div>}

      {data && !loading && (
        <>
          {(data.subtopics ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 24, padding: 16 }}>
              <div className="qa-panel-title">Subtopics</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {data.subtopics.map((st: any, i: number) => (
                  <div key={i} style={{ flex: "1 1 250px", padding: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card, rgba(90,103,216,0.04))" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{st.name}</span>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: st.relevance === "High" ? "#38a16920" : "#dd6b2020", color: st.relevance === "High" ? "#38a169" : "#dd6b20" }}>{st.relevance}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>{st.searchVolumeTrend}</div>
                    {(st.contentIdeas ?? []).length > 0 && <div style={{ fontSize: 11, color: "#5a67d8", marginTop: 4 }}>{st.contentIdeas.join(", ")}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(data.questions ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Questions People Ask</div>
              {data.questions.map((q: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>{q.question}</span>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{q.type}</span>
                  <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: q.searchPotential === "High" ? "#38a16920" : "#dd6b2020", color: q.searchPotential === "High" ? "#38a169" : "#dd6b20" }}>{q.searchPotential}</span>
                </div>
              ))}
            </div>
          )}

          {(data.angles ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Content Angles</div>
              {data.angles.map((a: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.angle}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Target: {a.targetAudience} | Format: {a.contentFormat}</div>
                </div>
              ))}
            </div>
          )}

          {(data.contentCalendar ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Content Calendar</div>
              <table className="qa-table">
                <thead><tr>{["Week", "Topic", "Format", "Target Keyword"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{data.contentCalendar.map((c: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 600 }}>Week {c.week}</td>
                    <td style={{ padding: "6px 10px", fontSize: 13 }}>{c.topic}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{c.format}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "#5a67d8" }}>{c.targetKeyword}</td>
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
