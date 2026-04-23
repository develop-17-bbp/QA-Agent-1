import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchBrandMonitoring, fetchBrandMentionsAggregated, type BrandMentionRow, type BrandMentionsBundle } from "../api";

import { LoadingPanel, ErrorBanner } from "../components/UI";

const RSS_SOURCE_COLORS: Record<string, string> = {
  "google-news": "#4285f4",
  "reddit": "#ff4500",
  "hackernews": "#ff6600",
  "gdelt": "#0284c7",
  "stackexchange": "#f48024",
  "wayback-cdx": "#6b7280",
};
const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

const SOURCE_COLORS: Record<string, string> = {
  "crawl": "#38a169",
  "duckduckgo-serp": "#111111",
  "common-crawl": "#9f7aea",
  "urlscan": "#ed8936",
};

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

export default function BrandMonitoring() {
  const [runId, setRunId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // RSS-aggregator "brand radar" — no runId needed, pulls from 6 free sources.
  const [radarQuery, setRadarQuery] = useState("");
  const [radar, setRadar] = useState<BrandMentionsBundle | null>(null);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState("");

  const runRadar = async () => {
    const q = radarQuery.trim();
    if (!q) return;
    setRadarLoading(true); setRadarError(""); setRadar(null);
    try { setRadar(await fetchBrandMentionsAggregated(q)); }
    catch (e: any) { setRadarError(e.message); }
    finally { setRadarLoading(false); }
  };

  const analyze = async () => {
    if (!runId || !brandName.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchBrandMonitoring(brandName.trim(), runId)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const dq = data?.dataQuality ?? { providersHit: [], providersFailed: [], missingFields: [] };
  const mentions: any[] = data?.mentions ?? [];

  const counts = [
    { key: "crawlMentions", label: "Crawl" },
    { key: "webMentions", label: "DDG SERP" },
    { key: "commonCrawlHits", label: "Common Crawl" },
    { key: "urlscanHits", label: "URLScan" },
    { key: "totalUniqueMentions", label: "Total unique" },
  ];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Brand Monitoring</h1>
      <p className="qa-page-desc">
        Mentions come from <strong>real sources only</strong>: your run's crawl pages, DuckDuckGo SERP,
        Common Crawl CDX index, and URLScan. No sentiment scores, visibility percentages, or "brand
        strength" metrics — those were LLM fabrications. The LLM is restricted to a 2-sentence qualitative
        summary of the real findings.
      </p>

      {/* ── Brand radar — free RSS / API aggregator (no runId needed) ─────────── */}
      <div className="qa-panel" style={{ padding: 16, marginBottom: 16, border: "1px solid var(--accent-muted)", background: "var(--accent-light, #eff6ff)" }}>
        <div className="qa-panel-title" style={{ color: "var(--accent-hover, #1d4ed8)" }}>
          🛰 Brand Radar — Google News + Reddit + HN + GDELT + StackExchange + Wayback
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
          Aggregates mentions across 6 free feeds in parallel. No API keys. Comparable to paid brand-monitoring tools like Brand24 / Mention — run it as often as you want.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="qa-input"
            value={radarQuery}
            onChange={(e) => setRadarQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !radarLoading && runRadar()}
            placeholder='Brand, keyword, or domain — e.g. "Ahrefs" or "example.com"'
            style={{ flex: 1, minWidth: 260, padding: "8px 12px" }}
          />
          <button
            className="qa-btn-primary"
            onClick={runRadar}
            disabled={radarLoading || !radarQuery.trim()}
            style={{ padding: "8px 18px", whiteSpace: "nowrap" }}
          >
            {radarLoading ? "Scanning…" : "Run radar"}
          </button>
          <a
            href={radarQuery.trim() ? `/term-intel?term=${encodeURIComponent(radarQuery.trim())}` : "/term-intel"}
            style={{
              padding: "8px 14px", borderRadius: 6, background: "#fff", border: "1px solid var(--border)",
              color: "var(--accent)", fontWeight: 600, fontSize: 12.5, textDecoration: "none", whiteSpace: "nowrap",
            }}
            title="Ask the Council about this term — queries every source (Ads, Trends, GSC, Bing/Yandex/Ahrefs anchors, etc.) and runs the AI advisor panel"
          >
            🧭 Ask the Council →
          </a>
        </div>
        {radarError && <ErrorBanner error={radarError} />}
        {radar && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span className="qa-kicker" style={{ fontSize: 11 }}>Coverage:</span>
              {(radar.providersHit ?? []).map((p) => (
                <span key={`hit-${p}`} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 10, background: "#fff", color: RSS_SOURCE_COLORS[p] ?? "#16a34a", border: `1px solid ${RSS_SOURCE_COLORS[p] ?? "#16a34a"}` }}>
                  ● {p} ({radar.bySource[p] ?? 0})
                </span>
              ))}
              {(radar.providersFailed ?? []).map((p) => (
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 10, background: "#fff", color: "#94a3b8", border: "1px solid #cbd5e1" }}>
                  {p} (0)
                </span>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
                Tone from titles:&nbsp;
                <span style={{ color: "#16a34a", fontWeight: 600 }}>● {radar.titleTone.positive}</span>
                &nbsp;/&nbsp;
                <span style={{ color: "#6b7280", fontWeight: 600 }}>● {radar.titleTone.neutral}</span>
                &nbsp;/&nbsp;
                <span style={{ color: "#dc2626", fontWeight: 600 }}>● {radar.titleTone.negative}</span>
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              <strong>{radar.mentions.length}</strong> mentions, newest first (capped at 200).
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
              <table className="qa-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Source</th>
                    <th>Title</th>
                    <th style={{ width: 120 }}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {radar.mentions.map((m: BrandMentionRow, i: number) => (
                    <tr key={`${m.source}-${i}-${m.url}`}>
                      <td>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: "#fff", background: RSS_SOURCE_COLORS[m.source] ?? "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>{m.source}</span>
                      </td>
                      <td>
                        <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)", textDecoration: "none" }}>
                          {m.title}
                        </a>
                        {m.publisher && <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.publisher}{typeof m.score === "number" && ` · ${m.score} pts`}</div>}
                        {m.snippet && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>{m.snippet.slice(0, 180)}{m.snippet.length > 180 ? "…" : ""}</div>}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {m.publishedAt ? new Date(m.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 10px" }}>
        Prefer crawl-scoped mentions (your own site's pages + DDG + Common Crawl + URLScan)? Pick a run below.
      </div>

      <RunSelector value={runId} onChange={setRunId} label="Select run" />
      <div className="qa-panel" style={{ padding: 16, marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={brandName} onChange={e => setBrandName(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Enter brand name or domain..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !runId || !brandName.trim()}>{loading ? "Analyzing..." : "Monitor Brand"}</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
        Tip: enter a domain form (e.g. <code>acme.com</code>) to enable Common Crawl + URLScan lookups.
      </div>

      {error && <ErrorBanner error={error} />}
      {loading && <LoadingPanel message="Monitoring brand across real providers…" />}

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
              {data.meta?.urlscanConfigured === false && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }}>
                  URLScan key unset — falls back to anonymous (medium confidence)
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {counts.map(({ key, label }) => {
              const meta = data[key];
              const val = unwrap(meta);
              return (
                <div key={key} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                  <div className="qa-kicker">{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>
                    {val ?? 0}
                    <ConfidenceDot confidence={meta?.confidence} source={meta?.source} note={meta?.note} />
                  </div>
                </div>
              );
            })}
          </div>

          {data.summary && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Qualitative Summary</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                AI-generated ≤2-sentence interpretation of the real findings. No numeric claims.
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>{data.summary}</div>
            </div>
          )}

          {mentions.length > 0 ? (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">Mentions ({mentions.length})</div>
              <div style={{ overflowX: "auto" }}>
                <table className="qa-table">
                  <thead><tr><th>Source</th><th>Title / URL</th><th>Snippet</th><th>Time</th></tr></thead>
                  <tbody>
                    {mentions.map((m: any, i: number) => (
                      <tr key={i}>
                        <td>
                          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: (SOURCE_COLORS[m.source] ?? "#888") + "20", color: SOURCE_COLORS[m.source] ?? "#888", fontWeight: 600, whiteSpace: "nowrap" }}>{m.source}</span>
                        </td>
                        <td style={{ maxWidth: 300 }}>
                          {m.title && <div style={{ fontSize: 13, fontWeight: 500 }}>{m.title}</div>}
                          <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#111111", wordBreak: "break-all" }}>{m.url}</a>
                        </td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)", maxWidth: 300 }}>{m.snippet ?? "—"}</td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{m.time ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, textAlign: "center", color: "var(--text-secondary)" }}>
              <div style={{ fontSize: 13 }}>No mentions found in any real source.</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Try a broader brand spelling, or enter a domain form for Common Crawl + URLScan lookups.</div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
