import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageShell, SectionCard } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { FilterableTable, type FilterableColumn } from "../components/FilterableTable";
import AskCouncilButton from "../components/AskCouncilButton";
import { analyzeBulkKeywordsApi, type BulkKeywordResult, type BulkKeywordRow } from "../api";
import { useRegion } from "../components/RegionPicker";

const INTENT_COLORS: Record<BulkKeywordRow["intent"], string> = {
  informational: "#3b82f6",
  commercial:    "#f59e0b",
  navigational:  "#8b5cf6",
  transactional: "#10b981",
};

const DIFF_COLOR = (d: number | null) => d == null ? "var(--muted)" : d >= 80 ? "#dc2626" : d >= 50 ? "#d97706" : "#16a34a";

export default function BulkKeywords() {
  const [region] = useRegion();
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<"auto" | "google-ads" | "dataforseo">("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<BulkKeywordResult | null>(null);

  const parsed = useMemo(() => {
    return Array.from(new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)));
  }, [text]);

  const run = async () => {
    if (parsed.length === 0) { setError("paste at least one keyword"); return; }
    setError(""); setLoading(true); setData(null);
    try {
      setData(await analyzeBulkKeywordsApi(parsed, { region, provider }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    if (!data) return null;
    const rows = data.rows;
    const withVolume = rows.filter((r) => typeof r.volume === "number");
    const totalVol = withVolume.reduce((a, b) => a + (b.volume ?? 0), 0);
    const avgDiff = rows.length > 0
      ? Math.round(rows.reduce((a, b) => a + (b.difficulty ?? 0), 0) / rows.length)
      : 0;
    const byIntent: Record<string, number> = {};
    for (const r of rows) byIntent[r.intent] = (byIntent[r.intent] ?? 0) + 1;
    return { totalVol, withVolume: withVolume.length, avgDiff, byIntent };
  }, [data]);

  const columns: FilterableColumn<BulkKeywordRow>[] = useMemo(() => [
    {
      key: "keyword",
      label: "Keyword",
      accessor: (r) => r.keyword,
      filterType: "text",
      render: (r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 500 }}>{r.keyword}</span>
          <AskCouncilButton term={r.keyword} compact />
        </span>
      ),
    },
    {
      key: "volume",
      label: "Volume",
      accessor: (r) => r.volume ?? 0,
      filterType: "number",
      width: 120,
      render: (r) => r.volume != null
        ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.volume.toLocaleString()}</span>
        : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>,
      headerStyle: { textAlign: "right" },
      cellStyle: { textAlign: "right" },
    },
    {
      key: "difficulty",
      label: "KD",
      accessor: (r) => r.difficulty ?? 0,
      filterType: "number",
      width: 90,
      render: (r) => r.difficulty != null
        ? <span style={{ fontWeight: 700, color: DIFF_COLOR(r.difficulty) }}>{r.difficulty}</span>
        : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>,
      headerStyle: { textAlign: "right" },
      cellStyle: { textAlign: "right" },
    },
    {
      key: "cpcUsd",
      label: "CPC",
      accessor: (r) => r.cpcUsd ?? 0,
      filterType: "number",
      width: 100,
      render: (r) => r.cpcUsd != null
        ? <span>${r.cpcUsd.toFixed(2)}</span>
        : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>,
      headerStyle: { textAlign: "right" },
      cellStyle: { textAlign: "right" },
    },
    {
      key: "competitionLabel",
      label: "Competition",
      accessor: (r) => r.competitionLabel ?? "",
      filterType: "select",
      width: 130,
      render: (r) => r.competitionLabel
        ? (
            <span style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 10,
              background: r.competitionLabel === "HIGH" ? "#fef2f2" : r.competitionLabel === "MEDIUM" ? "#fef3c7" : "#dcfce7",
              color: r.competitionLabel === "HIGH" ? "#991b1b" : r.competitionLabel === "MEDIUM" ? "#92400e" : "#166534",
            }}>{r.competitionLabel}</span>
          )
        : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>,
    },
    {
      key: "intent",
      label: "Intent",
      accessor: (r) => r.intent,
      filterType: "select",
      width: 130,
      render: (r) => (
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
          background: `${INTENT_COLORS[r.intent]}22`, color: INTENT_COLORS[r.intent],
        }}>{r.intent}</span>
      ),
    },
    {
      key: "wordCount",
      label: "Words",
      accessor: (r) => r.wordCount,
      filterType: "number",
      width: 80,
      headerStyle: { textAlign: "right" },
      cellStyle: { textAlign: "right" },
    },
  ], []);

  return (
    <PageShell
      title="Bulk Keyword Analyzer"
      desc="Paste up to 1000 keywords. Get volume + difficulty + CPC + competition + intent in one table — the SEMrush workflow, done locally."
      purpose="I have a list of 500 keywords from client brainstorms — which ones deserve content investment, and which are too hard?"
      sources={["Google Ads", "DataForSEO", "Intent classifier"]}
    >
      <SectionCard title="Paste keywords">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"best seo tools\nkeyword research\nbacklink audit\ncore web vitals\n…"}
          rows={10}
          disabled={loading}
          style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical", background: "var(--glass2)" }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Parsed: <strong style={{ color: "var(--text)" }}>{parsed.length}</strong> unique
            {parsed.length > 1000 && <span style={{ color: "#b45309" }}> · capped at 1000</span>}
          </span>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} disabled={loading} style={{ fontSize: 12, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--glass)", color: "var(--text)" }}>
              <option value="auto">Auto</option>
              <option value="google-ads">Google Ads</option>
              <option value="dataforseo">DataForSEO (BYOK)</option>
            </select>
          </label>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Region: <strong>{region}</strong></span>
          <button
            onClick={run}
            disabled={loading || parsed.length === 0}
            className="qa-btn-primary"
            style={{ padding: "10px 22px", fontWeight: 700, marginLeft: "auto" }}
          >
            {loading ? "Analyzing…" : `Analyze ${parsed.length > 0 ? parsed.length : ""}`}
          </button>
        </div>
      </SectionCard>

      {error && <ErrorBanner error={error} />}
      {loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            <MetricCardSkeleton /><MetricCardSkeleton /><MetricCardSkeleton /><MetricCardSkeleton />
          </div>
          <LoadingPanel message={`Batching ${parsed.length} keywords via ${provider === "auto" ? "best available provider" : provider}… (~${Math.max(1, Math.round(parsed.length / 40))}s)`} />
        </>
      )}

      {data && summary && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            <MetricCard
              label="Total monthly volume"
              value={summary.totalVol}
              format="compact"
              tone="accent"
              caption={`${summary.withVolume}/${data.rows.length} got volume data`}
              source={data.meta.provider}
            />
            <MetricCard
              label="Average KD"
              value={summary.avgDiff}
              format="percent"
              tone={summary.avgDiff >= 70 ? "bad" : summary.avgDiff >= 50 ? "warn" : "ok"}
              caption="across all keywords"
            />
            <MetricCard
              label="Most common intent"
              value={Object.entries(summary.byIntent).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"}
              tone="default"
              caption={Object.entries(summary.byIntent).map(([k, v]) => `${k}: ${v}`).join(" · ")}
            />
            <MetricCard
              label="Gather time"
              value={`${(data.meta.durationMs / 1000).toFixed(1)}s`}
              tone="default"
              caption={`via ${data.meta.provider}`}
            />
          </div>

          <SectionCard title={`Results (${data.rows.length} keywords)`} actions={<span style={{ fontSize: 11, color: "var(--muted)" }}>Sort, filter, export CSV — all visible columns</span>}>
            <FilterableTable<BulkKeywordRow>
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.keyword}
              pageSize={100}
              itemLabel="keyword"
              exportFilename={`bulk-keywords-${data.region}`}
            />
          </SectionCard>
        </motion.div>
      )}
    </PageShell>
  );
}
