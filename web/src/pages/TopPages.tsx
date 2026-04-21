import { useEffect, useMemo, useState } from "react";
import RunSelector from "../components/RunSelector";
import { fetchTopPages, fetchGscPagesBatch, fetchGa4PagesBatch } from "../api";
import { toPathname, useGoogleOverlay } from "../lib/google-overlay";
import { FilterableTable, type FilterableColumn } from "../components/FilterableTable";
import { PageShell, SectionCard, StatGrid, EmptyState } from "../components/PageUI";

import { LoadingPanel, ErrorBanner } from "../components/UI";

type GscPageStat = {
  page: string;
  clicks?: { value: number; note?: string };
  impressions?: { value: number; note?: string };
  ctr?: { value: number; note?: string };
  position?: { value: number; note?: string };
};

type Ga4PageStat = {
  page: string;
  screenPageViews?: { value: number; note?: string };
  activeUsers?: { value: number; note?: string };
  sessions?: { value: number; note?: string };
};

interface PageRow {
  url: string;
  title?: string;
  score: number;
  loadMs: number;
}

export default function TopPages() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const primaryDomain = useMemo(() => {
    const firstUrl = (data?.pages ?? [])[0]?.url;
    if (!firstUrl) return "";
    try { return new URL(firstUrl).hostname.replace(/^www\./, ""); } catch { return ""; }
  }, [data]);

  const overlay = useGoogleOverlay(primaryDomain);
  const [gscPages, setGscPages] = useState<Map<string, GscPageStat>>(new Map());
  const [ga4Pages, setGa4Pages] = useState<Map<string, Ga4PageStat>>(new Map());

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true);
    setError("");
    setGscPages(new Map());
    setGa4Pages(new Map());
    try { setData(await fetchTopPages(rid)); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!primaryDomain) return;
    if (overlay.matchedGscSite) {
      fetchGscPagesBatch(overlay.matchedGscSite.siteUrl, 28, 500)
        .then((rows: any[]) => {
          const map = new Map<string, GscPageStat>();
          for (const r of rows) { if (r?.page) map.set(toPathname(r.page), r); }
          setGscPages(map);
        })
        .catch(() => setGscPages(new Map()));
    }
    if (overlay.matchedGa4Property) {
      fetchGa4PagesBatch(overlay.matchedGa4Property.propertyId, 28, 500)
        .then((rows: any[]) => {
          const map = new Map<string, Ga4PageStat>();
          for (const r of rows) { if (r?.page) map.set(toPathname(r.page), r); }
          setGa4Pages(map);
        })
        .catch(() => setGa4Pages(new Map()));
    }
  }, [primaryDomain, overlay.matchedGscSite, overlay.matchedGa4Property]);

  const summary = data?.summary ?? {};
  const pages: PageRow[] = data?.pages ?? [];
  const hasGsc = !!overlay.matchedGscSite && gscPages.size > 0;
  const hasGa4 = !!overlay.matchedGa4Property && ga4Pages.size > 0;

  const columns: FilterableColumn<PageRow>[] = useMemo(() => {
    const cols: FilterableColumn<PageRow>[] = [
      {
        key: "url",
        label: "URL",
        accessor: (p) => p.url,
        filterType: "text",
        render: (p) => (
          <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--text)", wordBreak: "break-all" }}>
            {p.url}
          </a>
        ),
      },
      {
        key: "title",
        label: "Title",
        accessor: (p) => p.title ?? "",
        filterType: "text",
        render: (p) => <span style={{ fontSize: 12 }}>{p.title || "—"}</span>,
      },
      {
        key: "score",
        label: "Score",
        accessor: (p) => p.score,
        filterType: "number",
        width: 90,
        render: (p) => (
          <span style={{ fontWeight: 700, color: p.score >= 80 ? "var(--ok)" : p.score >= 60 ? "var(--warn)" : "var(--bad)" }}>
            {p.score}
          </span>
        ),
        headerStyle: { textAlign: "right" },
        cellStyle: { textAlign: "right" },
      },
      {
        key: "loadMs",
        label: "Load",
        accessor: (p) => p.loadMs,
        filterType: "number",
        width: 90,
        render: (p) => <span style={{ fontSize: 12, color: "var(--muted)" }}>{(p.loadMs / 1000).toFixed(1)}s</span>,
        headerStyle: { textAlign: "right" },
        cellStyle: { textAlign: "right" },
      },
    ];

    if (hasGa4) {
      cols.push(
        {
          key: "ga4Sessions",
          label: "GA4 sessions",
          accessor: (p) => ga4Pages.get(toPathname(p.url))?.sessions?.value ?? null,
          filterType: "number",
          width: 120,
          render: (p) => {
            const v = ga4Pages.get(toPathname(p.url))?.sessions;
            return v ? <span style={{ fontSize: 12 }}>{v.value.toLocaleString()}</span> : <span style={{ color: "var(--muted)" }}>—</span>;
          },
          headerStyle: { textAlign: "right", color: "var(--ok)" },
          cellStyle: { textAlign: "right" },
        },
        {
          key: "ga4Users",
          label: "Users",
          accessor: (p) => ga4Pages.get(toPathname(p.url))?.activeUsers?.value ?? null,
          filterType: "number",
          width: 100,
          render: (p) => {
            const v = ga4Pages.get(toPathname(p.url))?.activeUsers;
            return v ? <span style={{ fontSize: 12 }}>{v.value.toLocaleString()}</span> : <span style={{ color: "var(--muted)" }}>—</span>;
          },
          headerStyle: { textAlign: "right", color: "var(--ok)" },
          cellStyle: { textAlign: "right" },
        },
      );
    }

    if (hasGsc) {
      cols.push(
        {
          key: "gscImpressions",
          label: "GSC imps",
          accessor: (p) => gscPages.get(toPathname(p.url))?.impressions?.value ?? null,
          filterType: "number",
          width: 110,
          render: (p) => {
            const v = gscPages.get(toPathname(p.url))?.impressions;
            return v ? <span style={{ fontSize: 12 }}>{v.value.toLocaleString()}</span> : <span style={{ color: "var(--muted)" }}>—</span>;
          },
          headerStyle: { textAlign: "right", color: "var(--ok)" },
          cellStyle: { textAlign: "right" },
        },
        {
          key: "gscClicks",
          label: "Clicks",
          accessor: (p) => gscPages.get(toPathname(p.url))?.clicks?.value ?? null,
          filterType: "number",
          width: 100,
          render: (p) => {
            const v = gscPages.get(toPathname(p.url))?.clicks;
            return v ? <span style={{ fontSize: 12 }}>{v.value.toLocaleString()}</span> : <span style={{ color: "var(--muted)" }}>—</span>;
          },
          headerStyle: { textAlign: "right", color: "var(--ok)" },
          cellStyle: { textAlign: "right" },
        },
        {
          key: "gscPosition",
          label: "Avg pos",
          accessor: (p) => gscPages.get(toPathname(p.url))?.position?.value ?? null,
          filterType: "number",
          width: 100,
          render: (p) => {
            const v = gscPages.get(toPathname(p.url))?.position;
            if (!v) return <span style={{ color: "var(--muted)" }}>—</span>;
            return (
              <span style={{ fontWeight: 600, color: v.value <= 3 ? "var(--ok)" : v.value <= 10 ? "var(--warn)" : "var(--bad)" }}>
                {v.value.toFixed(1)}
              </span>
            );
          },
          headerStyle: { textAlign: "right", color: "var(--ok)" },
          cellStyle: { textAlign: "right" },
        },
      );
    }

    return cols;
  }, [hasGa4, hasGsc, ga4Pages, gscPages]);

  return (
    <PageShell
      title="Top Pages"
      desc="Pages ranked by composite SEO + performance score, overlaid with real impressions and sessions from your connected Google account."
      purpose="Which pages are my top performers — by SEO score, real traffic, and real search impressions?"
      sources={["Crawl", "GSC (optional)", "GA4 (optional)"]}
    >
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <LoadingPanel message="Analyzing…" />}
      {error && <ErrorBanner error={error} />}

      {data && !loading && (
        <>
          <StatGrid
            stats={[
              { label: "Total Pages", value: summary.totalPages ?? 0 },
              { label: "Avg Score", value: summary.avgScore ?? 0 },
              ...(hasGsc ? [{ label: "GSC pages", value: gscPages.size, valueColor: "var(--ok)" }] : []),
              ...(hasGa4 ? [{ label: "GA4 pages", value: ga4Pages.size, valueColor: "var(--ok)" }] : []),
            ]}
          />

          {primaryDomain && (
            <GoogleOverlayBanner
              domain={primaryDomain}
              overlay={overlay}
              gscCount={gscPages.size}
              ga4Count={ga4Pages.size}
            />
          )}

          <SectionCard title={`Pages by Score (${pages.length})`}>
            {pages.length === 0 ? (
              <EmptyState title="No pages in this run" hint="Start a crawl from the Dashboard to populate this view." />
            ) : (
              <FilterableTable<PageRow>
                rows={pages}
                columns={columns}
                rowKey={(p) => p.url}
                pageSize={50}
                itemLabel="page"
                exportFilename="top-pages"
              />
            )}
          </SectionCard>
        </>
      )}
    </PageShell>
  );
}

