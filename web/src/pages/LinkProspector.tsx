import { useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchLinkProspects, type LinkProspectorResponse, type LinkProspect } from "../api";

export default function LinkProspector() {
  const [target, setTarget] = useState("");
  const [topic, setTopic] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [region, setRegion] = useState("us-en");
  const [data, setData] = useState<LinkProspectorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [contacted, setContacted] = useState<Record<string, boolean>>({});

  const run = async () => {
    if (!target.trim() || !topic.trim()) { setError("targetDomain + topicQuery required"); return; }
    setLoading(true); setError(""); setData(null);
    try {
      const competitorDomains = competitors.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      setData(await fetchLinkProspects({ targetDomain: target.trim(), topicQuery: topic.trim(), competitorDomains, region }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const copyEmail = (p: LinkProspect) => {
    if (!p.email) return;
    const text = `Subject: ${p.email.subject}\n\n${p.email.body}\n\n${p.email.cta}`;
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text);
  };

  const drafted = data?.prospects.filter((p) => p.email).length ?? 0;
  const fetched = data?.prospects.filter((p) => p.fetchOk).length ?? 0;

  return (
    <PageShell
      title="Zero-Budget Link Prospector"
      desc="Identifies link opportunities AND drafts personalized outreach copy — fully on-device. No DataForSEO spend, no email-discovery API. The prospects are sites already ranking for your topic; the email body is grounded in the prospect's own content."
      purpose="Who should I reach out to about my new page on this topic, and what should I actually say to them?"
      sources={["DuckDuckGo SERP", "On-page article extraction", "Local council outreach drafting"]}
    >
      <PageHero
        icon="link"
        eyebrow="Link Prospector"
        title={data ? `"${data.topicQuery}"` : "Find prospects"}
        subtitle={data ? `${data.prospects.length} prospects · ${drafted} email drafts ready · privacy: ${data.privacyMode}` : "Pick a target domain + topic. We'll surface SERP-ranked prospects and draft tone-matched outreach for each."}
        accent
      />

      <SectionCard title="Run">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Your domain</div>
            <input className="qa-input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="example.com" style={{ width: "100%" }} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Topic / angle</div>
            <input className="qa-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. on-page seo audit" style={{ width: "100%" }} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Competitors (excluded)</div>
            <input className="qa-input" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="comma-separated, optional" style={{ width: "100%" }} />
          </label>
          <label style={{ width: 120 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Region</div>
            <input className="qa-input" value={region} onChange={(e) => setRegion(e.target.value)} style={{ width: "100%" }} />
          </label>
          <button onClick={run} disabled={loading} className="qa-btn-primary" style={{ padding: "10px 20px", fontWeight: 700 }}>
            {loading ? "Hunting…" : "Find prospects"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
        <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "4px 10px", borderRadius: 999, background: "var(--grad-agentic-soft)", border: "1px solid var(--accent-muted)", color: "var(--accent-hover)", fontWeight: 700 }}>
          🔒 Local-only — your domain + topic + extracted prospect text never leave this machine
        </div>
      </SectionCard>

      {loading && <LoadingPanel message="Reading SERP, fetching prospects, drafting outreach…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="Prospects" value={data.prospects.length} tone="accent" caption={`top-${data.prospects.length} from SERP`} />
            <MetricCard label="Fetched" value={fetched} caption={`${fetched}/${data.prospects.length} extractable`} />
            <MetricCard label="Drafts ready" value={drafted} tone={drafted > 0 ? "ok" : "default"} caption="ready to copy" />
            <MetricCard label="Excluded" value={data.excluded.length} caption="target + competitors" />
          </div>

          {data.draftingError && data.prospects.every((p) => !p.email) && (
            <SectionCard title="Drafting skipped">
              <EmptyState title="LLM unavailable" hint={data.draftingError} />
            </SectionCard>
          )}

          {data.prospects.length === 0 ? (
            <SectionCard title="No prospects">
              <EmptyState title="SERP returned nothing usable" hint="Try a more specific topic, or remove some competitors from the exclusion list." />
            </SectionCard>
          ) : (
            <SectionCard title={`Prospects (${data.prospects.length})`}>
              {data.prospects.map((p) => (
                <ProspectCard key={p.url} p={p} contacted={!!contacted[p.url]} onContacted={(v) => setContacted((s) => ({ ...s, [p.url]: v }))} onCopy={() => copyEmail(p)} />
              ))}
            </SectionCard>
          )}
        </>
      )}
    </PageShell>
  );
}

function ProspectCard({ p, contacted, onContacted, onCopy }: { p: LinkProspect; contacted: boolean; onContacted: (v: boolean) => void; onCopy: () => void }) {
  return (
    <div className="qa-panel" style={{ padding: 12, marginBottom: 10, opacity: contacted ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 800, minWidth: 32, color: "var(--accent)" }}>#{p.rank}</div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>
              {p.title}
            </a>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>{p.domain}</span>
            {p.tone && (
              <span style={{ padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", fontWeight: 700, border: "1px solid var(--accent-muted)" }}>
                tone: {p.tone}
              </span>
            )}
            {!p.fetchOk && (
              <span style={{ color: "var(--bad)" }}>fetch failed: {p.fetchError ?? "unknown"}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {p.email && (
            <button onClick={onCopy} className="qa-btn-default" style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 700 }}>Copy email</button>
          )}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted)" }}>
            <input type="checkbox" checked={contacted} onChange={(e) => onContacted(e.target.checked)} />
            contacted
          </label>
        </div>
      </div>
      {p.email ? (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--glass2)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Subject: {p.email.subject}</div>
          <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{p.email.body}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", marginTop: 6 }}>{p.email.cta}</div>
        </div>
      ) : p.emailError ? (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>email: {p.emailError}</div>
      ) : null}
    </div>
  );
}
