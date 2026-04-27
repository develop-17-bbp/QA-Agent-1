import { useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchVoiceOfSerp, type VoiceOfSerpResponse } from "../api";

export default function VoiceOfSerp() {
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("us-en");
  const [topN, setTopN] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<VoiceOfSerpResponse | null>(null);

  const run = async () => {
    const k = keyword.trim();
    if (!k) { setError("enter a keyword"); return; }
    setLoading(true); setError(""); setData(null);
    try {
      setData(await fetchVoiceOfSerp(k, { region, topN }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell
      title="Voice of SERP"
      desc="The dominant content recipe Google is currently rewarding for a query — extracted by reading the actual top-10 result pages, not just their titles."
      purpose="What is the SERP rewarding right now for this keyword? What's the format, depth, tone — and what's missing that I could fill?"
      sources={["DuckDuckGo SERP", "On-page text extraction (Cheerio)", "Ollama council"]}
    >
      <PageHero
        icon="sparkles"
        eyebrow="Voice-of-SERP"
        title={data ? `"${data.keyword}"` : "Pick a keyword"}
        subtitle={data ? `${data.aggregate.successfulFetches}/${data.pages.length} top-${data.pages.length} pages fetched · region ${data.region}` : "We'll fetch the top-10 organic results, read the page text, and synthesize the recipe Google is rewarding."}
        accent
      />

      <SectionCard title="Run">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 260 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Keyword</div>
            <input
              className="qa-input"
              placeholder="e.g. best seo tools 2026"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ width: 140 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Region</div>
            <input className="qa-input" value={region} onChange={(e) => setRegion(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label style={{ width: 100 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Top N</div>
            <input className="qa-input" type="number" min={3} max={10} value={topN} onChange={(e) => setTopN(Number(e.target.value) || 10)} style={{ width: "100%" }} />
          </label>
          <button onClick={run} disabled={loading} className="qa-btn-primary" style={{ padding: "10px 20px", fontWeight: 700 }}>
            {loading ? "Listening…" : "Listen to SERP"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      </SectionCard>

      {loading && <LoadingPanel message="Fetching top-10 pages and synthesizing…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="Avg word count" value={data.aggregate.avgWordCount} format="compact" tone="accent" caption={`median ${data.aggregate.medianWordCount}`} />
            <MetricCard label="List layout" value={`${data.aggregate.listLayoutPct}%`} caption="of top-10 use h2 lists" />
            <MetricCard label="Comparison tables" value={`${data.aggregate.comparisonTablePct}%`} caption="multi-row, multi-column" />
            <MetricCard label="FAQ schema" value={`${data.aggregate.faqPct}%`} caption="JSON-LD or details/summary" />
          </div>

          {data.voice && (
            <SectionCard title="Why these win">
              <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, marginBottom: 12 }}>
                {data.voice.whyTheyWin}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                <Bucket title="Dominant topics" items={data.voice.dominantTopics} />
                <Bucket title="Depth signals" items={data.voice.depthSignals} />
                <Bucket title="Coverage gaps (your opportunity)" items={data.voice.coverageGaps} accent />
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Tag label="Format" value={data.voice.formatProfile} />
                <Tag label="Tone" value={data.voice.tone} />
                <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: "auto" }}>
                  {data.voice.model} · {data.voice.durationMs}ms
                </span>
              </div>
            </SectionCard>
          )}

          {!data.voice && data.voiceError && (
            <SectionCard title="Synthesis skipped">
              <EmptyState title="LLM synthesis unavailable" hint={data.voiceError} />
            </SectionCard>
          )}

          <SectionCard title={`Top-${data.pages.length} results`}>
            {data.pages.map((p) => (
              <div
                key={p.url}
                className="qa-panel"
                style={{
                  padding: 12,
                  marginBottom: 8,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 800, minWidth: 32, color: "var(--accent)" }}>#{p.rank}</div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>
                      {p.title}
                    </a>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.domain}</div>
                  {p.fetchOk ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      <SignalChip label={`${p.wordCount.toLocaleString()} words`} />
                      {p.signals.hasH2List && <SignalChip label="h2 list" />}
                      {p.signals.hasComparisonTable && <SignalChip label="compare table" />}
                      {p.signals.hasFaqStructured && <SignalChip label="faq schema" />}
                      <SignalChip label={`${p.signals.paragraphCount} paragraphs`} muted />
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--bad)" }}>
                      fetch failed: {p.fetchError ?? "unknown"}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </SectionCard>
        </>
      )}
    </PageShell>
  );
}

function Bucket({ title, items, accent }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div className="qa-panel" style={{ padding: 12, borderTop: accent ? "3px solid var(--accent)" : undefined }}>
      <div className="qa-kicker" style={{ marginBottom: 6 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>—</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: "var(--text)", lineHeight: 1.55 }}>
          {items.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 12, background: "var(--accent-light)", color: "var(--accent-hover)", fontWeight: 600, border: "1px solid var(--accent-muted)" }}>
      <strong style={{ marginRight: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, fontSize: 9.5 }}>{label}</strong>
      {value}
    </span>
  );
}

function SignalChip({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span style={{
      fontSize: 10.5, padding: "2px 8px", borderRadius: 10,
      background: muted ? "#f1f5f9" : "var(--accent-light)",
      color: muted ? "#64748b" : "var(--accent-hover)",
      fontWeight: 600,
      border: "1px solid " + (muted ? "var(--border)" : "var(--accent-muted)"),
    }}>
      {label}
    </span>
  );
}
