import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
  fetchBrokenLinks,
  fetchHistory,
  fetchLinkFixRecommendations,
  type BrokenLinkRow,
  type HealthRunMeta,
} from "../api";
import { ErrorBanner } from "../components/UI";
import { FilterableTable, type FilterableColumn } from "../components/FilterableTable";
import { PageShell, EmptyState } from "../components/PageUI";

function keyFor(l: BrokenLinkRow): string {
  return `${l.siteHostname}|${l.foundOn}|${l.target}|${l.status ?? 0}`;
}

function statusLabel(l: BrokenLinkRow): string {
  if (l.status) return String(l.status);
  if (l.error && /timeout|aborted/i.test(l.error)) return "Timeout";
  return "Network";
}

function statusColor(l: BrokenLinkRow): string {
  if (!l.status) return "#94a3b8";
  if (l.status >= 500) return "#7c2d12";
  if (l.status >= 400) return "#dc2626";
  if (l.status >= 300) return "#d97706";
  return "#94a3b8";
}

/**
 * Coarse category for the Error Type select filter. Keeps the dropdown short
 * (5 choices) regardless of how many distinct error strings the crawl produced.
 */
function errorCategory(l: BrokenLinkRow): string {
  if (l.status && l.status >= 500) return "5xx server error";
  if (l.status === 404) return "404 not found";
  if (l.status === 410) return "410 gone";
  if (l.status && l.status >= 400) return "4xx client error";
  if (l.status && l.status >= 300) return "3xx redirect";
  if (l.error && /timeout|aborted/i.test(l.error)) return "Timeout";
  if (l.error) return "Network error";
  return "Other";
}

