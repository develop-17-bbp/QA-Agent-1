import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { fetchGoogleAuthStatus, fetchLlmStats } from "../api";
import { usePageTitle } from "../hooks/usePageTitle";
import RegionPicker from "./RegionPicker";
import { ThemeToggle } from "./PageUI";

// ─── Data honesty ────────────────────────────────────────────────────────────
type SourceClass = "real" | "llm-safe" | "mixed";

const SOURCE_MAP: Record<string, SourceClass> = {
  "/": "real", "/history": "real", "/reports": "real", "/upload": "real",
  "/site-audit": "real", "/onpage-seo-checker": "mixed", "/position-tracking": "real",
  "/domain-overview": "real", "/organic-rankings": "real", "/top-pages": "real",
  "/compare-domains": "real", "/keyword-gap": "real", "/backlink-gap": "real",
  "/traffic-analytics": "mixed",
  "/keyword-overview": "mixed", "/keyword-magic-tool": "mixed",
  "/keyword-strategy": "mixed", "/keyword-manager": "real",
  "/seo-writing-assistant": "mixed", "/topic-research": "mixed",
  "/seo-content-template": "mixed", "/content-audit": "mixed", "/post-tracking": "real",
  "/backlinks": "real", "/referring-domains": "real", "/backlink-audit": "real",
  "/query-lab": "mixed", "/serp-analyzer": "real", "/agentic-crawl": "llm-safe",
  "/brand-monitoring": "mixed", "/log-file-analyzer": "mixed", "/local-seo": "mixed",
  "/url-report": "mixed", "/form-tests": "real", "/keyword-impact": "mixed",
  "/competitive-estimator": "mixed", "/link-fix-advisor": "mixed",
  "/competitor-rank-tracker": "real",
};

const DOT_COLORS: Record<SourceClass, string> = {
  real: "#22c55e", "llm-safe": "#3b82f6", mixed: "#eab308",
};

const DOT_LABELS: Record<SourceClass, string> = {
  real: "Real data",
  "llm-safe": "LLM commentary only",
  mixed: "Real + estimated",
};

const DOT_TITLES: Record<SourceClass, string> = {
  real: "Real data — every number comes from a crawl, SERP scrape, or free-tier API. No AI-generated numbers.",
  "llm-safe": "LLM commentary only — AI generates narrative/suggestions; the numbers themselves are real.",
  mixed: "Real + estimated — some numbers are AI- or heuristic-estimated (e.g. traffic bands, confidence scores). Each field shows its own provenance badge.",
};

function SourceDot({ path }: { path: string }) {
  const cls: SourceClass = SOURCE_MAP[path] ?? "real";
  return (
    <span
      aria-hidden
      title={DOT_TITLES[cls]}
      style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: DOT_COLORS[cls], flexShrink: 0,
      }}
    />
  );
}

/**
 * Always-visible legend panel — appears on the Dashboard and at the top of
 * every nav dropdown so SEO teammates never wonder what the dots mean.
 */
export function DataSourceLegend({ style }: { style?: React.CSSProperties } = {}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        background: "#f8fafc",
        border: "1px solid var(--border)",
        borderRadius: 6,
        fontSize: 11.5,
        color: "var(--text)",
        ...style,
      }}
    >
      <span style={{ fontWeight: 700, marginRight: 2, color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Dot legend
      </span>
      {(["real", "mixed", "llm-safe"] as const).map((cls) => (
        <span key={cls} title={DOT_TITLES[cls]} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: DOT_COLORS[cls], flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{DOT_LABELS[cls]}</span>
        </span>
      ))}
      <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: "auto" }}>
        Status bar (top-right) ● = Ollama / Google connection, NOT data source
      </span>
    </div>
  );
}

