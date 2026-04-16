import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchKeywordStrategy, fetchGscPagesBatch } from "../api";
import { useGoogleOverlay } from "../lib/google-overlay";

function bestGscForKeyword(urls: string[], gscPages: Map<string, any>) {
  for (const u of urls ?? []) {
    const p = gscPages.get(u);
    if (p) return p;
    try {
      const path = new URL(u).pathname;
      for (const [k, v] of gscPages) {
        try { if (new URL(k).pathname === path) return v; } catch {}
      }
    } catch {}
  }
  return null;
}

const PRIORITY_COLORS: Record<string, string> = { High: "#e53e3e", Medium: "#dd6b20", Low: "#111111" };
const SOURCE_COLORS: Record<string, string> = { crawl: "#38a169", "google-suggest": "#111111" };

export default function KeywordStrategyBuilder() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState("");
  const [gscPages, setGscPages] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    const firstUrl = (data?.priorityKeywords?.[0]?.urls ?? [])[0];
    if (firstUrl) { try { setDomain(new URL(firstUrl).hostname.replace(/^www\./, "")); } catch {} }
  }, [data]);

  const overlay = useGoogleOverlay(domain);

  useEffect(() => {
    if (!overlay.matchedGscSite) return;
    fetchGscPagesBatch(overlay.matchedGscSite.siteUrl, 28, 500)
      .then(pages => {
        const m = new Map<string, any>();
        for (const p of pages) m.set(p.page ?? "", p);
        setGscPages(m);
      }).catch(() => {});
  }, [overlay.matchedGscSite?.siteUrl]);

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true);
    setError("");
    try { setData(await fetchKeywordStrategy(rid)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const priorityKeywords = data?.priorityKeywords ?? [];
  const relatedKeywords = data?.relatedKeywords ?? [];
  const clusters = data?.clusters ?? [];
  const dq = data?.dataQuality ?? { realDataFields: [], estimatedFields: [], missingFields: [], providersHit: [], providersFailed: [] };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Keyword Strategy Builder</h1>
      <p className="qa-page-desc" style={{ marginBottom: 16 }}>
        Keyword strategy built from <strong>real sources only</strong>: crawl-extracted keywords from your run's pages
        plus Google Suggest autocomplete. The LLM is used only to cluster the real keywords into themes —
        it never invents keywords, volumes, or priorities.
      </p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-panel" style={{ marginTop: 20 }}><div className="qa-loading-panel">Extracting from crawl + Google Suggest...</div></div>}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

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
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
              {overlay.matchedGscSite && gscPages.size > 0 && (
                <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(56,161,105,0.15)", color: "#38a169", fontWeight: 600, border: "1px solid rgba(56,161,105,0.3)" }} title="Real GSC data overlaid">
                  ● google-search-console
                </span>
              )}
            </div>
          )}

          {data.meta && (
            <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
              {[
                { label: "Pages analyzed", val: data.meta.totalPages ?? 0 },
                { label: "Sites", val: data.meta.sitesAnalyzed ?? 0 },
                { label: "Priority keywords", val: priorityKeywords.length },
                { label: "Google Suggest related", val: relatedKeywords.length },
              ].map((s) => (
                <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                  <div className="qa-kicker">{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{s.val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Priority Keywords — all from real crawl extraction */}
          {priorityKeywords.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title" style={{ marginBottom: 4 }}>Priority Keywords</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
                Extracted from your crawl's page titles. Priority is a deterministic bucket based on frequency rank.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="qa-table">
                  <thead>
                    <tr>
                      {["Keyword", "Source", "Frequency", "Priority", "Sample URLs"].map((h) => <th key={h}>{h}</th>)}
                      {gscPages.size > 0 && <th>GSC Impr.</th>}
                      {gscPages.size > 0 && <th>GSC Clicks</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {priorityKeywords.map((kw: any, i: number) => {
                      const gscMatch = gscPages.size > 0 ? bestGscForKeyword(kw.urls, gscPages) : null;
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{kw.keyword}</td>
                          <td>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (SOURCE_COLORS[kw.source] ?? "#888") + "20", color: SOURCE_COLORS[kw.source] ?? "#888", fontWeight: 600 }}>{kw.source}</span>
                          </td>
                          <td style={{ color: "var(--text-secondary)" }}>{kw.frequency ?? "—"}</td>
                          <td>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: (PRIORITY_COLORS[kw.priority] ?? "#888") + "20", color: PRIORITY_COLORS[kw.priority] ?? "#888", fontWeight: 600 }}>{kw.priority ?? "—"}</span>
                          </td>
                          <td style={{ fontSize: 11, color: "var(--text-secondary)", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {(kw.urls ?? []).slice(0, 2).join(", ")}
                            {(kw.urls ?? []).length > 2 && ` +${kw.urls.length - 2} more`}
                          </td>
                          {gscPages.size > 0 && <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{gscMatch?.impressions?.value ?? "—"}</td>}
                          {gscPages.size > 0 && <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{gscMatch?.clicks?.value ?? "—"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Related Keywords — all real from Google Suggest */}
          {relatedKeywords.length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title" style={{ marginBottom: 4 }}>Related Keywords (Google Suggest)</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
                Real autocomplete suggestions from Google for each top priority keyword. No LLM expansion.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {relatedKeywords.map((kw: any, i: number) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 12,
                      padding: "6px 12px",
                      borderRadius: 16,
                      background: "rgba(90,103,216,0.08)",
                      border: "1px solid rgba(90,103,216,0.2)",
                      color: "var(--text-primary)",
                    }}
                    title={`from seed: ${kw.fromSeed ?? "—"}`}
                  >
                    {kw.keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Topic Clusters — LLM groups the real set into themes */}
          <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
            <div className="qa-panel-title" style={{ marginBottom: 4 }}>Topic Clusters</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
              LLM is restricted to grouping real keywords into themes. It cannot invent new keywords — any
              hallucinated keyword is filtered out before rendering.
            </div>
            {clusters.length > 0 ? (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {clusters.map((c: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      flex: "1 1 280px",
                      padding: 16,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-card, rgba(90,103,216,0.04))",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>{(c.keywords ?? []).length} keywords</div>
                    <div style={{ fontSize: 12, marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(c.keywords ?? []).map((k: string, j: number) => (
                        <span key={j} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 10, background: "rgba(56,161,105,0.1)", color: "#38a169" }}>{k}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>
                Clustering unavailable — LLM returned no valid groups. Priority + related keywords above are
                still fully usable as a flat list.
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