function GoogleOverlayBanner({
  domain,
  overlay,
  gscCount,
  ga4Count,
}: {
  domain: string;
  overlay: ReturnType<typeof useGoogleOverlay>;
  gscCount: number;
  ga4Count: number;
}) {
  if (!overlay.loaded) return null;
  if (!overlay.connected) {
    return (
      <div className="qa-panel" style={{ marginTop: 14, padding: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--muted-light)" }} />
        <span>
          Connect Google for real impressions, clicks, and sessions per page.
          <a href="/google-connections" style={{ marginLeft: 6, color: "var(--accent)" }}>Connect →</a>
        </span>
      </div>
    );
  }
  const anyMatch = overlay.matchedGscSite || overlay.matchedGa4Property;
  if (!anyMatch) {
    return (
      <div className="qa-panel" style={{ marginTop: 14, padding: 10, fontSize: 12, color: "var(--muted)" }}>
        Google connected, but no verified GSC property or GA4 property matches <code>{domain}</code>.
      </div>
    );
  }
  return (
    <div className="qa-panel" style={{ marginTop: 14, padding: 10, fontSize: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
      <span>Real data overlay active for <strong>{domain}</strong> (last 28 days):</span>
      {overlay.matchedGscSite && (
        <span style={{ padding: "2px 9px", borderRadius: 10, background: "var(--ok-bg)", color: "var(--ok)", border: "1px solid var(--ok-border)", fontSize: 11, fontWeight: 600 }}>
          GSC · {gscCount} pages
        </span>
      )}
      {overlay.matchedGa4Property && (
        <span style={{ padding: "2px 9px", borderRadius: 10, background: "var(--ok-bg)", color: "var(--ok)", border: "1px solid var(--ok-border)", fontSize: 11, fontWeight: 600 }}>
          GA4 · {ga4Count} pages
        </span>
      )}
    </div>
  );
}
