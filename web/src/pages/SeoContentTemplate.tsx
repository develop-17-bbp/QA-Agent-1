import { useState } from "react";
import { motion } from "framer-motion";
import { fetchSeoContentTemplate } from "../api";

import { LoadingPanel, ErrorBanner } from "../components/UI";
const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

function ConfidenceDot({ confidence, source, note }: { confidence?: string; source?: string; note?: string }) {
  const c = confidence ?? "low";
  const label = CONFIDENCE_LABELS[c] ?? c;
  const title = `${label} · ${source ?? "unknown"}${note ? ` · ${note}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: CONFIDENCE_COLORS[c] ?? "#9ca3af",
        marginLeft: 8,
        verticalAlign: "middle",
      }}
    />
  );
}

function unwrap(dp: any): any {
  return dp && typeof dp === "object" && "value" in dp ? dp.value : dp;
}

export default function SeoContentTemplate() {
  const [keyword, setKeyword] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCompetitors, setShowCompetitors] = useState(false);

  const generate = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchSeoContentTemplate(keyword.trim())); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const dq = data?.dataQuality ?? { providersHit: [], providersFailed: [], missingFields: [] };
  const competitors: { url: string; wordCount: number }[] = data?.competitorsAnalyzed ?? [];
  const targetWordCountMeta = data?.contentBrief?.targetWordCount;
  const targetWordCount = unwrap(targetWordCountMeta);

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">SEO Content Template</h1>
      <p className="qa-page-desc">
        Template structure (title, headings, outline) is qualitative LLM output. The only numeric field — target word count —
        is computed from the real word count of the top 10 DuckDuckGo SERP competitors for your keyword.
      </p>

      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && generate()} placeholder="Enter target keyword..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={generate} disabled={loading || !keyword.trim()}>{loading ? "Generating..." : "Generate Template"}</button>
      </div>

      {error && <ErrorBanner error={error} />}
      {loading && <LoadingPanel message="Generating content template…" />}

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
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(229,62,62,0.1)", color: "#e53e3e", fontWeight: 600, border: "1px solid rgba(229,62,62,0.3)" }} title="Provider failed">
                  ✕ {p}
                </span>
              ))}
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
            </div>
          )}

          {targetWordCount !== undefined && targetWordCount !== null && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">
                Target Word Count
                <ConfidenceDot confidence={targetWordCountMeta?.confidence} source={targetWordCountMeta?.source} note={targetWordCountMeta?.note} />
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: "#111111" }}>{targetWordCount}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  computed from {competitors.length} competitor{competitors.length === 1 ? "" : "s"} via DuckDuckGo SERP
                </div>
              </div>
              {competitors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => setShowCompetitors(v => !v)}
                    style={{ fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 10px", cursor: "pointer", color: "var(--text-secondary)" }}
                  >
                    {showCompetitors ? "Hide" : "Show"} {competitors.length} competitor URL{competitors.length === 1 ? "" : "s"}
                  </button>
                  {showCompetitors && (
                    <table className="qa-table" style={{ marginTop: 10 }}>
                      <thead><tr><th>#</th><th>URL</th><th>Word count</th></tr></thead>
                      <tbody>
                        {competitors.map((c, i) => (
                          <tr key={i}>
                            <td style={{ color: "var(--text-secondary)" }}>{i + 1}</td>
                            <td style={{ fontSize: 11, maxWidth: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: "#111111" }}>{c.url}</a>
                            </td>
                            <td style={{ fontWeight: 600 }}>{c.wordCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {(data.title || data.metaDescription) && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 20 }}>
              <div className="qa-panel-title">Title &amp; Meta</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                AI-generated structural skeleton — verify before publishing.
              </div>
              {data.title && (
                <div style={{ padding: "8px 12px", background: "var(--bg-card, rgba(90,103,216,0.04))", borderRadius: 6, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Title</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#1a0dab" }}>{data.title}</div>
                </div>
              )}
              {data.metaDescription && (
                <div style={{ padding: "8px 12px", background: "var(--bg-card, rgba(90,103,216,0.04))", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Meta Description</div>
                  <div style={{ fontSize: 13, color: "#545454" }}>{data.metaDescription}</div>
                </div>
              )}
            </div>
          )}

          {(data.headings ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Heading Structure</div>
              {data.headings.map((h: any, i: number) => (
                <div key={i} style={{ padding: "4px 0", paddingLeft: h.level === "h1" ? 0 : h.level === "h2" ? 16 : 32 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#111111", marginRight: 8, textTransform: "uppercase" }}>{h.level}</span>
                  <span style={{ fontSize: 13 }}>{h.text}</span>
                </div>
              ))}
            </div>
          )}

          {data.keywords && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Keywords</div>
              {["primary", "secondary", "lsi"].map(type => (data.keywords[type] ?? []).length > 0 && (
                <div key={type} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "capitalize", marginBottom: 4 }}>{type}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {data.keywords[type].map((kw: string) => <span key={kw} style={{ padding: "3px 10px", borderRadius: 12, background: type === "primary" ? "#11111120" : type === "secondary" ? "#38a16920" : "#dd6b2020", color: type === "primary" ? "#111111" : type === "secondary" ? "#38a169" : "#dd6b20", fontSize: 12 }}>{kw}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(data.outline ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Content Outline</div>
              {data.outline.map((s: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.section}</div>
                  {(s.keyPoints ?? []).length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{s.keyPoints.map((p: string, j: number) => <li key={j} style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{p}</li>)}</ul>}
                </div>
              ))}
            </div>
          )}

          {(data.seoChecklist ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">SEO Checklist</div>
              {data.seoChecklist.map((item: string, i: number) => (
                <div key={i} style={{ padding: "6px 0", fontSize: 13, display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>{i + 1}.</span> {item}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
