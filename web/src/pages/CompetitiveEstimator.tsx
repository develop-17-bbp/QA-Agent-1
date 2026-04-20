import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchCompetitiveEstimate,
  type CompetitiveEstimateResponse,
  type CompetitiveEstimateSignals,
} from "../api";
import { ErrorBanner } from "../components/UI";

type Confidence = "high" | "medium" | "low";

const CONF_COLORS: Record<Confidence, string> = {
  high: "#16a34a",
  medium: "#d97706",
  low: "#dc2626",
};

const CONF_BG: Record<Confidence, string> = {
  high: "#dcfce7",
  medium: "#fef3c7",
  low: "#fee2e2",
};

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        background: CONF_BG[c],
        color: CONF_COLORS[c],
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {c}
    </span>
  );
}

function RangeBar({ min, max, mid }: { min: number; max: number; mid: number }) {
  const log = (n: number) => (n <= 0 ? 0 : Math.log10(n + 1));
  const lo = log(min);
  const hi = log(max);
  const m = log(mid);
  const span = Math.max(hi - lo, 0.001);
  const midPct = ((m - lo) / span) * 100;
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 999,
          background: "linear-gradient(90deg, #e2e8f0 0%, #0f172a 50%, #e2e8f0 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -3,
            left: `calc(${Math.max(0, Math.min(100, midPct))}% - 6px)`,
            width: 12,
            height: 14,
            borderRadius: 4,
            background: "#0f172a",
          }}
          title={`midpoint ≈ ${fmt(mid)}`}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
        <span>min {fmt(min)}</span>
        <span style={{ color: "var(--text)", fontWeight: 700 }}>mid ≈ {fmt(mid)}</span>
        <span>max {fmt(max)}</span>
      </div>
    </div>
  );
}

function SignalRow({ label, value, source, confidence, note }: {
  label: string;
  value: string | number | boolean | null;
  source?: string;
  confidence?: string;
  note?: string;
}) {
  const missing = value === null || value === undefined;
  return (
    <tr>
      <td style={{ fontWeight: 600, color: missing ? "var(--muted)" : "var(--text)" }}>{label}</td>
      <td style={{ fontFamily: "ui-monospace, monospace" }}>
        {missing ? "—" : typeof value === "boolean" ? (value ? "yes" : "no") : String(value)}
      </td>
      <td style={{ fontSize: 11, color: "var(--muted)" }}>{source ?? "—"}</td>
      <td>
        {confidence === "high" || confidence === "medium" || confidence === "low" ? (
          <ConfidenceBadge c={confidence as Confidence} />
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 11 }}>{missing ? "missing" : "—"}</span>
        )}
      </td>
      <td style={{ fontSize: 11, color: "var(--muted)" }}>{note ?? ""}</td>
    </tr>
  );
}

function signalsRows(s: CompetitiveEstimateSignals) {
  const rows: React.ReactNode[] = [];
  const push = (label: string, dp: { value: unknown; source?: string; confidence?: string; note?: string } | undefined, note?: string) => {
    rows.push(
      <SignalRow
        key={label}
        label={label}
        value={(dp?.value as string | number | boolean) ?? null}
        source={dp?.source}
        confidence={dp?.confidence}
        note={note ?? dp?.note ?? ""}
      />,
    );
  };
  push("Tranco rank (top 1M)", s.trancoRank, "lower = more popular");
  push("Tranco percentile", s.trancoPercentile, "0-100, higher = more popular");
  push("Domain Authority (0-100)", s.domainAuthority, "OpenPageRank rescaled");
  push("Cloudflare Radar rank", s.cloudflareRank, "real-traffic signal");
  push("Wikipedia monthly views", s.wikipediaMonthlyViews, "brand-query proxy");
  push("Google Trends (latest)", s.googleTrendsLatest, "0-100 relative");
  push("In CrUX dataset", s.cruxPresent, "requires real-user traffic");
  push("Common Crawl referring hosts", s.commonCrawlReferringHosts, "distinct hosts (proxy)");
  push("Common Crawl indexed URLs", s.commonCrawlDomainHits, "indexed-page proxy");
  push("SERP visibility (brand, of 3)", s.serpVisibilityCount, "DDG top-30 hits");
  return rows;
}

