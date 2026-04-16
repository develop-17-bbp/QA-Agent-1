import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";
import RunSelector from "../components/RunSelector";
import {
  fetchPositionTracking,
  trackPositions,
  fetchKeywordHistory,
  fetchGoogleAuthStatus,
  fetchGscSites,
  fetchGscKeywordStats,
  fetchHistoryStats,
  addTrackedPairApi,
  removeTrackedPairApi,
  type GscSite,
} from "../api";

const COLORS = ["#38a169", "#111111", "#dd6b20", "#e53e3e"];
const HISTORY_COLORS = ["#111111", "#38a169", "#dd6b20", "#e53e3e", "#805ad5", "#d69e2e"];

type LiveResult = {
  domain: string;
  keyword: string;
  position: number | null;
  url: string | null;
  topUrl: string | null;
  error?: string;
};

type HistoryPoint = { at: string; position: number | null };
type HistorySeries = { key: string; label: string; points: HistoryPoint[] };

type GscStat = {
  clicks?: { value: number; source?: string; confidence?: string; note?: string };
  impressions?: { value: number; source?: string; confidence?: string; note?: string };
  ctr?: { value: number; source?: string; confidence?: string; note?: string };
  position?: { value: number; source?: string; confidence?: string; note?: string };
};

/**
 * Find the GSC site entry that matches a user-supplied domain. GSC sites
 * come in two shapes: domain properties like `sc-domain:example.com` and
 * URL-prefix properties like `https://www.example.com/`. We strip both
 * forms down to a hostname and compare. The subdomain-or-exact rule
 * matches the host-matching used by the DDG scraper.
 */
function findMatchingGscSite(sites: GscSite[], domain: string): GscSite | null {
  const clean = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!clean) return null;
  for (const s of sites) {
    const url = s.siteUrl;
    let host = "";
    if (url.startsWith("sc-domain:")) {
      host = url.slice("sc-domain:".length).toLowerCase();
    } else {
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        continue;
      }
    }
    if (host === clean || clean.endsWith("." + host) || host.endsWith("." + clean)) return s;
  }
  return null;
}

