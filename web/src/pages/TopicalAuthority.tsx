import { useEffect, useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import RunSelector from "../components/RunSelector";
import { fetchTopicalAuthority, fetchGscSites, type TopicalAuthorityResponse, type TopicalAuthorityRow, type GscSite } from "../api";

const TIER_BG: Record<TopicalAuthorityRow["tier"], string> = {
  authoritative: "#dcfce7",
  established:   "#dbeafe",
  emerging:      "#fef3c7",
  thin:          "#fef2f2",
};
const TIER_COLOR: Record<TopicalAuthorityRow["tier"], string> = {
  authoritative: "#166534",
  established:   "#1e3a8a",
  emerging:      "#92400e",
  thin:          "#991b1b",
};

export default function TopicalAuthority() {
  const [runId, setRunId] = useState("");
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [gscSiteUrl, setGscSiteUrl] = useState("");
  const [data, setData] = useState<TopicalAuthorityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { fetchGscSites().then(setGscSites).catch(() => {}); }, []);

  const run = async () => {
    if (!runId) { setError("pick a run"); return; }
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchTopicalAuthority(runId, gscSiteUrl || undefined)); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  };

  return (
    <PageShell
      title="Topical Authority"
      desc="Measures how authoritative your domain is on each TOPIC, not just overall. Google's E-E-A-T framework rewards topic-level expertise; this surfaces where you're authoritative vs thin."
      purpose="On which topics does Google trust me, and which clusters need more depth before they'll rank?"
      sources={["Crawl pages bucketed by URL section", "GSC impressions + average position per page (when connected)"]}
    >
      <PageHero
        icon="bar-chart"
        eyebrow="Topical Authority"
        title={data ? data.hostname : "Pick a crawl run"}
        subtitle={data ? `${data.totalSections} topics scored across ${data.totalPages} pages` : "Composite of content depth, search demand, ranking quality, page density, and citation density per topic."}
        accent
      />

      <SectionCard title="Score">
        <RunSelector value={runId} onChange={setRunId} label="Crawl run" />
        <div style={{ marginTop: 12 }}>
          <div className="qa-kicker" style={{ marginBottom: 4 }}>GSC site (optional — adds impressions + position layer)</div>
          <select className="qa-input" value={gscSiteUrl} onChange={(e) => setGscSiteUrl(e.target.value)} style={{ width: "100%" }}>
            <option value="">— skip GSC layer —</option>
            {gscSites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={run} disabled={loading || !runId} className="qa-btn-primary" style={{ padding: "10px 22px", fontWeight: 700 }}>
            {loading ? "Scoring…" : "Score topics"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      </SectionCard>

      {loading && <LoadingPanel message="Bucketing pages by section, layering GSC, computing scores…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="Topics scored" value={data.totalSections} caption={`${data.totalPages} pages`} tone="accent" />
            <MetricCard label="Authoritative" value={data.rows.filter((r) => r.tier === "authoritative").length} tone="ok" caption="score ≥ 75" />
            <MetricCard label="Emerging" value={data.rows.filter((r) => r.tier === "emerging").length} tone="warn" caption="35-54" />
            <MetricCard label="Thin" value={data.rows.filter((r) => r.tier === "thin").length} tone="bad" caption="< 35 — Google doesn't trust" />
          </div>

          {data.rows.length === 0 ? (
            <SectionCard title="No topics found">
              <EmptyState title="Site has no clear sections" hint="Topical Authority needs ≥2 pages per URL section. This run may have crawled too few pages or the site uses a flat URL structure." />
            </SectionCard>
          ) : (
            <SectionCard title={`Topics (${data.rows.length})`}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "8px" }}>Section</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>Tier</th>
                    <th style={{ textAlign: "right", padding: "8px" }}>Score</th>
                    <th style={{ textAlign: "right", padding: "8px" }}>Pages</th>
                    <th style={{ textAlign: "right", padding: "8px" }}>Avg words</th>
                    <th style={{ textAlign: "right", padding: "8px" }}>GSC impr</th>
                    <th style={{ textAlign: "right", padding: "8px" }}>Avg pos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.section} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px" }}>
                        <code style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent)" }}>{r.section}</code>
                        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{r.label}</div>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: TIER_BG[r.tier], color: TIER_COLOR[r.tier], fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
                          {r.tier}
                        </span>
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", fontWeight: 800, fontSize: 14, color: TIER_COLOR[r.tier] }}>{r.authorityScore}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{r.pageCount}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: "var(--muted)" }}>{r.avgWordCount.toLocaleString()}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: "var(--muted)" }}>{r.avgGscImpressions != null ? r.avgGscImpressions.toLocaleString() : "—"}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: r.avgGscPosition != null && r.avgGscPosition <= 10 ? "#16a34a" : "var(--muted)" }}>{r.avgGscPosition != null ? `#${r.avgGscPosition}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          )}
        </>
      )}
    </PageShell>
  );
}
