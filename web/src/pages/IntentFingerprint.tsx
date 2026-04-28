import { useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { fetchIntentShifts, snapshotIntentFingerprintsNow, type IntentShiftsResponse, type IntentShift } from "../api";

export default function IntentFingerprint() {
  const [domain, setDomain] = useState("");
  const [region, setRegion] = useState("us-en");
  const [data, setData] = useState<IntentShiftsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");
  const [seedSummary, setSeedSummary] = useState<string | null>(null);

  const detect = async () => {
    if (!domain.trim()) { setError("enter a domain"); return; }
    setLoading(true); setError(""); setData(null); setSeedSummary(null);
    try {
      setData(await fetchIntentShifts(domain.trim()));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const seed = async () => {
    if (!domain.trim()) { setError("enter a domain"); return; }
    setSeeding(true); setError(""); setSeedSummary(null);
    try {
      const r = await snapshotIntentFingerprintsNow(domain.trim(), region);
      const ok = r.fingerprints.filter((x) => !x.error).length;
      setSeedSummary(`Captured ${ok}/${r.fingerprints.length} fingerprints. Run detection again after the next snapshot to see shifts.`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <PageShell
      title="Competitive Intent Fingerprint"
      desc="Detects when the SERP intent for your tracked keywords shifts — usually 1-2 weeks before rankings actually move. SEMrush shows the rank delta. This shows the why-it's-coming."
      purpose="Which of my tracked keywords just had their SERP intent pivot, and what does the council think a competitor is doing about it?"
      sources={["DuckDuckGo SERP fingerprint", "Position-DB history", "Council narration"]}
    >
      <PageHero
        icon="target"
        eyebrow="Intent Fingerprint"
        title={data ? data.domain : "Pick a tracked domain"}
        subtitle={data ? `${data.shifts.length} shifts in last ${data.windowDays} days · ${data.pairsWithFingerprintHistory}/${data.pairsChecked} pairs have fingerprint history` : "Detect SERP-intent shifts on tracked keywords. New domains need a 'Capture now' to seed history."}
        accent
      />

      <SectionCard title="Detect shifts">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 240 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Domain</div>
            <input className="qa-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" style={{ width: "100%" }} />
          </label>
          <label style={{ width: 140 }}>
            <div className="qa-kicker" style={{ marginBottom: 4 }}>Region</div>
            <input className="qa-input" value={region} onChange={(e) => setRegion(e.target.value)} style={{ width: "100%" }} />
          </label>
          <button onClick={detect} disabled={loading} className="qa-btn-primary" style={{ padding: "10px 20px", fontWeight: 700 }}>
            {loading ? "Detecting…" : "Detect shifts"}
          </button>
          <button onClick={seed} disabled={seeding} className="qa-btn-default" style={{ padding: "10px 16px", fontWeight: 600 }}>
            {seeding ? "Capturing…" : "Capture now"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
        {seedSummary && (
          <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #86efac", fontSize: 12.5 }}>
            {seedSummary}
          </div>
        )}
      </SectionCard>

      {loading && <LoadingPanel message="Walking position-history snapshots…" />}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
            <MetricCard label="Shifts found" value={data.shifts.length} tone={data.shifts.length > 0 ? "warn" : "ok"} caption={`min distance 2 · ${data.windowDays}-day window`} />
            <MetricCard label="Pairs tracked" value={data.pairsChecked} caption="on this domain" />
            <MetricCard label="With fingerprint" value={data.pairsWithFingerprintHistory} caption={data.pairsWithFingerprintHistory < data.pairsChecked ? "use 'Capture now' to seed" : "full coverage"} />
            <MetricCard label="Council" value={data.council ? "live" : "skipped"} tone={data.council ? "ok" : "default"} caption={data.council ? `${data.council.model}` : data.councilError ?? "n/a"} />
          </div>

          {data.council && (
            <SectionCard title="Council narration">
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text)", marginBottom: 8 }}>
                {data.council.synthesis}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{data.council.model} · {data.council.durationMs}ms</div>
            </SectionCard>
          )}

          {data.shifts.length === 0 ? (
            <SectionCard title="No shifts">
              <EmptyState
                title="Nothing has shifted yet"
                hint={data.councilError ?? "Either fingerprint history is too thin, or every tracked keyword's SERP layout is steady. Click 'Capture now' to start the history; come back after the next daily snapshot."}
              />
            </SectionCard>
          ) : (
            <SectionCard title={`Detected shifts (${data.shifts.length})`}>
              {data.shifts.map((s, i) => <ShiftCard key={`${s.keyword}-${s.toAt}-${i}`} s={s} verdicts={data.council?.verdicts} />)}
            </SectionCard>
          )}
        </>
      )}
    </PageShell>
  );
}

function ShiftCard({ s, verdicts }: { s: IntentShift; verdicts?: Record<string, Record<string, string>> }) {
  const id = `${s.domain}::${s.keyword}`;
  const v = verdicts?.[id];
  return (
    <div className="qa-panel" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>"{s.keyword}"</strong>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{s.domain}</span>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--warn-bg)", color: "var(--warn)", border: "1px solid var(--warn-border)", fontWeight: 700 }}>
          distance {s.distance}
        </span>
        <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: "auto" }}>
          {s.fromAt} → {s.toAt}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap", fontSize: 11 }}>
        <code style={{ background: "var(--glass2)", padding: "3px 8px", borderRadius: 6 }}>{s.fromSignature}</code>
        <span style={{ color: "var(--muted)" }}>→</span>
        <code style={{ background: "var(--accent-light)", color: "var(--accent-hover)", padding: "3px 8px", borderRadius: 6, fontWeight: 700 }}>{s.toSignature}</code>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11, color: "var(--text-secondary)", flexWrap: "wrap" }}>
        {s.added.length > 0 && <span><strong style={{ color: "var(--ok)" }}>+ added:</strong> {s.added.join(", ")}</span>}
        {s.removed.length > 0 && <span><strong style={{ color: "var(--bad)" }}>− removed:</strong> {s.removed.join(", ")}</span>}
      </div>
      {v && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {Object.entries(v).map(([advId, verdict]) => (
            <details key={advId} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", border: "1px solid var(--accent-muted)" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>{advId}</summary>
              <div style={{ fontSize: 11.5, marginTop: 4, color: "var(--text-secondary)", maxWidth: 360 }}>{verdict}</div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
