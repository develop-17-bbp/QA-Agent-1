import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { fetchSerpAnalysis, queryGscAnalytics } from "../api";
import { useGoogleOverlay } from "../lib/google-overlay";

import { LoadingPanel, ErrorBanner } from "../components/UI";
const DIFF_COLORS = { easy: "#38a169", medium: "#dd6b20", hard: "#e53e3e" };

export default function SerpAnalyzer() {
  const [keywords, setKeywords] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gscPositions, setGscPositions] = useState<Map<string, any>>(new Map());

  const overlay = useGoogleOverlay(targetDomain.trim() || undefined);

  const analyze = async () => {
    const kws = keywords.split("\n").map(k => k.trim()).filter(Boolean);
    if (kws.length === 0) return;
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchSerpAnalysis(kws, targetDomain.trim() || undefined)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!data || !overlay.matchedGscSite) return;
    const kws = (data.results ?? []).map((r: any) => r.query).filter(Boolean);
    if (kws.length === 0) return;
    queryGscAnalytics({
      siteUrl: overlay.matchedGscSite.siteUrl,
      dimensions: ["query"],
      rowLimit: 200,
    }).then((rows: any[]) => {
      const m = new Map<string, any>();
      for (const r of rows) {
        const q = (r.keys?.[0] ?? "").toLowerCase();
        if (q) m.set(q, r);
      }
      setGscPositions(m);
    }).catch(() => {});
  }, [data, overlay.matchedGscSite?.siteUrl]);

  const positionData = data?.competitors?.filter((c: any) => c.yourPosition)?.map((c: any) => ({
    keyword: c.query.length > 20 ? c.query.slice(0, 20) + "..." : c.query,
    position: c.yourPosition,
    fill: c.yourPosition <= 3 ? "#38a169" : c.yourPosition <= 10 ? "#dd6b20" : "#e53e3e",
  })) ?? [];

  const diffData = data?.competitors ? (() => {
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const c of data.competitors) counts[c.difficulty as keyof typeof counts]++;
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: DIFF_COLORS[name as keyof typeof DIFF_COLORS],
    }));
  })() : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">SERP Analyzer</h1>
      <p className="qa-page-desc">
        Real search results from DuckDuckGo — track rankings, analyze competitors, and find opportunities. No API keys required.
      </p>

      <div className="qa-panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <input className="qa-input" value={targetDomain} onChange={e => setTargetDomain(e.target.value)} placeholder="Your domain (e.g. example.com) — optional" style={{ flex: 1, padding: "8px 12px" }} />
        </div>
        <textarea className="qa-input" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Enter keywords (one per line)..." style={{ width: "100%", padding: "8px 12px", minHeight: 100, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !keywords.trim()} style={{ marginTop: 8, padding: "8px 24px" }}>{loading ? "Searching..." : "Analyze SERPs"}</button>
      </div>

      {error && <ErrorBanner error={error} />}
      {loading && <LoadingPanel message="Scraping search results…" />}

      {data && !loading && (
        <>
          {/* GSC overlay status pill */}
          {overlay.connected && overlay.matchedGscSite && (
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, background: "#e8f5e8", color: "#1a7a1a", fontWeight: 600, border: "1px solid #a3d9a3" }}>
                ● GSC overlay active · {overlay.matchedGscSite.siteUrl}
              </span>
            </div>
          )}
          {overlay.connected && !overlay.matchedGscSite && targetDomain && (
            <div style={{ marginTop: 16 }}>
              <span style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, background: "rgba(221,107,32,0.1)", color: "#dd6b20", fontWeight: 500, border: "1px solid rgba(221,107,32,0.3)" }}>
                Google connected — no verified GSC property matches "{targetDomain}"
              </span>
            </div>
          )}

          {/* Summary cards */}
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[
              { label: "Keywords Searched", val: data.results?.length ?? 0 },
              { label: "Avg Results", val: data.summary?.avgResults ?? 0 },
              { label: "Cache Hit", val: `${data.summary?.cachedPercent ?? 0}%` },
              { label: "Avg Latency", val: `${data.summary?.avgLatencyMs ?? 0}ms` },
            ].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {positionData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 2, minWidth: 300 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Your Positions</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={positionData} layout="vertical">
                    <XAxis type="number" domain={[0, 30]} reversed fontSize={11} />
                    <YAxis type="category" dataKey="keyword" width={140} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="position" radius={[0, 4, 4, 0]}>
                      {positionData.map((d: any, i: number) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {diffData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 240 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Keyword Difficulty</div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={diffData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40} label>
                      {diffData.map((d: any, i: number) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* SERP Results per keyword */}
          {(data.results ?? []).map((serp: any, si: number) => (
            <div key={si} className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>"{serp.query}"</span>
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{serp.results.length} results · {serp.latencyMs}ms{serp.cached ? " · cached" : ""}</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["#", "Title", "Domain", "Snippet"].map(h => <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 11, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                <tbody>{serp.results.slice(0, 10).map((r: any) => (
                  <tr key={r.position} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px", fontSize: 13, fontWeight: 700, color: r.position <= 3 ? "#38a169" : "var(--text-primary)", width: 30 }}>{r.position}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12 }}>
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)", textDecoration: "none" }}>{r.title}</a>
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{r.displayUrl}</td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: "var(--text-secondary)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>{r.snippet}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}

          {/* Competitor Analysis */}
          {(data.competitors ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Competitor Analysis</div>
              {data.competitors.map((ca: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: i < data.competitors.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>"{ca.query}"</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: DIFF_COLORS[ca.difficulty as keyof typeof DIFF_COLORS] + "20", color: DIFF_COLORS[ca.difficulty as keyof typeof DIFF_COLORS], fontWeight: 600 }}>{ca.difficulty}</span>
                      {ca.yourPosition && <span style={{ fontSize: 12, fontWeight: 700, color: ca.yourPosition <= 3 ? "#38a169" : ca.yourPosition <= 10 ? "#dd6b20" : "#e53e3e" }}>#{ca.yourPosition}</span>}
                      {gscPositions.has(ca.query.toLowerCase()) && (
                        <span title="Real GSC data" style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#e8f5e8", color: "#1a7a1a", fontWeight: 600, marginLeft: 4 }}>
                          GSC #{gscPositions.get(ca.query.toLowerCase())?.position?.value?.toFixed(0) ?? "?"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>{ca.opportunity}</div>
                  {ca.serpFeatures.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {ca.serpFeatures.map((f: string, fi: number) => (
                        <span key={fi} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "var(--border)", color: "var(--text-secondary)" }}>{f}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