export default function LinkFixAdvisor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<HealthRunMeta[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>(searchParams.get("runId") ?? "");
  const [links, setLinks] = useState<BrokenLinkRow[] | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [error, setError] = useState("");
  const [fixes, setFixes] = useState<Map<string, string>>(new Map());
  const [fixing, setFixing] = useState(false);
  const [visibleRows, setVisibleRows] = useState<BrokenLinkRow[]>([]);

  useEffect(() => {
    fetchHistory().then((h) => {
      const flat: HealthRunMeta[] = [];
      for (const d of h.days) for (const r of d.runs) flat.push(r);
      setRuns(flat);
      if (!selectedRunId && flat.length > 0) setSelectedRunId(flat[0]!.runId);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    setSearchParams({ runId: selectedRunId });
    setLoadingLinks(true);
    setLinks(null);
    setFixes(new Map());
    setError("");
    fetchBrokenLinks(selectedRunId)
      .then((r) => setLinks(r.links))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingLinks(false));
  }, [selectedRunId]);

  const runAiFixes = async () => {
    if (visibleRows.length === 0) return;
    setFixing(true);
    setError("");
    try {
      const input = visibleRows.map((l) => ({
        foundOn: l.foundOn,
        target: l.target,
        status: l.status,
        error: l.error,
        anchorText: l.anchorText,
        linkContext: l.linkContext,
      }));
      const { recommendations } = await fetchLinkFixRecommendations(input);
      const map = new Map(fixes);
      for (let i = 0; i < visibleRows.length; i++) {
        const rec = recommendations[i]?.recommendation ?? "";
        if (rec) map.set(keyFor(visibleRows[i]!), rec);
      }
      setFixes(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFixing(false);
    }
  };

  const pendingFixesInView = visibleRows.filter((l) => !fixes.has(keyFor(l))).length;

  const columns: FilterableColumn<BrokenLinkRow>[] = useMemo(() => [
    {
      key: "siteHostname",
      label: "Site",
      accessor: (l) => l.siteHostname,
      filterType: "select",
      width: 140,
      render: (l) => <span style={{ fontWeight: 600, wordBreak: "break-all" }}>{l.siteHostname}</span>,
    },
    {
      key: "foundOn",
      label: "Found on (origin page)",
      accessor: (l) => l.foundOn,
      filterType: "text",
      render: (l) => {
        const placeholder = l.foundOn.startsWith("(") && l.foundOn.endsWith(")");
        return placeholder ? (
          <span style={{ color: "var(--muted)", fontSize: 12, fontStyle: "italic", wordBreak: "break-all" }}>{l.foundOn}</span>
        ) : (
          <a
            href={l.foundOn}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--text)", textDecoration: "none", fontSize: 12, wordBreak: "break-all" }}
          >
            {l.foundOn}
          </a>
        );
      },
    },
    {
      key: "target",
      label: "Broken target",
      accessor: (l) => l.target,
      filterType: "text",
      render: (l) => (
        <a
          href={l.target}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#dc2626", fontSize: 12, textDecoration: "underline", wordBreak: "break-all" }}
        >
          {l.target}
        </a>
      ),
    },
    {
      key: "status",
      label: "HTTP",
      accessor: (l) => l.status ?? null,
      filterType: "number",
      width: 90,
      render: (l) => (
        <span
          style={{
            display: "inline-block",
            padding: "2px 9px",
            borderRadius: 6,
            background: statusColor(l),
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {statusLabel(l)}
        </span>
      ),
    },
    {
      key: "errorCategory",
      label: "Error type",
      accessor: (l) => errorCategory(l),
      filterType: "select",
      width: 150,
      render: (l) => <span style={{ fontSize: 12, color: "var(--muted)" }}>{errorCategory(l)}</span>,
    },
    {
      key: "anchorText",
      label: "Anchor text",
      accessor: (l) => l.anchorText ?? "",
      filterType: "text",
      width: 180,
      render: (l) => (l.anchorText ? <span style={{ fontSize: 12, fontWeight: 600 }}>"{l.anchorText}"</span> : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>),
    },
    {
      key: "details",
      label: "Context / HTML / AI fix",
      accessor: (l) => l.linkContext ?? "",
      filterType: "none",
      unsortable: true,
      render: (l) => {
        const rec = fixes.get(keyFor(l));
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {l.linkContext && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.4 }}>
                …{l.linkContext}…
              </div>
            )}
            {l.outerHtml && (
              <details style={{ fontSize: 11 }}>
                <summary style={{ cursor: "pointer", color: "var(--muted)" }}>HTML snippet</summary>
                <pre
                  style={{
                    margin: "6px 0 0",
                    padding: 8,
                    background: "#f8fafc",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    fontSize: 11,
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {l.outerHtml}
                </pre>
              </details>
            )}
            {rec ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.5, color: "var(--text)" }}
              >
                <span style={{ background: "#16a34a", color: "#fff", padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                  AI FIX
                </span>
                <span>{rec}</span>
              </motion.div>
            ) : !l.anchorText && !l.linkContext && !l.outerHtml ? (
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{l.error ?? "—"}</span>
            ) : null}
          </div>
        );
      },
    },
  ], [fixes]);

  const fixedCount = fixes.size;

  const handleVisibleRowsChange = useCallback((rows: BrokenLinkRow[]) => {
    setVisibleRows(rows);
  }, []);

  return (
    <PageShell
      title="Link Fix Advisor"
      desc={<>Every broken link the crawler found, with the exact page where it appeared. Click <strong>Get AI fix suggestions</strong> and the local LLM writes one actionable sentence per link — redirect, remove, fix typo, contact owner, etc.</>}
      purpose="Every broken link on your site + one-line AI recommendations for what to do."
      sources={["Crawl", "Ollama"]}
    >
      <div
        className="qa-panel"
        style={{
          padding: 16,
          display: "grid",
          gridTemplateColumns: "minmax(240px, 2fr) auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 14,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          Run
          <select className="qa-input" value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)} style={{ padding: "8px 12px" }}>
            {runs.length === 0 && <option value="">No runs yet</option>}
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.runId} · {r.totalSites ?? 0} site{r.totalSites === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <button
          className="qa-btn-primary"
          onClick={runAiFixes}
          disabled={fixing || !links || pendingFixesInView === 0}
          style={{ padding: "10px 20px", whiteSpace: "nowrap" }}
          title="Only the currently visible page is sent to the LLM — click 'Load next 100' to process more."
        >
          {fixing
            ? "Thinking…"
            : pendingFixesInView === 0
              ? "All visible fixed ✓"
              : `Get AI fix suggestions (${pendingFixesInView})`}
        </button>
      </div>

      {fixedCount > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
          <strong style={{ color: "var(--ok)" }}>{fixedCount}</strong> link{fixedCount === 1 ? "" : "s"} with AI fix so far
        </div>
      )}

      {error && <ErrorBanner error={error} />}

      <AnimatePresence mode="wait">
        {loadingLinks && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="qa-loading-panel"
            style={{ padding: 40 }}
          >
            <span className="qa-spinner qa-spinner--lg" />
            <div style={{ marginTop: 12, color: "var(--muted)" }}>Loading broken links…</div>
          </motion.div>
        )}

        {!loadingLinks && links && links.length === 0 && (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <EmptyState
              icon="✓"
              title="No broken links in this run"
              hint="Every internal link resolved successfully."
            />
          </motion.div>
        )}

        {!loadingLinks && links && links.length > 0 && (
          <motion.div key="table" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <FilterableTable<BrokenLinkRow>
              rows={links}
              columns={columns}
              rowKey={keyFor}
              pageSize={100}
              itemLabel="broken link"
              exportFilename="broken-links"
              onVisibleRowsChange={handleVisibleRowsChange}
              emptyMessage="No broken links match the current filters."
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PageShell>
  );
}
