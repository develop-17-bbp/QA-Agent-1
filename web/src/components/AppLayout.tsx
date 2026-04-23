import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { fetchGoogleAuthStatus, fetchLlmStats } from "../api";
import { usePageTitle } from "../hooks/usePageTitle";
import RegionPicker from "./RegionPicker";
import { ThemeToggle } from "./PageUI";
import Sidebar from "./Sidebar";
import AutoCouncilToggle from "./AutoCouncilToggle";

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

// ─── Compact topbar (sidebar handles the nav now) ──────────────────────────
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
      height: 54,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, color: "var(--muted)" }}>
        <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, fontSize: 10 }}>
          Connections
        </span>
        <StatusBar />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AutoCouncilToggle />
        <div style={{ width: 1, height: 20, background: "var(--border)" }} />
        <RegionPicker compact label="Region" />
        <div style={{ width: 1, height: 20, background: "var(--border)" }} />
        <ThemeToggle />
        <div style={{ width: 1, height: 20, background: "var(--border)" }} />
        <Link
          to="/integrations"
          style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: "var(--radius-sm)", fontWeight: 600, color: "var(--accent)", background: "var(--accent-light)", textDecoration: "none", border: "1px solid var(--accent-muted)" }}
          title="Connect Google, Bing, Yandex, Ahrefs and more"
        >
          Connect →
        </Link>
      </div>
    </header>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function AppLayout() {
  const { pathname } = useLocation();
  usePageTitle();

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg-app)" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar />
        <main style={{ flex: 1 }}>
          <div style={{ maxWidth: 1600, width: "100%", margin: "0 auto", padding: "28px 28px 80px" }}>
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
