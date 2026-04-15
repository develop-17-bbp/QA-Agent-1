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
        <p className="qa-page-desc">
          Real keyword data from Google Trends, Google Suggest, Wikipedia, and DuckDuckGo SERP — no paid APIs.
        </p>
      </motion.div>

      {/* Search Bar */}
      <div className="qa-panel" style={{ padding: 16, marginBottom: 24, display: "flex", gap: 12, alignItems: "center" }}>
        <input
          className="qa-input"
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && research()}
          placeholder="Enter keyword for research..."
          style={{ flex: 1, padding: "10px 14px" }}
        />
        <button className="qa-btn-primary" onClick={research} disabled={loading || !keyword.trim()} style={{ padding: "10px 24px" }}>
          {loading ? "Analyzing..." : "Research"}
        </button>
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}
      {loading && (
        <div className="qa-panel">
          <div className="qa-loading-panel">Querying Google Trends, Suggest, Wikipedia and DuckDuckGo SERP…</div>
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

          {/* Data quality badges */}
          {data.dataQuality && (
            <div className="qa-panel" style={{ padding: 12, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span className="qa-kicker" style={{ marginRight: 4 }}>Data sources:</span>
              {(data.dataQuality.providersHit ?? []).map((p: string) => (
                <span key={p} className="qa-lozenge" style={{ background: "var(--ok-bg, #ecfdf5)", color: "var(--ok, #047857)", fontSize: 11 }}>
                  {p}
                </span>
              ))}
              {(data.dataQuality.providersFailed ?? []).map((p: string) => (
                <span key={p} className="qa-lozenge" style={{ background: "var(--warn-bg, #fef3c7)", color: "var(--warn, #b45309)", fontSize: 11 }}>
                  {p} offline
                </span>
              ))}
              {(data.dataQuality.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  • Missing: {(data.dataQuality.missingFields ?? []).join(", ")}
                </span>
              )}
            </div>
          )}

          {/* ── Metrics Row ──────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
            {/* Volume */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <div className="qa-kicker" style={{ marginBottom: 4 }}>Volume</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{formatVolume(data.volume)}</div>
              <div style={{ borderTop: "3px solid var(--accent)", marginTop: 8 }} />
              <div className="qa-kicker" style={{ marginTop: 8 }}>Keyword Difficulty</div>
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
              <div className="qa-kicker" style={{ marginBottom: 4 }}>Global Volume</div>
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
              <div className="qa-kicker" style={{ marginBottom: 4 }}>Intent</div>
              <span style={{
                display: "inline-block", padding: "4px 12px", borderRadius: 12, fontSize: 13, fontWeight: 600,
                background: `${INTENT_COLORS[data.intent] ?? "#888"}20`,
                color: INTENT_COLORS[data.intent] ?? "#888",
                border: `1px solid ${INTENT_COLORS[data.intent] ?? "#888"}40`,
              }}>
                {(data.intent ?? "informational").charAt(0).toUpperCase() + (data.intent ?? "informational").slice(1)}
              </span>
              <div className="qa-kicker" style={{ marginTop: 16, marginBottom: 4 }}>Trend (12 months)</div>
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={trendData}>
                  <Bar dataKey="volume" fill="var(--accent)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* CPC + Competitive Density */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <div className="qa-kicker" style={{ marginBottom: 4 }}>CPC</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>${data.cpc?.toFixed(2) ?? "0.00"}</div>
              <hr className="qa-divider" />
              <div className="qa-kicker" style={{ marginBottom: 4 }}>Competitive Density</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.competitiveDensity?.toFixed(2) ?? "0.00"}</div>
              <hr className="qa-divider" />
              <div className="qa-kicker" style={{ marginBottom: 4 }}>Results</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{data.totalResults}</div>
            </div>
          </div>

          {/* ── Keyword Ideas ────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
            {/* Variations */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <h3 className="qa-panel-title" style={{ color: "var(--muted)" }}>Keyword Variations</h3>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
                {formatVolume(data.variationsTotalCount)}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)", marginLeft: 8 }}>
                  Total Volume: {formatVolume(data.variationsTotalVolume)}
                </span>
              </div>
              <table className="qa-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Keywords</th>
                    <th style={{ textAlign: "right" }}>Volume</th>
                    <th style={{ textAlign: "right" }}>KD %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.variations ?? []).slice(0, 5).map((v: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "var(--accent)" }}>{v.keyword}</td>
                      <td style={{ textAlign: "right" }}>{formatVolume(v.volume)}</td>
                      <td style={{ textAlign: "right" }}>
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
              <h3 className="qa-panel-title" style={{ color: "var(--muted)" }}>Questions</h3>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
                {formatVolume(data.questionsTotalCount)}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)", marginLeft: 8 }}>
                  Total Volume: {formatVolume(data.questionsTotalVolume)}
                </span>
              </div>
              <table className="qa-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Keywords</th>
                    <th style={{ textAlign: "right" }}>Volume</th>
                    <th style={{ textAlign: "right" }}>KD %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.questions ?? []).slice(0, 5).map((q: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "var(--accent)" }}>{q.keyword}</td>
                      <td style={{ textAlign: "right" }}>{formatVolume(q.volume)}</td>
                      <td style={{ textAlign: "right" }}>
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
              <h3 className="qa-panel-title" style={{ color: "var(--muted)" }}>Keyword Strategy</h3>
              <p className="qa-panel-subtitle" style={{ marginBottom: 12 }}>Topic clusters and related terms</p>
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
              <h3 className="qa-panel-title">SERP Analysis</h3>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Results: <strong style={{ color: "var(--text)" }}>{data.totalResults}</strong></span>
                {data.serpFeatures?.length > 0 && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    SERP Features: {data.serpFeatures.join(", ")}
                  </span>
                )}
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.serp ?? []).map((s: any) => (
                    <tr key={s.position}>
                      <td style={{ fontWeight: 600, color: "var(--muted)" }}>{s.position}</td>
                      <td>
                        <div>{s.url}</div>
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
              <h3 className="qa-panel-title" style={{ marginBottom: 12 }}>All Keyword Variations</h3>
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th style={{ textAlign: "right" }}>Volume</th>
                    <th style={{ textAlign: "right" }}>KD %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.variations ?? []).map((v: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: "var(--accent)" }}>{v.keyword}</td>
                      <td style={{ textAlign: "right" }}>{formatVolume(v.volume)}</td>
                      <td style={{ textAlign: "right" }}>
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
