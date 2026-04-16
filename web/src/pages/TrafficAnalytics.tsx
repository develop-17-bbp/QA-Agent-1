import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchTrafficAnalytics, queryGscAnalytics, fetchGa4Totals } from "../api";
import { useGoogleOverlay } from "../lib/google-overlay";

const SOURCE_COLORS: Record<string, string> = {
  organic: "#38a169",
  direct: "#111111",
  referral: "#dd6b20",
  social: "#d53f8c",
  paid: "#e53e3e",
};

type GscTopQuery = {
  query: string;
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

export default function TrafficAnalytics() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Derive the primary domain for this run from the first landing page URL.
  const primaryDomain = useMemo(() => {
    const firstUrl = (data?.topLandingPages ?? [])[0]?.url;
    if (!firstUrl) return "";
    try {
      return new URL(firstUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }, [data]);

  const overlay = useGoogleOverlay(primaryDomain);
  const [ga4Totals, setGa4Totals] = useState<Ga4Totals | null>(null);
  const [topQueries, setTopQueries] = useState<GscTopQuery[]>([]);

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true);
    setError("");
    setGa4Totals(null);
    setTopQueries([]);
    try {
      setData(await fetchTrafficAnalytics(rid));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Load GA4 totals and GSC top queries whenever the primary domain or
  // matched property changes.
  useEffect(() => {
    if (!primaryDomain || !overlay.connected) return;
    if (overlay.matchedGa4Property) {
      fetchGa4Totals(overlay.matchedGa4Property.propertyId, 28)
        .then((totals) => setGa4Totals(totals ?? null))
        .catch(() => setGa4Totals(null));
    }
    if (overlay.matchedGscSite) {
      queryGscAnalytics({
        siteUrl: overlay.matchedGscSite.siteUrl,
        dimensions: ["query"],
        rowLimit: 15,
      })
        .then((rows: any[]) => {
          const out: GscTopQuery[] = [];
          for (const r of rows) {
            const query = r?.keys?.[0];
            if (!query) continue;
            out.push({
              query,
              clicks: r.clicks?.value ?? 0,
              impressions: r.impressions?.value ?? 0,
              ctr: r.ctr?.value ?? 0,
              position: r.position?.value ?? 0,
            });
          }
          out.sort((a, b) => b.clicks - a.clicks);
          setTopQueries(out);
        })
        .catch(() => setTopQueries([]));
    }
  }, [primaryDomain, overlay.connected, overlay.matchedGa4Property, overlay.matchedGscSite]);

  const sourceData = data?.trafficSources
    ? Object.entries(data.trafficSources)
        .map(([key, val]) => ({ name: key, value: val as number, color: SOURCE_COLORS[key] ?? "#888" }))
        .filter((d) => d.value > 0)
    : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Traffic Analytics</h1>
      <p className="qa-page-desc">
        Real domain traffic data from Tranco, Cloudflare Radar, and OpenPageRank — with your own crawl
        metrics and real first-party GA4 sessions layered on top.
      </p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Querying real traffic providers…</div>}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

      {data?.dataQuality && !loading && (
        <div className="qa-panel" style={{ padding: 12, marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="qa-kicker">Data sources:</span>
          {(data.dataQuality.providersHit ?? []).map((p: string) => (
            <span key={p} className="qa-lozenge" style={{ background: "#ecfdf5", color: "#047857", fontSize: 11 }}>{p}</span>
          ))}
          {(data.dataQuality.providersFailed ?? []).map((p: string) => (
            <span key={p} className="qa-lozenge" style={{ background: "#fef3c7", color: "#b45309", fontSize: 11 }}>{p} unavailable</span>
          ))}
          {(data.dataQuality.missingFields ?? []).length > 0 && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>• Missing (no free source): {(data.dataQuality.missingFields ?? []).join(", ")}</span>
          )}
        </div>
      )}

      {data && !loading && overlay.loaded && !overlay.connected && (
        <div className="qa-panel" style={{ padding: 10, marginTop: 14, fontSize: 12, display: "flex", alignItems: "center", gap: 8, background: "var(--bg-app)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#94a3b8" }} />
          <span>
            Connect Google to replace the estimated monthly traffic below with real first-party GA4 sessions and add a &ldquo;Top queries from GSC&rdquo; panel.
            <a href="/google-connections" style={{ marginLeft: 6, color: "var(--accent, #111111)" }}>Connect →</a>
          </span>
        </div>
      )}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}>
              <div className="qa-kicker">Est. Monthly Traffic</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.monthlyTrafficEstimate}</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Estimated (free providers)</div>
            </div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}>
              <div className="qa-kicker">Pages Crawled</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.crawlStats?.totalPages ?? 0}</div>
            </div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}>
              <div className="qa-kicker">Avg Load Time</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.crawlStats?.avgLoadTime ?? 0}ms</div>
            </div>
            {ga4Totals && (
              <>
                <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center", borderLeft: "3px solid #38a169" }}>
                  <div className="qa-kicker" style={{ color: "#38a169" }}>GA4 sessions (28d)</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(ga4Totals.sessions?.value ?? 0)}</div>
                  <div style={{ fontSize: 10, color: "#38a169", marginTop: 2 }}>Real · first-party</div>
                </div>
                <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center", borderLeft: "3px solid #38a169" }}>
                  <div className="qa-kicker" style={{ color: "#38a169" }}>GA4 users (28d)</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(ga4Totals.activeUsers?.value ?? 0)}</div>
                  <div style={{ fontSize: 10, color: "#38a169", marginTop: 2 }}>Real · first-party</div>
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {(data.trafficTrend ?? []).length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 2, minWidth: 300 }}>
                <div className="qa-panel-title">Traffic Trend</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.trafficTrend}>
                    <XAxis dataKey="month" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Line type="monotone" dataKey="estimated" stroke="#111111" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {sourceData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1, minWidth: 240 }}>
                <div className="qa-panel-title">Traffic Sources</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={sourceData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                      {sourceData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", fontSize: 11 }}>
                  {sourceData.map(d => <span key={d.name} style={{ color: d.color, textTransform: "capitalize" }}>{d.name}: {d.value}%</span>)}
                </div>
              </div>
            )}
          </div>

          {topQueries.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, borderLeft: "3px solid #38a169" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                <div className="qa-panel-title" style={{ color: "#38a169", margin: 0 }}>
                  Top queries (Google Search Console · last 28 days)
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                What people actually searched to reach <code>{overlay.matchedGscSite?.siteUrl}</code>.
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th style={{ textAlign: "right" }}>Impressions</th>
                    <th style={{ textAlign: "right" }}>Clicks</th>
                    <th style={{ textAlign: "right" }}>CTR</th>
                    <th style={{ textAlign: "right" }}>Avg position</th>
                  </tr>
                </thead>
                <tbody>
                  {topQueries.map((q) => (
                    <tr key={q.query}>
                      <td style={{ fontWeight: 500 }}>{q.query}</td>
                      <td style={{ textAlign: "right" }}>{q.impressions.toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>{q.clicks.toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>{q.ctr.toFixed(2)}%</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: q.position <= 3 ? "#38a169" : q.position <= 10 ? "#dd6b20" : "#e53e3e" }}>
                        {q.position.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(data.topLandingPages ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
              <div className="qa-panel-title">Top Landing Pages</div>
              <table className="qa-table">
                <thead><tr>{["URL", "Title", "Organic Potential", "Load Time"].map(h => <th key={h} style={{ textAlign: h === "URL" || h === "Title" ? "left" : "center" }}>{h}</th>)}</tr></thead>
                <tbody>{data.topLandingPages.map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>{p.url}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{p.title}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, color: p.organicPotential >= 70 ? "#38a169" : "#dd6b20" }}>{p.organicPotential}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: "var(--text-secondary)" }}>{p.loadTimeMs}ms</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {(data.insights ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Insights</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{data.insights.map((ins: string, i: number) => <li key={i} style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>{ins}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
