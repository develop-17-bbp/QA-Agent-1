import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHistory, streamUrl, type HealthRunMeta } from "../api";
import JobCard from "../components/JobCard";
import type { HealthSsePayload } from "../types/healthSse";

export default function RunHistory() {
  const [days, setDays] = useState<{ date: string; runs: HealthRunMeta[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await fetchHistory();
      setDays(h.days);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const es = new EventSource(streamUrl());
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as HealthSsePayload;
        if (data.type === "run_complete") void load();
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [load]);

  const totalRuns = useMemo(() => days.reduce((n, d) => n + d.runs.length, 0), [days]);

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="qa-page-title">Run history</h1>
        <p className="qa-page-desc">
          Every completed run lists start/end times, wall duration, and per-site stats. Expand a row for report links, PDF downloads,
          and the full workspace.
        </p>
      </motion.div>

      {err ? (
        <p style={{ color: "var(--bad)", marginTop: 24 }}>{err}</p>
      ) : null}

      <h2 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "24px 0 14px", color: "var(--muted)" }}>
        Activity · {totalRuns} run{totalRuns === 1 ? "" : "s"}
      </h2>

      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      ) : days.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No runs yet. Start one from <strong>Dashboard</strong>.</p>
      ) : (
        days.map((day) => (
          <div key={day.date} style={{ marginBottom: 36 }}>
            <motion.h3
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="qa-nav-section"
              style={{ margin: "0 0 12px" }}
            >
              {day.date}
            </motion.h3>
            <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
              {day.runs.map((run) => (
                <JobCard key={run.runId} run={run} />
              ))}
            </motion.div>
          </div>
        ))
      )}
    </div>
  );
}
