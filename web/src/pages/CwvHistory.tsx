import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";
import { snapshotCwv, fetchCwvHistory, detectCwvRegressions, type CwvSnapshot, type CwvRegressionResponse, type CwvFormFactor } from "../api";

// Google's Core Web Vitals tier boundaries
const TIER_BOUNDARIES: Record<string, { good: number; poor: number }> = {
  lcp: { good: 2500, poor: 4000 },   // ms
  inp: { good: 200, poor: 500 },     // ms
  cls: { good: 0.1, poor: 0.25 },    // unitless
  fcp: { good: 1800, poor: 3000 },   // ms
  ttfb: { good: 800, poor: 1800 },   // ms
};

export default function CwvHistory() {
  const [url, setUrl] = useState("");
  const [formFactor, setFormFactor] = useState<CwvFormFactor>("PHONE");
  const [snapshots, setSnapshots] = useState<CwvSnapshot[]>([]);
  const [regressions, setRegressions] = useState<CwvRegressionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = async () => {
    if (!url.trim()) return;
    setLoading(true); setError("");
    try {
      const r = await fetchCwvHistory(url.trim(), 90);
      setSnapshots(r.snapshots);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const takeSnapshot = async () => {
    if (!url.trim()) return;
    setTaking(true); setError("");
    try {
      await snapshotCwv(url.trim(), formFactor);
      const reg = await detectCwvRegressions(url.trim(), formFactor, false);
      setRegressions(reg);
      void loadHistory();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setTaking(false);
    }
  };

  const chartData = snapshots.map((s) => ({
    date: s.fetchedAt.slice(0, 10),
    LCP: s.lcpP75,
    INP: s.inpP75,
    CLS: s.clsP75 != null ? s.clsP75 * 1000 : null, // CLS scaled for chart display
    FCP: s.fcpP75,
    TTFB: s.ttfbP75,
  }));

  const latest = snapshots[snapshots.length - 1] ?? null;

  return (
    <PageShell
      title="Core Web Vitals History"
      desc="INP / LCP / CLS / FCP / TTFB tracked over 90 days against deploys. INP replaced FID in March 2024 and is now a confirmed Google ranking signal — tracking it across releases is no longer optional."
      purpose="Did our latest deploy regress any Core Web Vital, and by how much vs the 7-day median?"
      sources={["Google CrUX API (real-user field data)", "data/cwv-history/<host>.jsonl"]}
    >
      <PageHero
        icon="trending-up"
        eyebrow="Core Web Vitals"
        title={url ? new URL(url || "https://x").hostname.replace(/^www\./, "") : "Pick a URL"}
        subtitle={latest ? `Latest snapshot ${new Date(latest.fetchedAt).toLocaleDateString()} · ${snapshots.length} historical points` : "Snapshot CrUX field data, append to history, detect regressions vs 7-day median."}
        accent
      />

      <SectionCard title="URL + form factor">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="qa-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/" style={{ flex: 1, minWidth: 280, padding: "8px 12px" }} />
          <select className="qa-input" value={formFactor} onChange={(e) => setFormFactor(e.target.value as CwvFormFactor)} style={{ width: 140 }}>
            <option value="PHONE">Phone</option>
            <option value="DESKTOP">Desktop</option>
            <option value="TABLET">Tablet</option>
            <option value="ALL_FORM_FACTORS">All</option>
          </select>
          <button onClick={loadHistory} disabled={loading || !url.trim()} className="qa-btn-default" style={{ padding: "8px 18px" }}>{loading ? "Loading…" : "Load history"}</button>
          <button onClick={takeSnapshot} disabled={taking || !url.trim()} className="qa-btn-primary" style={{ padding: "8px 18px" }}>{taking ? "Snapshotting…" : "Take snapshot + detect regressions"}</button>
        </div>
        {error && <div style={{ marginTop: 10 }}><ErrorBanner error={error} /></div>}
      </SectionCard>

      {(loading || taking) && <LoadingPanel message={taking ? "Pulling CrUX field data + comparing to 7-day median…" : "Reading history…"} />}

      {latest && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
          <MetricCard label="LCP p75" value={latest.lcpP75 != null ? `${Math.round(latest.lcpP75)}ms` : "—"} tone={latest.ratings.lcp === "good" ? "ok" : latest.ratings.lcp === "needs-improvement" ? "warn" : "bad"} caption={latest.ratings.lcp ?? "—"} />
          <MetricCard label="INP p75" value={latest.inpP75 != null ? `${Math.round(latest.inpP75)}ms` : "—"} tone={latest.ratings.inp === "good" ? "ok" : latest.ratings.inp === "needs-improvement" ? "warn" : "bad"} caption={latest.ratings.inp ?? "—"} />
          <MetricCard label="CLS p75" value={latest.clsP75 != null ? latest.clsP75.toFixed(3) : "—"} tone={latest.ratings.cls === "good" ? "ok" : latest.ratings.cls === "needs-improvement" ? "warn" : "bad"} caption={latest.ratings.cls ?? "—"} />
          <MetricCard label="FCP p75" value={latest.fcpP75 != null ? `${Math.round(latest.fcpP75)}ms` : "—"} tone={latest.ratings.fcp === "good" ? "ok" : latest.ratings.fcp === "needs-improvement" ? "warn" : "bad"} caption={latest.ratings.fcp ?? "—"} />
          <MetricCard label="TTFB p75" value={latest.ttfbP75 != null ? `${Math.round(latest.ttfbP75)}ms` : "—"} tone={latest.ratings.ttfb === "good" ? "ok" : latest.ratings.ttfb === "needs-improvement" ? "warn" : "bad"} caption={latest.ratings.ttfb ?? "—"} />
        </div>
      )}

      {regressions && (regressions.regressions.length > 0 || regressions.improvements.length > 0) && (
        <SectionCard title={`Vs 7-day median (${regressions.baseline.count} prior snapshots)`}>
          {regressions.regressions.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="qa-kicker" style={{ marginBottom: 6, color: "#dc2626" }}>Regressions</div>
              {regressions.regressions.map((r) => (
                <div key={`r-${r.metric}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 10px", borderRadius: 6, background: r.severity === "critical" ? "#fef2f2" : r.severity === "warn" ? "#fef3c7" : "var(--glass2)", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#fff", color: r.severity === "critical" ? "#991b1b" : r.severity === "warn" ? "#92400e" : "#475569", fontWeight: 700, textTransform: "uppercase" }}>{r.severity}</span>
                  <strong style={{ fontSize: 13, textTransform: "uppercase" }}>{r.metric}</strong>
                  <span style={{ fontSize: 12 }}>{r.beforeMedian} → <strong style={{ color: "#dc2626" }}>{r.current}</strong> (Δ +{r.delta})</span>
                  {r.crossedTier && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#dc2626", color: "#fff", fontWeight: 700 }}>TIER CROSSED</span>}
                </div>
              ))}
            </div>
          )}
          {regressions.improvements.length > 0 && (
            <div>
              <div className="qa-kicker" style={{ marginBottom: 6, color: "#16a34a" }}>Improvements</div>
              {regressions.improvements.map((r) => (
                <div key={`i-${r.metric}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 10px", borderRadius: 6, background: "#f0fdf4", marginBottom: 4 }}>
                  <strong style={{ fontSize: 13, textTransform: "uppercase" }}>{r.metric}</strong>
                  <span style={{ fontSize: 12 }}>{r.beforeMedian} → <strong style={{ color: "#16a34a" }}>{r.current}</strong> (Δ {r.delta})</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {snapshots.length === 0 && !loading && !taking && (
        <SectionCard title="No history yet">
          <EmptyState title="Take your first snapshot" hint="Click 'Take snapshot' above. Run periodically (or via /schedules) to build a deploy-vs-CWV trend line." />
        </SectionCard>
      )}

      {snapshots.length > 1 && (
        <SectionCard title="LCP & INP trend (last 90 days)">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} unit="ms" />
              <Tooltip />
              <ReferenceLine y={TIER_BOUNDARIES.lcp.good} stroke="#16a34a" strokeDasharray="3 3" label={{ value: "LCP good", fontSize: 10, fill: "#16a34a" }} />
              <ReferenceLine y={TIER_BOUNDARIES.lcp.poor} stroke="#dc2626" strokeDasharray="3 3" label={{ value: "LCP poor", fontSize: 10, fill: "#dc2626" }} />
              <Line type="monotone" dataKey="LCP" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="INP" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="FCP" stroke="#0891b2" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="TTFB" stroke="#64748b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
      )}
    </PageShell>
  );
}
