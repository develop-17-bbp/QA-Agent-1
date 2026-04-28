import { useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchDisavow, fetchSchemaPreview, fetchSnippetOwnership, type DisavowResponse, type SchemaPreviewResponse, type SnippetOwnershipResponse } from "../api";

type Tab = "disavow" | "schema" | "snippets";

export default function SeoToolsBundle() {
  const [tab, setTab] = useState<Tab>("disavow");

  return (
    <PageShell
      title="SEO Tools"
      desc="Three small but high-impact tools: toxic-link disavow generator, schema rich-result preview, featured-snippet ownership tracker."
      purpose="Three things every SEO team needs to do but doesn't want a separate paid tool for."
      sources={["DataForSEO live backlinks (BYOK)", "DataForSEO live SERP (BYOK)", "Live page fetch (Cheerio)"]}
    >
      <PageHero
        icon="settings"
        eyebrow="SEO Tools"
        title="Three small tools, one page"
        subtitle="Disavow toxic links · preview schema rich results · track featured-snippet ownership."
        accent
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 14, borderBottom: "1px solid var(--border)" }}>
        {(["disavow", "schema", "snippets"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 16px", border: "none", background: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 600,
              color: tab === t ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t === "disavow" && "🛡 Disavow Generator"}
            {t === "schema" && "💎 Schema Preview"}
            {t === "snippets" && "⭐ Snippet Ownership"}
          </button>
        ))}
      </div>

      {tab === "disavow" && <DisavowTab />}
      {tab === "schema" && <SchemaTab />}
      {tab === "snippets" && <SnippetsTab />}
    </PageShell>
  );
}

// ── Disavow ─────────────────────────────────────────────────────────────

