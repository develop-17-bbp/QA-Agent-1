import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { startAgenticPipeline, fetchAgenticSession, fetchAgenticSessions, fetchLlmStats } from "../api";

const SEVERITY_COLORS = { high: "#e53e3e", medium: "#dd6b20", low: "#38a169" };

export default function AgenticCrawl() {
  const [targetUrl, setTargetUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [, setSessionId] = useState("");
  const [session, setSession] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [llmStats, setLlmStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPipeline = async () => {
    if (!targetUrl.trim()) return;
    setLoading(true); setError(""); setSession(null);
    try {
      const kws = keywords.split("\n").map(k => k.trim()).filter(Boolean);
      const result = await startAgenticPipeline(targetUrl.trim(), kws);
      setSessionId(result.sessionId);
      pollSession(result.sessionId);
    } catch (e: any) { setError(e.message); setLoading(false); }
  };

  const pollSession = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await fetchAgenticSession(id);
        setSession(s);
        if (s.status === "complete" || s.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setLoading(false);
        }
      } catch { /* ignore poll errors */ }
    }, 1500);
  };

  useEffect(() => {
    fetchAgenticSessions().then(setSessions).catch(() => {});
    fetchLlmStats().then(setLlmStats).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const analysis = session?.analysis;
  const radarData = analysis ? [
    { metric: "Technical SEO", value: analysis.technicalSeo?.score ?? 0 },
    { metric: "SERP Visibility", value: analysis.serpPresence?.visibility === "strong" ? 90 : analysis.serpPresence?.visibility === "moderate" ? 60 : 30 },
    { metric: "Content", value: analysis.contentStrategy?.opportunities?.length > 3 ? 40 : 70 },
    { metric: "Overall", value: analysis.overallScore ?? 0 },
  ] : [];

  const insightPie = session?.crawlInsights ? (() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const i of session.crawlInsights) counts[i.severity as keyof typeof counts]++;
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: SEVERITY_COLORS[name as keyof typeof SEVERITY_COLORS],
    }));
  })() : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Agentic Crawl Intelligence</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
        Multi-agent AI pipeline: SERP collection, smart crawl planning, and automated SEO analysis. Powered by Gemini with Ollama fallback.
      </p>

      {/* LLM Status Bar */}
      {llmStats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div className="qa-panel" style={{ padding: "8px 16px", display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
            <span style={{ color: llmStats.gemini?.circuitOpen ? "#e53e3e" : "#38a169", fontWeight: 600 }}>Gemini: {llmStats.gemini?.circuitOpen ? "Circuit Open" : "OK"}</span>
            <span style={{ color: "var(--text-secondary)" }}>Reqs: {llmStats.gemini?.requests ?? 0}</span>
            <span style={{ color: "var(--text-secondary)" }}>Avg: {llmStats.gemini?.avgLatencyMs ?? 0}ms</span>
          </div>
          <div className="qa-panel" style={{ padding: "8px 16px", display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
            <span style={{ color: llmStats.ollama?.available ? "#38a169" : "#888", fontWeight: 600 }}>Ollama: {llmStats.ollama?.available ? "Available" : "Offline"}</span>
            <span style={{ color: "var(--text-secondary)" }}>Reqs: {llmStats.ollama?.requests ?? 0}</span>
          </div>
        </div>
      )}

      {/* Input Form */}
      <div className="qa-panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <input className="qa-input" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="Target URL (e.g. https://example.com)" style={{ flex: 1, padding: "8px 12px" }} />
        </div>
        <textarea className="qa-input" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Target keywords (one per line) — used for SERP tracking and content analysis..." style={{ width: "100%", padding: "8px 12px", minHeight: 80, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} />
        <button className="qa-btn" onClick={startPipeline} disabled={loading || !targetUrl.trim()} style={{ marginTop: 8, padding: "8px 24px" }}>{loading ? "Running Pipeline..." : "Start Agentic Pipeline"}</button>
      </div>

      {error && <div className="qa-panel" style={{ marginTop: 16, color: "#e53e3e", padding: 16 }}>{error}</div>}

      {/* Progress */}
      {session && session.status !== "complete" && session.status !== "error" && (
        <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{session.progress?.phase}</span>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{session.progress?.percent}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--border)" }}>
            <div style={{ height: 6, borderRadius: 3, width: `${session.progress?.percent ?? 0}%`, background: "#5a67d8", transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{session.progress?.message}</div>
        </div>
      )}

      {/* Analysis Results */}
      {analysis && (
        <>
          {/* Score + Radar */}
          <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ textAlign: "center", padding: 24, minWidth: 160 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>Overall Score</div>
              <div style={{ fontSize: 56, fontWeight: 700, color: analysis.overallScore >= 70 ? "#38a169" : analysis.overallScore >= 50 ? "#dd6b20" : "#e53e3e" }}>{analysis.overallScore}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>/100</div>
            </div>
            {radarData.length > 0 && (
              <div className="qa-panel" style={{ flex: 1, padding: 16, minWidth: 280 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" fontSize={11} />
                    <PolarRadiusAxis domain={[0, 100]} fontSize={10} />
                    <Radar dataKey="value" stroke="#5a67d8" fill="#5a67d8" fillOpacity={0.3} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Summary */}
          {analysis.summary && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Executive Summary</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>{analysis.summary}</div>
              {analysis.competitiveEdge && <div style={{ fontSize: 12, marginTop: 8, fontStyle: "italic", color: "#5a67d8" }}>{analysis.competitiveEdge}</div>}
            </div>
          )}

          {/* SERP Presence */}
          {analysis.serpPresence && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>SERP Presence</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ textAlign: "center", minWidth: 100 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Keywords Tracked</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{analysis.serpPresence.keywordsTracked}</div>
                </div>
                <div style={{ textAlign: "center", minWidth: 100 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Avg Position</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: analysis.serpPresence.avgPosition && analysis.serpPresence.avgPosition <= 10 ? "#38a169" : "#dd6b20" }}>{analysis.serpPresence.avgPosition ?? "N/A"}</div>
                </div>
                <div style={{ textAlign: "center", minWidth: 100 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Visibility</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: analysis.serpPresence.visibility === "strong" ? "#38a169" : analysis.serpPresence.visibility === "moderate" ? "#dd6b20" : "#e53e3e", textTransform: "capitalize" }}>{analysis.serpPresence.visibility}</div>
                </div>
              </div>
              {analysis.serpPresence.topCompetitors?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Top Competitors</div>
                  {analysis.serpPresence.topCompetitors.map((c: any, i: number) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
                      <span>{c.domain}</span>
                      <span style={{ color: "var(--text-secondary)" }}>Avg #{c.avgPosition}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Insights + Issues */}
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {insightPie.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 240 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Issue Severity</div>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart><Pie data={insightPie} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                    {insightPie.map((d: any, i: number) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Crawl Insights</div>
              {(session?.crawlInsights ?? []).map((insight: any, i: number) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: SEVERITY_COLORS[insight.severity as keyof typeof SEVERITY_COLORS] + "20", color: SEVERITY_COLORS[insight.severity as keyof typeof SEVERITY_COLORS], fontWeight: 600, flexShrink: 0, textTransform: "uppercase" }}>{insight.severity}</span>
                  <div>
                    <div style={{ fontSize: 12 }}>{insight.message}</div>
                    {insight.urls?.length > 0 && <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>{insight.urls.slice(0, 3).join(", ")}</div>}
                  </div>
                </div>
              ))}
              {(session?.crawlInsights ?? []).length === 0 && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No insights generated yet</div>}
            </div>
          </div>

          {/* Content Strategy */}
          {analysis.contentStrategy && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Content Strategy</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
                {[
                  { title: "Content Gaps", items: analysis.contentStrategy.gaps, color: "#e53e3e" },
                  { title: "Opportunities", items: analysis.contentStrategy.opportunities, color: "#dd6b20" },
                  { title: "Quick Wins", items: analysis.contentStrategy.quickWins, color: "#38a169" },
                ].map(section => (section.items ?? []).length > 0 && (
                  <div key={section.title}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: section.color, marginBottom: 6 }}>{section.title}</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>{section.items.map((item: string, i: number) => (
                      <li key={i} style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>{item}</li>
                    ))}</ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {(analysis.recommendations ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>AI Recommendations</div>
              {analysis.recommendations.map((rec: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: (rec.priority === "high" ? "#e53e3e" : rec.priority === "medium" ? "#dd6b20" : "#38a169") + "20", color: rec.priority === "high" ? "#e53e3e" : rec.priority === "medium" ? "#dd6b20" : "#38a169", fontWeight: 600, flexShrink: 0, textTransform: "uppercase" }}>{rec.priority}</span>
                  <div>
                    <div style={{ fontSize: 13 }}>{rec.action}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{rec.impact}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Agent Log */}
      {session?.log?.length > 0 && (
        <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Agent Log</div>
          <div style={{ maxHeight: 300, overflowY: "auto", fontFamily: "monospace", fontSize: 11 }}>
            {session.log.map((entry: any, i: number) => (
              <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
                <span style={{ color: "var(--text-secondary)", flexShrink: 0, width: 70 }}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span style={{ color: "#5a67d8", fontWeight: 600, flexShrink: 0, width: 80 }}>[{entry.agent}]</span>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Previous Sessions */}
      {sessions.length > 0 && (
        <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Previous Sessions</div>
          {sessions.map((s: any) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => { setSessionId(s.id); fetchAgenticSession(s.id).then(setSession).catch(() => {}); }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{s.targetUrl}</div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{new Date(s.startedAt).toLocaleString()}</div>
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: s.status === "complete" ? "#38a16920" : s.status === "error" ? "#e53e3e20" : "#dd6b2020", color: s.status === "complete" ? "#38a169" : s.status === "error" ? "#e53e3e" : "#dd6b20", fontWeight: 600 }}>{s.status}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
