import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { startRun, streamUrl, fetchHistory, fetchLlmStats } from "../api";
import type { HealthSsePayload } from "../types/healthSse";
import OptionWithTooltip from "../components/OptionWithTooltip";
import RunProgressBanner, { type RunBannerState } from "../components/RunProgressBanner";
import { DataSourceLegend } from "../components/AppLayout";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { PageHero } from "../components/PageHero";

export default function Dashboard({ initialUrls }: { initialUrls?: string }) {
  const [urlsText, setUrlsText] = useState(initialUrls ?? "");
  const [runBanner, setRunBanner] = useState<RunBannerState>({ kind: "idle" });
  const [pageSpeedBoth, setPageSpeedBoth] = useState(true);
  const [viewportCheck, setViewportCheck] = useState(true);
  const [aiSummary, setAiSummary] = useState(true);
  const [seoAudit, setSeoAudit] = useState(false);
  const [smartAnalysis, setSmartAnalysis] = useState(false);
  const maxPages = 0;
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialUrls) setUrlsText(initialUrls);
  }, [initialUrls]);

  useEffect(() => {
    if (runBanner.kind !== "success" && runBanner.kind !== "error") return;
    const ms = runBanner.kind === "success" ? 3200 : 9000;
    const t = window.setTimeout(() => setRunBanner({ kind: "idle" }), ms);
    return () => window.clearTimeout(t);
  }, [runBanner]);

  useEffect(() => {
    const es = new EventSource(streamUrl());
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as HealthSsePayload;
        switch (data.type) {
          case "run_start": {
            const firstHost = data.sites?.[0]?.hostname ?? "…";
            setRunBanner({
              kind: "live",
              runId: data.runId,
              startedAt: data.startedAt ?? new Date().toISOString(),
              totalSites: data.totalSites,
              sitesDone: 0,
              currentIndex: 1,
              currentHostname: firstHost,
              lastDetail: `Queued ${data.totalSites} site(s) — starting…`,
            });
            break;
          }
          case "site_start":
            setRunBanner((prev) => {
              if (prev.kind !== "live" || prev.runId !== data.runId) return prev;
              return {
                ...prev,
                currentIndex: data.index,
                currentHostname: data.hostname,
                lastDetail: `Crawling ${data.hostname}…`,
              };
            });
            break;
          case "site_complete":
            setRunBanner((prev) => {
              if (prev.kind !== "live" || prev.runId !== data.runId) return prev;
              return {
                ...prev,
                sitesDone: prev.sitesDone + 1,
                currentIndex: data.index,
                currentHostname: data.hostname,
                lastDetail: `Finished ${data.hostname}: ${data.pagesVisited} pages crawled · ${data.brokenLinks} broken link rows`,
              };
            });
            break;
          case "site_error":
            setRunBanner((prev) => {
              if (prev.kind !== "live" || prev.runId !== data.runId) return prev;
              return {
                ...prev,
                lastDetail: `Error on ${data.hostname}: ${data.message}`,
              };
            });
            break;
          case "run_complete":
            setRunBanner({
              kind: "success",
              runId: data.runId,
              siteFailures: data.siteFailures,
              totalSites: data.totalSites,
              endedAt: data.endedAt,
              durationMs: data.durationMs,
            });
            break;
          case "run_error":
            setErr(data.message);
            setRunBanner({ kind: "error", message: data.message });
            break;
          default:
            break;
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  const runInFlight =
    runBanner.kind === "posting" || runBanner.kind === "queued" || runBanner.kind === "live";

  const onStart = async () => {
    setErr(null);
    setRunBanner({ kind: "posting" });
    try {
      await startRun({
        urlsText,
        pageSpeedBoth,
        viewportCheck,
        aiSummary,
        seoAudit,
        smartAnalysis,
        maxPages,
      });
      setRunBanner((b) => {
        if (b.kind === "live") return b;
        return { kind: "queued" };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setRunBanner({ kind: "error", message: msg });
    }
  };

  const formDimmed = runBanner.kind === "live";

  return (
    <div>
      <PageHero
        icon="home"
        category="workspace"
        eyebrow="SEO Intelligence"
        title="Start a New Crawl"
        subtitle="Enter any website URL to crawl, audit, and analyze. Data flows automatically through site audit, keyword research, backlinks, and SEO checks."
        actions={
          <>
            <Link to="/url-report" className="qa-btn-default" style={{ gap: 6 }}>
              ⚡ URL Report
            </Link>
            <Link to="/history" className="qa-btn-default" style={{ gap: 6 }}>
              📋 Run History
            </Link>
          </>
        }
        accent
      />

      {/* ── Data-source legend (always visible so SEO teammates know what the nav dots mean) ──────── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        style={{ marginBottom: 22 }}
      >
        <DataSourceLegend />
      </motion.div>

      {/* ── New-flagship quick-start tiles ─────────────────────────────── */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } } }}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 22 }}
      >
        {[
          { to: "/keyword-impact", icon: "◎", title: "Keyword Impact Predictor", desc: "URL + keyword → metrics, recommendations, projections — all grounded in real providers.", accent: "#111" },
          { to: "/link-fix-advisor", icon: "⚙", title: "Link Fix Advisor", desc: "Every broken link with its origin + an AI one-line remediation.", accent: "#16a34a" },
          { to: "/form-tests", icon: "▣", title: "Form & Flow Tests", desc: "Playwright smoke tests for contact forms and chat handoffs.", accent: "#475569" },
        ].map((tile) => (
          <motion.div
            key={tile.to}
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } }}
            whileHover={{ y: -3, transition: { duration: 0.18 } }}
          >
            <Link
              to={tile.to}
              style={{
                display: "block",
                padding: 18,
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                textDecoration: "none",
                color: "inherit",
                position: "relative",
                overflow: "hidden",
                height: "100%",
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              }}
            >
              <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${tile.accent}08, transparent 60%)`, pointerEvents: "none" }} />
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: tile.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{tile.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: tile.accent, letterSpacing: "0.1em", textTransform: "uppercase" }}>New</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 4 }}>{tile.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{tile.desc}</div>
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: tile.accent, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Open <span style={{ fontSize: 13 }}>→</span>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      <RunProgressBanner state={runBanner} />

      <motion.section
        className="qa-panel"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: formDimmed ? 0.75 : 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{ padding: "0", overflow: "hidden" }}
      >
        <div style={{ padding: "18px 24px 16px", borderBottom: "1px solid var(--border)", background: "var(--glass2)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>🔍</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Crawl Configuration</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
              Paste root URLs, choose analysis options, and start a run.
            </div>
          </div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <label className="qa-label-field">Root URLs — one per line</label>
          <textarea
            className="qa-textarea"
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={"https://www.example.com\nhttps://www.another.org"}
            rows={5}
            disabled={runInFlight}
            style={{
              width: "100%", resize: "vertical",
              padding: "12px 14px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.8125rem", lineHeight: 1.55,
              borderRadius: "var(--radius-sm)",
              opacity: runInFlight ? 0.8 : 1,
            }}
          />

          <div style={{ marginTop: 18, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>
              Optional post-crawl analysis
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {[
                { checked: pageSpeedBoth, setter: setPageSpeedBoth, label: "PageSpeed (mobile + desktop)", hint: "Calls Google PageSpeed Insights for each page. Requires PAGESPEED_API_KEY." },
                { checked: viewportCheck, setter: setViewportCheck, label: "Viewport smoke test", hint: "Opens each URL in headless Chromium at phone and desktop sizes." },
                { checked: aiSummary, setter: setAiSummary, label: "AI summary (Ollama)", hint: "Local LLM generates an executive summary. Requires Ollama running." },
                { checked: seoAudit, setter: setSeoAudit, label: "SEO URL audit", hint: "Discovers sitemaps, checks 404s/redirects, classifies URLs with LLM." },
                { checked: smartAnalysis, setter: setSmartAnalysis, label: "Smart analysis", hint: "Ollama analyzes results and generates prioritized fix recommendations." },
              ].map(({ checked, setter, label, hint }) => (
                <OptionWithTooltip key={label} hint={hint}>
                  <label style={{
                    display: "flex", gap: 8, alignItems: "center",
                    cursor: runInFlight ? "default" : "pointer",
                    fontSize: 13.5, color: "var(--text-secondary)",
                    padding: "8px 12px",
                    border: `1px solid ${checked ? "var(--accent-muted)" : "var(--border)"}`,
                    borderRadius: "var(--radius-sm)",
                    background: checked ? "var(--accent-light)" : "var(--glass)",
                    transition: "background 0.12s, border-color 0.12s",
                  }}>
                    <input type="checkbox" checked={checked} disabled={runInFlight} onChange={(e) => setter(e.target.checked)} />
                    {label}
                  </label>
                </OptionWithTooltip>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <motion.button
              type="button"
              className="qa-btn-primary"
              whileTap={{ scale: runInFlight ? 1 : 0.98 }}
              onClick={() => void onStart()}
              disabled={runInFlight || !urlsText.trim()}
              style={{ padding: "10px 24px", fontSize: 14 }}
            >
              {runBanner.kind === "posting" ? "⏳ Sending…"
               : runBanner.kind === "queued" ? "⏳ Starting…"
               : runBanner.kind === "live" ? "⚡ Run in progress…"
               : "▶ Start run"}
            </motion.button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Large sites: disable PageSpeed for faster crawls
            </span>
          </div>
        </div>
      </motion.section>

      {err && <div className="qa-alert qa-alert--error" style={{ marginTop: 14 }}>⚠ {err}</div>}

      <QuickStartCards />
      <SystemHealth />
    </div>
  );
}

// ── Quick-start cards ────────────────────────────────────────────────────────

const FEATURE_CARDS = [
  { title: "URL Report",       desc: "Full parallel report for any URL", path: "/url-report",        icon: "⚡", color: "#2563eb" },
  { title: "Site Audit",       desc: "Health score + issue breakdown",   path: "/site-audit",         icon: "🔍", color: "#16a34a" },
  { title: "Keyword Magic",    desc: "Discover & analyze keywords",       path: "/keyword-magic-tool", icon: "🔑", color: "#7c3aed" },
  { title: "SERP Analyzer",   desc: "Live search result analysis",       path: "/serp-analyzer",      icon: "📊", color: "#d97706" },
  { title: "Backlinks",        desc: "Full link profile analysis",        path: "/backlinks",          icon: "🔗", color: "#0284c7" },
  { title: "Agentic Crawl",   desc: "Multi-agent AI intelligence",       path: "/agentic-crawl",      icon: "🤖", color: "#dc2626" },
] as const;

function QuickStartCards() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1 }}
      style={{ marginTop: 24 }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 14 }}>
        Quick Access
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {FEATURE_CARDS.map((c) => (
          <Link
            key={c.path}
            to={c.path}
            style={{ textDecoration: "none" }}
          >
            <div style={{
              background: "var(--glass)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "16px 18px",
              cursor: "pointer",
              transition: "box-shadow 0.15s, border-color 0.15s, transform 0.15s",
              height: "100%",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-md)";
              (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent-muted)";
              (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.boxShadow = "";
              (e.currentTarget as HTMLDivElement).style.borderColor = "";
              (e.currentTarget as HTMLDivElement).style.transform = "";
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: "var(--radius-sm)",
                background: c.color + "14",
                border: `1px solid ${c.color}28`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, marginBottom: 12,
              }}>
                {c.icon}
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text)", marginBottom: 3 }}>{c.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>{c.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </motion.section>
  );
}

// ── System health indicator ──────────────────────────────────────────────────

function SystemHealth() {
  const [stats, setStats] = useState<{
    ollamaAvailable?: boolean;
    totalRequests?: number;
    fallbackCount?: number;
  } | null>(null);
  const [recentRuns, setRecentRuns] = useState<number | null>(null);
  const [runsTrend, setRunsTrend] = useState<number[]>([]);

  useEffect(() => {
    fetchLlmStats()
      .then((s: any) => setStats({
        ollamaAvailable: !!s.ollama?.available,
        totalRequests: s.totalRequests ?? 0,
        fallbackCount: s.fallbackCount ?? 0,
      }))
      .catch(() => {});
    fetchHistory()
      .then((h) => {
        const allRuns = h.days.flatMap((d) => d.runs);
        setRecentRuns(allRuns.length);
        // Build a per-day count sparkline for the last 14 days (oldest → newest).
        const byDay = new Map<string, number>();
        for (const d of h.days) byDay.set(d.date, d.runs.length);
        const today = new Date();
        const series: number[] = [];
        for (let i = 13; i >= 0; i--) {
          const dt = new Date(today);
          dt.setUTCDate(today.getUTCDate() - i);
          const key = dt.toISOString().slice(0, 10);
          series.push(byDay.get(key) ?? 0);
        }
        setRunsTrend(series);
      })
      .catch(() => {});
  }, []);

  const loaded = stats != null && recentRuns != null;
  const fallbackRate = stats && stats.totalRequests
    ? +((stats.fallbackCount ?? 0) / Math.max(1, stats.totalRequests) * 100).toFixed(1)
    : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.2 }}
      style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}
    >
      {!loaded ? (
        <>
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </>
      ) : (
        <>
          <MetricCard
            label="Local LLM"
            value={stats?.ollamaAvailable ? "Online" : "Offline"}
            tone={stats?.ollamaAvailable ? "ok" : "bad"}
            caption={stats?.ollamaAvailable ? "Ollama ready for inference" : "Start Ollama to enable AI features"}
            source="ollama"
          />
          <MetricCard
            label="Past Runs"
            value={recentRuns ?? 0}
            format="compact"
            sparkline={runsTrend.length ? runsTrend : undefined}
            tone="accent"
            caption="Last 14 days"
            source="history-db"
          />
          <MetricCard
            label="LLM Requests"
            value={stats?.totalRequests ?? 0}
            format="compact"
            delta={fallbackRate > 0 ? -fallbackRate : undefined}
            deltaLabel="fallback rate"
            tone={fallbackRate > 20 ? "warn" : "default"}
            caption={fallbackRate > 0 ? `${fallbackRate}% fell back to cloud` : "All served by local Ollama"}
            source="llm-router"
          />
          <MetricCard
            label="Integrations"
            value="Connect →"
            tone="accent"
            caption="Google, Bing, Yandex, Ahrefs + 9 more"
            onClick={() => { window.location.href = "/integrations"; }}
          />
        </>
      )}
    </motion.section>
  );
}
