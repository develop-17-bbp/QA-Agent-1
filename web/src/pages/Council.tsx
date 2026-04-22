import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner } from "../components/UI";
import { SkeletonCard, MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import {
  runCouncilApi,
  type CouncilFeature,
  type CouncilResponse,
  type CouncilAgendaItem,
  type CouncilAdvisor,
} from "../api";

type FeatureDef = {
  id: CouncilFeature;
  label: string;
  blurb: string;
  extraInput?: "keywords" | "competitors" | "urls";
  extraLabel?: string;
  extraPlaceholder?: string;
};
const FEATURES: FeatureDef[] = [
  { id: "keywords", label: "Keywords", blurb: "Terms that appear across GSC + Bing/Yandex/Ahrefs anchors + news/RSS — cross-source = strong editorial signal." },
  { id: "backlinks", label: "Backlinks", blurb: "Referring domains confirmed by multiple link indexes (Bing + Yandex + Ahrefs + GSC). 3+ sources = credible link." },
  { id: "serp", label: "SERP Ranks", blurb: "Your domain's ranking consensus across DDG + Startpage + GSC + Brave for a given keyword set.", extraInput: "keywords", extraLabel: "Keywords to probe (comma or newline separated)", extraPlaceholder: "best seo tools\nkeyword research\nbacklink audit" },
  { id: "authority", label: "Domain Authority", blurb: "OpenPageRank + Tranco + Cloudflare Radar agreement per domain. 3/3 sources = genuine top-tier site; 1/3 may be SEO-juiced.", extraInput: "competitors", extraLabel: "Competitor domains (optional — comma or newline separated)", extraPlaceholder: "wikipedia.org\nahrefs.com\nsemrush.com" },
  { id: "vitals", label: "Web Vitals", blurb: "Lab (PageSpeed mobile + desktop) vs. field (CrUX phone + desktop) per URL. Big lab-vs-field gaps are where real regressions hide.", extraInput: "urls", extraLabel: "URLs to probe (optional — defaults to homepage; 1 per line)", extraPlaceholder: "/\n/pricing\n/blog" },
];

const TIER_META = {
  top: { label: "Top tier", note: "3+ sources agree", color: "#16a34a", bg: "#dcfce7", border: "#86efac" },
  mid: { label: "Mid tier", note: "exactly 2 sources agree", color: "#d97706", bg: "#fef3c7", border: "#fcd34d" },
  bottom: { label: "Bottom tier", note: "only 1 source — not triangulated", color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1" },
};

const SOURCE_COLOR: Record<string, string> = {
  gsc: "#4285f4",
  "bing-anchors": "#00a4ef",
  "yandex-anchors": "#ff0000",
  "awt-anchors": "#ff6a00",
  "rss-mentions": "#8b5cf6",
  "bing-wmt": "#00a4ef",
  "yandex-wmt": "#ff0000",
  "ahrefs-wmt": "#ff6a00",
  "gsc-links": "#4285f4",
  ddg: "#de5833",
  startpage: "#4b5563",
  brave: "#fb542b",
  // Domain Authority
  opr: "#8b5cf6",
  tranco: "#0ea5e9",
  "cloudflare-radar": "#f38020",
  // Vitals
  "psi-mobile": "#34a853",
  "psi-desktop": "#1a73e8",
  "crux-phone": "#ea4335",
  "crux-desktop": "#fbbc04",
};

function sourceChip(src: string): { bg: string; color: string; label: string } {
  const color = SOURCE_COLOR[src] ?? "#64748b";
  return { bg: `${color}20`, color, label: src };
}

// ── Per-feature metric visualizations ──────────────────────────────────────
// Generic metric chips only serve keywords + backlinks well. Authority,
// Vitals, and SERP carry their meaning in relationships between numbers
// (lab vs field LCP, OPR vs Tranco vs Cloudflare, per-source rank spread),
// which chips hide. These renderers expose the comparison directly.

function ScoreBar({ label, value, max, color, note }: { label: string; value: number | undefined; max: number; color: string; note?: string }) {
  const pct = typeof value === "number" ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>
        <span style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
        <span style={{ color: typeof value === "number" ? "var(--text)" : "var(--muted)" }}>
          {typeof value === "number" ? value.toLocaleString() : "—"}
        </span>
      </div>
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        {typeof value === "number" && <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />}
      </div>
      {note && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function AuthorityMetrics({ item }: { item: CouncilAgendaItem }) {
  const opr = item.metrics.oprAuthority as number | undefined;
  const oprRank = item.metrics.oprGlobalRank as number | undefined;
  const trPct = item.metrics.trancoPercentile as number | undefined;
  const trRank = item.metrics.trancoRank as number | undefined;
  const radarRank = item.metrics.radarRank as number | undefined;
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)" }}>
      <ScoreBar
        label="OPR Authority (0-100)"
        value={opr}
        max={100}
        color={SOURCE_COLOR.opr!}
        note={oprRank != null ? `Global rank #${oprRank.toLocaleString()}` : "not indexed"}
      />
      <ScoreBar
        label="Tranco Percentile"
        value={trPct}
        max={100}
        color={SOURCE_COLOR.tranco!}
        note={trRank != null ? `Top-1M rank #${trRank.toLocaleString()}` : "not in top 1M"}
      />
      <ScoreBar
        label="Cloudflare Radar"
        value={radarRank != null ? Math.max(0, 100 - Math.min(100, Math.log10(radarRank + 1) * 15)) : undefined}
        max={100}
        color={SOURCE_COLOR["cloudflare-radar"]!}
        note={radarRank != null ? `Radar rank #${radarRank.toLocaleString()}` : "not in Cloudflare top list"}
      />
    </div>
  );
}

function lcpRating(ms: number | undefined): { label: string; color: string } {
  if (typeof ms !== "number") return { label: "—", color: "#94a3b8" };
  if (ms <= 2500) return { label: "good", color: "#16a34a" };
  if (ms <= 4000) return { label: "needs work", color: "#d97706" };
  return { label: "poor", color: "#dc2626" };
}
function clsRating(cls: number | undefined): { label: string; color: string } {
  if (typeof cls !== "number") return { label: "—", color: "#94a3b8" };
  if (cls <= 0.1) return { label: "good", color: "#16a34a" };
  if (cls <= 0.25) return { label: "needs work", color: "#d97706" };
  return { label: "poor", color: "#dc2626" };
}

function MetricPair({ metric, lab, field, unit, rate }: {
  metric: string;
  lab: number | undefined;
  field: number | undefined;
  unit: string;
  rate: (v: number | undefined) => { label: string; color: string };
}) {
  const labR = rate(lab);
  const fieldR = rate(field);
  const bothPresent = typeof lab === "number" && typeof field === "number";
  const gap = bothPresent ? Math.abs(lab! - field!) : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px", background: "#fff", borderRadius: 6, border: "1px solid var(--border)", minWidth: 160, flex: 1 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted)" }}>{metric}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>Lab (PSI)</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: labR.color }}>
            {typeof lab === "number" ? (unit === "ms" ? `${Math.round(lab)}ms` : lab.toFixed(3)) : "—"}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>Field (CrUX p75)</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: fieldR.color }}>
            {typeof field === "number" ? (unit === "ms" ? `${Math.round(field)}ms` : field.toFixed(3)) : "—"}
          </div>
        </div>
      </div>
      {bothPresent && (
        <div style={{ fontSize: 10, color: gap! > 1000 ? "#dc2626" : gap! > 300 ? "#d97706" : "var(--muted)", fontWeight: gap! > 1000 ? 700 : 500 }}>
          Δ {unit === "ms" ? `${Math.round(gap!)}ms` : gap!.toFixed(3)} {gap! > 1000 ? "— real users slower than lab" : ""}
        </div>
      )}
    </div>
  );
}

