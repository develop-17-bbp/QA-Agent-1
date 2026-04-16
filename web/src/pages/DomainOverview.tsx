import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import RunSelector from "../components/RunSelector";
import {
  fetchDomainOverview,
  queryGscAnalytics,
  fetchGa4Totals,
} from "../api";
import { useGoogleOverlay, findMatchingGscSite, findMatchingGa4Property } from "../lib/google-overlay";

type GscTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type Ga4Totals = {
  activeUsers?: { value: number };
  sessions?: { value: number };
  screenPageViews?: { value: number };
  averageSessionDuration?: { value: number };
  bounceRate?: { value: number };
};

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export default function DomainOverview() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load the Google connection state once — then derive per-site matches
  // against the sites returned by fetchDomainOverview.
  const overlay = useGoogleOverlay();
  const [gscTotals, setGscTotals] = useState<Map<string, GscTotals>>(new Map());
  const [ga4Totals, setGa4Totals] = useState<Map<string, Ga4Totals>>(new Map());

  const siteHostnames: string[] = useMemo(
    () => (data?.sites ?? []).map((s: any) => s.hostname).filter(Boolean),
    [data],
  );

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true);
    setError("");
    setGscTotals(new Map());
    setGa4Totals(new Map());
    try {
      setData(await fetchDomainOverview(rid));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // For every crawled site in the run, if a matching GSC / GA4 property
  // exists in the user's Google account, pull the last-28-day totals.
  useEffect(() => {
    if (!overlay.loaded || !overlay.connected || siteHostnames.length === 0) return;

    const loadGsc = async () => {
      const nextGsc = new Map<string, GscTotals>();
      await Promise.all(
        siteHostnames.map(async (host) => {
          const match = findMatchingGscSite(overlay.gscSites, host);
          if (!match) return;
          try {
            const rows = await queryGscAnalytics({
              siteUrl: match.siteUrl,
              dimensions: [],
              rowLimit: 1,
            });
            const r = rows[0];
            if (r) {
              nextGsc.set(host, {
                clicks: r.clicks?.value ?? 0,
                impressions: r.impressions?.value ?? 0,
                ctr: r.ctr?.value ?? 0,
                position: r.position?.value ?? 0,
              });
            }
          } catch {
            /* silent */
          }
        }),
      );
      setGscTotals(nextGsc);
    };

    const loadGa4 = async () => {
      const nextGa4 = new Map<string, Ga4Totals>();
      await Promise.all(
        siteHostnames.map(async (host) => {
          const match = findMatchingGa4Property(overlay.ga4Properties, host);
          if (!match) return;
          try {
            const totals = await fetchGa4Totals(match.propertyId, 28);
            if (totals) nextGa4.set(host, totals);
          } catch {
            /* silent */
          }
        }),
      );
      setGa4Totals(nextGa4);
    };

    void loadGsc();
    void loadGa4();
  }, [overlay.loaded, overlay.connected, overlay.gscSites, overlay.ga4Properties, siteHostnames]);

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">Domain Overview</h1>
      <p className="qa-page-desc">
        Comprehensive domain health analysis across SEO, performance, content, technical, and link
        dimensions — overlaid with real search impressions and traffic from your connected Google account.
      </p>
      <RunSelector value={runId} onChange={load} label="Select run" />
      {loading && (
        <div className="qa-panel qa-loading-panel" style={{ marginTop: 20 }}>
          <span className="qa-spinner" />
          <span>Analyzing...</span>
        </div>
      )}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}
      {data && !loading && overlay.loaded && !overlay.connected && (
        <div className="qa-panel" style={{ marginTop: 14, padding: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 8, background: "var(--bg-app)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#94a3b8" }} />
          <span>
            Connect Google to overlay real impressions, clicks, and sessions per site.
            <a href="/google-connections" style={{ marginLeft: 6, color: "var(--accent, #111111)" }}>Connect →</a>
          </span>
        </div>
      )}
      {data && !loading && (data.sites ?? []).map((site: any) => {
        const radarData = Object.entries(site.scores).filter(([k]) => k !== "overall").map(([k, v]) => ({ dim: k.charAt(0).toUpperCase() + k.slice(1), score: v as number, fullMark: 100 }));
        const gsc = gscTotals.get(site.hostname);
        const ga4 = ga4Totals.get(site.hostname);
        const matchedGscSite = findMatchingGscSite(overlay.gscSites, site.hostname);
        const matchedGa4Property = findMatchingGa4Property(overlay.ga4Properties, site.hostname);
        return (
          <div key={site.hostname} className="qa-panel" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{site.hostname}</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{site.pageCount} pages crawled | Avg load: {site.avgLoadMs}ms</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 42, fontWeight: 700, color: site.scores.overall >= 70 ? "#38a169" : site.scores.overall >= 50 ? "#dd6b20" : "#e53e3e" }}>{site.scores.overall}</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Overall Score</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div style={{ width: 300, height: 250 }}>
                <ResponsiveContainer>
                  <RadarChart data={radarData}><PolarGrid /><PolarAngleAxis dataKey="dim" fontSize={12} /><PolarRadiusAxis domain={[0, 100]} tick={false} /><Radar dataKey="score" stroke="#111111" fill="#111111" fillOpacity={0.3} /><Tooltip /></RadarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Object.entries(site.scores).map(([k, v]) => (
                  <div key={k} style={{ minWidth: 100, textAlign: "center", padding: 12, background: "var(--bg-app)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "capitalize" }}>{k}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: (v as number) >= 70 ? "#38a169" : (v as number) >= 50 ? "#dd6b20" : "#e53e3e" }}>{v as number}</div>
                  </div>
                ))}
              </div>
            </div>

            {(gsc || ga4) && (
              <div style={{ marginTop: 16, padding: 12, background: "var(--bg-app)", borderRadius: 8, borderLeft: "3px solid #38a169" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#38a169" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                  Real first-party data (last 28 days)
                </div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {gsc && (
                    <>
                      <Metric label="GSC impressions" value={formatNumber(gsc.impressions)} source={matchedGscSite?.siteUrl} />
                      <Metric label="GSC clicks" value={formatNumber(gsc.clicks)} source={matchedGscSite?.siteUrl} />
                      <Metric label="CTR" value={`${gsc.ctr.toFixed(2)}%`} source={matchedGscSite?.siteUrl} />
                      <Metric label="Avg position" value={gsc.position.toFixed(1)} source={matchedGscSite?.siteUrl} />
                    </>
                  )}
                  {ga4 && (
                    <>
                      <Metric label="GA4 users" value={formatNumber(ga4.activeUsers?.value ?? 0)} source={matchedGa4Property?.displayName} />
                      <Metric label="GA4 sessions" value={formatNumber(ga4.sessions?.value ?? 0)} source={matchedGa4Property?.displayName} />
                      <Metric label="GA4 pageviews" value={formatNumber(ga4.screenPageViews?.value ?? 0)} source={matchedGa4Property?.displayName} />
                      <Metric label="Bounce rate" value={`${((ga4.bounceRate?.value ?? 0) * 100).toFixed(1)}%`} source={matchedGa4Property?.displayName} />
                    </>
                  )}
                </div>
              </div>
            )}
            {overlay.connected && !gsc && !ga4 && (matchedGscSite || matchedGa4Property) && (
              <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
                Loading Google data for {site.hostname}…
              </div>
            )}
            {overlay.connected && !matchedGscSite && !matchedGa4Property && (
              <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
                Google connected, but no GSC property or GA4 property matches <code>{site.hostname}</code>.
              </div>
            )}

            {site.issues.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Issues:</div>
                {site.issues.map((issue: string, i: number) => <div key={i} style={{ fontSize: 13, color: "#e53e3e", padding: "2px 0" }}>{issue}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </motion.div>
  );
}

function Metric({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div style={{ minWidth: 100 }} title={source ? `Source: ${source}` : undefined}>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