// ─── Nav structure ────────────────────────────────────────────────────────────
interface NavTool { label: string; path: string }
interface NavGroup { label: string; icon: string; tools: NavTool[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Crawl & Audit",
    icon: "⬡",
    tools: [
      { label: "URL Report", path: "/url-report" },
      { label: "Site Audit", path: "/site-audit" },
      { label: "On-Page SEO Checker", path: "/onpage-seo-checker" },
      { label: "Position Tracking", path: "/position-tracking" },
    ],
  },
  {
    label: "Competitive",
    icon: "◈",
    tools: [
      { label: "Domain Overview", path: "/domain-overview" },
      { label: "Organic Rankings", path: "/organic-rankings" },
      { label: "Top Pages", path: "/top-pages" },
      { label: "Compare Domains", path: "/compare-domains" },
      { label: "Traffic Analytics", path: "/traffic-analytics" },
      { label: "AI Competitive Estimator", path: "/competitive-estimator" },
      { label: "Competitor Rank Tracker", path: "/competitor-rank-tracker" },
    ],
  },
  {
    label: "Keywords",
    icon: "◎",
    tools: [
      { label: "Keyword Overview", path: "/keyword-overview" },
      { label: "Keyword Magic Tool", path: "/keyword-magic-tool" },
      { label: "Keyword Impact Predictor", path: "/keyword-impact" },
      { label: "Keyword Gap", path: "/keyword-gap" },
      { label: "Keyword Strategy", path: "/keyword-strategy" },
      { label: "Keyword Manager", path: "/keyword-manager" },
    ],
  },
  {
    label: "Content",
    icon: "▦",
    tools: [
      { label: "SEO Writing Assistant", path: "/seo-writing-assistant" },
      { label: "Topic Research", path: "/topic-research" },
      { label: "Content Template", path: "/seo-content-template" },
      { label: "Content Audit", path: "/content-audit" },
      { label: "Post Tracking", path: "/post-tracking" },
    ],
  },
  {
    label: "Links",
    icon: "⬡",
    tools: [
      { label: "Backlinks", path: "/backlinks" },
      { label: "Referring Domains", path: "/referring-domains" },
      { label: "Backlink Gap", path: "/backlink-gap" },
      { label: "Backlink Audit", path: "/backlink-audit" },
    ],
  },
  {
    label: "AI Tools",
    icon: "◆",
    tools: [
      { label: "Query Lab", path: "/query-lab" },
      { label: "SERP Analyzer", path: "/serp-analyzer" },
      { label: "Agentic Crawl", path: "/agentic-crawl" },
      { label: "Brand Monitoring", path: "/brand-monitoring" },
      { label: "Log File Analyzer", path: "/log-file-analyzer" },
      { label: "Local SEO", path: "/local-seo" },
      { label: "Form Tests", path: "/form-tests" },
      { label: "Link Fix Advisor", path: "/link-fix-advisor" },
    ],
  },
];

// ─── Dropdown menu ────────────────────────────────────────────────────────────
function DropMenu({ group, open, onClose }: { group: NavGroup; open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12 }}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 230,
            background: "var(--glass)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "0 10px 30px rgba(15,23,42,0.14), 0 1px 4px rgba(15,23,42,0.08)",
            zIndex: 500,
            padding: "4px 0",
            overflow: "hidden",
          }}
          role="menu"
        >
          <div style={{
            padding: "6px 14px 7px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted)",
            borderBottom: "1px solid var(--border)",
            marginBottom: 3,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}>
            <span>{group.label}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              <span title={DOT_TITLES.real} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: DOT_COLORS.real }} />
                Real
              </span>
              <span title={DOT_TITLES.mixed} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: DOT_COLORS.mixed }} />
                Mixed
              </span>
              <span title={DOT_TITLES["llm-safe"]} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: DOT_COLORS["llm-safe"] }} />
                LLM
              </span>
            </span>
          </div>
          {group.tools.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              role="menuitem"
              onClick={onClose}
              className={({ isActive }) => isActive ? "qa-dropmenu-item qa-dropmenu-item--active" : "qa-dropmenu-item"}
            >
              <SourceDot path={t.path} />
              {t.label}
            </NavLink>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Top nav group button ────────────────────────────────────────────────────
function NavGroupBtn({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const isGroupActive = group.tools.some((t) => pathname === t.path || pathname.startsWith(t.path + "/"));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open]);

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div ref={ref} style={{ position: "relative", height: "100%", display: "flex", alignItems: "center" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`qa-topnav-btn${isGroupActive ? " qa-topnav-btn--active" : ""}${open ? " qa-topnav-btn--open" : ""}`}
      >
        {group.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5, marginTop: 1, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <DropMenu group={group} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────
function StatusBar() {
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

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, color: "var(--muted)" }}
      title="Connection status — green = service reachable. These dots are NOT the data-source legend."
    >
      <span style={{ display: "flex", alignItems: "center", gap: 5 }} title={ollamaReady ? "Ollama is running" : "Ollama is offline — start with: ollama serve"}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: ollamaReady ? "#22c55e" : "#e53e3e", display: "inline-block", flexShrink: 0 }} />
        Ollama {ollamaReady === null ? "…" : ollamaReady ? "ready" : "offline"}
      </span>
      <Link
        to="/google-connections"
        style={{ display: "flex", alignItems: "center", gap: 5, color: "inherit", textDecoration: "none", fontWeight: 500 }}
        title={googleStatus?.connected ? "Google OAuth connected" : "Click to connect Google (GSC + GA4 + Ads)"}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: googleStatus?.connected ? "#22c55e" : "#eab308", display: "inline-block", flexShrink: 0 }} />
        {googleStatus === null ? "Google …" : googleStatus.connected ? "Google ✓" : "Connect Google"}
      </Link>
    </div>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
