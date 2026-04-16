import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { fetchKeywordMagic, queryGscAnalytics } from "../api";
import { useGoogleOverlay } from "../lib/google-overlay";

const INTENT_COLORS: Record<string, string> = { Informational: "#3182ce", Commercial: "#dd6b20", Transactional: "#38a169", Navigational: "#111111" };
const DIFF_COLORS: Record<string, string> = { Easy: "#38a169", Medium: "#dd6b20", Hard: "#e53e3e", "Very Hard": "#9b2c2c" };
const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

function ConfidenceDot({ confidence, source, value }: { confidence?: string; source?: string; value?: unknown }) {
  const c = confidence ?? "low";
  const label = CONFIDENCE_LABELS[c] ?? c;
  const title = `${label} · ${source ?? "unknown"}${value !== undefined && value !== null ? ` · ${String(value)}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        backgroundColor: CONFIDENCE_COLORS[c] ?? "#9ca3af",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

export default function KeywordMagicTool() {
  const [seed, setSeed] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [gscDomain, setGscDomain] = useState("");
  const [gscKwStats, setGscKwStats] = useState<Map<string, any>>(new Map());
  const [gscLoading, setGscLoading] = useState(false);

  const overlay = useGoogleOverlay(gscDomain.trim() || undefined);

  const search = async () => {
    if (!seed.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchKeywordMagic(seed.trim())); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!data || !overlay.matchedGscSite) return;
    setGscLoading(true);
    queryGscAnalytics({
      siteUrl: overlay.matchedGscSite.siteUrl,
      dimensions: ["query"],
      rowLimit: 500,
    }).then((rows: any[]) => {
      const m = new Map<string, any>();
      for (const r of rows) {
        const q = (r.keys?.[0] ?? "").toLowerCase();
        if (q) m.set(q, r);
      }
      setGscKwStats(m);
    }).catch(() => {}).finally(() => setGscLoading(false));
  }, [data, overlay.matchedGscSite?.siteUrl]);

  const keywords = data?.keywords ?? [];
  const filtered = filter === "all" ? keywords : keywords.filter((k: any) => k.intent === filter);
  const clusters = data?.clusters ?? [];
  const dq = data?.dataQuality ?? { realDataFields: [], estimatedFields: [], missingFields: [], providersHit: [], providersFailed: [] };
  const hideCpc = (dq.missingFields ?? []).includes("cpc");

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Keyword Magic Tool</h1>
      <p className="qa-page-desc" style={{ marginBottom: 16 }}>
        Enter a seed keyword to discover related keywords, volumes, and clusters — backed by real providers
        (Google Suggest, Google Trends, Wikipedia pageviews, DuckDuckGo SERP). No numbers are invented by the LLM.
      </p>

      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={seed} onChange={e => setSeed(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Enter seed keyword..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn" onClick={search} disabled={loading || !seed.trim()} style={{ padding: "8px 24px" }}>{loading ? "Researching..." : "Research"}</button>
        <input className="qa-input" value={gscDomain} onChange={e => setGscDomain(e.target.value)} placeholder="Your domain for GSC overlay (optional — e.g. example.com)" style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        {overlay.connected && overlay.matchedGscSite && (
          <span style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, background: "#e8f5e8", color: "#1a7a1a", fontWeight: 600, border: "1px solid #a3d9a3", whiteSpace: "nowrap" }}>
            ● GSC active
          </span>
        )}
      </div>

      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 16 }}>{error}</div>}
      {loading && <div className="qa-panel" style={{ marginTop: 20 }}><div className="qa-loading-panel">Fetching from live providers...</div></div>}

      {data && !loading && (
        <>
          {(dq.providersHit?.length > 0 || dq.providersFailed?.length > 0 || dq.missingFields?.length > 0) && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="qa-kicker" style={{ fontSize: 11 }}>Data sources:</span>
              {(dq.providersHit ?? []).map((p: string) => (
                <span key={`hit-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(56,161,105,0.15)", color: "#38a169", fontWeight: 600, border: "1px solid rgba(56,161,105,0.3)" }} title="Real provider hit">
                  ● {p}
                </span>
              ))}
              {(dq.providersFailed ?? []).map((p: string) => (
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(229,62,62,0.1)", color: "#e53e3e", fontWeight: 600, border: "1px solid rgba(229,62,62,0.3)" }} title="Provider failed or unavailable">
                  ✕ {p}
                </span>
              ))}
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`No free provider populates: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[
              { label: "Keywords Found", val: keywords.length },
              { label: "Clusters", val: clusters.length },
              { label: "Providers Hit", val: (dq.providersHit ?? []).length },
            ].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div className="qa-kicker">{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{s.val}</div>
              </div>
            ))}
          </div>

          {clusters.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title" style={{ marginBottom: 12 }}>Keyword Clusters</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {clusters.map((c: any, i: number) => (
                  <div key={i} style={{ padding: "10px 16px", borderRadius: 8, background: "var(--bg-card, rgba(90,103,216,0.06))", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{(c.keywords ?? []).join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="qa-panel-title">
                Keywords ({filtered.length})
                {gscLoading && <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8, fontWeight: 400 }}>Loading GSC data...</span>}
              </div>
              <select className="qa-select" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 160 }}>
                <option value="all">All Intents</option>
                <option value="Informational">Informational</option>
                <option value="Commercial">Commercial</option>
                <option value="Transactional">Transactional</option>
                <option value="Navigational">Navigational</option>
              </select>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
              Confidence dots: <span style={{ color: "#38a169" }}>● real</span> · <span style={{ color: "#dd6b20" }}>● derived</span> · <span style={{ color: "#9ca3af" }}>● estimated</span>. Hover for source.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="qa-table">
                <thead><tr>
                  {["Keyword", "Source", "Volume", "Difficulty", "Intent", ...(hideCpc ? [] : ["CPC"]), "Trend"].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                  {gscKwStats.size > 0 && <th>GSC Pos</th>}
                  {gscKwStats.size > 0 && <th>GSC Clicks</th>}
                </tr></thead>
                <tbody>
                  {filtered.map((kw: any, i: number) => {
                    const gscRow = gscKwStats.get(kw.keyword.toLowerCase());
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{kw.keyword}</td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>{kw.source ?? "—"}</td>
                        <td style={{ color: "var(--text-secondary)" }}>
                          {kw.volume}
                          <ConfidenceDot confidence={kw.volumeData?.confidence} source={kw.volumeData?.source} value={kw.volumeData?.value} />
                        </td>
                        <td>
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (DIFF_COLORS[kw.difficulty] ?? "#888") + "20", color: DIFF_COLORS[kw.difficulty] ?? "#888", fontWeight: 600 }}>{kw.difficulty}</span>
                          <ConfidenceDot confidence={kw.difficultyData?.confidence} source={kw.difficultyData?.source} value={kw.difficultyData?.value} />
                        </td>
                        <td>
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (INTENT_COLORS[kw.intent] ?? "#888") + "20", color: INTENT_COLORS[kw.intent] ?? "#888", fontWeight: 600 }}>{kw.intent}</span>
                          <ConfidenceDot confidence={kw.intentData?.confidence} source={kw.intentData?.source} />
                        </td>
                        {!hideCpc && <td style={{ color: "var(--text-secondary)" }}>{kw.cpc || "—"}</td>}
                        <td style={{ color: kw.trend === "Rising" ? "#38a169" : kw.trend === "Declining" ? "#e53e3e" : "var(--text-secondary)" }}>{kw.trend}</td>
                        {gscKwStats.size > 0 && (
                          <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                            {gscRow ? (gscRow.position?.value?.toFixed(1) ?? gscRow.position?.toFixed?.(1) ?? "—") : "—"}
                          </td>
                        )}
                        {gscKwStats.size > 0 && (
                          <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                            {gscRow ? (gscRow.clicks?.value ?? gscRow.clicks ?? "—") : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
