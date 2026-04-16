import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchTopPages, fetchGscPagesBatch, fetchGa4PagesBatch } from "../api";
import { toPathname, useGoogleOverlay } from "../lib/google-overlay";

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

export default function TopPages() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Derive the primary domain from the first crawled page so the overlay
  // can match it against verified GSC / GA4 properties.
  const primaryDomain = useMemo(() => {
    const firstUrl = (data?.pages ?? [])[0]?.url;
    if (!firstUrl) return "";
    try {
      return new URL(firstUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
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
    try {
      setData(await fetchTopPages(rid));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch GSC + GA4 batches whenever the matched site/property or the
  // primary domain changes. Failures are silent — this is bonus data.
  useEffect(() => {
    if (!primaryDomain) return;
    if (overlay.matchedGscSite) {
      fetchGscPagesBatch(overlay.matchedGscSite.siteUrl, 28, 500)
        .then((rows: any[]) => {
          const map = new Map<string, GscPageStat>();
          for (const r of rows) {
            if (r?.page) map.set(toPathname(r.page), r);
          }
          setGscPages(map);
        })
        .catch(() => setGscPages(new Map()));
    }
    if (overlay.matchedGa4Property) {
      fetchGa4PagesBatch(overlay.matchedGa4Property.propertyId, 28, 500)
        .then((rows: any[]) => {
          const map = new Map<string, Ga4PageStat>();
          for (const r of rows) {
            if (r?.page) map.set(toPathname(r.page), r);
          }
          setGa4Pages(map);
        })
        .catch(() => setGa4Pages(new Map()));
    }
  }, [primaryDomain, overlay.matchedGscSite, overlay.matchedGa4Property]);

  const summary = data?.summary ?? {};
  const pages = data?.pages ?? [];
  const hasGsc = overlay.matchedGscSite && gscPages.size > 0;
  const hasGa4 = overlay.matchedGa4Property && ga4Pages.size > 0;

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">Top Pages</h1>
      <p className="qa-page-desc">Pages ranked by composite SEO + performance score, overlaid with real impressions and sessions from your connected Google account.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />
      {loading && (
        <div className="qa-panel qa-loading-panel" style={{ marginTop: 20 }}>
          <span className="qa-spinner" />
          <span>Analyzing...</span>
        </div>
      )}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}
      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[{ label: "Total Pages", val: summary.totalPages ?? 0 }, { label: "Avg Score", val: summary.avgScore ?? 0 }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{s.val}</div>
              </div>
            ))}
          </div>

          {primaryDomain && (
            <GoogleOverlayBanner
              domain={primaryDomain}
              overlay={overlay}
              gscCount={gscPages.size}
              ga4Count={ga4Pages.size}
            />
          )}

          <div className="qa-panel" style={{ marginTop: 16 }}>
            <div className="qa-panel-head">
              <div className="qa-panel-title">Pages by Score</div>
            </div>
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              <table className="qa-table">
                <thead><tr>
                  <th>#</th>
                  <th>URL</th>
                  <th>Title</th>
                  <th style={{ textAlign: "right" }}>Score</th>
                  <th style={{ textAlign: "right" }}>Load</th>
                  {hasGa4 && <th style={{ textAlign: "right", color: "#38a169" }} title="Real sessions from GA4 (last 28d)">GA4 sessions</th>}
                  {hasGa4 && <th style={{ textAlign: "right", color: "#38a169" }} title="Real users from GA4 (last 28d)">Users</th>}
                  {hasGsc && <th style={{ textAlign: "right", color: "#38a169" }} title="Real impressions from Google Search Console (last 28d)">GSC imps</th>}
                  {hasGsc && <th style={{ textAlign: "right", color: "#38a169" }} title="Real clicks from Google Search Console (last 28d)">Clicks</th>}
                  {hasGsc && <th style={{ textAlign: "right", color: "#38a169" }} title="Average SERP position from Google Search Console (last 28d)">Avg pos</th>}
                </tr></thead>
                <tbody>{pages.slice(0, 100).map((p: any, i: number) => {
                  const path = toPathname(p.url);
                  const g = hasGsc ? gscPages.get(path) : undefined;
                  const a = hasGa4 ? ga4Pages.get(path) : undefined;
                  return (
                    <tr key={i}>
                      <td style={{ color: "var(--text-secondary)" }}>{i + 1}</td>
                      <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.url}</td>
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: p.score >= 80 ? "#38a169" : p.score >= 60 ? "#dd6b20" : "#e53e3e" }}>{p.score}</td>
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{(p.loadMs / 1000).toFixed(1)}s</td>
                      {hasGa4 && <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{a?.sessions ? a.sessions.value.toLocaleString() : "—"}</td>}
                      {hasGa4 && <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{a?.activeUsers ? a.activeUsers.value.toLocaleString() : "—"}</td>}
                      {hasGsc && <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{g?.impressions ? g.impressions.value.toLocaleString() : "—"}</td>}
                      {hasGsc && <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{g?.clicks ? g.clicks.value.toLocaleString() : "—"}</td>}
                      {hasGsc && <td style={{ textAlign: "right", fontWeight: 600, color: g?.position ? (g.position.value <= 3 ? "#38a169" : g.position.value <= 10 ? "#dd6b20" : "#e53e3e") : "var(--text-secondary)" }}>{g?.position ? g.position.value.toFixed(1) : "—"}</td>}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

/**
 * Compact status banner explaining whether the Google overlay is active
 * for the current domain. Always shows something useful — either a
 * "real data is layered in" confirmation or a "connect for real data" CTA.
 */
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
      <div className="qa-panel" style={{ marginTop: 14, padding: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 8, background: "var(--bg-app)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#94a3b8" }} />
        <span>
          Connect Google for real impressions, clicks, and sessions per page.
          <a href="/google-connections" style={{ marginLeft: 6, color: "var(--accent, #111111)" }}>Connect →</a>
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
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
      <span>Real data overlay active for <strong>{domain}</strong> (last 28 days):</span>
      {overlay.matchedGscSite && (
        <span className="qa-lozenge" style={{ background: "#ecfdf5", color: "#047857", fontSize: 11 }}>
          GSC · {overlay.matchedGscSite.siteUrl} · {gscCount} pages
        </span>
      )}
      {overlay.matchedGa4Property && (
        <span className="qa-lozenge" style={{ background: "#ecfdf5", color: "#047857", fontSize: 11 }}>
          GA4 · {overlay.matchedGa4Property.displayName} · {ga4Count} pages
        </span>
      )}
    </div>
  );
}
