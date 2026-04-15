import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { fetchGoogleAuthStatus, fetchLlmStats } from "../api";

/**
 * Data-honesty classification for every sidebar feature. Drives the colored
 * dot rendered next to each nav link so the user can see at a glance whether
 * a tool shows real numbers, LLM commentary, or a mix.
 *
 *   "real"     — every numeric field comes from a real signal (crawl, DDG SERP,
 *                free-tier provider like Google Suggest / Wikipedia / OpenPageRank
 *                / Wayback / Common Crawl / URLScan). No fabricated numbers.
 *   "llm-safe" — the LLM only produces qualitative commentary, summaries,
 *                clustering or planning. No numeric output that could be
 *                mistaken for a measurement.
 *   "mixed"    — some fields are real, some are estimated by the LLM. The
 *                corresponding page must show per-field provenance badges
 *                (source + confidence), and estimated fields must be
 *                clearly labeled as such.
 */
type SourceClass = "real" | "llm-safe" | "mixed";

const SOURCE_MAP: Record<string, SourceClass> = {
  // Workspace
  "/": "real",
  "/history": "real",
  "/reports": "real",
  // Import
  "/upload": "real",
  // On-Page & Tech SEO
  "/site-audit": "real",
  "/onpage-seo-checker": "mixed",
  "/position-tracking": "real",
  // Competitive Analysis (all computed from crawl reports)
  "/domain-overview": "real",
  "/organic-rankings": "real",
  "/top-pages": "real",
  "/compare-domains": "real",
  "/keyword-gap": "real",
  "/backlink-gap": "real",
  "/traffic-analytics": "mixed",
  // Keyword Research
  "/keyword-overview": "mixed",
  "/keyword-magic-tool": "mixed",
  "/keyword-strategy": "mixed",
  "/keyword-manager": "real",
  // Content Marketing
  "/seo-writing-assistant": "mixed",
  "/topic-research": "mixed",
  "/seo-content-template": "mixed",
  "/content-audit": "mixed",
  "/post-tracking": "real",
  // Link Building
  "/backlinks": "real",
  "/referring-domains": "real",
  "/backlink-audit": "real",
  // AI Tools
  "/query-lab": "mixed",
  "/serp-analyzer": "real",
  "/agentic-crawl": "llm-safe",
  // Monitoring
  "/brand-monitoring": "mixed",
  "/log-file-analyzer": "mixed",
  // Local SEO
  "/local-seo": "mixed",
};

const DOT_COLORS: Record<SourceClass, string> = {
  real: "#22c55e",
  "llm-safe": "#3b82f6",
  mixed: "#eab308",
};

const DOT_TITLES: Record<SourceClass, string> = {
  real: "Real data — every number sourced from crawl, DDG SERP, or a free-tier provider",
  "llm-safe": "LLM-safe — only qualitative commentary, no numeric output",
  mixed: "Mixed — some numbers are estimated; check per-field provenance badges on the page",
};

function SourceDot({ to }: { to: string }) {
  const cls: SourceClass = SOURCE_MAP[to] ?? "real";
  return (
    <span
      aria-hidden
      title={DOT_TITLES[cls]}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: DOT_COLORS[cls],
        marginRight: 10,
        flexShrink: 0,
        boxShadow: "0 0 0 1px rgba(9, 30, 66, 0.08)",
      }}
    />
  );
}

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}
      style={{ display: "flex", alignItems: "center" }}
    >
      <SourceDot to={to} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </NavLink>
  );
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="qa-lozenge qa-lozenge--neutral" style={{ marginLeft: "auto", fontSize: "0.68rem", padding: "1px 6px" }}>
      {count}
    </span>
  );
}

function DataHonestyLegend() {
  const entries: { cls: SourceClass; label: string }[] = [
    { cls: "real", label: "Real data" },
    { cls: "llm-safe", label: "LLM-safe" },
    { cls: "mixed", label: "Mixed" },
  ];
  return (
    <div
      style={{
        padding: "10px 16px",
        margin: "8px 0 0",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: "0.66rem",
        color: "var(--muted)",
      }}
      aria-label="Data source legend"
    >
      <div style={{ textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Data source</div>
      {entries.map((e) => (
        <div key={e.cls} style={{ display: "flex", alignItems: "center", gap: 8 }} title={DOT_TITLES[e.cls]}>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: DOT_COLORS[e.cls],
              flexShrink: 0,
            }}
          />
          <span>{e.label}</span>
        </div>
      ))}
    </div>
  );
}

