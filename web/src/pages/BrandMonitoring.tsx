import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchBrandMonitoring, fetchBrandMentionsAggregated, type BrandMentionRow, type BrandMentionsBundle } from "../api";

import { ErrorBanner } from "../components/UI";
import { HeroSkeleton, TableSkeleton } from "../components/Skeletons";
import { PageHero } from "../components/PageHero";

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
  // Phase F — Private AI Brand Guardian: opt-in sentiment + competitor proximity.
  const [withSentiment, setWithSentiment] = useState(true);
  const [competitorsRaw, setCompetitorsRaw] = useState("");

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
    try {
      const competitors = competitorsRaw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      setData(await fetchBrandMonitoring(brandName.trim(), runId, { withSentiment, competitors }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
      <PageHero
        icon="eye"
        category="monitoring"
        eyebrow="Brand Monitoring"
        title="Real-source mentions only"
        subtitle="Mentions come from real sources only: your run's crawl pages, DuckDuckGo SERP, Common Crawl CDX index, and URLScan. No sentiment scores, visibility percentages, or 'brand strength' metrics — those were LLM fabrications. The LLM is restricted to a 2-sentence qualitative summary of the real findings."
        accent
      />

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
        <input className="qa-input" value={competitorsRaw} onChange={e => setCompetitorsRaw(e.target.value)} placeholder="Competitors (comma-separated) — optional" style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
          <input type="checkbox" checked={withSentiment} onChange={(e) => setWithSentiment(e.target.checked)} />
          Sentiment + urgency (Ollama, local-only)
        </label>
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !runId || !brandName.trim()}>{loading ? "Analyzing..." : "Monitor Brand"}</button>
      </div>
      <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "4px 10px", borderRadius: 999, background: "var(--grad-agentic-soft)", border: "1px solid var(--accent-muted)", color: "var(--accent-hover)", fontWeight: 700 }}>
        🔒 Local-only — your brand string never leaves this machine
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
        Tip: enter a domain form (e.g. <code>acme.com</code>) to enable Common Crawl + URLScan lookups.
      </div>

      {error && <ErrorBanner error={error} />}
      {loading && (
        <div style={{ marginTop: 14 }}>
          <HeroSkeleton showKpis />
          <TableSkeleton rows={8} cols={4} />
        </div>
      )}

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

          {data.sentimentSummary && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Sentiment + urgency
                {data.privacyMode === "local-only" && (
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "var(--grad-agentic-soft)", color: "var(--accent-hover)", border: "1px solid var(--accent-muted)", fontWeight: 700, letterSpacing: 0.4 }}>
                    🔒 LOCAL-ONLY {data.sentimentModel ? `· ${data.sentimentModel}` : ""}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 10 }}>
                <SentTile label="Positive" value={data.sentimentSummary.positive} color="#16a34a" />
                <SentTile label="Neutral" value={data.sentimentSummary.neutral} color="#64748b" />
                <SentTile label="Negative" value={data.sentimentSummary.negative} color="#dc2626" />
                <SentTile label="High urgency" value={data.sentimentSummary.high} color="#b91c1c" />
                <SentTile label="Medium urgency" value={data.sentimentSummary.medium} color="#d97706" />
                <SentTile label="Low urgency" value={data.sentimentSummary.low} color="#0ea5e9" />
              </div>
              {Object.keys(data.sentimentSummary.competitorProximity ?? {}).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="qa-kicker" style={{ marginBottom: 6 }}>Competitor co-occurrence</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {Object.entries(data.sentimentSummary.competitorProximity as Record<string, number>).map(([name, count]) => (
                      <span key={name} style={{ fontSize: 11.5, padding: "3px 10px", borderRadius: 12, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", fontWeight: 700 }}>
                        {name} <span style={{ opacity: 0.7, fontWeight: 500 }}>×{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
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

function SentTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="qa-panel" style={{ padding: 12, borderTop: `3px solid ${color}` }}>
      <div className="qa-kicker" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
