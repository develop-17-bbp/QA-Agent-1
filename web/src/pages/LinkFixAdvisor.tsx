import { useEffect, useMemo, useState } from "react";
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

export default function LinkFixAdvisor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<HealthRunMeta[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>(searchParams.get("runId") ?? "");
  const [links, setLinks] = useState<BrokenLinkRow[] | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [error, setError] = useState("");
  const [fixes, setFixes] = useState<Map<string, string>>(new Map());
  const [fixing, setFixing] = useState(false);
  const [filter, setFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);

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
    setVisibleCount(100);
    fetchBrokenLinks(selectedRunId)
      .then((r) => setLinks(r.links))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingLinks(false));
  }, [selectedRunId]);

  const filtered = useMemo(() => {
    if (!links) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => `${l.siteHostname} ${l.foundOn} ${l.target} ${l.error ?? ""}`.toLowerCase().includes(q));
  }, [links, filter]);

  /**
   * Runs the AI fix-suggestions endpoint against a specific slice of links
   * (what's currently visible). Pagination lets the user process a huge
   * broken-link haul in 100-at-a-time batches instead of hammering Ollama
   * with 500+ prompts in one go.
   */
  const runAiFixes = async () => {
    if (!filtered || filtered.length === 0) return;
    const batch = filtered.slice(0, visibleCount);
    setFixing(true);
    setError("");
    try {
      const input = batch.map((l) => ({ foundOn: l.foundOn, target: l.target, status: l.status, error: l.error, anchorText: l.anchorText, linkContext: l.linkContext }));
      const { recommendations } = await fetchLinkFixRecommendations(input);
      const map = new Map(fixes);
      for (let i = 0; i < batch.length; i++) {
        const rec = recommendations[i]?.recommendation ?? "";
        if (rec) map.set(keyFor(batch[i]!), rec);
      }
      setFixes(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFixing(false);
    }
  };

  const loadMore = () => setVisibleCount((v) => v + 100);
  const fixedCount = fixes.size;
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;
  const pendingFixesInView = visible.filter((l) => !fixes.has(keyFor(l))).length;

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="qa-page-title">Link Fix Advisor</h1>
        <p className="qa-page-desc" style={{ marginBottom: 18 }}>
          Every broken link the crawler found, with the exact page where it appeared. Click <strong>Get AI fix suggestions</strong> and
          the local LLM writes one actionable sentence per link — redirect, remove, fix typo, contact owner, etc.
        </p>
      </motion.div>

      <div
        className="qa-panel"
        style={{
          padding: 16,
          display: "grid",
          gridTemplateColumns: "minmax(240px, 2fr) minmax(180px, 1fr) auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 18,
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
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
          Filter
          <input className="qa-input" placeholder="Search site, URL, error…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: "8px 12px" }} />
        </label>
        <button
          className="qa-btn-primary"
          onClick={runAiFixes}
          disabled={fixing || !links || pendingFixesInView === 0}
          style={{ padding: "10px 20px", whiteSpace: "nowrap" }}
          title={filtered.length > visibleCount ? "Only the currently visible batch is sent to the LLM — click 'Load next 100' to process more." : ""}
        >
          {fixing
            ? "Thinking…"
            : pendingFixesInView === 0
              ? "All visible fixed ✓"
              : `Get AI fix suggestions (${pendingFixesInView})`}
        </button>
      </div>

      {error && <ErrorBanner error={error} />}

      <AnimatePresence mode="wait">
        {loadingLinks && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="qa-loading-panel" style={{ padding: 40 }}>
            <span className="qa-spinner qa-spinner--lg" />
            <div style={{ marginTop: 12, color: "var(--muted)" }}>Loading broken links…</div>
          </motion.div>
        )}

        {!loadingLinks && links && links.length === 0 && (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="qa-panel" style={{ padding: 30, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "var(--ok)", fontWeight: 600 }}>No broken links in this run</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Every internal link resolved successfully.</div>
          </motion.div>
        )}

        {!loadingLinks && filtered.length > 0 && (
          <motion.div key="table" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
              <span>
                Showing <strong style={{ color: "var(--text)" }}>{visible.length}</strong> of {filtered.length} broken link{filtered.length === 1 ? "" : "s"}
                {links && filtered.length !== links.length && <span> ({links.length} before filter)</span>}
                {fixedCount > 0 && <span style={{ marginLeft: 10 }}>· <strong style={{ color: "var(--ok)" }}>{fixedCount}</strong> with AI fix</span>}
              </span>
              <span style={{ fontSize: 11 }}>Origin = page where the broken link appears</span>
            </div>
            <div className="qa-panel" style={{ padding: 0, overflow: "hidden" }}>
              <table className="qa-table">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Site</th>
                    <th>Found on (origin page)</th>
                    <th>Broken target</th>
                    <th style={{ width: 70 }}>HTTP</th>
                    <th style={{ minWidth: 260 }}>Anchor / HTML / AI fix</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l, i) => {
                    const rec = fixes.get(keyFor(l));
                    const originIsPlaceholder = l.foundOn.startsWith("(") && l.foundOn.endsWith(")");
                    return (
                      <motion.tr
                        key={keyFor(l) + i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.01, 0.3) }}
                      >
                        <td style={{ fontWeight: 600, wordBreak: "break-all" }}>{l.siteHostname}</td>
                        <td style={{ wordBreak: "break-all" }}>
                          {originIsPlaceholder ? (
                            <span style={{ color: "var(--muted)", fontSize: 12, fontStyle: "italic" }}>{l.foundOn}</span>
                          ) : (
                            <a href={l.foundOn} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "none", fontSize: 12 }}>
                              {l.foundOn}
                            </a>
                          )}
                        </td>
                        <td style={{ wordBreak: "break-all" }}>
                          <a href={l.target} target="_blank" rel="noreferrer" style={{ color: "#dc2626", fontSize: 12, textDecoration: "underline" }}>
                            {l.target}
                          </a>
                        </td>
                        <td>
                          <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 6, background: statusColor(l), color: "#fff", fontSize: 11, fontWeight: 700 }}>
                            {statusLabel(l)}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {l.anchorText && (
                              <div style={{ fontSize: 12, color: "var(--text)" }}>
                                <span style={{ color: "var(--muted)", fontSize: 10.5, marginRight: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>Anchor</span>
                                <span style={{ fontWeight: 600 }}>"{l.anchorText}"</span>
                              </div>
                            )}
                            {l.linkContext && (
                              <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.4 }}>
                                …{l.linkContext}…
                              </div>
                            )}
                            {l.outerHtml && (
                              <details style={{ fontSize: 11 }}>
                                <summary style={{ cursor: "pointer", color: "var(--muted)" }}>HTML snippet</summary>
                                <pre style={{ margin: "6px 0 0", padding: 8, background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
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
                                <span style={{ background: "#16a34a", color: "#fff", padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>AI FIX</span>
                                <span>{rec}</span>
                              </motion.div>
                            ) : !l.anchorText && !l.linkContext && !l.outerHtml ? (
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>{l.error ?? "—"}</span>
                            ) : null}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <button
                  className="qa-btn-ghost"
                  onClick={loadMore}
                  style={{ padding: "8px 24px", fontSize: 13 }}
                >
                  Load next 100 ({filtered.length - visibleCount} more)
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
