import { useEffect, useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchCannibalization, fetchGscSites, type CannibalizationResponse, type CannibalCandidate, type GscSite } from "../api";

const SEV_BG: Record<CannibalCandidate["severity"], string> = {
  low: "#f1f5f9",
  medium: "#fef3c7",
  high: "#fef2f2",
};
const SEV_COLOR: Record<CannibalCandidate["severity"], string> = {
  low: "#475569",
  medium: "#92400e",
  high: "#991b1b",
};

export default function Cannibalization() {
  const [siteUrl, setSiteUrl] = useState("");
  const [windowDays, setWindowDays] = useState(28);
  const [minPages, setMinPages] = useState(2);
  const [impressionsFloor, setImpressionsFloor] = useState(50);
  const [sites, setSites] = useState<GscSite[]>([]);
  const [data, setData] = useState<CannibalizationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchGscSites().then((s) => setSites(s ?? [])).catch(() => {});
  }, []);

  const run = async () => {
    if (!siteUrl.trim()) { setError("pick a GSC site"); return; }
    setLoading(true); setError(""); setData(null);
    try {
      setData(await fetchCannibalization(siteUrl.trim(), { windowDays, minPages, impressionsFloor }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell
      title="Keyword Cannibalization"
      desc="Finds queries where multiple pages on YOUR site compete for the same SERP slot. Every number comes from your own Google Search Console — no third-party estimates."
      purpose="Which of my queries have two-or-more pages cannibalizing each other, and what's the impressions-at-risk?"
      sources={["Google Search Console (28-day window)"]}
    >
      <PageHero
        icon="target"
        eyebrow="Cannibalization"
        title={data ? data.siteUrl : "Pick a verified site"}
        subtitle={data ? `${data.totalConflicts} conflicts across ${data.totalQueries} queries · ${data.totalImpressionsAtRisk.toLocaleString()} impressions at risk` : "Detects pages that compete for the same query so you can consolidate, canonicalize, or 301."}
        accent
      />

      <SectionCard title="Detect">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 280 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Verified GSC site</div>
            <select className="qa-input" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} style={{ width: "100%" }}>
              <option value="">— pick a site —</option>
              {sites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
            </select>
          </label>
          <label style={{ width: 110 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Window (days)</div>
            <input className="qa-input" type="number" min={7} max={90} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value) || 28)} style={{ width: "100%" }} />
          </label>
          <label style={{ width: 110 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Min pages</div>
            <input className="qa-input" type="number" min={2} max={6} value={minPages} onChange={(e) => setMinPages(Number(e.target.value) || 2)} style={{ width: "100%" }} />
          </label>
          <label style={{ width: 130 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Min impressions</div>
            <input className="qa-input" type="number" min={1} value={impressionsFloor} onChange={(e) => setImpressionsFloor(Number(e.target.value) || 50)} style={{ width: "100%" }} />
          </label>
          <button onClick={run} disabled={loading || !siteUrl.trim()} className="qa-btn-primary" style={{ padding: "10px 20px", fontWeight: 700 }}>
            {loading ? "Scanning…" : "Detect conflicts"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
        {sites.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            No GSC sites loaded — connect Google at <code>/google-connections</code> first.
          </div>
        )}
      </SectionCard>

      {loading && <LoadingPanel message="Pulling 28 days of (query, page) rows from GSC…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="Conflicts" value={data.totalConflicts} tone={data.totalConflicts > 10 ? "warn" : "default"} caption={`out of ${data.totalQueries} queries`} />
            <MetricCard label="Impressions at risk" value={data.totalImpressionsAtRisk.toLocaleString()} tone="accent" caption="combined across conflicts" />
            <MetricCard label="High severity" value={data.candidates.filter((c) => c.severity === "high").length} tone="bad" caption="≥5K impressions or ≥4 pages" />
            <MetricCard label="Medium" value={data.candidates.filter((c) => c.severity === "medium").length} tone="warn" caption="≥500 impressions or 3 pages" />
          </div>

          {data.candidates.length === 0 ? (
            <SectionCard title="No conflicts detected">
              <EmptyState title="Your pages aren't cannibalizing each other" hint={`No queries had ${minPages}+ pages above the impression floor in the ${data.startDate} → ${data.endDate} window.`} />
            </SectionCard>
          ) : (
            <SectionCard title={`Conflicts (${data.candidates.length})`}>
              {data.candidates.map((c) => <ConflictCard key={c.query} c={c} />)}
            </SectionCard>
          )}
        </>
      )}
    </PageShell>
  );
}

function ConflictCard({ c }: { c: CannibalCandidate }) {
  return (
    <div className="qa-panel" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          padding: "2px 8px", borderRadius: 10,
          background: SEV_BG[c.severity],
          color: SEV_COLOR[c.severity],
          textTransform: "uppercase",
        }}>
          {c.severity}
        </span>
        <strong style={{ fontSize: 13.5 }}>"{c.query}"</strong>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {c.pages.length} pages · {c.combinedImpressions.toLocaleString()} impressions · {c.combinedClicks} clicks
        </span>
      </div>
      <table className="qa-table" style={{ width: "100%", fontSize: 12 }}>
        <thead><tr><th>Role</th><th>URL</th><th>Pos</th><th>Impressions</th><th>Clicks</th><th>CTR</th></tr></thead>
        <tbody>
          {c.pages.map((p) => {
            const isWinner = p.url === c.winner;
            return (
              <tr key={p.url} style={{ background: isWinner ? "rgba(22,163,74,0.05)" : undefined }}>
                <td>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                    padding: "2px 8px", borderRadius: 10,
                    background: isWinner ? "#dcfce7" : "#fef3c7",
                    color: isWinner ? "#166534" : "#92400e",
                    textTransform: "uppercase",
                  }}>
                    {isWinner ? "winner" : "consolidate"}
                  </span>
                </td>
                <td><a href={p.url} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all", color: "var(--text)", fontSize: 11.5 }}>{p.url}</a></td>
                <td style={{ fontWeight: 700, color: p.avgPosition <= 3 ? "#16a34a" : p.avgPosition <= 10 ? "#d97706" : "var(--muted)" }}>
                  {p.avgPosition.toFixed(1)}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.impressions.toLocaleString()}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.clicks}</td>
                <td>{(p.ctr * 100).toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {c.losers.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          <strong style={{ color: "var(--text)" }}>Recommendation:</strong> consolidate {c.losers.length} loser{c.losers.length === 1 ? "" : "s"} into the winner via 301 redirect or rel=canonical, OR rewrite each page to target distinct intents.
        </div>
      )}
    </div>
  );
}
