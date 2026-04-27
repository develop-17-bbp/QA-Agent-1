import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner } from "../components/UI";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";

interface AlertAdvice {
  synthesis: string;
  verdicts: Record<string, string>;
  model: string;
  durationMs: number;
}

interface AlertRecord {
  id: string;
  kind: "rank-drop" | "rank-gain" | "backlink-drop" | "backlink-gain";
  severity: "info" | "warn" | "critical";
  target: string;
  summary: string;
  delta: number;
  before?: number;
  after?: number;
  firedAt: string;
  webhookStatus?: "ok" | "skipped" | "failed";
  advice?: AlertAdvice | null;
}

const ADVISOR_LABELS: Record<string, string> = {
  content:     "Content",
  technical:   "Technical",
  competitive: "Competitive",
  performance: "Performance",
};

const KIND_META: Record<AlertRecord["kind"], { icon: string; label: string; color: string }> = {
  "rank-drop":     { icon: "📉", label: "Rank drop",     color: "#dc2626" },
  "rank-gain":     { icon: "📈", label: "Rank gain",     color: "#16a34a" },
  "backlink-drop": { icon: "🔻", label: "Backlink loss", color: "#b45309" },
  "backlink-gain": { icon: "🔗", label: "Backlink gain", color: "#0ea5e9" },
};

const SEVERITY_BG: Record<AlertRecord["severity"], string> = {
  info:     "#f1f5f9",
  warn:     "#fef3c7",
  critical: "#fef2f2",
};

export default function Alerts() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [lastRunSummary, setLastRunSummary] = useState<{ rankPairs: number; backlinkDomains: number; fired: number } | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { alerts: AlertRecord[] };
      setAlerts(data.alerts);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const runCheck = async () => {
    setRunning(true); setError("");
    try {
      const res = await fetch("/api/alerts/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { checked: { rankPairs: number; backlinkDomains: number }; fired: AlertRecord[] };
      setLastRunSummary({ rankPairs: data.checked.rankPairs, backlinkDomains: data.checked.backlinkDomains, fired: data.fired.length });
      void load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const counts = {
    critical: alerts.filter((a) => a.severity === "critical").length,
    warn: alerts.filter((a) => a.severity === "warn").length,
    rankDrops: alerts.filter((a) => a.kind === "rank-drop").length,
    backlinkDrops: alerts.filter((a) => a.kind === "backlink-drop").length,
  };

  return (
    <PageShell
      title="Alerts"
      desc="Automatic detection of rank drops (>3 positions on any tracked keyword) and backlink losses (>10 referring domains) — fires webhooks when ALERT_WEBHOOK_URL is configured."
      purpose="I want to know when a tracked keyword drops 5+ positions overnight, or when a domain loses a chunk of referring domains — without manually checking the dashboard."
      sources={["Position DB history", "Ahrefs WMT CSV", "Background ticker (every 15 min)"]}
      actions={
        <button onClick={runCheck} disabled={running} className="qa-btn-primary" style={{ padding: "8px 18px", fontWeight: 700 }}>
          {running ? "Checking…" : "Run check now"}
        </button>
      }
    >
      {error && <ErrorBanner error={error} />}
      {lastRunSummary && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #86efac", fontSize: 12.5, marginBottom: 14 }}>
          Last check: scanned {lastRunSummary.rankPairs} keyword{lastRunSummary.rankPairs === 1 ? "" : "s"} + {lastRunSummary.backlinkDomains} backlink domain{lastRunSummary.backlinkDomains === 1 ? "" : "s"}. Fired {lastRunSummary.fired} new alert{lastRunSummary.fired === 1 ? "" : "s"}.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
        {loading ? (
          <>
            <MetricCardSkeleton tone="bad" />
            <MetricCardSkeleton tone="warn" />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Critical" value={counts.critical} tone="bad" caption="action-required" />
            <MetricCard label="Warnings" value={counts.warn} tone="warn" caption="worth reviewing" />
            <MetricCard label="Rank drops" value={counts.rankDrops} tone={counts.rankDrops > 0 ? "warn" : "ok"} caption="all severities" />
            <MetricCard label="Backlink losses" value={counts.backlinkDrops} tone={counts.backlinkDrops > 0 ? "warn" : "ok"} caption="all severities" />
          </>
        )}
      </div>

      <SectionCard
        title={`Recent alerts (${alerts.length})`}
        actions={
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Background ticker runs every 15 min · set <code>ALERT_WEBHOOK_URL</code> in /integrations for Slack/Teams
          </span>
        }
      >
        {alerts.length === 0 && !loading && (
          <EmptyState title="No alerts yet" hint="The background ticker runs every 15 minutes. You can also click 'Run check now' to trigger a manual scan." />
        )}
        {alerts.map((a) => {
          const meta = KIND_META[a.kind];
          return (
            <motion.div
              key={a.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                padding: 12, border: `1px solid ${a.severity === "critical" ? "#fecaca" : a.severity === "warn" ? "#fcd34d" : "var(--border)"}`,
                background: SEVERITY_BG[a.severity],
                borderRadius: 8, marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span aria-hidden style={{ fontSize: 16 }}>{meta.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 10, background: "#fff", color: meta.color, textTransform: "uppercase" }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: a.severity === "critical" ? "#fef2f2" : a.severity === "warn" ? "#fef3c7" : "#f1f5f9", color: a.severity === "critical" ? "#991b1b" : a.severity === "warn" ? "#92400e" : "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>
                  {a.severity}
                </span>
                <div style={{ flex: 1, fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{a.summary}</div>
                <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(a.firedAt).toLocaleString()}</span>
                {a.webhookStatus && (
                  <span title={`Webhook: ${a.webhookStatus}`} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: a.webhookStatus === "ok" ? "#dcfce7" : a.webhookStatus === "failed" ? "#fef2f2" : "#f1f5f9", color: a.webhookStatus === "ok" ? "#166534" : a.webhookStatus === "failed" ? "#991b1b" : "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {a.webhookStatus}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                target: <code>{a.target}</code>
              </div>
              {a.advice && (
                <div
                  className="qa-panel"
                  style={{
                    marginTop: 10,
                    padding: 10,
                    background: "var(--grad-agentic-soft)",
                    borderColor: "var(--accent-muted)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--accent)" }}>
                      🧠 Council advice
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>
                      {a.advice.model} · {a.advice.durationMs}ms
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5, marginBottom: 8 }}>
                    {a.advice.synthesis}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.entries(a.advice.verdicts).map(([id, v]) => (
                      <details
                        key={id}
                        style={{
                          fontSize: 11,
                          padding: "4px 10px",
                          borderRadius: 12,
                          background: "#fff",
                          border: "1px solid var(--accent-muted)",
                          color: "var(--text)",
                        }}
                      >
                        <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--accent)" }}>
                          {ADVISOR_LABELS[id] ?? id}
                        </summary>
                        <div style={{ fontSize: 11.5, marginTop: 4, color: "var(--text-secondary)", maxWidth: 360 }}>{v}</div>
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </SectionCard>
    </PageShell>
  );
}
