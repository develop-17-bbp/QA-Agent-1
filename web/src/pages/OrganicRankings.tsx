import { useState, useEffect, useMemo } from "react";
import { BarTrendChart } from "../components/Chart";
import RunSelector from "../components/RunSelector";
import { fetchOrganicRankings, fetchGscPagesBatch } from "../api";
import { useGoogleOverlay } from "../lib/google-overlay";
import { FilterableTable, type FilterableColumn } from "../components/FilterableTable";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";

import { ErrorBanner } from "../components/UI";
import { HeroSkeleton, ChartSkeleton, TableSkeleton } from "../components/Skeletons";

function getGsc(gscPages: Map<string, any>, url: string) {
  if (gscPages.has(url)) return gscPages.get(url);
  try {
    const path = new URL(url).pathname;
    for (const [k, v] of gscPages) {
      try { if (new URL(k).pathname === path) return v; } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

interface Ranking {
  url: string;
  title?: string;
  score: number;
}

export default function OrganicRankings() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState("");
  const overlay = useGoogleOverlay(domain);
  const [gscPages, setGscPages] = useState<Map<string, any>>(new Map());

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true); setError("");
    setGscPages(new Map());
    try { setData(await fetchOrganicRankings(rid)); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!data) return;
    const firstUrl = data.rankings?.[0]?.url ?? "";
    if (firstUrl) {
      try { setDomain(new URL(firstUrl).hostname.replace(/^www\./, "")); } catch { /* skip */ }
    }
  }, [data]);

  useEffect(() => {
    if (!overlay.matchedGscSite) return;
    fetchGscPagesBatch(overlay.matchedGscSite.siteUrl, 28, 500)
      .then((pages: any[]) => {
        const m = new Map<string, any>();
        for (const p of pages) m.set(p.page ?? p.url ?? "", p);
        setGscPages(m);
      })
      .catch(() => { /* silent — optional overlay */ });
  }, [overlay.matchedGscSite?.siteUrl]);

  const rankings: Ranking[] = data?.rankings ?? [];
  const dist = data?.distribution ?? {};
  const distData = [
    { name: "Excellent (80+)", value: dist.excellent ?? 0, fill: "#16a34a" },
    { name: "Good (60-79)", value: dist.good ?? 0, fill: "#2563eb" },
    { name: "Average (40-59)", value: dist.average ?? 0, fill: "#d97706" },
    { name: "Poor (<40)", value: dist.poor ?? 0, fill: "#dc2626" },
  ];

  const hasGsc = gscPages.size > 0;

  const columns: FilterableColumn<Ranking>[] = useMemo(() => {
    const cols: FilterableColumn<Ranking>[] = [
      {
        key: "url",
        label: "URL",
        accessor: (r) => r.url,
        filterType: "text",
        render: (r) => (
          <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--text)", wordBreak: "break-all" }}>
            {r.url}
          </a>
        ),
      },
      {
        key: "title",
        label: "Title",
        accessor: (r) => r.title ?? "",
        filterType: "text",
        render: (r) => <span style={{ fontSize: 12 }}>{r.title || "—"}</span>,
      },
      {
        key: "score",
        label: "Score",
        accessor: (r) => r.score,
        filterType: "number",
        width: 90,
        render: (r) => (
          <span style={{ fontWeight: 600, color: r.score >= 80 ? "var(--ok)" : r.score >= 60 ? "var(--accent)" : r.score >= 40 ? "var(--warn)" : "var(--bad)" }}>
            {r.score}
          </span>
        ),
        headerStyle: { textAlign: "right" },
        cellStyle: { textAlign: "right" },
      },
    ];

    if (hasGsc) {
      cols.push(
        {
          key: "gscPosition",
          label: "GSC Pos",
          accessor: (r) => getGsc(gscPages, r.url)?.position?.value ?? null,
          filterType: "number",
          width: 100,
          render: (r) => {
            const v = getGsc(gscPages, r.url)?.position?.value;
            return v != null ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: v <= 3 ? "var(--ok)" : v <= 10 ? "var(--warn)" : "var(--bad)" }}>
                {v.toFixed(1)}
              </span>
            ) : <span style={{ color: "var(--muted)" }}>—</span>;
          },
          headerStyle: { textAlign: "right", color: "var(--ok)" },
          cellStyle: { textAlign: "right" },
        },
        {
          key: "gscClicks",
          label: "Clicks",
          accessor: (r) => getGsc(gscPages, r.url)?.clicks?.value ?? null,
          filterType: "number",
          width: 100,
          render: (r) => {
            const v = getGsc(gscPages, r.url)?.clicks?.value;
            return v != null ? <span style={{ fontSize: 12 }}>{v}</span> : <span style={{ color: "var(--muted)" }}>—</span>;
          },
          headerStyle: { textAlign: "right", color: "var(--ok)" },
          cellStyle: { textAlign: "right" },
        },
      );
    }

    return cols;
  }, [hasGsc, gscPages]);

  return (
    <PageShell
      title="Organic Rankings"
      desc="Pages ranked by organic SEO value score based on on-page signals."
      purpose="Which pages are scoring well for organic SEO — and how do they actually rank in Google?"
      sources={["Crawl", "GSC (optional)"]}
    >
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && (
        <div style={{ marginTop: 14 }}>
          <HeroSkeleton showKpis={false} />
          <ChartSkeleton height={180} />
          <div style={{ marginTop: 14 }}><TableSkeleton rows={6} cols={5} /></div>
        </div>
      )}
      {error && <ErrorBanner error={error} />}

      {overlay.connected && data && !loading && (
        <div className="qa-panel" style={{ marginTop: 14, padding: 10, fontSize: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          {overlay.matchedGscSite ? (
            <>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)", flexShrink: 0 }} />
              <span>Real GSC overlay for <strong>{domain}</strong> (last 28 days)</span>
              <span style={{ padding: "2px 9px", borderRadius: 10, background: "var(--ok-bg)", color: "var(--ok)", border: "1px solid var(--ok-border)", fontSize: 11, fontWeight: 600 }}>
                GSC · {gscPages.size} pages
              </span>
            </>
          ) : (
            <>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--warn)", flexShrink: 0 }} />
              <span style={{ color: "var(--warn)" }}>Google connected — no verified GSC property matches this domain</span>
            </>
          )}
        </div>
      )}

      {data && !loading && (
        <>
          <SectionCard title="Score Distribution">
            <BarTrendChart
              data={distData as unknown as Record<string, unknown>[]}
              xKey="name"
              height={180}
              hideLegend
              series={[{ key: "value", label: "Pages", color: "var(--cat-audit, var(--accent))" }]}
            />
          </SectionCard>

          <SectionCard title={`Rankings (${rankings.length} pages)`}>
            {rankings.length === 0 ? (
              <EmptyState title="No rankings in this run" hint="Start a crawl to score pages." />
            ) : (
              <FilterableTable<Ranking>
                rows={rankings}
                columns={columns}
                rowKey={(r) => r.url}
                pageSize={50}
                itemLabel="page"
                exportFilename="organic-rankings"
              />
            )}
          </SectionCard>
        </>
      )}
    </PageShell>
  );
}