function DisavowTab() {
  const [domain, setDomain] = useState("");
  const [threshold, setThreshold] = useState(50);
  const [useDfs, setUseDfs] = useState(false);
  const [data, setData] = useState<DisavowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!domain.trim()) { setError("domain required"); return; }
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchDisavow(domain.trim(), { threshold, useDfs })); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  };

  return (
    <SectionCard title="Toxic-link disavow generator">
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
        Pulls backlink data from <strong>free sources by default</strong> (AHREFS Webmaster Tools CSV imports + Bing Webmaster API), flags toxic patterns, and generates a Google-format <code>disavow.txt</code>. Review carefully — disavow is irreversible.
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, padding: "3px 10px", borderRadius: 999, background: useDfs ? "#fef3c7" : "#dcfce7", color: useDfs ? "#92400e" : "#166534", border: "1px solid " + (useDfs ? "#fde68a" : "#86efac"), fontWeight: 700, margin: "4px 0 10px" }}>
        {useDfs ? "🌍 PAID — DataForSEO BYOK" : "✅ FREE — AHREFS CSV + Bing WMT"}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="your-domain.com" style={{ flex: 1, minWidth: 240, padding: "8px 12px" }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          Threshold:
          <input type="number" min={20} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 50)} className="qa-input" style={{ width: 70, padding: "6px 8px" }} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={useDfs} onChange={(e) => setUseDfs(e.target.checked)} /> Use DFS (paid, richer DR signal)
        </label>
        <button onClick={run} disabled={loading || !domain.trim()} className="qa-btn-primary" style={{ padding: "8px 18px" }}>
          {loading ? "Scanning…" : "Generate disavow"}
        </button>
      </div>
      {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      {loading && <LoadingPanel message="Pulling live backlinks, scoring toxicity…" />}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
            <MetricCard label="Links scanned" value={data.totalLinksScanned} />
            <MetricCard label="Toxic domains" value={data.toxicLinks.length} tone={data.toxicLinks.length > 0 ? "bad" : "ok"} caption={`threshold ${threshold}+`} />
            <MetricCard label="Highest score" value={data.toxicLinks[0]?.toxicityScore ?? 0} caption={data.toxicLinks[0]?.domain ?? "—"} />
          </div>
          {data.toxicLinks.length === 0 ? (
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #86efac", fontSize: 12.5 }}>
              No toxic patterns detected at threshold {threshold}. Lower the threshold to surface borderline cases.
            </div>
          ) : (
            <>
              <table style={{ width: "100%", fontSize: 12, marginTop: 14, borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><th style={{ textAlign: "left", padding: "6px 8px" }}>Domain</th><th style={{ textAlign: "right", padding: "6px 8px" }}>Score</th><th style={{ textAlign: "right", padding: "6px 8px" }}>Links</th><th style={{ textAlign: "right", padding: "6px 8px" }}>DR</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Reasons</th></tr></thead>
                <tbody>
                  {data.toxicLinks.map((t) => (
                    <tr key={t.domain} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>{t.domain}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#dc2626" }}>{t.toxicityScore}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{t.linksFromThisDomain}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--muted)" }}>{t.domainRank ?? "—"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 11, color: "var(--muted)" }}>{t.reasons.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>disavow.txt — paste into Google Search Console</strong>
                  <button className="qa-btn-default" onClick={() => navigator.clipboard?.writeText(data.disavowFileContent)} style={{ padding: "4px 10px", fontSize: 11.5 }}>Copy</button>
                </div>
                <pre style={{ background: "var(--glass2)", padding: 12, borderRadius: 6, fontSize: 11.5, fontFamily: "ui-monospace, monospace", overflow: "auto", maxHeight: 360 }}>{data.disavowFileContent}</pre>
              </div>
            </>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── Schema Preview ──────────────────────────────────────────────────────

function SchemaTab() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<SchemaPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!url.trim()) { setError("URL required"); return; }
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchSchemaPreview(url.trim())); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  };

  return (
    <SectionCard title="Schema rich-result preview">
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        Fetches the page, parses every JSON-LD block, and tells you exactly which Google rich result would render — and which required fields are missing.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/your-page" style={{ flex: 1, minWidth: 320, padding: "8px 12px" }} />
        <button onClick={run} disabled={loading || !url.trim()} className="qa-btn-primary" style={{ padding: "8px 18px" }}>
          {loading ? "Fetching…" : "Preview schema"}
        </button>
      </div>
      {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      {loading && <LoadingPanel message="Fetching page and parsing JSON-LD…" />}
      {data && (
        <>
          <div style={{ display: "flex", gap: 14, fontSize: 13, marginTop: 14, flexWrap: "wrap" }}>
            <span><strong>{data.blocksFound}</strong> JSON-LD block{data.blocksFound === 1 ? "" : "s"}</span>
            <span><strong>{data.items.length}</strong> schema item{data.items.length === 1 ? "" : "s"}</span>
            <span><strong style={{ color: "#16a34a" }}>{data.items.filter((i) => i.isValid).length}</strong> valid</span>
            <span><strong style={{ color: "#dc2626" }}>{data.items.filter((i) => !i.isValid).length}</strong> incomplete</span>
          </div>
          {data.items.length === 0 ? (
            <EmptyState title="No schema found" hint="Page has no JSON-LD blocks. Add structured data for rich results in SERP." />
          ) : (
            <div style={{ marginTop: 14 }}>
              {data.items.map((item, i) => (
                <div key={i} className="qa-panel" style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: item.isValid ? "#dcfce7" : "#fef2f2", color: item.isValid ? "#166534" : "#991b1b", fontWeight: 700, textTransform: "uppercase" }}>{item.isValid ? "✓ valid" : "✕ incomplete"}</span>
                    <strong style={{ fontSize: 13 }}>{item.schemaType}</strong>
                    {item.richResult !== "none" && <code style={{ fontSize: 11, color: "var(--accent)" }}>{item.richResult}</code>}
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 6, color: "var(--text-secondary)" }}>{item.preview}</div>
                  {item.missingRequired.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: "#dc2626" }}>
                      Missing: {item.missingRequired.map((m) => <code key={m} style={{ marginRight: 6, padding: "1px 6px", background: "#fef2f2", borderRadius: 4 }}>{m}</code>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── Snippet Ownership ──────────────────────────────────────────────────

function SnippetsTab() {
  const [domain, setDomain] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [region, setRegion] = useState("United States");
  const [useDfs, setUseDfs] = useState(false);
  const [data, setData] = useState<SnippetOwnershipResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    const keywords = keywordsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!domain.trim() || keywords.length === 0) { setError("domain + at least one keyword required"); return; }
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchSnippetOwnership({ operatorDomain: domain.trim(), keywords, region, device, useDfs })); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  };

  return (
    <SectionCard title="Featured snippet ownership tracker">
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
        For each keyword, queries Google SERP and reports whether the operator owns the position-zero snippet. Steal opportunities = you're top-5 organically but a competitor owns the snippet.
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, padding: "3px 10px", borderRadius: 999, background: useDfs ? "#fef3c7" : "#dcfce7", color: useDfs ? "#92400e" : "#166534", border: "1px solid " + (useDfs ? "#fde68a" : "#86efac"), fontWeight: 700, margin: "4px 0 10px" }}>
        {useDfs ? "🌍 PAID — DataForSEO live SERP" : "✅ FREE — Playwright scrape of google.com"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <input className="qa-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="your-domain.com" style={{ padding: "8px 12px" }} />
        <input className="qa-input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="United States" style={{ padding: "8px 12px" }} />
      </div>
      <textarea className="qa-input" value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} rows={5} placeholder={"how to write a blog post\nbest seo tools 2026\nplastic surgeon seattle"} style={{ width: "100%", fontFamily: "inherit", padding: "8px 12px" }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <select value={device} onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")} className="qa-input" style={{ width: 140 }}>
          <option value="desktop">Desktop</option>
          <option value="mobile">Mobile</option>
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={useDfs} onChange={(e) => setUseDfs(e.target.checked)} /> Use DFS (paid, faster at scale)
        </label>
        <button onClick={run} disabled={loading || !domain.trim()} className="qa-btn-primary" style={{ padding: "8px 18px" }}>
          {loading ? "Scanning…" : "Check snippet ownership"}
        </button>
      </div>
      {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      {loading && <LoadingPanel message="Querying live SERP for each keyword…" />}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
            <MetricCard label="You own" value={data.summary.operatorOwned} tone="ok" caption="position zero secured" />
            <MetricCard label="Competitor owns" value={data.summary.competitorOwned} tone={data.summary.competitorOwned > 0 ? "warn" : "ok"} />
            <MetricCard label="No snippet" value={data.summary.totalKeywords - data.summary.snippetsAvailable} caption="not eligible / not shown" />
            <MetricCard label="Steal targets" value={data.summary.stealOpportunities} tone={data.summary.stealOpportunities > 0 ? "accent" : "default"} caption="top-5 + comp owns snippet" />
          </div>
          <table style={{ width: "100%", fontSize: 12, marginTop: 14, borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><th style={{ textAlign: "left", padding: "6px 8px" }}>Keyword</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Snippet?</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Owner</th><th style={{ textAlign: "right", padding: "6px 8px" }}>Your pos</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Status</th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const isSteal = r.hasSnippet && !r.operatorOwns && r.operatorPosition > 0 && r.operatorPosition <= 5;
                return (
                  <tr key={r.keyword} style={{ borderBottom: "1px solid var(--border)", background: isSteal ? "rgba(37,99,235,0.05)" : undefined }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>"{r.keyword}"</td>
                    <td style={{ padding: "6px 8px" }}>{r.hasSnippet ? "yes" : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ padding: "6px 8px", color: r.operatorOwns ? "#16a34a" : "var(--text-secondary)", fontWeight: r.operatorOwns ? 700 : 500 }}>{r.ownerDomain ?? "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.operatorPosition > 0 ? `#${r.operatorPosition}` : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {r.operatorOwns ? <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>✓ YOU OWN</span> :
                       isSteal ? <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#dbeafe", color: "#1e3a8a", fontWeight: 700 }}>STEAL TARGET</span> :
                       r.hasSnippet ? <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontWeight: 700 }}>COMP OWNS</span> :
                       <span style={{ fontSize: 10, color: "var(--muted)" }}>no snippet</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </SectionCard>
  );
}