function VitalsMetrics({ item }: { item: CouncilAgendaItem }) {
  const labLcpMobile = item.metrics.labLcpMobileMs as number | undefined;
  const fieldLcpPhone = item.metrics.fieldLcpPhoneMs as number | undefined;
  const labLcpDesktop = item.metrics.labLcpDesktopMs as number | undefined;
  const fieldLcpDesktop = item.metrics.fieldLcpDesktopMs as number | undefined;
  const labClsMobile = item.metrics.labClsMobile as number | undefined;
  const fieldClsPhone = item.metrics.fieldClsPhone as number | undefined;
  const fieldInpPhone = item.metrics.fieldInpPhoneMs as number | undefined;
  const gapSeverity = item.metrics.labFieldGap as string | undefined;
  const labPerfMobile = item.metrics.labPerfMobile as number | undefined;
  const labPerfDesktop = item.metrics.labPerfDesktop as number | undefined;
  return (
    <div style={{ marginBottom: 10 }}>
      {gapSeverity === "large" && (
        <div style={{ padding: "6px 10px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 6, fontSize: 11.5, marginBottom: 8, fontWeight: 600 }}>
          ⚠ Lab-vs-field gap &gt; 1s — the regression is not visible in Lighthouse CI but real users feel it.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <MetricPair metric="LCP (mobile)" lab={labLcpMobile} field={fieldLcpPhone} unit="ms" rate={lcpRating} />
        <MetricPair metric="LCP (desktop)" lab={labLcpDesktop} field={fieldLcpDesktop} unit="ms" rate={lcpRating} />
        <MetricPair metric="CLS (mobile)" lab={labClsMobile} field={fieldClsPhone} unit="" rate={clsRating} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
        {typeof labPerfMobile === "number" && <span>Lab perf (mobile): <strong style={{ color: labPerfMobile >= 90 ? "#16a34a" : labPerfMobile >= 50 ? "#d97706" : "#dc2626" }}>{labPerfMobile}/100</strong></span>}
        {typeof labPerfDesktop === "number" && <span>Lab perf (desktop): <strong style={{ color: labPerfDesktop >= 90 ? "#16a34a" : labPerfDesktop >= 50 ? "#d97706" : "#dc2626" }}>{labPerfDesktop}/100</strong></span>}
        {typeof fieldInpPhone === "number" && <span>Field INP (p75): <strong style={{ color: fieldInpPhone <= 200 ? "#16a34a" : fieldInpPhone <= 500 ? "#d97706" : "#dc2626" }}>{fieldInpPhone}ms</strong></span>}
      </div>
    </div>
  );
}

function RankBadge({ source, rank }: { source: string; rank: number | undefined }) {
  const color = SOURCE_COLOR[source] ?? "#64748b";
  const present = typeof rank === "number";
  return (
    <div style={{
      padding: "6px 10px", borderRadius: 6, border: `1px solid ${present ? color : "var(--border)"}`,
      background: present ? `${color}12` : "#f8fafc",
      minWidth: 96, textAlign: "center",
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color }}>{source}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: present ? "var(--text)" : "var(--muted)", lineHeight: 1.1 }}>
        {present ? `#${rank}` : "—"}
      </div>
    </div>
  );
}

function SerpMetrics({ item }: { item: CouncilAgendaItem }) {
  const ddg = item.metrics.ddgRank as number | undefined;
  const sp = item.metrics.startpageRank as number | undefined;
  const gsc = item.metrics.gscRank as number | undefined;
  const br = item.metrics.braveRank as number | undefined;
  const consensus = item.metrics.consensusPosition as number | undefined;
  const spread = item.metrics.sourceSpread as number | undefined;
  return (
    <div style={{ marginBottom: 10, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted)" }}>Consensus</div>
        <div style={{
          fontSize: 22, fontWeight: 800, padding: "2px 12px", borderRadius: 8,
          background: typeof consensus === "number" && consensus <= 10 ? "#dcfce7" : typeof consensus === "number" && consensus <= 30 ? "#fef3c7" : "#f1f5f9",
          color: typeof consensus === "number" && consensus <= 10 ? "#166534" : typeof consensus === "number" && consensus <= 30 ? "#92400e" : "var(--muted)",
        }}>
          {typeof consensus === "number" ? `#${consensus}` : "—"}
        </div>
        {typeof spread === "number" && spread > 0 && (
          <div style={{ fontSize: 11, color: spread > 10 ? "#dc2626" : "var(--muted)" }}>
            range across sources: {spread}{spread > 10 ? " — sources disagree" : ""}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RankBadge source="ddg" rank={ddg} />
        <RankBadge source="startpage" rank={sp} />
        <RankBadge source="gsc" rank={gsc} />
        <RankBadge source="brave" rank={br} />
      </div>
    </div>
  );
}

function AdvisorVerdictCard({ advisor, verdict }: { advisor: CouncilAdvisor; verdict: string | undefined }) {
  return (
    <div
      title={advisor.focus}
      style={{
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "#fff",
        flex: 1,
        minWidth: 180,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
        {advisor.name}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 }}>
        {verdict ?? <span style={{ color: "var(--muted)", fontStyle: "italic" }}>no verdict</span>}
      </div>
    </div>
  );
}

function GenericMetricChips({ item }: { item: CouncilAgendaItem }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
      {Object.entries(item.metrics)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .slice(0, 6)
        .map(([k, v]) => (
          <span key={k} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: "#f8fafc", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            {k}: {typeof v === "number" ? v.toLocaleString() : String(v)}
          </span>
        ))}
    </div>
  );
}

function TierRow({
  item,
  advisors,
  verdicts,
  tierTone,
  feature,
}: {
  item: CouncilAgendaItem;
  advisors: CouncilAdvisor[];
  verdicts: Record<string, string> | undefined;
  tierTone: typeof TIER_META[keyof typeof TIER_META];
  feature: CouncilFeature;
}) {
  return (
    <div
      style={{
        padding: 14,
        border: `1px solid ${tierTone.border}`,
        borderRadius: 10,
        background: "#fff",
        marginBottom: 10,
        boxShadow: "0 1px 0 rgba(15,23,42,0.02)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", wordBreak: "break-all" }}>{item.label}</div>
        {item.sublabel && <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.sublabel}</div>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <div
            title={`Consensus score ${item.score}/100`}
            style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: tierTone.bg, color: tierTone.color }}
          >
            score {item.score}
          </div>
        </div>
      </div>

      {/* Source chips shown for every feature */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {item.sources.map((s) => {
          const c = sourceChip(s);
          return (
            <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: c.bg, color: c.color, textTransform: "uppercase", letterSpacing: 0.3 }}>
              {c.label}
            </span>
          );
        })}
      </div>

      {/* Feature-specific metric visualization */}
      {feature === "authority" && <AuthorityMetrics item={item} />}
      {feature === "vitals" && <VitalsMetrics item={item} />}
      {feature === "serp" && <SerpMetrics item={item} />}
      {(feature === "keywords" || feature === "backlinks") && <GenericMetricChips item={item} />}

      {item.rawVariants && item.rawVariants.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
          {feature === "backlinks" ? "top anchor text" : "as"}: {item.rawVariants.map((v) => `"${v}"`).join(" · ")}
        </div>
      )}

      {verdicts && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {advisors.map((a) => (
            <AdvisorVerdictCard key={a.id} advisor={a} verdict={verdicts[a.id]} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Council() {
  const [feature, setFeature] = useState<CouncilFeature>("keywords");
  const [domain, setDomain] = useState("");
  const [extrasText, setExtrasText] = useState("");
  const [includeLlm, setIncludeLlm] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<CouncilResponse | null>(null);

  const featureMeta = useMemo(() => FEATURES.find((f) => f.id === feature)!, [feature]);

  const run = async () => {
    const d = domain.trim();
    if (!d) { setError("domain required"); return; }
    if (feature === "serp" && !extrasText.trim()) { setError("at least one keyword required for SERP council"); return; }
    setError("");
    setLoading(true);
    setData(null);
    try {
      const lines = extrasText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      const extras: { keywords?: string[]; competitors?: string[]; urls?: string[]; includeLlm: boolean } = { includeLlm };
      if (feature === "serp") extras.keywords = lines;
      else if (feature === "authority") extras.competitors = lines;
      else if (feature === "vitals") extras.urls = lines;
      const resp = await runCouncilApi(feature, d, extras);
      setData(resp);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const councilResult = data?.council && !("error" in (data.council as any)) ? data.council as Exclude<typeof data.council, null | { error: string }> : null;
  const councilError = data?.council && "error" in (data.council as any) ? (data.council as { error: string }).error : null;

  return (
    <PageShell
      title="Council"
      desc="Cross-source consensus analysis — each feature pulls from multiple SEO data sources, tiers what they agree on, and has the LLM role-play a panel of advisors giving per-item verdicts."
      purpose="When 3+ of our 13 integrated data sources agree on a keyword, referring domain, or SERP rank, that's a far stronger signal than any single source alone. The Council layer surfaces this overlap AND has the LLM tell you what to do about it."
      sources={["GSC", "Bing", "Yandex", "Ahrefs WMT", "RSS", "DDG", "Startpage", "Brave", "OPR", "Tranco", "Cloudflare", "PageSpeed", "CrUX"]}
    >
      {/* Feature tabs */}
      <SectionCard title="Choose feature area">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {FEATURES.map((f) => (
            <button
              key={f.id}
              onClick={() => { setFeature(f.id); setExtrasText(""); }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: feature === f.id ? "2px solid var(--accent, #111)" : "1px solid var(--border)",
                background: feature === f.id ? "var(--accent, #111)" : "#fff",
                color: feature === f.id ? "#fff" : "var(--text)",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>{featureMeta.blurb}</div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="qa-kicker" style={{ display: "block", marginBottom: 4 }}>Domain</label>
            <input
              className="qa-input"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. wikipedia.org"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
              disabled={loading}
            />
          </div>

          {featureMeta.extraInput && (
            <div style={{ flex: 2, minWidth: 280 }}>
              <label className="qa-kicker" style={{ display: "block", marginBottom: 4 }}>{featureMeta.extraLabel}</label>
              <textarea
                value={extrasText}
                onChange={(e) => setExtrasText(e.target.value)}
                rows={3}
                placeholder={featureMeta.extraPlaceholder}
                style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, resize: "vertical" }}
                disabled={loading}
              />
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={includeLlm} onChange={(e) => setIncludeLlm(e.target.checked)} disabled={loading} />
            Run LLM advisor panel (local Ollama, ~10-45s)
          </label>
          <button
            onClick={run}
            disabled={loading || !domain.trim()}
            className="qa-btn-primary"
            style={{ padding: "10px 20px", fontWeight: 700, marginLeft: "auto" }}
          >
            {loading ? "Convening council…" : "Convene council"}
          </button>
        </div>
      </SectionCard>

      {error && <ErrorBanner error={error} />}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12.5, color: "var(--muted)" }}>
            Gathering {featureMeta.label.toLowerCase()} data from every configured source… the LLM council runs last (~10-45s on CPU).
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <MetricCardSkeleton tone="ok" />
            <MetricCardSkeleton tone="warn" />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </div>
          <SkeletonCard rows={6} />
          <SkeletonCard rows={4} />
        </div>
      )}

      {data && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <SectionCard
            title={`${data.context.featureLabel} for ${data.context.target}`}
            actions={
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {data.context.totalItems} items · aggregate {data.elapsed.aggregateMs}ms · LLM {data.elapsed.llmMs}ms
              </div>
            }
          >
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.55 }}>
              {data.context.featureTagline}
            </div>

            {/* Tier-count KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
              <MetricCard
                label="Strong consensus"
                value={data.context.tierTop.length}
                tone="ok"
                caption="3+ sources agree"
                format="compact"
              />
              <MetricCard
                label="Partial agreement"
                value={data.context.tierMid.length}
                tone="warn"
                caption="exactly 2 sources"
                format="compact"
              />
              <MetricCard
                label="Single-source"
                value={data.context.tierBottom.length}
                tone="default"
                caption="needs triangulation"
                format="compact"
              />
              <MetricCard
                label="Sources active"
                value={`${data.context.sourcesQueried.length}/${data.context.sourcesQueried.length + data.context.sourcesFailed.length}`}
                tone="accent"
                caption={data.context.sourcesFailed.length > 0 ? `${data.context.sourcesFailed.length} unavailable` : "all configured sources live"}
              />
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              {data.context.sourcesQueried.map((s) => {
                const c = sourceChip(s);
                return (
                  <span key={s} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12, background: c.bg, color: c.color, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    ✓ {s}
                  </span>
                );
              })}
              {data.context.sourcesFailed.map((f) => (
                <span key={f.source} title={f.reason} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "#f1f5f9", color: "var(--muted)", border: "1px dashed var(--border)" }}>
                  × {f.source} — {f.reason.slice(0, 40)}{f.reason.length > 40 ? "…" : ""}
                </span>
              ))}
            </div>

            {councilError && (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", marginBottom: 14, fontSize: 12.5 }}>
                LLM council failed: {councilError}. Consensus data below is still valid.
              </div>
            )}
            {councilResult && (
              <div style={{ padding: "14px 16px", borderRadius: 10, background: "#f0f9ff", border: "1px solid #bae6fd", marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#0369a1", marginBottom: 6 }}>
                  Council synthesis · {councilResult.model}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.55 }}>{councilResult.synthesis}</div>
              </div>
            )}
          </SectionCard>

          {/* Tiers */}
          {([
            { key: "top" as const, items: data.context.tierTop },
            { key: "mid" as const, items: data.context.tierMid },
            { key: "bottom" as const, items: data.context.tierBottom },
          ]).map(({ key, items }) => {
            const meta = TIER_META[key];
            return (
              <SectionCard
                key={key}
                title={`${meta.label} (${items.length})`}
                actions={
                  <span style={{ fontSize: 11, color: meta.color, fontWeight: 600 }}>{meta.note}</span>
                }
              >
                {items.length === 0 ? (
                  <EmptyState title={`No ${key}-tier items found.`} />
                ) : (
                  items.slice(0, 30).map((item) => (
                    <TierRow
                      key={item.id}
                      item={item}
                      advisors={data.context.advisors}
                      verdicts={councilResult?.verdicts?.[item.id]}
                      tierTone={meta}
                      feature={data.context.feature as CouncilFeature}
                    />
                  ))
                )}
                {items.length > 30 && (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                    Showing 30 of {items.length}. LLM council only reviewed the highest-scored items.
                  </div>
                )}
              </SectionCard>
            );
          })}
        </motion.div>
      )}
    </PageShell>
  );
}
