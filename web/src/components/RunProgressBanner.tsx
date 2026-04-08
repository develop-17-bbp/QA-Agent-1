import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useElapsedMs } from "../hooks/useElapsedMs";
import { formatDeviceDateTime, formatDurationMs } from "../lib/time";

export type RunBannerState =
  | { kind: "idle" }
  | { kind: "posting" }
  | { kind: "queued" }
  | {
      kind: "live";
      runId: string;
      startedAt: string;
      totalSites: number;
      sitesDone: number;
      currentIndex: number;
      currentHostname: string;
      lastDetail?: string;
    }
  | {
      kind: "success";
      runId: string;
      siteFailures: number;
      totalSites: number;
      endedAt?: string;
      durationMs?: number;
    }
  | { kind: "error"; message: string };

type Props = {
  state: RunBannerState;
};

function Spinner() {
  return (
    <motion.span
      aria-hidden
      style={{
        display: "inline-block",
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: "2px solid var(--border)",
        borderTopColor: "var(--accent)",
      }}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.75, repeat: Infinity, ease: "linear" }}
    />
  );
}

function LiveElapsed({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedMs(startedAt, true);
  return (
    <div
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "0.8125rem",
        color: "var(--accent)",
        fontWeight: 600,
      }}
    >
      {formatDurationMs(elapsed)} elapsed
      <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: 10, fontSize: "0.75rem" }}>
        Started {formatDeviceDateTime(startedAt)}
      </span>
    </div>
  );
}

export default function RunProgressBanner({ state }: Props) {
  const active = state.kind !== "idle";

  return (
    <AnimatePresence mode="wait">
      {active ? (
        <motion.div
          key={state.kind === "live" ? state.runId + state.sitesDone : state.kind}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -6, height: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 24, overflow: "hidden" }}
        >
          <div
            className="qa-panel"
            style={{
              borderLeft: "4px solid var(--accent)",
              padding: "16px 20px",
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
            }}
          >
            <div style={{ paddingTop: 2 }}>
              {(state.kind === "posting" || state.kind === "queued" || state.kind === "live") && <Spinner />}
              {state.kind === "success" && (
                <span style={{ fontSize: "1.125rem", lineHeight: 1, color: "var(--ok)" }} aria-hidden>
                  ✓
                </span>
              )}
              {state.kind === "error" && (
                <span style={{ fontSize: "1.125rem", lineHeight: 1, color: "var(--bad)" }} aria-hidden>
                  !
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: 6, color: "var(--text)" }}>
                {state.kind === "posting" && "Sending run to server…"}
                {state.kind === "queued" && "Run accepted — starting workers…"}
                {state.kind === "live" && (
                  <>
                    Run in progress
                    <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: "0.8125rem", marginLeft: 8 }}>
                      {state.runId}
                    </span>
                  </>
                )}
                {state.kind === "success" && "Run finished"}
                {state.kind === "error" && "Run failed"}
              </div>
              {state.kind === "live" && (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <LiveElapsed startedAt={state.startedAt} />
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: "0.875rem", lineHeight: 1.45, marginBottom: 8 }}>
                    Site {state.currentIndex} of {state.totalSites}: <strong style={{ color: "var(--text)" }}>{state.currentHostname}</strong>
                    {state.lastDetail ? (
                      <span style={{ display: "block", marginTop: 4, fontSize: "0.8125rem" }}>{state.lastDetail}</span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      background: "var(--glass2)",
                      overflow: "hidden",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <motion.div
                      initial={{ width: "0%" }}
                      animate={{
                        width: `${(() => {
                          if (state.totalSites <= 0) return 5;
                          const pct = (state.sitesDone / state.totalSites) * 100;
                          return Math.min(100, Math.max(6, pct));
                        })()}%`,
                      }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                      style={{
                        height: "100%",
                        borderRadius: 2,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                    Crawl runs in the background. Open <strong>Run history</strong> when the run completes.
                  </p>
                </>
              )}
              {state.kind === "posting" && (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>Preparing your URL list…</p>
              )}
              {state.kind === "queued" && (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>Connecting to the live event stream…</p>
              )}
              {state.kind === "success" && (
                <div style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>
                  <p style={{ margin: "0 0 8px" }}>
                    {state.siteFailures > 0
                      ? `${state.siteFailures} of ${state.totalSites} site(s) reported issues.`
                      : `All ${state.totalSites} site(s) passed the checks we run.`}
                  </p>
                  {(state.durationMs != null || state.endedAt) && (
                    <p style={{ margin: 0, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.8125rem" }}>
                      {state.durationMs != null ? (
                        <span style={{ color: "var(--ok)", fontWeight: 600 }}>{formatDurationMs(state.durationMs)}</span>
                      ) : null}
                      {state.endedAt ? <span style={{ marginLeft: 12 }}>Ended {formatDeviceDateTime(state.endedAt)}</span> : null}
                    </p>
                  )}
                  <p style={{ margin: "10px 0 0" }}>
                    <Link to={`/run/${encodeURIComponent(state.runId)}`} style={{ fontWeight: 600 }}>
                      Open run workspace →
                    </Link>
                  </p>
                </div>
              )}
              {state.kind === "error" && (
                <p style={{ margin: 0, color: "var(--bad)", fontSize: "0.875rem", wordBreak: "break-word" }}>{state.message}</p>
              )}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
