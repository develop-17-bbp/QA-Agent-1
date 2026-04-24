import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { BarChart, Bar, ResponsiveContainer } from "recharts";
import { fetchKeywordResearch, fetchKeywordSuggestions, fetchKeywordTrends, fetchGscKeywordStats, fetchBrandMentionsAggregated, type GscSite, type BrandMentionRow } from "../api";
import { useGoogleOverlay } from "../lib/google-overlay";
import { useRegion } from "../components/RegionPicker";
import { FilterableTable, type FilterableColumn } from "../components/FilterableTable";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import CouncilSidecar from "../components/CouncilSidecar";
import { ProvenanceBadge } from "../components/ProvenanceDot";

import { ErrorBanner } from "../components/UI";
/**
 * Per-site GSC stats for the queried keyword. Each entry is what Google
 * actually reported for the user's own verified property over the last
 * 28 days — not a scrape, not an estimate.
 */
type PerSiteGscStat = {
  site: GscSite;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

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

/** Bucket RSS/news mentions into the 4 most recent ISO weeks (oldest → newest)
 *  so we can show a compact sparkline of how often the keyword is being
 *  written about. Mentions with no publishedAt are dropped (most RSS feeds
 *  do provide one; a few don't). */
function bucketArticleVelocity(mentions: BrandMentionRow[]): { weekly: number[]; total: number; startedAt: string | null } {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const weekly = [0, 0, 0, 0]; // oldest → newest
  let counted = 0;
  for (const m of mentions) {
    if (!m.publishedAt) continue;
    const t = Date.parse(m.publishedAt);
    if (!Number.isFinite(t)) continue;
    const delta = now - t;
    if (delta < 0 || delta > 4 * week) continue;
    const idx = 3 - Math.floor(delta / week); // newest → last bucket
    if (idx >= 0 && idx < 4) {
      weekly[idx]!++;
      counted++;
    }
  }
  const startedAt = new Date(now - 4 * week).toISOString().slice(0, 10);
  return { weekly, total: counted, startedAt };
}

export default function KeywordOverview() {
  const [keyword, setKeyword] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google overlay — when connected, query the keyword against every
  // verified GSC property in parallel so the user sees their own sites'
  // real performance for it.
  const overlay = useGoogleOverlay();
  const [perSiteGsc, setPerSiteGsc] = useState<PerSiteGscStat[]>([]);
  const [gscLoading, setGscLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [trend, setTrend] = useState<any>(null);
  const [velocity, setVelocity] = useState<{ weekly: number[]; total: number; startedAt: string | null; providersHit: string[] } | null>(null);
  const [region] = useRegion();

  const research = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setLoading(true);
    setError(null);
    setPerSiteGsc([]);
    setSuggestions([]);
    setQuestions([]);
    setTrend(null);
    setVelocity(null);
    try {
      const [main, sugg, tr, vel] = await Promise.allSettled([
        fetchKeywordResearch(kw, region),
        fetchKeywordSuggestions(kw, "en", region),
        fetchKeywordTrends(kw, region),
        fetchBrandMentionsAggregated(kw),
      ]);
      if (main.status === "fulfilled") setData(main.value);
      else setError(main.reason?.message ?? String(main.reason));
      if (sugg.status === "fulfilled") { setSuggestions(sugg.value.suggestions); setQuestions(sugg.value.questions); }
      if (tr.status === "fulfilled") setTrend(tr.value);
      if (vel.status === "fulfilled") {
        const bucketed = bucketArticleVelocity(vel.value.mentions ?? []);
        setVelocity({ ...bucketed, providersHit: vel.value.providersHit ?? [] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }

    // In parallel, ask each connected GSC site whether it has any
    // impressions for this exact keyword in the last 28 days. Sites
    // with zero impressions are quietly skipped.
    if (overlay.connected && overlay.gscSites.length > 0) {
      setGscLoading(true);
      try {
        const results = await Promise.all(
          overlay.gscSites.map(async (site) => {
            try {
              const stats = await fetchGscKeywordStats(site.siteUrl, kw, 28);
              if (!stats) return null;
              return {
                site,
                clicks: stats.clicks?.value ?? 0,
                impressions: stats.impressions?.value ?? 0,
                ctr: stats.ctr?.value ?? 0,
                position: stats.position?.value ?? 0,
              } as PerSiteGscStat;
            } catch {
              return null;
            }
          }),
        );
        setPerSiteGsc(
          results
            .filter((r): r is PerSiteGscStat => r !== null && r.impressions > 0)
            .sort((a, b) => b.impressions - a.impressions),
        );
      } finally {
        setGscLoading(false);
      }
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

      {error && <ErrorBanner error={error} />}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 16 }}>
          <MetricCardSkeleton tone="accent" />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      )}

      {(trend || suggestions.length > 0 || questions.length > 0) && !loading && (
        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          {trend && (
            <div className="qa-panel" style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>Trend:</span>
              <span style={{ fontWeight: 700, color: trend.trend === "rising" ? "#38a169" : trend.trend === "falling" ? "#e53e3e" : "var(--muted)" }}>
                {trend.trend === "rising" ? "↑ Rising" : trend.trend === "falling" ? "↓ Falling" : "→ Stable"}
              </span>
              {trend.peakMonth && <span style={{ fontSize: 11, color: "var(--muted)" }}>Peak: {trend.peakMonth}</span>}
              <span style={{ fontSize: 10, color: "var(--muted)" }}>google-trends</span>
            </div>
          )}
          {velocity && (
            <div
              className="qa-panel"
              style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
              title={`${velocity.total} articles across ${velocity.providersHit.length} sources in the last 4 weeks`}
            >
              <span style={{ fontWeight: 600 }}>Articles (4wk):</span>
              <ArticleVelocitySparkline weekly={velocity.weekly} />
              <span style={{ fontWeight: 700 }}>{velocity.total}</span>
              {(() => {
                const w = velocity.weekly;
                const last = w[3] ?? 0;
                const prev = (w[0]! + w[1]! + w[2]!) / 3;
                if (prev < 1 && last < 1) return <span style={{ fontSize: 11, color: "var(--muted)" }}>→ quiet</span>;
                const delta = last - prev;
                const color = delta > 0.3 * Math.max(prev, 1) ? "#38a169" : delta < -0.3 * Math.max(prev, 1) ? "#e53e3e" : "var(--muted)";
                const label = delta > 0.3 * Math.max(prev, 1) ? "↑ accelerating" : delta < -0.3 * Math.max(prev, 1) ? "↓ cooling" : "→ steady";
                return <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>;
              })()}
              <span style={{ fontSize: 10, color: "var(--muted)" }}>rss+news</span>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="qa-panel" style={{ padding: "10px 16px", flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 6 }}>Related (Google Suggest)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {suggestions.map(s => (
                  <button key={s} onClick={() => { setKeyword(s); }} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--glass2)", cursor: "pointer", color: "var(--text)" }}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {questions.length > 0 && (
            <div className="qa-panel" style={{ padding: "10px 16px", flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 6 }}>People Also Ask</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {questions.map(q => (
                  <button key={q} onClick={() => setKeyword(q)} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--glass2)", cursor: "pointer", color: "var(--text)" }}>{q}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {data && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* Top title + Ask the Council deep-link */}
          <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>
              Keyword Overview: <span style={{ fontWeight: 400, color: "var(--muted)" }}>{data.keyword}</span>
            </h2>
            <a
              href={`/term-intel?term=${encodeURIComponent(data.keyword)}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
                borderRadius: 8, background: "var(--accent-light)", color: "var(--accent)",
                border: "1px solid var(--accent-muted)", fontWeight: 600, fontSize: 12.5,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
              title='Query every configured source (Ads, Trends, Suggest, GSC, Bing/Yandex/Ahrefs anchors, RSS, SERPs) for this term and run 4 AI advisors'
            >
              🧭 Ask the Council about this term →
            </a>
          </div>

          {/* Data quality badges — provenance-honest */}
          {data.dataQuality && (
            <div className="qa-panel" style={{ padding: 12, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span className="qa-kicker" style={{ marginRight: 4 }}>Data sources:</span>
              {(data.dataQuality.providersHit ?? []).map((p: string) => (
                <ProvenanceBadge key={p} source={p} confidence="high" note="Returned data for this keyword" />
              ))}
              {(data.dataQuality.providersFailed ?? []).map((p: string) => (
                <ProvenanceBadge key={`fail-${p}`} source={`${p} offline`} confidence="low" note="Provider reachable but returned error or empty response" />
              ))}
              {(data.dataQuality.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
                  • Missing: {(data.dataQuality.missingFields ?? []).join(", ")}
                </span>
              )}
              {(data.dataQuality.estimatedFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--warn, #b45309)", marginLeft: 4 }} title="These fields aren't a direct provider read — they're derived from signals (Trends × Wikipedia blend etc.). The individual metric cards show provenance dots.">
                  • Estimated: {(data.dataQuality.estimatedFields ?? []).join(", ")}
                </span>
              )}
            </div>
          )}

          {/* ── Headline KPI strip (uniform MetricCards) ─────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
            <MetricCard
              label="Monthly volume"
              value={data.volume}
              format="compact"
              tone="accent"
              sparkline={Array.isArray(data.trend) ? data.trend : undefined}
              caption={`${region} region`}
              source="google-ads"
            />
            <MetricCard
              label="Keyword difficulty"
              value={data.difficulty}
              format="percent"
              tone={data.difficulty >= 80 ? "bad" : data.difficulty >= 50 ? "warn" : "ok"}
              caption={data.difficultyLabel}
            />
            <MetricCard
              label="CPC"
              value={data.cpc ?? 0}
              format="currency"
              tone="default"
              caption={`Competitive density: ${data.competitiveDensity?.toFixed(2) ?? "0.00"}`}
              source="google-ads"
            />
            <MetricCard
              label="Global volume"
              value={data.globalVolume ?? 0}
              format="compact"
              tone="default"
              caption={`${(data.countryVolumes ?? []).length} countries tracked`}
            />
            {velocity && (
              <MetricCard
                label="Articles (4 weeks)"
                value={velocity.total}
                format="compact"
                sparkline={velocity.weekly}
                tone={velocity.total > 20 ? "ok" : "default"}
                caption={`${velocity.providersHit.length} RSS sources`}
                source="rss"
              />
            )}
          </div>

          {/* ── Metrics Row ──────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
            {/* Volume */}
            <div className="qa-panel" style={{ padding: 16 }}>
              <div className="qa-kicker" style={{ marginBottom: 4 }}>Volume</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{formatVolume(data.volume)}</div>
              <div style={{ borderTop: "3px solid var(--accent)", marginTop: 8 }} />
              <div className="qa-kicker" style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Keyword Difficulty</span>
                {data.difficultyBreakdown?.method && (
                  <span title="Multi-factor scoring: authority of top-10 × Ads competition × SERP saturation × content depth" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, padding: "1px 5px", borderRadius: 6, background: "#dcfce7", color: "#166534" }}>
                    v2
                  </span>
                )}
              </div>
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
              {data.difficultyBreakdown && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", fontSize: 10.5, color: "var(--muted)", lineHeight: 1.55 }}>
                  <div style={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", fontSize: 9, marginBottom: 4 }}>Breakdown</div>
                  {[
                    { id: "A", label: "Top-10 authority", info: data.difficultyBreakdown.breakdown.authorityOfTop10 },
                    { id: "B", label: "Ads competition", info: data.difficultyBreakdown.breakdown.adsCompetition },
                    { id: "C", label: "SERP saturation", info: data.difficultyBreakdown.breakdown.serpSaturation },
                    { id: "D", label: "Content depth",    info: data.difficultyBreakdown.breakdown.contentDepth },
                  ].map((row) => (
                    <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "1px 0", opacity: row.info.available ? 1 : 0.45 }} title={row.info.note ?? ""}>
                      <span>{row.label}</span>
                      <span style={{ fontWeight: 600, color: row.info.available ? "var(--text)" : "var(--muted)" }}>
                        {row.info.available ? row.info.score : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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

          {/* ── Your real GSC performance for this keyword ───────── */}
          {overlay.loaded && !overlay.connected && (
            <div className="qa-panel" style={{ padding: 10, marginBottom: 16, fontSize: 12, display: "flex", alignItems: "center", gap: 8, background: "var(--bg-app)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#94a3b8" }} />
              <span>
                Connect Google to see real impressions, clicks, and average position for <strong>{data.keyword}</strong> on your own sites.
                <a href="/google-connections" style={{ marginLeft: 6, color: "var(--accent, #111111)" }}>Connect →</a>
              </span>
            </div>
          )}
          {overlay.connected && gscLoading && (
            <div className="qa-panel" style={{ padding: 10, marginBottom: 16, fontSize: 12, color: "var(--muted)" }}>
              Checking your verified Google Search Console properties for <strong>{data.keyword}</strong>…
            </div>
          )}
          {overlay.connected && !gscLoading && perSiteGsc.length > 0 && (
            <div className="qa-panel" style={{ padding: 16, marginBottom: 16, borderLeft: "3px solid #38a169" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#38a169", marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                Your real performance for &quot;{data.keyword}&quot; (last 28 days · Google Search Console)
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th style={{ textAlign: "right" }}>Impressions</th>
                    <th style={{ textAlign: "right" }}>Clicks</th>
                    <th style={{ textAlign: "right" }}>CTR</th>
                    <th style={{ textAlign: "right" }}>Avg position</th>
                  </tr>
                </thead>
                <tbody>
                  {perSiteGsc.map((r) => (
                    <tr key={r.site.siteUrl}>
                      <td style={{ fontWeight: 600 }}>{r.site.siteUrl}</td>
                      <td style={{ textAlign: "right" }}>{r.impressions.toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>{r.clicks.toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>{r.ctr.toFixed(2)}%</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: r.position <= 3 ? "#38a169" : r.position <= 10 ? "#dd6b20" : "#e53e3e" }}>
                        {r.position.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {overlay.connected && !gscLoading && perSiteGsc.length === 0 && overlay.gscSites.length > 0 && (
            <div className="qa-panel" style={{ padding: 10, marginBottom: 16, fontSize: 12, color: "var(--muted)" }}>
              None of your {overlay.gscSites.length} verified site{overlay.gscSites.length === 1 ? "" : "s"} had impressions for <strong>{data.keyword}</strong> in the last 28 days.
            </div>
          )}

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
            <div className="qa-panel" style={{ padding: 16 }}>
              <h3 className="qa-panel-title" style={{ marginBottom: 10 }}>All Keyword Variations</h3>
              <VariationsTable rows={data.variations ?? []} filename={`variations-${data.keyword}`} />
            </div>
          )}
          {(data.questions ?? []).length > 5 && (
            <div className="qa-panel" style={{ padding: 16, marginTop: 16 }}>
              <h3 className="qa-panel-title" style={{ marginBottom: 10 }}>All Questions</h3>
              <VariationsTable rows={data.questions ?? []} filename={`questions-${data.keyword}`} />
            </div>
          )}

          {/* Embedded Council Sidecar — cross-source intel + AI advisors inline */}
          <CouncilSidecar term={data.keyword} autoInvoke />
        </motion.div>
      )}
    </div>
  );
}

/** 4-bar sparkline (oldest → newest). Bars scale relative to the max in
 *  the series so a low-activity keyword still shows shape. */
function ArticleVelocitySparkline({ weekly }: { weekly: number[] }) {
  const max = Math.max(1, ...weekly);
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 22 }} aria-label={`Weekly counts: ${weekly.join(", ")}`}>
      {weekly.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * 22));
        return (
          <div
            key={i}
            title={`Week ${i + 1}: ${v}`}
            style={{
              width: 6,
              height: h,
              background: i === weekly.length - 1 ? "var(--accent)" : "var(--accent)",
              opacity: 0.4 + (i * 0.2),
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}

interface VarRow { keyword: string; volume: number; difficulty: number }

function VariationsTable({ rows, filename }: { rows: VarRow[]; filename: string }) {
  const columns: FilterableColumn<VarRow>[] = useMemo(() => [
    {
      key: "keyword",
      label: "Keyword",
      accessor: (r) => r.keyword,
      filterType: "text",
      render: (r) => <span style={{ fontWeight: 600, color: "var(--accent)" }}>{r.keyword}</span>,
    },
    {
      key: "volume",
      label: "Volume",
      accessor: (r) => r.volume ?? 0,
      filterType: "number",
      width: 130,
      render: (r) => <span>{formatVolume(r.volume ?? 0)}</span>,
      headerStyle: { textAlign: "right" },
      cellStyle: { textAlign: "right" },
    },
    {
      key: "difficulty",
      label: "KD %",
      accessor: (r) => r.difficulty ?? 0,
      filterType: "number",
      width: 110,
      render: (r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {r.difficulty}
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: DIFF_COLORS(r.difficulty ?? 0) }} />
        </span>
      ),
      headerStyle: { textAlign: "right" },
      cellStyle: { textAlign: "right" },
    },
  ], []);
  return (
    <FilterableTable<VarRow>
      rows={rows}
      columns={columns}
      rowKey={(r) => r.keyword}
      pageSize={50}
      itemLabel="keyword"
      exportFilename={filename}
    />
  );
}
