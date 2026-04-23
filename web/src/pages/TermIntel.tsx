import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { PageShell, SectionCard } from "../components/PageUI";
import { ErrorBanner } from "../components/UI";
import { SkeletonCard, MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { useRegion } from "../components/RegionPicker";
import {
  runTermIntelApi,
  type TermIntelResponse,
  type TermIntelSource,
  type TermIntelSourceStatus,
  type CouncilAdvisor,
} from "../api";

const STATUS_META: Record<TermIntelSourceStatus, { color: string; bg: string; label: string }> = {
  ok:              { color: "#166534", bg: "#dcfce7", label: "Has data" },
  "no-data":       { color: "#64748b", bg: "#f1f5f9", label: "No match" },
  "not-configured":{ color: "#92400e", bg: "#fef3c7", label: "Not connected" },
  error:           { color: "#991b1b", bg: "#fef2f2", label: "Error" },
};

const CATEGORY_META: Record<TermIntelSource["category"], { label: string; order: number }> = {
  volume:    { label: "Search demand",      order: 1 },
  editorial: { label: "Editorial presence", order: 2 },
  anchor:    { label: "Inbound anchors",    order: 3 },
  serp:      { label: "SERP landscape",     order: 4 },
  topic:     { label: "Topic signals",      order: 5 },
};

function SourceCard({ source }: { source: TermIntelSource }) {
  const [open, setOpen] = useState(source.status === "ok");
  const meta = STATUS_META[source.status];
  const canExpand = !!source.detail;

  return (
    <div style={{
      border: `1px solid ${source.status === "ok" ? "#86efac" : "var(--border)"}`,
      borderRadius: 10,
      background: source.status === "ok" ? "#f0fdf4" : "#fff",
      marginBottom: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => canExpand && setOpen((v) => !v)}
        disabled={!canExpand}
        style={{
          width: "100%", textAlign: "left", padding: 14, display: "flex", gap: 10, alignItems: "center",
          background: "transparent", border: "none", cursor: canExpand ? "pointer" : "default",
        }}
      >
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: meta.bg, color: meta.color, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {meta.label}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{source.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{source.headline}</div>
          {source.reason && source.status !== "ok" && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>{source.reason}</div>
          )}
        </div>
        {source.metric && (
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>{source.metric}</div>
        )}
        {canExpand && (
          <span style={{ fontSize: 12, color: "var(--muted)", transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>▾</span>
        )}
      </button>
      {open && source.detail && (
        <div style={{ borderTop: "1px solid var(--border)", padding: 14, background: "#fff" }}>
          <DetailBody detail={source.detail} />
        </div>
      )}
    </div>
  );
}

function DetailBody({ detail }: { detail: NonNullable<TermIntelSource["detail"]> }) {
  switch (detail.kind) {
    case "text":
      return <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>{detail.text}</div>;
    case "list":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {detail.items.map((item, i) => (
            <span key={i} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: "#f1f5f9", color: "var(--text)", border: "1px solid var(--border)" }}>
              {item}
            </span>
          ))}
        </div>
      );
    case "table":
      return (
        <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {detail.columns.map((c) => (
                  <th key={c} style={{ position: "sticky", top: 0, background: "var(--glass2)", padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ padding: "6px 10px", verticalAlign: "top", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {typeof cell === "number" ? cell.toLocaleString() : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "serp":
      return (
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "var(--text)", lineHeight: 1.6 }}>
          {detail.results.map((r) => (
            <li key={r.position} style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>{r.url}</a>
            </li>
          ))}
        </ol>
      );
    case "trend":
      return <TrendSpark data={detail.monthly} />;
    default:
      return null;
  }
}

function TrendSpark({ data }: { data: number[] }) {
  if (data.length < 2) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Not enough data points.</div>;
  const max = Math.max(...data, 1);
  const W = 400; const H = 60;
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`);
  return (
    <div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%" }}>
        <path d={`M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`} fill="var(--accent)" opacity={0.15} />
        <path d={`M ${pts.join(" L ")}`} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
      </svg>
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>
        Google Trends interest over 12 months · peak {max} · {data.length} samples
      </div>
    </div>
  );
}

function AdvisorCard({ advisor, verdict }: { advisor: CouncilAdvisor; verdict: string | undefined }) {
  return (
    <div title={advisor.focus} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", flex: 1, minWidth: 200 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
        {advisor.name}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>
        {verdict ?? <span style={{ color: "var(--muted)", fontStyle: "italic" }}>no verdict</span>}
      </div>
    </div>
  );
}

export default function TermIntel() {
  const location = useLocation();
  const initialTerm = useMemo(() => new URLSearchParams(location.search).get("term") ?? "", [location.search]);
  const initialDomain = useMemo(() => new URLSearchParams(location.search).get("domain") ?? "", [location.search]);

  const [term, setTerm] = useState(initialTerm);
  const [domain, setDomain] = useState(initialDomain);
  const [region] = useRegion();
  const [includeLlm, setIncludeLlm] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<TermIntelResponse | null>(null);

  // If a term was passed via query string, auto-fire on mount.
  useEffect(() => {
    if (initialTerm && !data && !loading) {
      setTerm(initialTerm);
      void run(initialTerm, initialDomain || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTerm]);

  const run = async (overrideTerm?: string, overrideDomain?: string) => {
    const t = (overrideTerm ?? term).trim();
    if (!t) { setError("enter a term"); return; }
    setError("");
    setLoading(true);
    setData(null);
    try {
      const resp = await runTermIntelApi(t, {
        region,
        domain: (overrideDomain ?? domain).trim() || undefined,
        includeLlm,
      });
      setData(resp);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const council = data?.council && !("error" in (data.council as any))
    ? (data.council as Exclude<typeof data.council, null | { error: string }>)
    : null;
  const councilErr = data?.council && "error" in (data.council as any) ? (data.council as { error: string }).error : null;

  const groupedSources = useMemo(() => {
    if (!data) return [];
    const byCat = new Map<string, TermIntelSource[]>();
    for (const s of data.intel.perSource) {
      if (!byCat.has(s.category)) byCat.set(s.category, []);
      byCat.get(s.category)!.push(s);
    }
    return [...byCat.entries()]
      .map(([cat, sources]) => ({ cat, meta: CATEGORY_META[cat as TermIntelSource["category"]], sources }))
      .sort((a, b) => (a.meta?.order ?? 99) - (b.meta?.order ?? 99));
  }, [data]);

  return (
    <PageShell
      title="Term Intel"
      desc="Type any term — we query every configured data source in parallel and the 4-advisor council tells you what to do about it."
      purpose='Give me a single word or phrase (e.g. "surgery"). In return: Google Ads monthly volume, Trends direction, Suggest completions, GSC presence on your own sites, Bing + Yandex + Ahrefs anchor-text mentions, recent news/RSS coverage, and the current SERP — all with expandable detail tables and four AI advisor verdicts.'
      sources={["Google Ads","Trends","Suggest","Wikipedia","GSC","Bing","Yandex","Ahrefs","RSS","DDG","Startpage"]}
    >
      {/* Input bar */}
      <SectionCard title="Lookup">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: 2, minWidth: 260 }}>
            <label className="qa-kicker" style={{ display: "block", marginBottom: 4 }}>Term</label>
            <input
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && run()}
              placeholder="e.g. surgery"
              disabled={loading}
              style={{ width: "100%", padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14 }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="qa-kicker" style={{ display: "block", marginBottom: 4 }}>Domain (optional — filters anchor/GSC)</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. wikipedia.org"
              disabled={loading}
              style={{ width: "100%", padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={includeLlm} onChange={(e) => setIncludeLlm(e.target.checked)} disabled={loading} />
            Run AI advisor panel (local Ollama, ~8-25s)
          </label>
          <button
            onClick={() => run()}
            disabled={loading || !term.trim()}
            className="qa-btn-primary"
            style={{ padding: "10px 22px", fontWeight: 700, marginLeft: "auto" }}
          >
            {loading ? "Querying every source…" : "Ask the council"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Region (from top-nav): {region}</div>
      </SectionCard>

      {error && <ErrorBanner error={error} />}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <MetricCardSkeleton tone="ok" /><MetricCardSkeleton /><MetricCardSkeleton /><MetricCardSkeleton />
          </div>
          <SkeletonCard rows={8} />
          <SkeletonCard rows={4} />
        </div>
      )}

      {data && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* KPI strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            <MetricCard
              label="Sources with data"
              value={`${data.intel.sourcesHit.length}/${data.intel.perSource.length}`}
              tone={data.intel.sourcesHit.length >= 5 ? "ok" : data.intel.sourcesHit.length >= 3 ? "accent" : "warn"}
              caption={data.intel.sourcesHit.length === 0 ? "No data anywhere — term too rare?" : "cross-source breadth"}
            />
            <MetricCard
              label="Gather time"
              value={`${(data.elapsed.gatherMs / 1000).toFixed(1)}s`}
              tone="default"
              caption="parallel fan-out"
            />
            <MetricCard
              label="Council time"
              value={data.elapsed.llmMs > 0 ? `${(data.elapsed.llmMs / 1000).toFixed(1)}s` : "—"}
              tone="accent"
              caption={data.elapsed.llmMs > 0 ? "Ollama advisor panel" : "advisors skipped"}
            />
            <MetricCard
              label="Not configured"
              value={data.intel.sourcesMissed.length}
              tone="default"
              caption={data.intel.sourcesMissed.length > 0 ? "connect more in /integrations" : "all connected"}
            />
          </div>

          {/* Council synthesis */}
          {councilErr && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", marginBottom: 14, fontSize: 12.5 }}>
              AI council failed: {councilErr}. Raw source data is still shown below.
            </div>
          )}
          {council && (
            <SectionCard title={`Council verdict on "${data.intel.term}"`} actions={<span style={{ fontSize: 11, color: "var(--muted)" }}>{council.model}</span>}>
              <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.55, marginBottom: 12, padding: "12px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8 }}>
                {council.synthesis}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {data.context.advisors.map((a) => (
                  <AdvisorCard key={a.id} advisor={a} verdict={council.verdicts[data.intel.term]?.[a.id]} />
                ))}
              </div>
            </SectionCard>
          )}

          {/* Per-source accordion, grouped by category */}
          {groupedSources.map(({ cat, meta, sources }) => (
            <SectionCard
              key={cat}
              title={meta?.label ?? cat}
              actions={<span style={{ fontSize: 11, color: "var(--muted)" }}>{sources.filter((s) => s.status === "ok").length}/{sources.length} with data</span>}
            >
              {sources.map((s) => (<SourceCard key={s.id} source={s} />))}
            </SectionCard>
          ))}
        </motion.div>
      )}
    </PageShell>
  );
}
