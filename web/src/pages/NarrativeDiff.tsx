import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchNarrativeDiff, type NarrativeDiffResponse, type NarrativeSiteDelta, type NarrativeSectionDelta } from "../api";

export default function NarrativeDiff() {
  const [params, setParams] = useSearchParams();
  const [a, setA] = useState(params.get("a") ?? "");
  const [b, setB] = useState(params.get("b") ?? "");
  const [data, setData] = useState<NarrativeDiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!a.trim() || !b.trim()) { setError("both run IDs are required"); return; }
    setLoading(true); setError(""); setData(null);
    try {
      setData(await fetchNarrativeDiff(a.trim(), b.trim()));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params.get("a") && params.get("b")) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalSections = data?.sites.reduce((acc, s) => acc + s.sections.length, 0) ?? 0;
  const totalNewlyBroken = data?.sites.reduce((acc, s) => acc + s.newlyBrokenUrls.length, 0) ?? 0;
  const totalFixed = data?.sites.reduce((acc, s) => acc + s.fixedBrokenUrls.length, 0) ?? 0;

  return (
    <PageShell
      title="Narrative Diff"
      desc="Plain-English narration of what changed between two runs — section-level deltas, broken-link diffs, and a council synthesis grounded in the numbers."
      purpose="Between these two runs of mine, what actually moved and why does it matter?"
      sources={["run-meta.json (both runs)", "per-site report.json", "Council narration"]}
    >
      <PageHero
        icon="trending-up"
        eyebrow="Narrative Diff"
        title={data ? `${data.runIdA} → ${data.runIdB}` : "Compare two runs"}
        subtitle={data ? `${data.sites.length} sites compared · ${totalSections} section deltas surfaced` : "Pick two run IDs to render structural deltas + a 4-advisor narration."}
        accent
      />

      <SectionCard title="Pick runs">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Run A (older)</div>
            <input className="qa-input" value={a} onChange={(e) => setA(e.target.value)} placeholder="e.g. 2026-04-25T01-15-…" style={{ width: "100%" }} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Run B (newer)</div>
            <input className="qa-input" value={b} onChange={(e) => setB(e.target.value)} placeholder="e.g. 2026-04-28T05-…" style={{ width: "100%" }} />
          </label>
          <button onClick={() => { setParams({ a, b }); void run(); }} disabled={loading} className="qa-btn-primary" style={{ padding: "10px 20px", fontWeight: 700 }}>
            {loading ? "Comparing…" : "Compare"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      </SectionCard>

      {loading && <LoadingPanel message="Reading both run trees and synthesizing…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="Sites compared" value={data.sites.length} tone="accent" caption={`${data.sitesOnlyInA.length} only in A · ${data.sitesOnlyInB.length} only in B`} />
            <MetricCard label="Section deltas" value={totalSections} caption="largest pages-delta first" />
            <MetricCard label="Newly broken" value={totalNewlyBroken} tone={totalNewlyBroken > 0 ? "bad" : "ok"} caption="regressions in B" />
            <MetricCard label="Fixed" value={totalFixed} tone={totalFixed > 0 ? "ok" : "default"} caption="resolved since A" />
          </div>

          {data.council && (
            <SectionCard title="Council narration">
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text)", marginBottom: 12 }}>
                {data.council.synthesis}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{data.council.model} · {data.council.durationMs}ms · {data.council.reviewedItemIds.length} items</div>
            </SectionCard>
          )}

          {!data.council && data.councilError && (
            <SectionCard title="Synthesis skipped">
              <EmptyState title="LLM unavailable" hint={data.councilError} />
            </SectionCard>
          )}

          {data.sites.length === 0 && (
            <SectionCard title="No common sites">
              <EmptyState title="No sites in both runs" hint="The two runs share zero hostnames, so there's nothing to diff." />
            </SectionCard>
          )}

          {data.sites.map((s) => (
            <SiteDeltaCard key={s.hostname} site={s} verdicts={data.council?.verdicts} />
          ))}
        </>
      )}
    </PageShell>
  );
}

function SiteDeltaCard({ site, verdicts }: { site: NarrativeSiteDelta; verdicts?: Record<string, Record<string, string>> }) {
  return (
    <SectionCard title={site.hostname}>
      <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" }}>
        <span><strong style={{ color: "var(--text)" }}>{site.pagesA}</strong> → <strong style={{ color: "var(--text)" }}>{site.pagesB}</strong> pages</span>
        <span><strong style={{ color: "var(--text)" }}>{site.brokenLinksA}</strong> → <strong style={{ color: "var(--text)" }}>{site.brokenLinksB}</strong> broken links</span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {site.sections.map((sec) => (
          <SectionRow key={sec.section} site={site.hostname} sec={sec} verdicts={verdicts} />
        ))}
      </div>
      {site.newlyBrokenUrls.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--bad)" }}>
            ↘ {site.newlyBrokenUrls.length} newly broken URL{site.newlyBrokenUrls.length === 1 ? "" : "s"}
          </summary>
          <ul style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-secondary)", paddingLeft: 20 }}>
            {site.newlyBrokenUrls.map((u) => <li key={u} style={{ wordBreak: "break-all" }}><code>{u}</code></li>)}
          </ul>
        </details>
      )}
      {site.fixedBrokenUrls.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ok)" }}>
            ↗ {site.fixedBrokenUrls.length} fixed since A
          </summary>
          <ul style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-secondary)", paddingLeft: 20 }}>
            {site.fixedBrokenUrls.map((u) => <li key={u} style={{ wordBreak: "break-all" }}><code>{u}</code></li>)}
          </ul>
        </details>
      )}
    </SectionCard>
  );
}

function SectionRow({ site, sec, verdicts }: { site: string; sec: NarrativeSectionDelta; verdicts?: Record<string, Record<string, string>> }) {
  const id = `${site}::${sec.section}`;
  const v = verdicts?.[id];
  const tone = sec.pagesDelta > 0 ? "ok" : sec.pagesDelta < 0 ? "bad" : "default";
  const toneColor = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--muted)";
  return (
    <div className="qa-panel" style={{ padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <code style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent)" }}>{sec.section}</code>
        <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
          {sec.pagesA} → {sec.pagesB} pages
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: toneColor }}>
          {sec.pagesDelta > 0 ? "+" : ""}{sec.pagesDelta}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
          broken {sec.brokenLinksA} → {sec.brokenLinksB}
        </span>
        {sec.durationMsA != null && sec.durationMsB != null && (
          <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
            {sec.durationMsA}ms → {sec.durationMsB}ms
          </span>
        )}
      </div>
      {v && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {Object.entries(v).map(([advId, verdict]) => (
            <span key={advId} title={verdict} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", border: "1px solid var(--accent-muted)", fontWeight: 600 }}>
              {advId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
