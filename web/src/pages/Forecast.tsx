import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { LineTrendChart } from "../components/Chart";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner } from "../components/UI";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { ChartSkeleton, TableSkeleton } from "../components/Skeletons";
import AskCouncilButton from "../components/AskCouncilButton";
import {
  fetchForecastApi,
  type ForecastResponse,
  type KeywordForecast,
  type CouncilAdvisor,
} from "../api";

const CONFIDENCE_COLORS: Record<KeywordForecast["confidenceBand"], string> = {
  high: "#16a34a",
  medium: "#d97706",
  low: "#94a3b8",
};

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>;
  if (delta === 0) return <span style={{ color: "var(--muted)", fontWeight: 600 }}>→ flat</span>;
  const worse = delta > 0;
  return (
    <span style={{ color: worse ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
      {worse ? "↓" : "↑"} {Math.abs(delta)} {worse ? "drop" : "gain"}
    </span>
  );
}

function AdvisorCard({ advisor, verdict }: { advisor: CouncilAdvisor; verdict: string | undefined }) {
  return (
    <div title={advisor.focus} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
        {advisor.name}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>
        {verdict ?? <span style={{ color: "var(--muted)", fontStyle: "italic" }}>no verdict</span>}
      </div>
    </div>
  );
}

export default function Forecast() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ForecastResponse | null>(null);

  const run = async () => {
    const d = domain.trim();
    if (!d) { setError("enter a domain"); return; }
    setError(""); setLoading(true); setData(null);
    try {
      setData(await fetchForecastApi(d));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const council = data?.council && !("error" in (data.council as any))
    ? (data.council as Exclude<typeof data.council, null | { error: string }>)
    : null;

  const topChart = useMemo(() => {
    if (!data) return [];
    const top = data.perKeyword
      .filter((f) => typeof f.latestRank === "number" && typeof f.projectedRank === "number")
      .slice(0, 5);
    if (top.length === 0) return [];
    // Single synthetic chart: x = Current or +30d; y per keyword
    return [
      { label: "Now", ...Object.fromEntries(top.map((k) => [k.keyword, k.latestRank])) },
      { label: "+30d", ...Object.fromEntries(top.map((k) => [k.keyword, k.projectedRank])) },
    ] as Record<string, string | number | null>[];
  }, [data]);

  const topKeywords = useMemo(() => {
    if (!data) return [];
    return data.perKeyword
      .filter((f) => typeof f.latestRank === "number" && typeof f.projectedRank === "number")
      .slice(0, 5);
  }, [data]);

  return (
    <PageShell
      title="Forecast"
      desc="30-day rank projections grounded in YOUR own tracked position history. Linear regression per keyword; advisors explain causes + actions on top. Nothing comes from strangers' data."
      purpose="Which of my tracked keywords are about to drop next month, which are about to break through, and what should I do about it?"
      sources={["Position history DB", "Agentic council"]}
    >
      <SectionCard title="Pick a domain">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 260 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Domain</div>
            <input
              className="qa-input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && run()}
              placeholder="e.g. example.com"
              disabled={loading}
              style={{ width: "100%", padding: "8px 12px" }}
            />
          </label>
          <button
            onClick={run}
            disabled={loading || !domain.trim()}
            className="qa-btn-primary"
            style={{ padding: "10px 22px", fontWeight: 700 }}
          >
            {loading ? "Forecasting…" : "Forecast next 30 days"}
          </button>
          {domain.trim() && <AskCouncilButton term={domain.trim()} compact />}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
          Requires at least 7 days of tracked-keyword history for this domain. Use <a href="/position-tracking" style={{ color: "var(--accent)" }}>Position Tracking → Sweep all GSC queries</a> to auto-populate.
        </div>
      </SectionCard>

      {error && <ErrorBanner error={error} />}
      {loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            <MetricCardSkeleton /><MetricCardSkeleton /><MetricCardSkeleton /><MetricCardSkeleton />
          </div>
          <ChartSkeleton height={260} />
          <div style={{ marginTop: 14 }}><TableSkeleton rows={5} cols={5} /></div>
        </>
      )}

      {data && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            <MetricCard
              label="Avg projected delta"
              value={data.aggregate.avgProjectedDelta}
              tone={data.aggregate.avgProjectedDelta > 1 ? "bad" : data.aggregate.avgProjectedDelta < -1 ? "ok" : "default"}
              caption={data.aggregate.avgProjectedDelta > 0 ? "positive = rank going up (worse)" : data.aggregate.avgProjectedDelta < 0 ? "negative = rank going down (better)" : "flat"}
              format="raw"
            />
            <MetricCard
              label="At-risk keywords"
              value={data.aggregate.atRiskKeywords.length}
              tone={data.aggregate.atRiskKeywords.length > 0 ? "warn" : "ok"}
              caption="projected drop ≥5 positions"
              format="compact"
            />
            <MetricCard
              label="Breakthrough candidates"
              value={data.aggregate.breakthroughKeywords.length}
              tone="accent"
              caption="projected gain ≥3 positions"
              format="compact"
            />
            <MetricCard
              label="Median R²"
              value={data.aggregate.medianConfidenceR2}
              tone={data.aggregate.medianConfidenceR2 >= 0.7 ? "ok" : data.aggregate.medianConfidenceR2 >= 0.4 ? "warn" : "default"}
              caption={`${data.aggregate.pairsForecastable}/${data.aggregate.pairsTracked} keywords forecastable`}
            />
          </div>

          {data.aggregate.pairsTracked === 0 ? (
            <EmptyState
              title={`No tracked keywords for ${data.aggregate.domain} yet.`}
              hint="Go to Position Tracking → 'Sweep all GSC queries' to auto-register everything your site already ranks for, then come back in a week."
            />
          ) : (
            <>
              {topChart.length > 1 && topKeywords.length > 0 && (
                <SectionCard title={`Projected rank trajectory — top 5 keywords`}>
                  <LineTrendChart
                    data={topChart as Record<string, unknown>[]}
                    xKey="label"
                    height={320}
                    yReversed
                    yDomain={[1, "auto"]}
                    series={topKeywords.map((k, i) => ({
                      key: k.keyword,
                      label: k.keyword,
                      color: ["#4f46e5", "#ef4444", "#16a34a", "#d97706", "#0ea5e9"][i % 5],
                    }))}
                  />
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
                    Left = current rank · Right = projected +30d · lower is better
                  </div>
                </SectionCard>
              )}

              {council && (
                <SectionCard title={`Council verdict on ${data.aggregate.domain}'s next 30 days`} actions={<span style={{ fontSize: 11, color: "var(--muted)" }}>{council.model} · {council.durationMs}ms</span>}>
                  <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.55, marginBottom: 12, padding: "12px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8 }}>
                    {council.synthesis}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {(council.reviewedItemIds && council.reviewedItemIds.length > 0
                      ? [{ id: council.reviewedItemIds[0]! }]
                      : [{ id: data.aggregate.domain }]
                    ).map((it) => (data as ForecastResponse).council && ((data as ForecastResponse).council as any).verdicts?.[it.id] && (
                      <div key={it.id} style={{ display: "contents" }}>
                        {Object.entries(((data as ForecastResponse).council as any).verdicts[it.id] as Record<string, string>).map(([advisorId, verdict]) => {
                          const advisor: CouncilAdvisor = advisorId === "content" ? { id: "content", name: "Content Strategist", focus: "Which at-risk keywords need content refresh" }
                            : advisorId === "technical" ? { id: "technical", name: "Technical SEO", focus: "Which breakthroughs are helped by crawl/indexing wins" }
                            : advisorId === "competitive" ? { id: "competitive", name: "Competitive Analyst", focus: "Where competitors are gaining ground" }
                            : { id: advisorId, name: advisorId === "performance" ? "Performance Engineer" : advisorId, focus: "Core Web Vitals / speed correlation with rank movement" };
                          return <AdvisorCard key={advisorId} advisor={advisor} verdict={verdict} />;
                        })}
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {data.councilError && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontSize: 12.5, marginBottom: 14 }}>
                  AI advisor panel failed: {data.councilError}. Numeric forecast below is still valid.
                </div>
              )}

              <SectionCard title={`At-risk keywords (${data.aggregate.atRiskKeywords.length})`} actions={<span style={{ fontSize: 11, color: "#b91c1c" }}>projected rank drop ≥5 positions</span>}>
                {data.aggregate.atRiskKeywords.length === 0 ? (
                  <EmptyState title="No at-risk keywords" hint="No tracked keywords are projected to drop ≥5 positions next month." />
                ) : (
                  <ForecastTable rows={data.aggregate.atRiskKeywords} />
                )}
              </SectionCard>

              <SectionCard title={`Breakthrough candidates (${data.aggregate.breakthroughKeywords.length})`} actions={<span style={{ fontSize: 11, color: "#16a34a" }}>projected rank gain ≥3 positions</span>}>
                {data.aggregate.breakthroughKeywords.length === 0 ? (
                  <EmptyState title="No breakthroughs projected" hint="None of the tracked keywords are on a strong upward trajectory." />
                ) : (
                  <ForecastTable rows={data.aggregate.breakthroughKeywords} />
                )}
              </SectionCard>
            </>
          )}
        </motion.div>
      )}
    </PageShell>
  );
}

function ForecastTable({ rows }: { rows: KeywordForecast[] }) {
  return (
    <div style={{ maxHeight: 480, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            {["Keyword", "Now", "+30d", "Δ", "Conf R²", "Samples", ""].map((h) => (
              <th key={h} style={{ position: "sticky", top: 0, background: "var(--glass2)", padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.domain}::${r.keyword}`} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "6px 10px", fontWeight: 500 }}>{r.keyword}</td>
              <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums" }}>#{r.latestRank ?? "—"}</td>
              <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums" }}>#{r.projectedRank ?? "—"}</td>
              <td style={{ padding: "6px 10px" }}><DeltaBadge delta={r.projectedDelta} /></td>
              <td style={{ padding: "6px 10px", color: CONFIDENCE_COLORS[r.confidenceBand], fontWeight: 600 }} title={`Band: ${r.confidenceBand}`}>{r.confidenceR2.toFixed(2)}</td>
              <td style={{ padding: "6px 10px", color: "var(--muted)" }}>{r.sampleCount}</td>
              <td style={{ padding: "6px 10px" }}><AskCouncilButton term={r.keyword} domain={r.domain} compact /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
