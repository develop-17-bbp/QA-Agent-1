import { useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchAiSearchVisibility, type AiVisibilityResponse, type AiEngine, type AiVisibilityMetrics } from "../api";

const ENGINE_LABEL: Record<AiEngine, string> = {
  "chatgpt": "ChatGPT",
  "perplexity": "Perplexity",
  "gemini": "Gemini",
  "ai-overviews": "Google AI Overviews",
};

const ENGINE_COLOR: Record<AiEngine, string> = {
  "chatgpt": "#10a37f",
  "perplexity": "#1e3a8a",
  "gemini": "#1a73e8",
  "ai-overviews": "#ea4335",
};

export default function AiSearchVisibility() {
  const [domain, setDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  const [queriesText, setQueriesText] = useState("");
  const [competitorsText, setCompetitorsText] = useState("");
  const [data, setData] = useState<AiVisibilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!domain.trim() || !brandName.trim() || !queriesText.trim()) {
      setError("domain, brand name, and at least one query are required");
      return;
    }
    setLoading(true); setError(""); setData(null);
    try {
      const queries = queriesText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const competitors = competitorsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      setData(await fetchAiSearchVisibility({ domain: domain.trim(), brandName: brandName.trim(), queries, competitors }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell
      title="AI Search Visibility"
      desc="The 2026 SEO frontier: visibility is no longer just about ranking on a Google SERP — it's about being the cited source in an AI-generated answer. Tracks 5 metrics across ChatGPT, Perplexity, Gemini, and Google AI Overviews."
      purpose="When ChatGPT / Perplexity / Google AI Overviews answer a question about my industry, am I cited? At what rank? More than my competitors?"
      sources={["OpenAI API (BYOK)", "Perplexity API (BYOK)", "Google Gemini API (BYOK)", "Google AI Overviews via Playwright"]}
    >
      <PageHero
        icon="sparkles"
        eyebrow="AI Search Visibility"
        title={data ? data.domain : "Pick a domain + queries"}
        subtitle={data ? `${data.queries.length} queries × ${data.enginesAttempted.length} engines · ${data.perQuery.length} answers analyzed` : "Track citations across ChatGPT, Perplexity, Gemini, and Google AI Overviews. Privacy-distinct: this is the only QA-Agent feature that legitimately sends queries to external LLMs (you can't track 'does ChatGPT cite me' without asking ChatGPT)."}
        accent
      />

      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "5px 12px", borderRadius: 999, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", fontWeight: 700, marginBottom: 14 }}>
        🌍 SENDS QUERIES EXTERNALLY — to OpenAI / Perplexity / Google. Your domain + queries reach those services. Configure each provider's BYOK key in <code>/integrations</code>; engines without a key are silently skipped.
      </div>

      <SectionCard title="Configure">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Your domain</div>
            <input className="qa-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" style={{ width: "100%" }} />
          </label>
          <label>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Your brand name</div>
            <input className="qa-input" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Example Inc." style={{ width: "100%" }} />
          </label>
        </div>
        <label style={{ display: "block", marginTop: 12 }}>
          <div className="qa-kicker" style={{ marginBottom: 4 }}>Queries (one per line) · 1-30 queries · branded + intent-of-purchase mix</div>
          <textarea className="qa-input" value={queriesText} onChange={(e) => setQueriesText(e.target.value)} rows={6} placeholder={"best plastic surgeon seattle\nallure esthetic reviews\ndr javad sajan reputation"} style={{ width: "100%", fontFamily: "inherit" }} />
        </label>
        <label style={{ display: "block", marginTop: 12 }}>
          <div className="qa-kicker" style={{ marginBottom: 4 }}>Competitor domains (comma or newline separated, optional — used for Share-of-Voice)</div>
          <input className="qa-input" value={competitorsText} onChange={(e) => setCompetitorsText(e.target.value)} placeholder="competitor1.com, competitor2.com" style={{ width: "100%" }} />
        </label>
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={run} disabled={loading} className="qa-btn-primary" style={{ padding: "10px 22px", fontWeight: 700 }}>
            {loading ? "Tracking…" : "Track AI search visibility"}
          </button>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            ChatGPT and Perplexity API calls are billed per query — about $0.001-0.01 each.
          </span>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      </SectionCard>

      {loading && <LoadingPanel message="Asking each AI engine your queries (in parallel, capped 4 at a time)…" />}

      {data && (
        <>
          {data.enginesSkipped.length > 0 && (
            <SectionCard title="Skipped engines">
              {data.enginesSkipped.map((s) => (
                <div key={s.engine} style={{ fontSize: 12, padding: "6px 10px", color: "var(--muted)" }}>
                  • <strong>{ENGINE_LABEL[s.engine]}</strong> — {s.reason}
                </div>
              ))}
            </SectionCard>
          )}

          {data.perEngine.map((m) => <EngineCard key={m.engine} m={m} />)}

          <SectionCard title={`Per-query answers (${data.perQuery.length})`}>
            {data.perQuery.length === 0 ? (
              <EmptyState title="No answers" hint="No engines were available." />
            ) : (
              data.perQuery.slice(0, 50).map((r, i) => (
                <div key={`${r.engine}-${r.query}-${i}`} className="qa-panel" style={{ padding: 10, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: ENGINE_COLOR[r.engine] + "20", color: ENGINE_COLOR[r.engine] }}>
                      {ENGINE_LABEL[r.engine]}
                    </span>
                    <strong style={{ fontSize: 12.5 }}>"{r.query}"</strong>
                    {r.brandMentioned && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>BRAND ✓</span>}
                    {r.domainCited && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", fontWeight: 700 }}>CITED #{r.operatorPosition}</span>}
                    {!r.domainCited && !r.brandMentioned && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>NOT MENTIONED</span>}
                    {r.error && <span style={{ fontSize: 10, color: "var(--bad)" }}>error: {r.error}</span>}
                  </div>
                  {r.answerText && (
                    <details style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                      <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 600 }}>answer ({r.citations.length} citations)</summary>
                      <div style={{ whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.5 }}>{r.answerText.slice(0, 800)}{r.answerText.length > 800 ? "…" : ""}</div>
                      {r.citations.length > 0 && (
                        <ol style={{ marginTop: 6, paddingLeft: 20 }}>
                          {r.citations.slice(0, 10).map((c, j) => (
                            <li key={j} style={{ fontSize: 11, color: c.domain === r.citations[0]?.domain ? "var(--accent)" : "var(--muted)" }}>
                              <a href={c.url} target="_blank" rel="noreferrer" style={{ color: "inherit", wordBreak: "break-all" }}>{c.domain || c.url}</a>
                            </li>
                          ))}
                        </ol>
                      )}
                    </details>
                  )}
                </div>
              ))
            )}
          </SectionCard>
        </>
      )}
    </PageShell>
  );
}

function EngineCard({ m }: { m: AiVisibilityMetrics }) {
  const c = ENGINE_COLOR[m.engine];
  return (
    <SectionCard title={ENGINE_LABEL[m.engine]} actions={<span style={{ fontSize: 11, color: "var(--muted)" }}>{m.queriesRan}/{m.queriesRan + m.queriesFailed} queries succeeded</span>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 10 }}>
        <MetricCard label="Mention rate" value={`${Math.round(m.mentionRate * 100)}%`} caption="brand string in answer" tone={m.mentionRate >= 0.5 ? "ok" : m.mentionRate >= 0.2 ? "warn" : "bad"} />
        <MetricCard label="Citation rate" value={`${Math.round(m.citationRate * 100)}%`} caption="domain in source list" tone={m.citationRate >= 0.5 ? "ok" : m.citationRate >= 0.2 ? "warn" : "bad"} />
        <MetricCard label="Share of voice" value={`${Math.round(m.shareOfVoice * 100)}%`} caption="vs competitors" tone={m.shareOfVoice >= 0.4 ? "ok" : m.shareOfVoice >= 0.15 ? "warn" : "bad"} />
        <MetricCard label="Avg position" value={m.averagePosition != null ? `#${m.averagePosition}` : "—"} caption="when cited" tone={m.averagePosition != null && m.averagePosition <= 3 ? "ok" : m.averagePosition != null && m.averagePosition <= 6 ? "warn" : "default"} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Sentiment:</span>
        <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}>{m.sentimentBreakdown.positive} positive</span>
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{m.sentimentBreakdown.neutral} neutral</span>
        <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 700 }}>{m.sentimentBreakdown.negative} negative</span>
      </div>
      {m.topCompetitors.length > 0 && (
        <div>
          <div className="qa-kicker" style={{ marginBottom: 6 }}>Top competitors {ENGINE_LABEL[m.engine]} cites instead</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {m.topCompetitors.map((tc) => (
              <span key={tc.domain} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: c + "12", color: c, border: `1px solid ${c}30`, fontWeight: 700 }}>
                {tc.domain} <span style={{ opacity: 0.7, fontWeight: 500 }}>×{tc.citationCount}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
