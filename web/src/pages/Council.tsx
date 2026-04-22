import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
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

function TierRow({
  item,
  advisors,
  verdicts,
  tierTone,
}: {
  item: CouncilAgendaItem;
  advisors: CouncilAdvisor[];
  verdicts: Record<string, string> | undefined;
  tierTone: typeof TIER_META[keyof typeof TIER_META];
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
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{item.label}</div>
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

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {item.sources.map((s) => {
          const c = sourceChip(s);
          return (
            <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: c.bg, color: c.color, textTransform: "uppercase", letterSpacing: 0.3 }}>
              {c.label}
            </span>
          );
        })}
        {Object.entries(item.metrics)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .slice(0, 6)
          .map(([k, v]) => (
            <span key={k} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: "#f8fafc", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              {k}: {typeof v === "number" ? v.toLocaleString() : String(v)}
            </span>
          ))}
      </div>

      {item.rawVariants && item.rawVariants.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
          as: {item.rawVariants.map((v) => `"${v}"`).join(" · ")}
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
      {loading && <LoadingPanel message={`Gathering ${featureMeta.label.toLowerCase()} data from every configured source…`} />}

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
