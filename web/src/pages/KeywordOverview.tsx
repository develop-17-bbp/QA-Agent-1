import { motion } from "framer-motion";
import { useState } from "react";
import { BarChart, Bar, ResponsiveContainer } from "recharts";
import { fetchKeywordResearch } from "../api";

const INTENT_COLORS: Record<string, string> = {
  informational: "#3b82f6",
  commercial: "#f59e0b",
  navigational: "#8b5cf6",
  transactional: "#10b981",
};

const DIFF_COLORS = (d: number) =>
  d >= 80 ? "var(--bad)" : d >= 50 ? "var(--warn)" : "var(--ok)";

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const MONTHS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];

export default function KeywordOverview() {
  const [keyword, setKeyword] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const research = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchKeywordResearch(kw));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const trendData = (data?.trend ?? []).map((v: number, i: number) => ({
    month: MONTHS[i] ?? `M${i + 1}`,
    volume: v,
  }));

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 24 }}>
        <h1 className="qa-page-title">Keyword Overview</h1>
        <p className="qa-page-desc">SEMrush-style keyword research powered by Gemini AI.</p>
      </motion.div>

      {/* Search Bar */}
      <div className="qa-panel" style={{ padding: 16, marginBottom: 24, display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && research()}
          placeholder="Enter keyword for research..."
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--bg-card)", color: "var(--text)", fontSize: 14,
          }}
        />
        <button className="qa-btn-primary" onClick={research} disabled={loading || !keyword.trim()} style={{ padding: "10px 24px" }}>
          {loading ? "Analyzing..." : "Research"}
        </button>
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}
      {loading && (
        <div className="qa-panel" style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>
          Analyzing keyword with Gemini AI...
        </div>
      )}

      {data && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* Top title */}
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>
              Keyword Overview: <span style={{ fontWeight: 400, color: "var(--muted)" }}>{data.keyword}</span>
            </h2>
          </div>

          {/* ── Metrics Row ──────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
            {/* Volume */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Volume</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{formatVolume(data.volume)}</div>
              <div style={{ borderTop: "3px solid var(--accent)", marginTop: 8 }} />
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Keyword Difficulty</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <svg width={48} height={48} viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border)" strokeWidth="4" />
                  <circle
                    cx="24" cy="24" r="20" fill="none"
                    stroke={DIFF_COLORS(data.difficulty)}
                    strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${(data.difficulty / 100) * 125.6} 125.6`}
                    transform="rotate(-90 24 24)"
                  />
                  <text x="24" y="28" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">{data.difficulty}%</text>
                </svg>
                <span style={{ fontSize: 13, color: DIFF_COLORS(data.difficulty), fontWeight: 600 }}>{data.difficultyLabel}</span>
              </div>
            </div>

            {/* Global Volume + Country Breakdown */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Global Volume</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{formatVolume(data.globalVolume)}</div>
              <div style={{ marginTop: 8 }}>
                {(data.countryVolumes ?? []).slice(0, 6).map((cv: any) => {
                  const pct = data.globalVolume > 0 ? (cv.volume / data.globalVolume) * 100 : 0;
                  return (
                    <div key={cv.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 3 }}>
                      <span style={{ width: 24, fontWeight: 600 }}>{cv.code}</span>
                      <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: "var(--accent)", borderRadius: 3 }} />
                      </div>
                      <span style={{ minWidth: 50, textAlign: "right", color: "var(--muted)" }}>{formatVolume(cv.volume)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Intent */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Intent</div>
              <span style={{
                display: "inline-block", padding: "4px 12px", borderRadius: 12, fontSize: 13, fontWeight: 600,
                background: `${INTENT_COLORS[data.intent] ?? "#888"}20`,
                color: INTENT_COLORS[data.intent] ?? "#888",
                border: `1px solid ${INTENT_COLORS[data.intent] ?? "#888"}40`,
              }}>
                {(data.intent ?? "informational").charAt(0).toUpperCase() + (data.intent ?? "informational").slice(1)}
              </span>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 16, marginBottom: 4 }}>Trend (12 months)</div>
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={trendData}>
                  <Bar dataKey="volume" fill="var(--accent)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* CPC + Competitive Density */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>CPC</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>${data.cpc?.toFixed(2) ?? "0.00"}</div>
              <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0" }} />
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Competitive Density</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.competitiveDensity?.toFixed(2) ?? "0.00"}</div>
              <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0" }} />
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Results</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{data.totalResults}</div>
            </div>
          </div>

          {/* ── Keyword Ideas ────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
            {/* Variations */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "var(--muted)" }}>Keyword Variations</h3>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
                {formatVolume(data.variationsTotalCount)}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)", marginLeft: 8 }}>
                  Total Volume: {formatVolume(data.variationsTotalVolume)}
                </span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Keywords</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Volume</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>KD %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.variations ?? []).slice(0, 5).map((v: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontSize: 13, color: "var(--accent)" }}>{v.keyword}</td>
                      <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>{formatVolume(v.volume)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {v.difficulty}
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: DIFF_COLORS(v.difficulty) }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Questions */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "var(--muted)" }}>Questions</h3>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
                {formatVolume(data.questionsTotalCount)}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)", marginLeft: 8 }}>
                  Total Volume: {formatVolume(data.questionsTotalVolume)}
                </span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Keywords</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Volume</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>KD %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.questions ?? []).slice(0, 5).map((q: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontSize: 13, color: "var(--accent)" }}>{q.keyword}</td>
                      <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>{formatVolume(q.volume)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {q.difficulty}
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: DIFF_COLORS(q.difficulty) }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Keyword Strategy (Clusters) */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "var(--muted)" }}>Keyword Strategy</h3>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>Topic clusters and related terms</p>
              <div style={{ paddingLeft: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)" }} />
                  {data.keyword}
                </div>
                {(data.clusters ?? []).slice(0, 5).map((c: any, i: number) => (
                  <div key={i} style={{ fontSize: 13, marginBottom: 4, paddingLeft: 16, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 3, borderRadius: 2, background: "var(--accent)", opacity: 0.4 + (i * 0.12) }} />
                    {c.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── SERP Analysis ────────────────────────────────────── */}
          {(data.serp ?? []).length > 0 && (
            <div className="qa-panel" style={{ padding: 16, marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 4px" }}>SERP Analysis</h3>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Results: <strong style={{ color: "var(--text)" }}>{data.totalResults}</strong></span>
                {data.serpFeatures?.length > 0 && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    SERP Features: {data.serpFeatures.join(", ")}
                  </span>
                )}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 12, color: "var(--muted)", borderBottom: "2px solid var(--border)", width: 40 }}>#</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 12, color: "var(--muted)", borderBottom: "2px solid var(--border)" }}>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.serp ?? []).map((s: any) => (
                    <tr key={s.position} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--muted)" }}>{s.position}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ fontSize: 13 }}>{s.url}</div>
                        <div style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>{s.domain}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Full Variations Table ────────────────────────────── */}
          {(data.variations ?? []).length > 5 && (
            <div className="qa-panel" style={{ padding: 16, overflowX: "auto" }}>
              <h3 style={{ margin: "0 0 12px" }}>All Keyword Variations</h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Keyword</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", borderBottom: "2px solid var(--border)" }}>Volume</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", borderBottom: "2px solid var(--border)" }}>KD %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.variations ?? []).map((v: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--accent)" }}>{v.keyword}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>{formatVolume(v.volume)}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {v.difficulty}
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: DIFF_COLORS(v.difficulty) }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
