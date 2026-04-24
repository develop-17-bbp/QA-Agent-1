import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { fetchGoogleAuthStatus, fetchLlmStats } from "../api";
import { usePageTitle } from "../hooks/usePageTitle";
import RegionPicker from "./RegionPicker";
import { ThemeToggle } from "./PageUI";
import Sidebar from "./Sidebar";
import AutoCouncilToggle from "./AutoCouncilToggle";
import AgenticModeChip from "./AgenticModeChip";
import { Icon } from "./Icon";

// ─── Data honesty ────────────────────────────────────────────────────────────
// Note: the per-path source map lives in Sidebar.tsx now (where the nav
// actually renders dots). The legend below still needs the shared colors +
// titles so the <DataSourceLegend /> widget — rendered on the Dashboard —
// keeps its existing meaning.
type SourceClass = "real" | "llm-safe" | "mixed";

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

/**
 * Always-visible legend panel — appears on the Dashboard and at the top of
 * every nav dropdown so SEO teammates never wonder what the dots mean.
 */
export function DataSourceLegend({ style }: { style?: React.CSSProperties } = {}) {
  return (
    <div
      className="qa-dashboard-legend"
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
      className="qa-topbar-status"
      style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, color: "var(--muted)", minWidth: 0 }}
      title="Connection status — green = service reachable. These dots are NOT the data-source legend."
    >
      <span style={{ display: "flex", alignItems: "center", gap: 5 }} title={ollamaReady ? "Ollama is running" : "Ollama is offline — start with: ollama serve"}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: ollamaReady ? "#22c55e" : "#e53e3e", display: "inline-block", flexShrink: 0 }} />
        <span className="qa-topbar-status-text">Ollama {ollamaReady === null ? "…" : ollamaReady ? "ready" : "offline"}</span>
      </span>
      <Link
        to="/google-connections"
        style={{ display: "flex", alignItems: "center", gap: 5, color: "inherit", textDecoration: "none", fontWeight: 500 }}
        title={googleStatus?.connected ? "Google OAuth connected" : "Click to connect Google (GSC + GA4 + Ads)"}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: googleStatus?.connected ? "#22c55e" : "#eab308", display: "inline-block", flexShrink: 0 }} />
        <span className="qa-topbar-status-text">{googleStatus === null ? "Google …" : googleStatus.connected ? "Google ✓" : "Connect Google"}</span>
      </Link>
    </div>
  );
}

// ─── Compact topbar (sidebar handles the nav now) ──────────────────────────
function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <header
      className="qa-app-topbar"
      style={{
      position: "sticky",
      top: 0,
      zIndex: 100,
      background: "color-mix(in oklab, var(--glass) 82%, transparent)",
      borderBottom: "1px solid var(--border)",
      boxShadow: "var(--depth-1)",
      backdropFilter: "blur(14px) saturate(1.1)",
      WebkitBackdropFilter: "blur(14px) saturate(1.1)",
      height: 54,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, color: "var(--muted)", minWidth: 0, flex: 1 }}>
        <button
          type="button"
          aria-label="Open navigation"
          title="Open navigation"
          onClick={onOpenSidebar}
          className="qa-sidebar-toggle"
        >
          <Icon name="menu" size={18} />
        </button>
        <span className="qa-topbar-label" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, fontSize: 10 }}>
          Connections
        </span>
        <StatusBar />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <AgenticModeChip />
        <AutoCouncilToggle />
        <span className="qa-topbar-only-desktop" style={{ width: 1, height: 20, background: "var(--border)" }} />
        <span className="qa-topbar-only-desktop"><RegionPicker compact label="Region" /></span>
        <span className="qa-topbar-only-wide" style={{ width: 1, height: 20, background: "var(--border)" }} />
        <span className="qa-topbar-only-wide"><ThemeToggle /></span>
        <span className="qa-topbar-only-desktop" style={{ width: 1, height: 20, background: "var(--border)" }} />
        <Link
          to="/integrations"
          className="qa-connect-link"
          style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: "var(--radius-sm)", fontWeight: 600, color: "var(--accent)", background: "var(--accent-light)", textDecoration: "none", border: "1px solid var(--accent-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}
          title="Connect Google, Bing, Yandex, Ahrefs and more"
        >
          <Icon name="plug" size={13} />
          <span className="qa-connect-link-label">Connect →</span>
        </Link>
      </div>
    </header>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function AppLayout() {
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  usePageTitle();

  // Close the mobile drawer on route change so navigating doesn't leave it covering the page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // ESC closes the drawer (standard modal behavior).
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg-app)" }}>
      {mobileNavOpen && (
        <div
          className="qa-sidebar-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}
      <div className={`qa-sidebar-wrap${mobileNavOpen ? " qa-sidebar-wrap--open" : ""}`} style={{ display: "flex" }}>
        <Sidebar onNavigate={() => setMobileNavOpen(false)} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar onOpenSidebar={() => setMobileNavOpen(true)} />
        <main style={{ flex: 1 }}>
          <div className="qa-app-main-inner" style={{ maxWidth: 1600, width: "100%", margin: "0 auto", padding: "28px 28px 80px" }}>
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
    </div>
  );
}
