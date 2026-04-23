import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchTopicResearch } from "../api";

import { LoadingPanel, ErrorBanner } from "../components/UI";
import AskCouncilButton from "../components/AskCouncilButton";
import CouncilSidecar from "../components/CouncilSidecar";
const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

const SOURCE_COLORS: Record<string, string> = {
  "google-suggest": "#111111",
  "google-suggest-cascade": "#9f7aea",
  "crawl": "#38a169",
};

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
        marginLeft: 8,
        verticalAlign: "middle",
      }}
    />
  );
}

function unwrap(dp: any): any {
  return dp && typeof dp === "object" && "value" in dp ? dp.value : dp;
}

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

  const dq = data?.dataQuality ?? { providersHit: [], providersFailed: [], missingFields: [] };
  const subtopics = data?.subtopics ?? [];
  const questions = data?.questions ?? [];
  const angles = data?.angles ?? [];
  const calendar = data?.contentCalendar ?? [];
  const topicPopularityMeta = data?.meta?.topicPopularity;
  const topicPopularity = unwrap(topicPopularityMeta);

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Topic Research</h1>
      <p className="qa-page-desc">
        Subtopics and questions come from <strong>real Google Suggest data</strong> (autocomplete + 2-level
        cascade). Topic popularity is the real monthly Wikipedia pageview count for the best-match article.
        The LLM is restricted to cluster labels and content-angle suggestions — it cannot invent subtopics,
        volumes, or "search potential" numbers.
      </p>

      <div style={{ marginBottom: 12 }}><RunSelector value={runId} onChange={setRunId} label="Context run (optional)" /></div>
      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === "Enter" && research()} placeholder="Enter topic to research..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={research} disabled={loading || !topic.trim()}>{loading ? "Researching..." : "Research"}</button>
        {topic.trim() && <AskCouncilButton term={topic} compact />}
      </div>

      {error && <ErrorBanner error={error} />}
      {loading && <LoadingPanel message="Researching topic via Google Suggest + Wikipedia…" />}

      {data && !loading && (
        <>
          {(dq.providersHit?.length > 0 || dq.providersFailed?.length > 0 || dq.missingFields?.length > 0) && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="qa-kicker" style={{ fontSize: 11 }}>Data sources:</span>
              {(dq.providersHit ?? []).map((p: string) => (
                <span key={`hit-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(56,161,105,0.15)", color: "#38a169", fontWeight: 600, border: "1px solid rgba(56,161,105,0.3)" }} title="Real provider hit">
                  ● {p}
                </span>
              ))}
              {(dq.providersFailed ?? []).map((p: string) => (
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(229,62,62,0.1)", color: "#e53e3e", fontWeight: 600, border: "1px solid rgba(229,62,62,0.3)" }} title="Provider failed or unavailable">
                  ✕ {p}
                </span>
              ))}
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
            </div>
          )}

          {topicPopularity !== undefined && topicPopularity !== null && topicPopularity > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-kicker">
                Topic popularity proxy (Wikipedia monthly pageviews)
                <ConfidenceDot confidence={topicPopularityMeta?.confidence} source={topicPopularityMeta?.source} note={topicPopularityMeta?.note} />
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#111111" }}>{topicPopularity.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                Real monthly-average pageviews over the last 12 months — not a Semrush-style search volume,
                but a genuine traffic signal.
              </div>
            </div>
          )}

          {subtopics.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Subtopics ({subtopics.length})</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
                Discovered via Google Suggest cascade + crawl titles. Source chip per node.
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {subtopics.map((st: any, i: number) => (
                  <div key={i} style={{ flex: "1 1 250px", padding: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card, rgba(90,103,216,0.04))" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{st.name}</span>
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: (SOURCE_COLORS[st.source] ?? "#888") + "20", color: SOURCE_COLORS[st.source] ?? "#888", fontWeight: 600, whiteSpace: "nowrap" }}>{st.source}</span>
                    </div>
                    {st.parentSeed && (
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                        from seed: <em>{st.parentSeed}</em>
                      </div>
                    )}
                    {st.clusterLabel && (
                      <div style={{ fontSize: 11, color: "#111111", marginTop: 4 }}>
                        cluster: {st.clusterLabel}
                      </div>
                    )}
                    {st.pageviewsProxy && (
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                        ~{unwrap(st.pageviewsProxy).toLocaleString()} wiki views/mo
                        <ConfidenceDot confidence={st.pageviewsProxy.confidence} source={st.pageviewsProxy.source} note={st.pageviewsProxy.note} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {questions.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Questions People Ask (Google Suggest)</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
                Real autocomplete completions starting with question words (who/what/why/how/when/where/is/can/will/do).
              </div>
              {questions.map((q: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>{q.question}</span>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#11111120", color: "#111111", fontWeight: 600 }}>{q.source}</span>
                </div>
              ))}
            </div>
          )}

          {angles.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Content Angles</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
                AI-generated qualitative suggestions — verify before adopting.
              </div>
              {angles.map((a: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.angle}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Format: {a.contentFormat}</div>
                </div>
              ))}
            </div>
          )}

          {calendar.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Content Calendar (from real subtopics)</div>
              <table className="qa-table">
                <thead><tr>{["Week", "Topic", "Source"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{calendar.map((c: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 600 }}>Week {c.week}</td>
                    <td style={{ padding: "6px 10px", fontSize: 13 }}>{c.topic}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-secondary)" }}>{c.source}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Embedded Council Sidecar — cross-source intel on the researched topic */}
      {data && topic.trim() && <CouncilSidecar term={topic.trim()} autoInvoke />}
    </motion.div>
  );
}
