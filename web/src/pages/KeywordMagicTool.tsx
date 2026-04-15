import { useState } from "react";
import { motion } from "framer-motion";
import { fetchKeywordMagic } from "../api";

const INTENT_COLORS: Record<string, string> = { Informational: "#3182ce", Commercial: "#dd6b20", Transactional: "#38a169", Navigational: "#5a67d8" };
const DIFF_COLORS: Record<string, string> = { Easy: "#38a169", Medium: "#dd6b20", Hard: "#e53e3e", "Very Hard": "#9b2c2c" };

export default function KeywordMagicTool() {
  const [seed, setSeed] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const search = async () => {
    if (!seed.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchKeywordMagic(seed.trim())); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const keywords = data?.keywords ?? [];
  const filtered = filter === "all" ? keywords : keywords.filter((k: any) => k.intent === filter);
  const clusters = data?.clusters ?? [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Keyword Magic Tool</h1>
      <p className="qa-page-desc" style={{ marginBottom: 16 }}>Enter a seed keyword to discover related keywords, search volumes, and clusters powered by your local AI model.</p>

      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={seed} onChange={e => setSeed(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Enter seed keyword..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn" onClick={search} disabled={loading || !seed.trim()} style={{ padding: "8px 24px" }}>{loading ? "Researching..." : "Research"}</button>
      </div>

      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 16 }}>{error}</div>}
      {loading && <div className="qa-panel" style={{ marginTop: 20 }}><div className="qa-loading-panel">Generating keyword ideas...</div></div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[{ label: "Keywords Found", val: keywords.length }, { label: "Clusters", val: clusters.length }, { label: "Avg Difficulty", val: keywords.length > 0 ? keywords.filter((k: any) => k.difficulty === "Easy").length > keywords.length / 2 ? "Easy" : "Medium" : "-" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div className="qa-kicker">{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{s.val}</div>
              </div>
            ))}
          </div>

          {clusters.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title" style={{ marginBottom: 12 }}>Keyword Clusters</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {clusters.map((c: any, i: number) => (
                  <div key={i} style={{ padding: "10px 16px", borderRadius: 8, background: "var(--bg-card, rgba(90,103,216,0.06))", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{(c.keywords ?? []).join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="qa-panel-title">Keywords ({filtered.length})</div>
              <select className="qa-select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 160 }}>
                <option value="all">All Intents</option>
                <option value="Informational">Informational</option>
                <option value="Commercial">Commercial</option>
                <option value="Transactional">Transactional</option>
                <option value="Navigational">Navigational</option>
              </select>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="qa-table">
                <thead><tr>
                  {["Keyword", "Volume", "Difficulty", "Intent", "CPC", "Trend"].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((kw: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{kw.keyword}</td>
                      <td style={{ color: "var(--text-secondary)" }}>{kw.volume}</td>
                      <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (DIFF_COLORS[kw.difficulty] ?? "#888") + "20", color: DIFF_COLORS[kw.difficulty] ?? "#888", fontWeight: 600 }}>{kw.difficulty}</span></td>
                      <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (INTENT_COLORS[kw.intent] ?? "#888") + "20", color: INTENT_COLORS[kw.intent] ?? "#888", fontWeight: 600 }}>{kw.intent}</span></td>
                      <td style={{ color: "var(--text-secondary)" }}>{kw.cpc}</td>
                      <td style={{ color: kw.trend === "Rising" ? "#38a169" : kw.trend === "Declining" ? "#e53e3e" : "var(--text-secondary)" }}>{kw.trend}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
