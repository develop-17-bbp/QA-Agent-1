import { useState } from "react";
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
import { fetchPositionTracking, trackPositions, fetchKeywordHistory } from "../api";

const COLORS = ["#38a169", "#5a67d8", "#dd6b20", "#e53e3e"];
const HISTORY_COLORS = ["#5a67d8", "#38a169", "#dd6b20", "#e53e3e", "#805ad5", "#d69e2e"];

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
    try {
      const pairs = kws.map((kw) => ({ domain: dom, keyword: kw }));
      const resp = await trackPositions(pairs, { strictHost });
      setLiveResults(resp.results ?? []);
      setSampledAt(resp.sampledAt ?? "");
      // Fetch history series for each keyword so the chart reflects
      // previously-recorded samples plus the one we just appended.
      const series: HistorySeries[] = [];
      for (const kw of kws) {
        try {
          const hist = await fetchKeywordHistory(dom, kw);
          const points: HistoryPoint[] = (hist?.series ?? []).map((s: any) => ({
            at: typeof s.at === "string" ? s.at.slice(0, 10) : "",
            position: typeof s.position === "number" ? s.position : null,
          }));
          series.push({ key: kw, label: kw, points });
        } catch {
          // history read failure is non-fatal — skip this series
        }
      }
      setHistorySeries(series);
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
                    <Bar dataKey="avgScore" fill="#5a67d8" radius={[4, 4, 0, 0]} />
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
              <table className="qa-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    {["Keyword", "Position", "Matched URL", "Top result"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {liveResults.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{r.keyword}</td>
                      <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 700, color: r.position == null ? "var(--muted)" : r.position <= 3 ? "#38a169" : r.position <= 10 ? "#dd6b20" : "#e53e3e" }}>
                        {r.position ?? (r.error ? "error" : "not found")}
                      </td>
                      <td style={{ padding: "6px 10px", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={r.url ?? ""}>
                        {r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent, #5a67d8)" }}>{r.url}</a> : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                      <td style={{ padding: "6px 10px", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={r.topUrl ?? ""}>
                        {r.topUrl ?? ""}
                      </td>
                    </tr>
                  ))}
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
