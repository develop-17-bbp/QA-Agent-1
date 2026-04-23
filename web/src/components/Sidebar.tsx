/**
 * Sidebar — categorized persistent navigation.
 *
 * Replaces the old two-row topbar (brand row + dropdown row + quick-links)
 * with a left rail grouped by product area. Groups are collapsible, the
 * collapsed state persists per-user via localStorage, and the whole rail
 * can be collapsed to icons-only to recover horizontal space on small
 * monitors.
 *
 * Every nav item carries a SourceDot (real / mixed / llm-safe) so SEO
 * teams keep the data-honesty signal the old top-nav had.
 */

import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

// ─── Data honesty (kept in sync with AppLayout.tsx) ────────────────────────
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
  "/council": "mixed", "/integrations": "real", "/google-connections": "real",
  "/term-intel": "mixed",
};
const DOT_COLORS: Record<SourceClass, string> = { real: "#22c55e", "llm-safe": "#3b82f6", mixed: "#eab308" };

// ─── Structure ───────────────────────────────────────────────────────────────
interface NavItem { label: string; path: string; badge?: string }
interface NavGroup { id: string; label: string; icon: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    id: "workspace", label: "Workspace", icon: "🏠",
    items: [
      { label: "Dashboard", path: "/" },
      { label: "Run History", path: "/history" },
      { label: "Reports", path: "/reports" },
      { label: "Import Data", path: "/upload" },
    ],
  },
  {
    id: "council", label: "Council", icon: "🧭",
    items: [
      { label: "Council — 6 AI panels", path: "/council", badge: "NEW" },
      { label: "Term Intel — every source", path: "/term-intel", badge: "NEW" },
    ],
  },
  {
    id: "audit", label: "Audit", icon: "🔍",
    items: [
      { label: "Site Audit", path: "/site-audit" },
      { label: "On-Page Checker", path: "/onpage-seo-checker" },
      { label: "URL Report", path: "/url-report" },
      { label: "Position Tracking", path: "/position-tracking" },
      { label: "Link Fix Advisor", path: "/link-fix-advisor" },
    ],
  },
  {
    id: "keywords", label: "Keywords", icon: "🔑",
    items: [
      { label: "Keyword Overview", path: "/keyword-overview" },
      { label: "Magic Tool", path: "/keyword-magic-tool" },
      { label: "Impact Predictor", path: "/keyword-impact" },
      { label: "Strategy Builder", path: "/keyword-strategy" },
      { label: "Keyword Manager", path: "/keyword-manager" },
    ],
  },
  {
    id: "competitive", label: "Competitive", icon: "📊",
    items: [
      { label: "Domain Overview", path: "/domain-overview" },
      { label: "Compare Domains", path: "/compare-domains" },
      { label: "Keyword Gap", path: "/keyword-gap" },
      { label: "Backlink Gap", path: "/backlink-gap" },
      { label: "Organic Rankings", path: "/organic-rankings" },
      { label: "Top Pages", path: "/top-pages" },
      { label: "Traffic Analytics", path: "/traffic-analytics" },
      { label: "Competitive Estimator", path: "/competitive-estimator" },
      { label: "Rank Tracker", path: "/competitor-rank-tracker" },
    ],
  },
  {
    id: "links", label: "Links", icon: "🔗",
    items: [
      { label: "Backlinks", path: "/backlinks" },
      { label: "Referring Domains", path: "/referring-domains" },
      { label: "Backlink Audit", path: "/backlink-audit" },
    ],
  },
  {
    id: "content", label: "Content", icon: "✍️",
    items: [
      { label: "Writing Assistant", path: "/seo-writing-assistant" },
      { label: "Topic Research", path: "/topic-research" },
      { label: "Content Template", path: "/seo-content-template" },
      { label: "Content Audit", path: "/content-audit" },
      { label: "Post Tracking", path: "/post-tracking" },
    ],
  },
  {
    id: "monitoring", label: "Monitoring", icon: "👁️",
    items: [
      { label: "Brand Monitor", path: "/brand-monitoring" },
      { label: "Log File Analyzer", path: "/log-file-analyzer" },
      { label: "Local SEO", path: "/local-seo" },
      { label: "Form Tests", path: "/form-tests" },
    ],
  },
  {
    id: "ai", label: "AI Tools", icon: "🤖",
    items: [
      { label: "Query Lab", path: "/query-lab" },
      { label: "SERP Analyzer", path: "/serp-analyzer" },
      { label: "Agentic Crawl", path: "/agentic-crawl" },
    ],
  },
  {
    id: "integrations", label: "Integrations", icon: "🔌",
    items: [
      { label: "Integrations Hub", path: "/integrations" },
      { label: "Google Connections", path: "/google-connections" },
    ],
  },
];

const COLLAPSED_STORAGE_KEY = "qa-sidebar-collapsed";
const GROUPS_STORAGE_KEY = "qa-sidebar-groups";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
}

function readClosedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(GROUPS_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}

function saveClosedGroups(s: Set<string>): void {
  window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify([...s]));
}

export const SIDEBAR_WIDTH = 232;
export const SIDEBAR_COLLAPSED_WIDTH = 58;

