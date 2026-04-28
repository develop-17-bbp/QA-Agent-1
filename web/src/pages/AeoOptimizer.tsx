import { useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchAeo, type AeoResponse } from "../api";

const EFFORT_COLOR: Record<"easy" | "medium" | "hard", string> = {
  easy: "#16a34a",
  medium: "#d97706",
  hard: "#dc2626",
};

export default function AeoOptimizer() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<AeoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!url.trim()) { setError("URL required"); return; }
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchAeo(url.trim())); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  };

  return (
    <PageShell
      title="AEO Optimizer"
      desc="Answer Engine Optimization — score how AI-citation-ready a page is. Companion to AI Search Visibility: visibility tells you whether AI engines cite you, this tells you HOW TO FIX a page so they will."
      purpose="What specific changes will make this page citable by ChatGPT, Perplexity, and Google AI Overviews?"
      sources={["Live page fetch", "Cheerio article extraction", "8 deterministic AEO signals", "Ollama-driven fix suggestions"]}
    >
      <PageHero
        icon="sparkles"
        eyebrow="Answer Engine Optimization"
        title={data ? new URL(data.url).hostname.replace(/^www\./, "") : "Score a page"}
        subtitle={data ? `AEO score ${data.score}/100 · ${data.wordCount.toLocaleString()} words` : "Scores 8 signals AI engines look for, then suggests one specific fix per failed signal."}
        accent
      />

      <SectionCard title="Score">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="qa-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/your-page" style={{ flex: 1, minWidth: 320, padding: "8px 12px" }} onKeyDown={(e) => e.key === "Enter" && run()} />
          <button onClick={run} disabled={loading || !url.trim()} className="qa-btn-primary" style={{ padding: "10px 22px", fontWeight: 700 }}>
            {loading ? "Scoring…" : "Score AEO"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      </SectionCard>

      {loading && <LoadingPanel message="Fetching page, extracting article, scoring 8 signals…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="AEO score" value={`${data.score}/100`} tone={data.score >= 75 ? "ok" : data.score >= 50 ? "warn" : "bad"} caption="weighted across 8 signals" />
            <MetricCard label="Signals passed" value={`${data.signals.filter((s) => s.passed).length}/${data.signals.length}`} caption="failed = fix opportunity" />
            <MetricCard label="Word count" value={data.wordCount.toLocaleString()} caption="extracted main article" />
            <MetricCard label="Fixes suggested" value={data.fixes.length} tone={data.fixes.length > 0 ? "warn" : "ok"} caption={data.fixesError ?? "from local LLM"} />
          </div>

          <SectionCard title="Lead paragraph (what AI engines see first)">
            <div style={{ padding: 12, fontSize: 13, fontStyle: "italic", color: "var(--text-secondary)", lineHeight: 1.6, background: "var(--glass2)", borderRadius: 6 }}>
              {data.lead || <span style={{ color: "var(--muted)" }}>(no lead paragraph extracted)</span>}
            </div>
          </SectionCard>

          <SectionCard title="Signals">
            {data.signals.map((s) => (
              <div key={s.key} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16, color: s.passed ? "#16a34a" : "#dc2626", fontWeight: 800 }}>{s.passed ? "✓" : "✕"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.evidence}</div>
                </div>
                <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: "var(--glass2)", color: "var(--muted)", fontWeight: 700 }}>{s.weight}pt</span>
              </div>
            ))}
          </SectionCard>

          {data.fixes.length > 0 && (
            <SectionCard title={`Fixes (${data.fixes.length})`}>
              {data.fixes.map((f, i) => (
                <div key={i} className="qa-panel" style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: EFFORT_COLOR[f.effort] + "20", color: EFFORT_COLOR[f.effort], fontWeight: 700, textTransform: "uppercase" }}>{f.effort}</span>
                    <code style={{ fontSize: 11, color: "var(--accent)" }}>{f.signal}</code>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>{f.recommendation}</div>
                </div>
              ))}
            </SectionCard>
          )}

          {data.fixes.length === 0 && data.fixesError && (
            <SectionCard title="Fixes skipped">
              <EmptyState title="LLM unavailable" hint={data.fixesError} />
            </SectionCard>
          )}
        </>
      )}
    </PageShell>
  );
}