function EstimateCard({
  title,
  subtitle,
  min,
  max,
  mid,
  confidence,
}: {
  title: string;
  subtitle: string;
  min: number;
  max: number;
  mid: number;
  confidence: Confidence;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="qa-panel"
      style={{ padding: 20, display: "flex", flexDirection: "column", gap: 4 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <ConfidenceBadge c={confidence} />
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{subtitle}</div>
      <RangeBar min={min} max={max} mid={mid} />
    </motion.div>
  );
}

export default function CompetitiveEstimator() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<CompetitiveEstimateResponse | null>(null);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = domain.trim();
    if (!clean) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetchCompetitiveEstimate(clean);
      setData(res);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="qa-page-title">AI Competitive Estimator</h1>
        <p className="qa-page-desc" style={{ marginBottom: 18 }}>
          Probabilistic ranges for any competitor domain's <strong>backlinks</strong>, <strong>monthly organic traffic</strong>, and <strong>keyword universe</strong>, using only free-tier signals
          (Tranco, OpenPageRank, Cloudflare Radar, Wikipedia, Google Trends, CrUX, Common Crawl, DuckDuckGo SERP) plus a local Ollama band-widener.
          Ranges reflect real uncertainty — never treat them as Semrush-grade precision.
        </p>
      </motion.div>

      <form
        onSubmit={run}
        className="qa-panel"
        style={{
          padding: 16,
          display: "grid",
          gridTemplateColumns: "minmax(240px, 2fr) auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 18,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          Competitor domain
          <input
            className="qa-input"
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            style={{ padding: "8px 12px" }}
            disabled={loading}
          />
        </label>
        <button className="qa-btn-primary" type="submit" disabled={loading || !domain.trim()} style={{ padding: "10px 20px", whiteSpace: "nowrap" }}>
          {loading ? "Estimating…" : "Estimate"}
        </button>
      </form>

      {error && <ErrorBanner error={error} />}

      <AnimatePresence mode="wait">
        {loading && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="qa-loading-panel" style={{ padding: 40 }}>
            <span className="qa-spinner qa-spinner--lg" />
            <div style={{ marginTop: 12, color: "var(--muted)" }}>Gathering free signals + running band-widener…</div>
          </motion.div>
        )}

        {!loading && data && (
          <motion.div key="data" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {!data.llmAvailable && (
              <div className="qa-panel" style={{ padding: 14, marginBottom: 16, background: "#fef3c7", borderColor: "#d97706" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>
                  Deterministic baseline only — Ollama is offline
                </div>
                <div style={{ fontSize: 12, color: "#92400e", marginTop: 4 }}>
                  Estimates below are the raw log-linear baseline without AI confidence calibration. Start Ollama with <code>ollama serve</code> for tighter ranges.
                </div>
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 14,
                marginBottom: 22,
              }}
            >
              <EstimateCard
                title="Referring domains"
                subtitle="Estimated distinct external domains linking in"
                min={data.estimates.backlinks.min}
                max={data.estimates.backlinks.max}
                mid={data.estimates.backlinks.mid}
                confidence={data.estimates.backlinks.confidence}
              />
              <EstimateCard
                title="Monthly organic traffic"
                subtitle="Estimated organic visits / month (all pages)"
                min={data.estimates.monthlyOrganicTraffic.min}
                max={data.estimates.monthlyOrganicTraffic.max}
                mid={data.estimates.monthlyOrganicTraffic.mid}
                confidence={data.estimates.monthlyOrganicTraffic.confidence}
              />
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="qa-panel"
                style={{ padding: 20, display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Keyword universe</div>
                  <ConfidenceBadge c={data.estimates.keywordUniverse.confidence} />
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Estimated distinct keywords ranked top-30</div>
                <div style={{ fontSize: 32, fontWeight: 800, marginTop: 14, color: "var(--text)" }}>
                  ≈ {fmt(data.estimates.keywordUniverse.estimate)}
                </div>
              </motion.div>
            </div>

            {data.drivers.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Top drivers</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {data.drivers.map((d, i) => (
                    <span key={i} style={{ padding: "4px 10px", borderRadius: 6, background: "#f1f5f9", fontSize: 12, color: "var(--text)" }}>
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {data.caveats.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Caveats</div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>
                  {data.caveats.map((c, i) => (<li key={i}>{c}</li>))}
                </ul>
              </div>
            )}

            <div className="qa-panel" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "14px 16px", fontSize: 13, fontWeight: 700, borderBottom: "1px solid var(--border)" }}>
                Free signals ({data.signals.providersHit.length} hit / {data.signals.providersFailed.length} missing)
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th>Value</th>
                    <th>Source</th>
                    <th>Confidence</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>{signalsRows(data.signals)}</tbody>
              </table>
            </div>

            <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
              <strong>Methodology:</strong> {data.methodology} Baseline deterministic values: backlinks ≈ {fmt(data.baseline.backlinks)}, traffic ≈ {fmt(data.baseline.monthlyOrganicTraffic)}, keyword-universe ≈ {fmt(data.baseline.keywordUniverse)}.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
