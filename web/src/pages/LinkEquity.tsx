import { useState } from "react";
import { PageShell, SectionCard } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import RunSelector from "../components/RunSelector";
import { fetchLinkEquity, type LinkEquityResponse, type LinkEquityNode } from "../api";

export default function LinkEquity() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<LinkEquityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!runId) { setError("pick a run"); return; }
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchLinkEquity(runId)); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  };

  return (
    <PageShell
      title="Internal Link Equity"
      desc="PageRank-style propagation across your internal link graph. Identifies your highest-authority pages, orphans Google can barely find, leaky pages giving away equity, and hoarders that should redistribute."
      purpose="Where is internal link equity flowing on my site, and which pages are wasting it?"
      sources={["Re-fetched HTML for up to 200 crawled pages", "Cheerio anchor extraction", "PageRank (damping 0.85, 20 iterations)"]}
    >
      <PageHero
        icon="link"
        eyebrow="Internal Link Equity"
        title={data ? data.hostname : "Pick a crawl run"}
        subtitle={data ? `${data.pagesAnalyzed}/${data.pagesAnalyzed + data.pagesSkipped} pages re-fetched · ${data.totalEdges.toLocaleString()} internal links` : "Re-fetches each crawled page, builds the internal link graph, runs PageRank, and surfaces 4 actionable categories."}
        accent
      />

      <SectionCard title="Run">
        <RunSelector value={runId} onChange={setRunId} label="Crawl run" />
        <div style={{ marginTop: 12 }}>
          <button onClick={run} disabled={loading || !runId} className="qa-btn-primary" style={{ padding: "10px 22px", fontWeight: 700 }}>
            {loading ? "Computing PageRank…" : "Analyze link equity"}
          </button>
          <span style={{ marginLeft: 12, fontSize: 11, color: "var(--muted)" }}>
            ~30s for 200 pages (re-fetches each at concurrency 6).
          </span>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      </SectionCard>

      {loading && <LoadingPanel message="Re-fetching pages, parsing links, running PageRank…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="Pages analyzed" value={data.pagesAnalyzed} tone="accent" caption={data.pagesSkipped > 0 ? `${data.pagesSkipped} skipped` : "all fetched"} />
            <MetricCard label="Internal links" value={data.totalEdges.toLocaleString()} caption={`${(data.totalEdges / Math.max(1, data.pagesAnalyzed)).toFixed(1)} avg per page`} />
            <MetricCard label="Orphans" value={data.orphans.length} tone={data.orphans.length > 0 ? "bad" : "ok"} caption="0 inbound — Google barely sees them" />
            <MetricCard label="Top PR concentration" value={`${Math.round((data.topAuthority.reduce((s, n) => s + n.pageRank, 0) * 100))}%`} caption="of equity in top 10 pages" />
          </div>

          <NodeList title="🏆 Top authority (highest PageRank)" nodes={data.topAuthority} mode="authority" />
          {data.leaky.length > 0 && <NodeList title="💧 Leaky pages — gifting equity (high outbound × low inbound)" nodes={data.leaky} mode="leaky" />}
          {data.hoarders.length > 0 && <NodeList title="🔒 Hoarders — should redistribute (high inbound × low outbound)" nodes={data.hoarders} mode="hoarder" />}
          {data.orphans.length > 0 && <NodeList title="🪨 Orphans (0 inbound — Google can find them only via sitemap)" nodes={data.orphans} mode="orphan" />}
        </>
      )}
    </PageShell>
  );
}

function NodeList({ title, nodes, mode }: { title: string; nodes: LinkEquityNode[]; mode: "authority" | "leaky" | "hoarder" | "orphan" }) {
  if (nodes.length === 0) return null;
  return (
    <SectionCard title={title}>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>URL</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>PageRank</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Inbound</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Outbound</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Net edge</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.url} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "6px 8px" }}>
                <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", wordBreak: "break-all", fontSize: 11.5 }}>{n.url}</a>
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: mode === "authority" ? "#16a34a" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{(n.pageRank * 1000).toFixed(2)}‰</td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: n.inboundCount === 0 ? "var(--bad)" : n.inboundCount >= 5 ? "var(--ok)" : "var(--text-secondary)" }}>{n.inboundCount}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{n.outboundCount}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: n.netEdge > 0 ? "#16a34a" : n.netEdge < 0 ? "#dc2626" : "var(--muted)" }}>{n.netEdge > 0 ? `+${n.netEdge}` : n.netEdge}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}
