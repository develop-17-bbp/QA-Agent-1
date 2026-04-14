import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchLocalSeo } from "../api";

export default function LocalSeo() {
  const [businessName, setBusinessName] = useState("");
  const [location, setLocation] = useState("");
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (!businessName.trim() || !location.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchLocalSeo(businessName.trim(), location.trim(), runId || undefined)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Local SEO Tools</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>AI-powered local SEO analysis including keyword suggestions, GBP optimization, review strategy, and citation sources.</p>

      <div style={{ marginBottom: 12 }}><RunSelector value={runId} onChange={setRunId} label="Website run (optional)" /></div>
      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business name..." style={{ flex: 1, minWidth: 150, padding: "8px 12px" }} />
        <input className="qa-input" value={location} onChange={e => setLocation(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Location (city, state)..." style={{ flex: 1, minWidth: 150, padding: "8px 12px" }} />
        <button className="qa-btn" onClick={analyze} disabled={loading || !businessName.trim() || !location.trim()} style={{ padding: "8px 24px" }}>{loading ? "Analyzing..." : "Analyze"}</button>
      </div>

      {error && <div className="qa-panel" style={{ marginTop: 16, color: "#e53e3e", padding: 16 }}>{error}</div>}
      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Analyzing local SEO...</div>}

      {data && !loading && (
        <>
          {/* Local Keywords */}
          {(data.localKeywords ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 24, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Local Keywords</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Keyword", "Volume", "Difficulty", "Intent", "Priority"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                <tbody>{data.localKeywords.map((kw: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{kw.keyword}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{kw.volume}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{kw.difficulty}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{kw.intent}</td>
                    <td style={{ padding: "6px 10px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: kw.priority === "High" ? "#e53e3e20" : "#dd6b2020", color: kw.priority === "High" ? "#e53e3e" : "#dd6b20", fontWeight: 600 }}>{kw.priority}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {/* GBP Tips */}
          {(data.gbpTips ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Google Business Profile Optimization</div>
              {data.gbpTips.map((tip: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: tip.priority === "High" ? "#e53e3e20" : "#dd6b2020", color: tip.priority === "High" ? "#e53e3e" : "#dd6b20", fontWeight: 600, flexShrink: 0 }}>{tip.priority}</span>
                  <div><div style={{ fontSize: 11, color: "#5a67d8", fontWeight: 600 }}>{tip.category}</div><div style={{ fontSize: 13 }}>{tip.tip}</div></div>
                </div>
              ))}
            </div>
          )}

          {/* NAP Consistency */}
          {data.napConsistency && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>NAP Consistency Score: <span style={{ color: data.napConsistency.score >= 80 ? "#38a169" : "#dd6b20" }}>{data.napConsistency.score}/100</span></div>
              {(data.napConsistency.recommendations ?? []).length > 0 && <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{data.napConsistency.recommendations.map((r: string, i: number) => <li key={i} style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{r}</li>)}</ul>}
            </div>
          )}

          {/* Listing Recommendations */}
          {(data.listingRecommendations ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Listing Recommendations</div>
              {data.listingRecommendations.map((lr: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{lr.platform}</span>
                    <span style={{ fontSize: 11, color: lr.priority === "High" ? "#e53e3e" : "#dd6b20" }}>{lr.priority} priority</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{lr.action}</div>
                </div>
              ))}
            </div>
          )}

          {/* Citation Sources */}
          {(data.citationSources ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Citation Sources</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Name", "Type", "Priority"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                <tbody>{data.citationSources.map((cs: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{cs.name}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{cs.type}</td>
                    <td style={{ padding: "6px 10px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: cs.priority === "High" ? "#e53e3e20" : "#dd6b2020", color: cs.priority === "High" ? "#e53e3e" : "#dd6b20", fontWeight: 600 }}>{cs.priority}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {/* Review Strategy */}
          {data.reviewStrategy && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Review Strategy</div>
              <div style={{ fontSize: 13, marginBottom: 4 }}>Target: <strong>{data.reviewStrategy.targetReviews}</strong> reviews across {(data.reviewStrategy.platforms ?? []).join(", ")}</div>
              {(data.reviewStrategy.tips ?? []).length > 0 && <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{data.reviewStrategy.tips.map((t: string, i: number) => <li key={i} style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{t}</li>)}</ul>}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
