import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Link } from "react-router-dom";
import { sitePdfUrl, siteReportHtmlUrl, type HealthRunMeta } from "../api";
import { formatDeviceDateTime, formatDurationMs } from "../lib/time";

type Props = {
  run: HealthRunMeta;
  defaultOpen?: boolean;
  /** When false, the title is plain text (e.g. already on the run workspace page). Default true. */
  titleNavigatesToRun?: boolean;
};

export default function JobCard({ run, defaultOpen, titleNavigatesToRun = true }: Props) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const fail = run.siteFailures > 0;

  const wall =
    run.durationMsTotal != null
      ? formatDurationMs(run.durationMsTotal)
      : run.startedAt
        ? formatDurationMs(new Date(run.generatedAt).getTime() - new Date(run.startedAt).getTime())
        : null;

  const headInner = (
    <div style={{ minWidth: 0 }}>
      {titleNavigatesToRun ? (
        <div style={{ fontWeight: 600, fontSize: "0.95rem", letterSpacing: "-0.02em" }}>{run.runId}</div>
      ) : null}
      <div
        style={{
          marginTop: titleNavigatesToRun ? 10 : 0,
          padding: "10px 12px",
          borderRadius: "var(--radius-sm)",
          background: "var(--glass2)",
          border: "1px solid var(--border)",
          fontSize: "0.75rem",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        <div>
          <span style={{ color: "var(--muted)", fontWeight: 600, marginRight: 8 }}>START</span>
          {run.startedAt ? formatDeviceDateTime(run.startedAt) : "—"}
        </div>
        <div>
          <span style={{ color: "var(--muted)", fontWeight: 600, marginRight: 8 }}>END</span>
          {formatDeviceDateTime(run.generatedAt)}
        </div>
        <div>
          <span style={{ color: "var(--muted)", fontWeight: 600, marginRight: 8 }}>WALL</span>
          <span style={{ color: "var(--ok)", fontWeight: 600 }}>{wall ?? "—"}</span>
          {run.totalSites ? (
            <span style={{ marginLeft: 10 }}>
              · {run.totalSites} site{run.totalSites === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
      {!titleNavigatesToRun ? (
        <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
          {run.urlsFile ? (
            <>
              <span style={{ fontWeight: 600 }}>{run.urlsSource}</span> · {run.urlsFile}
            </>
          ) : (
            <span>
              URLs · <span style={{ fontWeight: 600 }}>{run.urlsSource}</span>
            </span>
          )}
        </div>
      ) : null}
      {titleNavigatesToRun ? (
        <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 10 }}>
          {run.aiSummary?.skippedReason ? (
            <span style={{ color: "var(--bad)" }}>AI: {run.aiSummary.skippedReason}</span>
          ) : run.geminiSummaryHref ? (
            <span style={{ color: "var(--ok)" }}>AI summary</span>
          ) : null}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <span className={fail ? "qa-lozenge qa-lozenge--danger" : "qa-lozenge qa-lozenge--success"}>
          {fail ? "Issues" : "Clean"}
        </span>
        {run.features?.viewportCheck ? <span className="qa-lozenge qa-lozenge--neutral">Viewports</span> : null}
        {run.features?.pageSpeedStrategies?.length ? (
          <span className="qa-lozenge qa-lozenge--neutral">PSI {run.features.pageSpeedStrategies.join("+")}</span>
        ) : null}
      </div>
    </div>
  );

  return (
    <motion.article
      className="qa-panel"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
          gap: 0,
        }}
      >
        {titleNavigatesToRun ? (
          <Link
            to={`/run/${encodeURIComponent(run.runId)}`}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "left",
              textDecoration: "none",
              color: "inherit",
              display: "block",
              padding: "18px 8px 18px 20px",
            }}
          >
            {headInner}
          </Link>
        ) : (
          <div style={{ flex: 1, minWidth: 0, padding: "18px 20px" }}>{headInner}</div>
        )}
        {titleNavigatesToRun ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "Collapse run details" : "Expand run details"}
            style={{
              flexShrink: 0,
              width: 48,
              padding: "18px 12px",
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
            }}
          >
            <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ fontSize: "1.1rem" }}>
              ▾
            </motion.span>
          </button>
        ) : null}
      </div>
      {titleNavigatesToRun ? (
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28 }}
              style={{ overflow: "hidden", borderTop: "1px solid var(--border)" }}
            >
              <div style={{ padding: "16px 20px 20px", fontSize: "0.88rem" }}>
                <div style={{ marginBottom: 14 }}>
                  <Link to={`/run/${encodeURIComponent(run.runId)}`} className="qa-btn-primary" style={{ display: "inline-flex" }}>
                    Open workspace
                  </Link>
                  <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.45 }}>
                    Review reports, set site status, then download the final PDF from the workspace — not here.
                  </p>
                </div>
                <table className="qa-table">
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th>Pages</th>
                      <th>Broken</th>
                      <th>Crawl ms</th>
                      <th>Status</th>
                      <th>HTML</th>
                      <th>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.sites.map((s) => (
                      <tr key={s.hostname + s.startUrl}>
                        <td style={{ wordBreak: "break-all" }}>
                          <a
                            href={siteReportHtmlUrl(run.runId, s.reportHtmlHref)}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontWeight: 600, color: "var(--text)" }}
                          >
                            {s.hostname}
                          </a>
                        </td>
                        <td>{s.pagesVisited}</td>
                        <td>{s.brokenLinks}</td>
                        <td style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{s.durationMs}</td>
                        <td style={{ color: s.failed ? "var(--bad)" : "var(--ok)", fontWeight: 600 }}>
                          {s.failed ? "Issues" : "OK"}
                        </td>
                        <td>
                          <a href={siteReportHtmlUrl(run.runId, s.reportHtmlHref)} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </td>
                        <td>
                          <a href={sitePdfUrl(run.runId, s.reportHtmlHref, { download: true })} style={{ fontWeight: 600 }}>
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </motion.article>
  );
}
