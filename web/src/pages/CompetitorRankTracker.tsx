import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  listCompetitorRank,
  addCompetitorRank,
  removeCompetitorRank,
  fetchCompetitorRankHistory,
  type CompetitorRankPair,
  type CompetitorRankStats,
  type CompetitorRankSnapshot,
} from "../api";
import { useRegion } from "../components/RegionPicker";
import { ErrorBanner } from "../components/UI";

function rankLabel(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `#${n}`;
}

function deltaLabel(d: number | null): { text: string; color: string } {
  if (d === null) return { text: "—", color: "var(--muted)" };
  if (d > 0) return { text: `▲ ${d}`, color: "#16a34a" };
  if (d < 0) return { text: `▼ ${Math.abs(d)}`, color: "#dc2626" };
  return { text: "—", color: "var(--muted)" };
}

export default function CompetitorRankTracker() {
  const [region] = useRegion();
  const [pairs, setPairs] = useState<CompetitorRankPair[]>([]);
  const [stats, setStats] = useState<CompetitorRankStats[]>([]);
  const [domain, setDomain] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ domain: string; keyword: string } | null>(null);
  const [history, setHistory] = useState<CompetitorRankSnapshot[] | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const { pairs, stats } = await listCompetitorRank();
      setPairs(pairs);
      setStats(stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const d = domain.trim();
    const k = keyword.trim();
    if (!d || !k) return;
    setAdding(true);
    setError("");
    try {
      await addCompetitorRank(d, k, region);
      setDomain("");
      setKeyword("");
      await refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (d: string, k: string) => {
    try {
      await removeCompetitorRank(d, k);
      if (selected && selected.domain === d && selected.keyword === k) {
        setSelected(null); setHistory(null);
      }
      await refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  };

  const handleViewHistory = async (d: string, k: string) => {
    setSelected({ domain: d, keyword: k });
    setHistory(null);
    try {
      const r = await fetchCompetitorRankHistory(d, k);
      setHistory(r.history);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  };

  const chartData = (history ?? []).map((h) => ({
    at: h.at,
    ddg: h.ddgRank ?? null,
    brave: h.braveRank ?? null,
  }));

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="qa-page-title">Competitor Rank Tracker</h1>
        <p className="qa-page-desc" style={{ marginBottom: 8 }}>
          Track any competitor's ranking on any keyword using DuckDuckGo + Brave Search (both free).
          When Brave is configured (<code>BRAVE_SEARCH_API_KEY</code>), we cross-check the two and
          flag discrepancies &gt; 10 positions.
        </p>
        <div className="qa-panel" style={{ padding: 12, marginBottom: 18, background: "#fef3c7", borderColor: "#d97706", fontSize: 12, color: "#92400e" }}>
          Honest framing: DDG + Brave ranks correlate ~0.7 with Google's SERP. Use for <strong>trend and delta</strong>, not absolute "rank on Google".
        </div>
      </motion.div>

      <form
        onSubmit={handleAdd}
        className="qa-panel"
        style={{
          padding: 16,
          display: "grid",
          gridTemplateColumns: "minmax(180px, 1fr) minmax(240px, 2fr) auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 18,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          Competitor domain
          <input className="qa-input" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} style={{ padding: "8px 12px" }} disabled={adding} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          Keyword
          <input className="qa-input" placeholder="best seo tools" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ padding: "8px 12px" }} disabled={adding} />
        </label>
        <button className="qa-btn-primary" type="submit" disabled={adding || !domain.trim() || !keyword.trim()} style={{ padding: "10px 20px", whiteSpace: "nowrap" }}>
          {adding ? "Checking…" : `Add & Check (${region})`}
        </button>
      </form>

      {error && <ErrorBanner error={error} />}

      {loading && (
        <div className="qa-loading-panel" style={{ padding: 40 }}>
          <span className="qa-spinner qa-spinner--lg" />
          <div style={{ marginTop: 12, color: "var(--muted)" }}>Loading competitors…</div>
        </div>
      )}

      {!loading && pairs.length === 0 && (
        <div className="qa-panel" style={{ padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "var(--muted)" }}>No competitors tracked yet.</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Add a competitor domain + keyword above to start building rank history.</div>
        </div>
      )}

      {!loading && pairs.length > 0 && (
        <div className="qa-panel" style={{ padding: 0, overflow: "hidden" }}>
          <table className="qa-table">
            <thead>
              <tr>
                <th>Competitor</th>
                <th>Keyword</th>
                <th>Region</th>
                <th>DDG rank</th>
                <th>Brave rank</th>
                <th>7d Δ</th>
                <th>30d Δ</th>
                <th>Best</th>
                <th>Snapshots</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const d7 = deltaLabel(s.delta7d);
                const d30 = deltaLabel(s.delta30d);
                const discrep = s.latest?.discrepancy;
                return (
                  <tr key={`${s.domain}::${s.keyword}`}>
                    <td style={{ fontWeight: 600 }}>{s.domain}</td>
                    <td>{s.keyword}</td>
                    <td>{s.regionCode}</td>
                    <td>
                      {rankLabel(s.latest?.ddgRank)}
                      {discrep && <span title="DDG and Brave disagree by >10 positions" style={{ marginLeft: 4, color: "#d97706" }}>⚠</span>}
                    </td>
                    <td>{rankLabel(s.latest?.braveRank)}</td>
                    <td style={{ color: d7.color, fontWeight: 600 }}>{d7.text}</td>
                    <td style={{ color: d30.color, fontWeight: 600 }}>{d30.text}</td>
                    <td>{rankLabel(s.best)}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{s.snapshotCount}</td>
                    <td>
                      <button className="qa-btn-ghost" onClick={() => handleViewHistory(s.domain, s.keyword)} style={{ fontSize: 11, padding: "4px 10px", marginRight: 6 }}>History</button>
                      <button className="qa-btn-ghost" onClick={() => handleRemove(s.domain, s.keyword)} style={{ fontSize: 11, padding: "4px 10px", color: "#dc2626" }}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="qa-panel"
            style={{ padding: 20, marginTop: 18 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.domain} — "{selected.keyword}"</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>DDG vs Brave rank over time (lower = better)</div>
              </div>
              <button className="qa-btn-ghost" onClick={() => { setSelected(null); setHistory(null); }} style={{ fontSize: 12 }}>Close</button>
            </div>
            {history === null ? (
              <div className="qa-loading-panel" style={{ padding: 20 }}>
                <span className="qa-spinner qa-spinner--lg" />
              </div>
            ) : chartData.length === 0 ? (
              <div style={{ padding: 20, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>No history yet — re-add or wait for the next daily snapshot.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="at" fontSize={11} />
                  <YAxis reversed domain={[1, 30]} fontSize={11} label={{ value: "rank", angle: -90, position: "insideLeft", fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="ddg" stroke="#0f172a" strokeWidth={2} dot={{ r: 3 }} name="DDG" connectNulls />
                  <Line type="monotone" dataKey="brave" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} name="Brave" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