function SourceDot({ path, size = 7 }: { path: string; size?: number }) {
  const cls: SourceClass = SOURCE_MAP[path] ?? "real";
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: DOT_COLORS[cls], flexShrink: 0 }} />
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(readClosedGroups);
  const { pathname } = useLocation();

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Auto-expand the group containing the active route so users always see
  // their current page in context after a direct nav or refresh.
  useEffect(() => {
    const activeGroup = GROUPS.find((g) => g.items.some((i) => i.path === pathname));
    if (activeGroup && closedGroups.has(activeGroup.id)) {
      const next = new Set(closedGroups);
      next.delete(activeGroup.id);
      setClosedGroups(next);
      saveClosedGroups(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleGroup = (id: string) => {
    const next = new Set(closedGroups);
    if (next.has(id)) next.delete(id); else next.add(id);
    setClosedGroups(next);
    saveClosedGroups(next);
  };

  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <aside
      style={{
        width,
        minWidth: width,
        height: "100vh",
        position: "sticky",
        top: 0,
        background: "var(--sidebar-bg, var(--glass))",
        borderRight: "1px solid var(--border)",
        overflowY: "auto",
        overflowX: "hidden",
        transition: "width 0.18s ease, min-width 0.18s ease",
        display: "flex",
        flexDirection: "column",
        paddingBottom: 20,
      }}
      className="qa-sidebar"
    >
      {/* Brand */}
      <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <NavLink to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit", flex: 1, minWidth: 0 }}>
          <span className="qa-app-mark" aria-hidden style={{ flexShrink: 0 }} />
          {!collapsed && (
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em", color: "var(--text)", display: "block", lineHeight: 1.2 }}>QA Agent</span>
              <span style={{ fontSize: 9.5, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>SEO Intelligence</span>
            </span>
          )}
        </NavLink>
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            width: 24, height: 24, borderRadius: 4, border: "1px solid var(--border)",
            background: "transparent", color: "var(--muted)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, flexShrink: 0,
          }}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* Groups */}
      <nav style={{ flex: 1, padding: "8px 0" }}>
        {GROUPS.map((g) => {
          const isClosed = closedGroups.has(g.id);
          const hasActive = g.items.some((i) => i.path === pathname);
          return (
            <div key={g.id} style={{ marginBottom: 2 }}>
              <GroupHeader
                group={g}
                collapsed={collapsed}
                isClosed={isClosed}
                hasActive={hasActive}
                onToggle={() => toggleGroup(g.id)}
              />
              {!isClosed && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {g.items.map((item) => (
                    <SidebarItem key={item.path} item={item} collapsed={collapsed} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer legend — shown only when expanded */}
      {!collapsed && (
        <div style={{ padding: "10px 12px", fontSize: 10, color: "var(--muted)", borderTop: "1px solid var(--border)", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["real", "mixed", "llm-safe"] as const).map((cls) => (
            <span key={cls} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: DOT_COLORS[cls] }} />
              {cls === "llm-safe" ? "LLM" : cls}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}

function GroupHeader({
  group, collapsed, isClosed, hasActive, onToggle,
}: {
  group: NavGroup; collapsed: boolean; isClosed: boolean; hasActive: boolean; onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <div
        title={group.label}
        style={{
          padding: "10px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          color: hasActive ? "var(--accent)" : "var(--muted)",
          borderLeft: hasActive ? "2px solid var(--accent)" : "2px solid transparent",
        }}
      >
        {group.icon}
      </div>
    );
  }
  return (
    <button
      onClick={onToggle}
      aria-expanded={!isClosed}
      style={{
        width: "100%", textAlign: "left", background: "transparent", border: "none",
        padding: "8px 14px", display: "flex", alignItems: "center", gap: 8,
        color: hasActive ? "var(--text)" : "var(--muted)",
        fontWeight: hasActive ? 700 : 600,
        fontSize: 11.5, letterSpacing: 0.4, textTransform: "uppercase", cursor: "pointer",
      }}
      className="qa-sidebar-group"
    >
      <span aria-hidden style={{ fontSize: 14, opacity: 0.95 }}>{group.icon}</span>
      <span style={{ flex: 1 }}>{group.label}</span>
      <span aria-hidden style={{ fontSize: 10, opacity: 0.7, transform: isClosed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>▾</span>
    </button>
  );
}

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const dotSize = collapsed ? 5 : 7;
  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === "/"}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) => `qa-sidebar-item${isActive ? " qa-sidebar-item--active" : ""}`}
        style={({ isActive }) => ({
          display: "flex",
          alignItems: "center",
          gap: collapsed ? 0 : 10,
          padding: collapsed ? "7px 0" : "7px 14px 7px 30px",
          justifyContent: collapsed ? "center" : "flex-start",
          fontSize: 13,
          color: isActive ? "var(--accent)" : "var(--text-secondary)",
          background: isActive ? "var(--accent-light)" : "transparent",
          textDecoration: "none",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          marginLeft: collapsed ? 0 : 0,
          fontWeight: isActive ? 600 : 500,
          transition: "background 0.1s, color 0.1s",
          lineHeight: 1.3,
        })}
      >
        <SourceDot path={item.path} size={dotSize} />
        {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
        {!collapsed && item.badge && (
          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "var(--accent)", color: "#fff", fontWeight: 700, letterSpacing: 0.3 }}>
            {item.badge}
          </span>
        )}
      </NavLink>
    </li>
  );
}

/** Memoized lookup used by the content area's page-title hook. */
export function useCurrentNavContext(): { groupLabel: string; itemLabel: string } | null {
  const { pathname } = useLocation();
  return useMemo(() => {
    for (const g of GROUPS) {
      const i = g.items.find((x) => x.path === pathname);
      if (i) return { groupLabel: g.label, itemLabel: i.label };
    }
    return null;
  }, [pathname]);
}