function LlmStatusFooter() {
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);

  useEffect(() => {
    fetchLlmStats()
      .then((s: any) => setOllamaReady(!!s.ollama?.available))
      .catch(() => setOllamaReady(false));
    fetchGoogleAuthStatus()
      .then((s) => setGoogleStatus({ connected: s.connected, configured: s.configured }))
      .catch(() => setGoogleStatus({ connected: false, configured: false }));
  }, []);

  const googleLabel = !googleStatus
    ? "…"
    : googleStatus.connected
      ? "connected"
      : googleStatus.configured
        ? "connect →"
        : "not set up";
  const googleDotClass = googleStatus?.connected ? "ok" : googleStatus?.configured ? "warn" : "warn";
  const googleTitle = googleStatus?.connected
    ? "Google Search Console + GA4 connected — real first-party data is overlaid on every feature that supports it"
    : googleStatus?.configured
      ? "OAuth credentials are set but you haven't connected yet — click to authorize and get real GSC + GA4 data"
      : "Set GOOGLE_OAUTH_CLIENT_ID / SECRET in .env to enable real GSC + GA4 data on keyword, page, and traffic features";

  return (
    <div className="qa-sidebar-footer">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: "0.72rem" }}>
        <span className={`qa-status-dot qa-status-dot--${ollamaReady ? "ok" : "warn"}`} />
        Ollama {ollamaReady ? "ready" : "offline"}
      </div>
      <Link
        to="/google-connections"
        title={googleTitle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
          fontSize: "0.72rem",
          color: "inherit",
          textDecoration: "none",
        }}
      >
        <span className={`qa-status-dot qa-status-dot--${googleDotClass}`} />
        Google {googleLabel}
      </Link>
      <div>28 tools · Free tier APIs · Local LLM (Ollama)</div>
    </div>
  );
}

export default function AppLayout() {
  const { pathname } = useLocation();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "var(--bg-app)",
      }}
    >
      <motion.aside
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: 264,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--sidebar-bg)",
          padding: "12px 0 20px",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          minHeight: "100vh",
          boxShadow: "1px 0 0 rgba(9, 30, 66, 0.06)",
          overflowY: "auto",
        }}
      >
        <div className="qa-sidebar-brand">
          <Link to="/" className="qa-sidebar-brand-row">
            <span className="qa-app-mark" aria-hidden />
            <span style={{ minWidth: 0 }}>
              <span className="qa-sidebar-brand-text">QA Agent</span>
              <span className="qa-sidebar-brand-sub">SEO &amp; Site Intelligence</span>
            </span>
          </Link>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }} aria-label="Main">
          <div className="qa-nav-section">Workspace</div>
          <NavItem to="/" label="Dashboard" end />
          <NavItem to="/history" label="Run history" />
          <NavItem to="/reports" label="Reports" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Import">
          <div className="qa-nav-section">Import</div>
          <NavItem to="/upload" label="URL lists" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Site Audit">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>On Page &amp; Tech SEO<NavBadge count={3} /></div>
          <NavItem to="/site-audit" label="Site Audit" />
          <NavItem to="/onpage-seo-checker" label="On-Page SEO Checker" />
          <NavItem to="/position-tracking" label="Position Tracking" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Competitive Analysis">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Competitive Analysis<NavBadge count={7} /></div>
          <NavItem to="/domain-overview" label="Domain Overview" />
          <NavItem to="/organic-rankings" label="Organic Rankings" />
          <NavItem to="/top-pages" label="Top Pages" />
          <NavItem to="/compare-domains" label="Compare Domains" />
          <NavItem to="/keyword-gap" label="Keyword Gap" />
          <NavItem to="/backlink-gap" label="Backlink Gap" />
          <NavItem to="/traffic-analytics" label="Traffic Analytics" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Keyword Research">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Keyword Research<NavBadge count={4} /></div>
          <NavItem to="/keyword-overview" label="Keyword Overview" />
          <NavItem to="/keyword-magic-tool" label="Keyword Magic Tool" />
          <NavItem to="/keyword-strategy" label="Keyword Strategy Builder" />
          <NavItem to="/keyword-manager" label="Keyword Manager" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Content Marketing">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Content Marketing<NavBadge count={5} /></div>
          <NavItem to="/seo-writing-assistant" label="SEO Writing Assistant" />
          <NavItem to="/topic-research" label="Topic Research" />
          <NavItem to="/seo-content-template" label="SEO Content Template" />
          <NavItem to="/content-audit" label="Content Audit" />
          <NavItem to="/post-tracking" label="Post Tracking" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Link Building">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Link Building<NavBadge count={3} /></div>
          <NavItem to="/backlinks" label="Backlinks" />
          <NavItem to="/referring-domains" label="Referring Domains" />
          <NavItem to="/backlink-audit" label="Backlink Audit" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="AI Tools">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>AI Tools<NavBadge count={3} /></div>
          <NavItem to="/query-lab" label="Query Lab" />
          <NavItem to="/serp-analyzer" label="SERP Analyzer" />
          <NavItem to="/agentic-crawl" label="Agentic Crawl" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Monitoring">
          <div className="qa-nav-section">Monitoring</div>
          <NavItem to="/brand-monitoring" label="Brand Monitoring" />
          <NavItem to="/log-file-analyzer" label="Log File Analyzer" />
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Local SEO">
          <div className="qa-nav-section">Local SEO</div>
          <NavItem to="/local-seo" label="Local SEO Tools" />
        </nav>

        <DataHonestyLegend />
        <LlmStatusFooter />
      </motion.aside>

      <div className="qa-main">
        <main className="qa-main__inner">
          <motion.div
            key={pathname}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