function Topbar() {
  return (
    <header style={{
      position: "sticky",
      top: 0,
      zIndex: 100,
      background: "var(--glass)",
      borderBottom: "1px solid var(--border)",
      boxShadow: "var(--shadow-sm)",
      backdropFilter: "blur(8px)",
    }}>
      {/* Brand row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        height: 54,
        borderBottom: "1px solid var(--border)",
      }}
      className="qa-brand-row">
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
          <span className="qa-app-mark" aria-hidden />
          <span>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.03em", color: "var(--text)", display: "block", lineHeight: 1.2 }}>QA Agent</span>
            <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>SEO Intelligence</span>
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusBar />
          <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          <RegionPicker compact label="Region" />
          <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          <ThemeToggle />
          <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          <div style={{ display: "flex", gap: 2 }}>
            {[
              { to: "/history", label: "History" },
              { to: "/reports", label: "Reports" },
              { to: "/upload", label: "Import" },
              { to: "/google-connections", label: "Integrations" },
            ].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                style={({ isActive }) => ({
                  fontSize: 12.5, padding: "5px 10px", borderRadius: "var(--radius-sm)",
                  fontWeight: 500,
                  color: isActive ? "var(--accent)" : "var(--muted)",
                  background: isActive ? "var(--accent-light)" : "transparent",
                  textDecoration: "none",
                  transition: "background 0.12s, color 0.12s",
                })}
              >
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      {/* Tool nav row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        padding: "0 20px",
        height: 42,
        overflow: "visible",
      }}
      className="qa-topnav-row">
        {NAV_GROUPS.map((g) => (
          <NavGroupBtn key={g.label} group={g} />
        ))}

        {/* Data honesty legend — far right */}
        <div className="qa-data-honesty" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 10.5, color: "var(--muted)", flexShrink: 0 }}>
          {(["real", "llm-safe", "mixed"] as SourceClass[]).map((cls) => (
            <span key={cls} style={{ display: "flex", alignItems: "center", gap: 4 }} title={DOT_TITLES[cls]}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: DOT_COLORS[cls], display: "inline-block", flexShrink: 0 }} />
              <span style={{ letterSpacing: "0.02em" }}>{cls === "llm-safe" ? "LLM-safe" : cls.charAt(0).toUpperCase() + cls.slice(1)}</span>
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function AppLayout() {
  const { pathname } = useLocation();
  usePageTitle();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-app)" }}>
      <Topbar />
      <main style={{ flex: 1 }}>
        <div style={{ maxWidth: 1360, width: "100%", margin: "0 auto", padding: "28px 28px 80px" }}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </div>
      </main>
    </div>
  );
}