export default function PositionTracking() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Live SERP tracking state
  const [liveDomain, setLiveDomain] = useState("");
  const [liveKeywords, setLiveKeywords] = useState("");
  const [strictHost, setStrictHost] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [liveResults, setLiveResults] = useState<LiveResult[] | null>(null);
  const [historySeries, setHistorySeries] = useState<HistorySeries[]>([]);
  const [sampledAt, setSampledAt] = useState<string>("");
  const [trackedStats, setTrackedStats] = useState<any[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(false);

  // GSC overlay state — real impressions/clicks/position from the user's
  // verified Search Console property for the domain being tracked.
  const [gscConnected, setGscConnected] = useState(false);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [gscStats, setGscStats] = useState<Map<string, GscStat>>(new Map());
  const [gscMatchedSite, setGscMatchedSite] = useState<GscSite | null>(null);

  // Load stored tracked-keyword stats on mount
  useEffect(() => {
    setTrackedLoading(true);
    fetchHistoryStats()
      .then((stats) => setTrackedStats(Array.isArray(stats) ? stats : []))
      .catch(() => {})
      .finally(() => setTrackedLoading(false));
  }, []);

  const refreshTrackedStats = () => {
    fetchHistoryStats().then((stats) => setTrackedStats(Array.isArray(stats) ? stats : [])).catch(() => {});
  };

  // Load GSC connection status + site list on mount. Failures are silent —
  // this is a bonus overlay, not a core feature.
  useEffect(() => {
    fetchGoogleAuthStatus()
      .then((status) => {
        if (status.connected) {
          setGscConnected(true);
          return fetchGscSites();
        }
        return [];
      })
      .then((sites) => setGscSites(sites ?? []))
      .catch(() => {
        /* silent — GSC overlay is optional */
      });
  }, []);

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true);
    setError("");
    try {
      setData(await fetchPositionTracking(rid));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const runLiveSweep = async () => {
    const dom = liveDomain.trim();
    if (!dom) return;
    const kws = liveKeywords
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (kws.length === 0) return;
    setLiveLoading(true);
    setLiveError("");
    setLiveResults(null);
    setHistorySeries([]);
    setGscStats(new Map());
    setGscMatchedSite(null);
    try {
      const pairs = kws.map((kw) => ({ domain: dom, keyword: kw }));
      const resp = await trackPositions(pairs, { strictHost });
      setLiveResults(resp.results ?? []);
      setSampledAt(resp.sampledAt ?? "");

      // Auto-register each pair for daily GSC cron tracking
      await Promise.allSettled(kws.map(kw => addTrackedPairApi(dom, kw)));
      refreshTrackedStats();

      // Fetch history series for each keyword so the chart reflects
      // previously-recorded samples plus the one we just appended.
      const series: HistorySeries[] = [];
      for (const kw of kws) {
        try {
          const hist = await fetchKeywordHistory(dom, kw);
          // New endpoint returns { points: [...] }; legacy returns { series: [...] }
          const rawPoints = hist?.points ?? hist?.series ?? [];
          const points: HistoryPoint[] = rawPoints.map((s: any) => ({
            at: typeof s.at === "string" ? s.at.slice(0, 10) : "",
            position: typeof s.position === "number" ? s.position : null,
          }));
          series.push({ key: kw, label: kw, points });
        } catch {
          // history read failure is non-fatal — skip this series
        }
      }
      setHistorySeries(series);

      // GSC overlay — if the user has connected Google and has a verified
      // site for this domain, look up the real impressions / clicks / CTR /
      // average position for each keyword. These are first-party numbers
      // from Google's own index, not scraped from DDG.
      if (gscConnected && gscSites.length > 0) {
        const match = findMatchingGscSite(gscSites, dom);
        setGscMatchedSite(match);
        if (match) {
          const statsMap = new Map<string, GscStat>();
          await Promise.all(
            kws.map(async (kw) => {
              try {
                const stats = await fetchGscKeywordStats(match.siteUrl, kw, 28);
                if (stats) statsMap.set(kw, stats);
              } catch {
                /* silent — GSC lookup is optional overlay */
              }
            }),
          );
          setGscStats(statsMap);
        }
      }
    } catch (e: any) {
      setLiveError(e.message);
    } finally {
      setLiveLoading(false);
    }
  };

  const distData = data?.distribution
    ? [
        { name: "Excellent (80+)", value: data.distribution.excellent, color: COLORS[0] },
        { name: "Good (60-79)", value: data.distribution.good, color: COLORS[1] },
        { name: "Needs Work (40-59)", value: data.distribution.needsWork, color: COLORS[2] },
        { name: "Poor (<40)", value: data.distribution.poor, color: COLORS[3] },
      ].filter((d) => d.value > 0)
    : [];

  const hostData = data?.hostStats ?? [];

  // Merge all history series onto a single time axis, where each key is a
  // keyword. Recharts needs a flat array of { at, keyword1, keyword2, ... }.
  const mergedHistory: any[] = (() => {
    const byDate = new Map<string, Record<string, any>>();
    for (const s of historySeries) {
      for (const p of s.points) {
        if (!p.at) continue;
        const row = byDate.get(p.at) ?? { at: p.at };
        row[s.key] = p.position;
        byDate.set(p.at, row);
      }
    }
    return Array.from(byDate.values()).sort((a, b) => (a.at < b.at ? -1 : 1));
  })();

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Position Tracking</h1>
      <p className="qa-page-desc">Track keyword SEO optimization scores across your crawled pages, and sweep live DuckDuckGo rankings for any domain.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {/* Daily-tracked keywords — stored position history from GSC cron */}
      {(trackedLoading || trackedStats.length > 0) && (
        <div className="qa-panel" style={{ marginTop: 20, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="qa-panel-title">Daily Tracked Keywords</div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Auto-updated every 24h via GSC · snapshots stored in data/position-history/</span>
          </div>
          {trackedLoading && <div className="qa-loading-panel"><div className="qa-spinner" />Loading...</div>}
          {trackedStats.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  {["Domain", "Keyword", "Latest Pos.", "Best", "Trend", "Days", ""].map(h => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trackedStats.map((s: any) => (
                  <tr key={`${s.domain}::${s.keyword}`} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 500 }}>{s.domain}</td>
                    <td style={{ padding: "7px 10px" }}>{s.keyword}</td>
                    <td style={{ padding: "7px 10px", fontWeight: 700, color: s.latest?.position !== null ? (s.latest.position <= 3 ? "#38a169" : s.latest.position <= 10 ? "#dd6b20" : "var(--muted)") : "var(--muted)" }}>
                      {s.latest?.position !== null ? `#${s.latest.position}` : "—"}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#38a169" }}>{s.best !== null ? `#${s.best}` : "—"}</td>
                    <td style={{ padding: "7px 10px", fontWeight: 600, color: s.trend === "rising" ? "#38a169" : s.trend === "falling" ? "#e53e3e" : "var(--muted)" }}>
                      {s.trend === "rising" ? "↑ Rising" : s.trend === "falling" ? "↓ Falling" : s.trend === "stable" ? "→ Stable" : "New"}
                    </td>
                    <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{s.snapshotCount}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <button onClick={() => removeTrackedPairApi(s.domain, s.keyword).then(refreshTrackedStats)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "none", cursor: "pointer", color: "var(--muted)" }}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!trackedLoading && trackedStats.length === 0 && (
            <div className="qa-empty">No tracked keywords yet — run a Live Rank Sweep below to start tracking.</div>
          )}
        </div>
      )}

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Analyzing positions...</div>}
      {error && <div className="qa-panel" style={{ marginTop: 20, color: "#e53e3e" }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[
              { label: "Total Keywords", val: data.summary?.totalKeywords ?? 0 },
              { label: "Avg SEO Score", val: data.summary?.avgSeoScore ?? 0, color: (data.summary?.avgSeoScore ?? 0) >= 70 ? "#38a169" : "#dd6b20" },
              { label: "Top Performers", val: data.summary?.topPerformers ?? 0, color: "#38a169" },
              { label: "Needs Improvement", val: data.summary?.needsImprovement ?? 0, color: "#e53e3e" },
            ].map((s) => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {distData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 280 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Score Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={distData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                      {distData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", fontSize: 11 }}>
                  {distData.map((d) => <span key={d.name} style={{ color: d.color }}>{d.name}: {d.value}</span>)}
                </div>
              </div>
            )}
            {hostData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Average Score by Host</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hostData}>
                    <XAxis dataKey="hostname" fontSize={11} />
                    <YAxis domain={[0, 100]} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="avgScore" fill="#111111" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Keyword Positions ({(data.keywords ?? []).length})</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                {["Keyword", "URL", "SEO Score", "Title", "Meta", "H1", "Canonical", "Load Time"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: h === "Keyword" || h === "URL" ? "left" : "center", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(data.keywords ?? []).map((kw: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{kw.keyword}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={kw.url}>{kw.url}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, color: kw.seoScore >= 80 ? "#38a169" : kw.seoScore >= 60 ? "#dd6b20" : "#e53e3e" }}>{kw.seoScore}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.titlePresent ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.metaPresent ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.h1Present ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{kw.canonicalSet ? "Y" : "N"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: "var(--text-secondary)" }}>{kw.loadTimeMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Live SERP sweep — uses DuckDuckGo and records each sample to history-db. */}
      <div className="qa-panel" style={{ marginTop: 24, padding: 16 }}>
        <div className="qa-panel-title">Live Rank Sweep (DuckDuckGo)</div>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, marginBottom: 12 }}>
          Query real DuckDuckGo search results for any domain + keyword combination. Each sweep is recorded to
          local history so running it daily builds a ranking trend. No API key required.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="qa-kicker" style={{ display: "block", marginBottom: 4 }}>Domain</label>
            <input
              type="text"
              placeholder="e.g. wikipedia.org"
              value={liveDomain}
              onChange={(e) => setLiveDomain(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "var(--panel-bg)", color: "var(--text-primary)" }}
            />
          </div>
          <div style={{ flex: 2, minWidth: 260 }}>
            <label className="qa-kicker" style={{ display: "block", marginBottom: 4 }}>Keywords (comma or newline separated)</label>
            <textarea
              placeholder={"claude shannon\ninformation theory"}
              value={liveKeywords}
              onChange={(e) => setLiveKeywords(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "var(--panel-bg)", color: "var(--text-primary)", resize: "vertical" }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={strictHost}
              onChange={(e) => setStrictHost(e.target.checked)}
            />
            Strict host match
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              (off: <code>wikipedia.org</code> matches <code>en.wikipedia.org</code>)
            </span>
          </label>
          <button
            onClick={runLiveSweep}
            disabled={liveLoading || !liveDomain.trim() || !liveKeywords.trim()}
            className="qa-btn qa-btn--primary"
            style={{ padding: "8px 14px" }}
          >
            {liveLoading ? "Sweeping…" : "Sweep now"}
          </button>
          {sampledAt && <span style={{ fontSize: 11, color: "var(--muted)" }}>Last sampled: {sampledAt.slice(0, 19).replace("T", " ")} UTC</span>}
        </div>

        {liveError && <div className="qa-alert qa-alert--error" style={{ marginTop: 12 }}>{liveError}</div>}

        {liveResults && liveResults.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="qa-panel" style={{ padding: 12 }}>
              <div className="qa-panel-title">Sweep results</div>
              {gscMatchedSite && (
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                  <span>
                    Overlaying real Google Search Console data from <code>{gscMatchedSite.siteUrl}</code> (last 28 days, 3-day delay)
                  </span>
                </div>
              )}
              {gscConnected && !gscMatchedSite && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
                  Google connected, but no verified GSC property matches this domain. DDG scrape only.
                </div>
              )}
              <table className="qa-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    {["Keyword", "DDG position", "Matched URL", "Top result"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>
                    ))}
                    {gscMatchedSite && (
                      ["GSC position", "Impressions", "Clicks", "CTR"].map((h) => (
                        <th key={h} style={{ textAlign: "right", padding: "6px 10px", fontSize: 12, color: "#38a169", borderBottom: "2px solid var(--border)" }} title="Real first-party data from Google Search Console">{h}</th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {liveResults.map((r, i) => {
                    const gsc = gscStats.get(r.keyword);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{r.keyword}</td>
                        <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 700, color: r.position == null ? "var(--muted)" : r.position <= 3 ? "#38a169" : r.position <= 10 ? "#dd6b20" : "#e53e3e" }}>
                          {r.position ?? (r.error ? "error" : "not found")}
                        </td>
                        <td style={{ padding: "6px 10px", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={r.url ?? ""}>
                          {r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent, #111111)" }}>{r.url}</a> : <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td style={{ padding: "6px 10px", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={r.topUrl ?? ""}>
                          {r.topUrl ?? ""}
                        </td>
                        {gscMatchedSite && (
                          <>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 13, fontWeight: 700, color: gsc?.position ? (gsc.position.value <= 3 ? "#38a169" : gsc.position.value <= 10 ? "#dd6b20" : "#e53e3e") : "var(--muted)" }} title={gsc?.position?.note ?? "No GSC data for this keyword"}>
                              {gsc?.position ? gsc.position.value.toFixed(1) : "—"}
                            </td>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }} title={gsc?.impressions?.note ?? ""}>
                              {gsc?.impressions ? gsc.impressions.value.toLocaleString() : "—"}
                            </td>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }} title={gsc?.clicks?.note ?? ""}>
                              {gsc?.clicks ? gsc.clicks.value.toLocaleString() : "—"}
                            </td>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }} title={gsc?.ctr?.note ?? ""}>
                              {gsc?.ctr ? `${gsc.ctr.value.toFixed(2)}%` : "—"}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {mergedHistory.length > 0 && (
          <div className="qa-panel" style={{ padding: 12, marginTop: 12 }}>
            <div className="qa-panel-title">Rank history</div>
            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, marginBottom: 8 }}>
              Built from your saved sweeps (<code>out/history/keywords/&lt;domain&gt;/</code>). Lower is better — Y axis is inverted. Missing samples mean the domain didn't rank in the top 20 on that day.
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={mergedHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="at" fontSize={11} />
                <YAxis reversed domain={[1, 20]} allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {historySeries.map((s, i) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={HISTORY_COLORS[i % HISTORY_COLORS.length]}
                    connectNulls
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </motion.div>
  );
}
