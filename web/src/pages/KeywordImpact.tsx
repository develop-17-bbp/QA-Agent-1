import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, Cell } from "recharts";
import { fetchKeywordImpact } from "../api";
import { useRegion } from "../components/RegionPicker";
import { ErrorBanner } from "../components/UI";
import AskCouncilButton from "../components/AskCouncilButton";

type Projection = { period: "3-month" | "6-month" | "12-month"; rankingEstimate: string; trafficDelta: string; confidence: "low" | "medium" | "high" };

type ImpactResult = {
  request: { url: string; keyword: string; region: string };
  llmAvailable: boolean;
  llmError?: string;
  evidence: {
    volume: { avgMonthlySearches: number | null; competition: string | null; competitionIndex: number | null; lowBidUsd: number | null; highBidUsd: number | null; error?: string };
    trend: { interestLast12m: number | null; direction: "up" | "down" | "flat" | "unknown"; monthly: { month: string; value: number }[]; error?: string };
    serp: { topResults: { position: number; title: string; url: string; domain: string }[]; yourDomainPosition: number | null };
    targetPage: { title: string; h1: string | null; metaDescription: string | null; wordCount: number; keywordOccurrences: number; hreflang: string[] };
    domainAuthority: { score: number | null; pageRankDecimal: number | null };
    missingFields: string[];
  };
  analysis: {
    difficultyScore: number;
    opportunityScore: number;
    verdict: string;
    fitWithCurrentContent: string;
    keyMetricsToWatch: string[];
    recommendations: string[];
    risks: string[];
    quickWins: string[];
    projections: Projection[];
  };
};

const CONFIDENCE_COLORS = { high: "#16a34a", medium: "#ca8a04", low: "#94a3b8" };

function ScoreDial({ label, value, invertColor }: { label: string; value: number; invertColor?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = invertColor
    ? pct >= 70 ? "#dc2626" : pct >= 40 ? "#d97706" : "#16a34a"
    : pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#94a3b8";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="qa-panel"
      style={{ padding: 20, textAlign: "center", position: "relative", overflow: "hidden" }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ margin: "12px auto 8px", width: 130, height: 130, position: "relative" }}>
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r="58" fill="none" stroke="var(--panel-soft)" strokeWidth="10" />
          <motion.circle
            cx="65" cy="65" r="58" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 58}`}
            initial={{ strokeDashoffset: 2 * Math.PI * 58 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 58 * (1 - pct / 100) }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            transform="rotate(-90 65 65)"
          />
        </svg>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 800, color: "var(--text)" }}
        >
          {pct}
        </motion.div>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>out of 100</div>
    </motion.div>
  );
}

function MetricCard({ label, value, sub, highlight }: { label: string; value: string | number; sub?: string; highlight?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="qa-panel"
      style={{ padding: 16, background: highlight ? "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))" : undefined }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </motion.div>
  );
}

function ListCard({ title, items, icon, color }: { title: string; items: string[]; icon: string; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="qa-panel"
      style={{ padding: 20 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>{title}</h3>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.25 }}
            style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}
          >
            <span style={{ color, marginTop: 2, flexShrink: 0, fontWeight: 700 }}>›</span>
            <span>{item}</span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

export default function KeywordImpact() {
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [region] = useRegion();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImpactResult | null>(null);

  const run = async () => {
    if (!url.trim() || !keyword.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await fetchKeywordImpact({ url: url.trim(), keyword: keyword.trim(), region });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const e = result?.evidence;
  const a = result?.analysis;
  const trendSeries = (e?.trend.monthly ?? []).map((p) => ({ month: p.month.slice(5), value: p.value }));
  const serpSeries = (e?.serp.topResults ?? []).slice(0, 10).map((r) => ({
    position: `#${r.position}`,
    domain: r.domain.length > 22 ? r.domain.slice(0, 22) + "…" : r.domain,
    score: 100 - (r.position - 1) * 10,
    isYou: !!(e?.serp.yourDomainPosition === r.position),
  }));

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="qa-page-title">Keyword Impact Predictor</h1>
        <p className="qa-page-desc" style={{ marginBottom: 18 }}>
          Give a target URL and a keyword — the system pulls real volume, trend, SERP competitors, domain authority, and the page's
          actual content, then asks the local LLM to predict how targeting that keyword would play out.
          All numbers come from real providers; the LLM is explicitly instructed never to invent figures.
        </p>
      </motion.div>

      <div
        className="qa-panel"
        style={{
          padding: 18,
          display: "grid",
          gridTemplateColumns: "minmax(220px, 2fr) minmax(180px, 1.5fr) auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          Target URL
          <input className="qa-input" placeholder="https://www.allureesthetic.com/" value={url} onChange={(ev) => setUrl(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && run()} style={{ padding: "8px 12px" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          Keyword
          <input className="qa-input" placeholder="samosa" value={keyword} onChange={(ev) => setKeyword(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && run()} style={{ padding: "8px 12px" }} />
        </label>
        <button className="qa-btn-primary" onClick={run} disabled={loading || !url.trim() || !keyword.trim()} style={{ padding: "10px 22px", whiteSpace: "nowrap" }}>
          {loading ? "Predicting…" : "Predict impact"}
        </button>
        {keyword.trim() && (() => {
          let domain: string | undefined;
          try { domain = new URL(url.trim()).hostname; } catch { /* ignore */ }
          return <AskCouncilButton term={keyword} domain={domain} compact />;
        })()}
      </div>

      {error && <ErrorBanner error={error} />}

      <AnimatePresence mode="wait">
        {loading && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="qa-loading-panel" style={{ padding: 50 }}>
            <span className="qa-spinner qa-spinner--lg" />
            <div style={{ marginTop: 16, color: "var(--muted)", textAlign: "center", fontSize: 13, lineHeight: 1.7 }}>
              Fetching volume, trend, SERP, page content, and domain authority…
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Then synthesising with the local LLM. 30–90s typical.</div>
            </div>
          </motion.div>
        )}

        {!loading && result && e && a && (
          <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            {!result.llmAvailable && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="qa-panel"
                style={{
                  padding: "14px 18px",
                  marginBottom: 16,
                  background: "linear-gradient(135deg, rgba(234,179,8,0.08), rgba(234,179,8,0.02))",
                  border: "1px solid rgba(234,179,8,0.4)",
                  display: "flex", alignItems: "flex-start", gap: 12,
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>⚠︎</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>AI synthesis unavailable — evidence still live</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>{result.llmError ?? "Local Ollama is not reachable."}</div>
                </div>
              </motion.div>
            )}

            {/* ── Hero scores (LLM-derived — hide when unavailable) ────────────── */}
            {result.llmAvailable && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 18 }}>
                <ScoreDial label="Opportunity" value={a.opportunityScore} />
                <ScoreDial label="Difficulty" value={a.difficultyScore} invertColor />
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="qa-panel" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>Verdict</div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>{a.verdict}</p>
                  {a.fitWithCurrentContent && (
                    <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--muted)", fontStyle: "italic" }}>
                      Content fit: {a.fitWithCurrentContent}
                    </p>
                  )}
                </motion.div>
              </div>
            )}

            {/* ── Evidence cards ──────────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 18 }}>
              <MetricCard
                label="Monthly searches"
                value={e.volume.avgMonthlySearches != null ? e.volume.avgMonthlySearches.toLocaleString() : "—"}
                sub={e.volume.avgMonthlySearches != null
                  ? `${result.request.region} · Google Ads`
                  : (e.volume.error ?? "Google Ads not configured")}
                highlight
              />
              <MetricCard
                label="Competition"
                value={e.volume.competition ?? "—"}
                sub={e.volume.competitionIndex != null ? `Index: ${e.volume.competitionIndex}/100` : undefined}
              />
              <MetricCard
                label="12-mo trend"
                value={e.trend.direction === "up" ? "↑ Rising" : e.trend.direction === "down" ? "↓ Declining" : e.trend.direction === "flat" ? "→ Flat" : "—"}
                sub={e.trend.interestLast12m != null
                  ? `Avg interest: ${e.trend.interestLast12m}/100`
                  : (e.trend.error ?? "Google Trends")}
              />
              <MetricCard
                label="Domain Authority"
                value={e.domainAuthority.score != null ? `${e.domainAuthority.score}/100` : "—"}
                sub={e.domainAuthority.pageRankDecimal != null ? `OpenPageRank: ${e.domainAuthority.pageRankDecimal.toFixed(1)}` : "OpenPageRank not configured"}
              />
              <MetricCard
                label="Your SERP rank"
                value={e.serp.yourDomainPosition != null ? `#${e.serp.yourDomainPosition}` : "Not in top 10"}
                sub={`Top results: ${e.serp.topResults.length}`}
              />
              <MetricCard
                label="Keyword on page"
                value={e.targetPage.keywordOccurrences > 0 ? `${e.targetPage.keywordOccurrences}× uses` : "Not present"}
                sub={`${e.targetPage.wordCount.toLocaleString()} words total`}
              />
            </div>

            {/* ── Charts row: trend + SERP ──────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 18 }}>
              {trendSeries.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="qa-panel" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Search interest · last 12 months</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={trendSeries}>
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#111" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#111" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" tick={{ fill: "var(--muted)", fontSize: 11 }} />
                      <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="value" stroke="#111" strokeWidth={2} fill="url(#trendGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
              {serpSeries.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="qa-panel" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Current SERP — who you're up against</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={serpSeries} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" hide domain={[0, 100]} />
                      <YAxis type="category" dataKey="domain" tick={{ fill: "var(--muted)", fontSize: 11 }} width={140} />
                      <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="score" radius={[0, 6, 6, 0]}>
                        {serpSeries.map((r, i) => <Cell key={i} fill={r.isYou ? "#16a34a" : "#111"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
            </div>

            {/* ── Projections timeline (LLM-derived) ──────────────────────── */}
            {result.llmAvailable && a.projections.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="qa-panel" style={{ padding: 22, marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 12 }}>Projected outcomes</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                  {a.projections.map((p, i) => (
                    <motion.div
                      key={p.period}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 + i * 0.08 }}
                      style={{
                        padding: 16,
                        borderRadius: 12,
                        background: "linear-gradient(135deg, rgba(0,0,0,0.03), transparent)",
                        border: "1px solid var(--border)",
                        position: "relative",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{p.period}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginTop: 8 }}>{p.rankingEstimate}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text)", opacity: 0.8, marginTop: 4 }}>{p.trafficDelta}</div>
                      <div style={{ display: "inline-block", marginTop: 10, padding: "3px 10px", borderRadius: 999, fontSize: 10, fontWeight: 700, color: "#fff", background: CONFIDENCE_COLORS[p.confidence], letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        {p.confidence} confidence
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Lists (LLM-derived) ──────────────────────────────────────── */}
            {result.llmAvailable && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                <ListCard title="Recommendations" items={a.recommendations} icon="✓" color="#111" />
                <ListCard title="Quick wins" items={a.quickWins} icon="⚡" color="#16a34a" />
                <ListCard title="Risks" items={a.risks} icon="!" color="#dc2626" />
                <ListCard title="Metrics to watch" items={a.keyMetricsToWatch} icon="◉" color="#475569" />
              </div>
            )}

            {e.missingFields.length > 0 && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="qa-footnote" style={{ marginTop: 18 }}>
                Fields unavailable in this prediction: <code>{e.missingFields.join(", ")}</code>. Connect Google (/google-connections) or set the matching API keys in <code>.env</code> to fill the gap.
              </motion.p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
