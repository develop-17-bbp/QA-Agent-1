import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { fetchLlmStats } from "../api";

function NavBadge({ count }: { count: number }) {
  return (
    <span className="qa-lozenge qa-lozenge--neutral" style={{ marginLeft: "auto", fontSize: "0.68rem", padding: "1px 6px" }}>
      {count}
    </span>
  );
}

function LlmStatusFooter() {
  const [status, setStatus] = useState<{ gemini: boolean; ollama: boolean } | null>(null);
  useEffect(() => {
    fetchLlmStats()
      .then((s: any) => setStatus({ gemini: !!s.geminiConfigured, ollama: !!s.ollamaAvailable }))
      .catch(() => {});
  }, []);

  return (
    <div className="qa-sidebar-footer">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: "0.72rem" }}>
        <span className={`qa-status-dot qa-status-dot--${status?.gemini ? "ok" : "off"}`} />
        Gemini
        <span className={`qa-status-dot qa-status-dot--${status?.ollama ? "ok" : "warn"}`} style={{ marginLeft: 8 }} />
        Ollama
      </div>
      <div>28 tools · Free tier APIs · Gemini + Ollama</div>
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
          <NavLink to="/" end className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Dashboard
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Run history
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Reports
          </NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Import">
          <div className="qa-nav-section">Import</div>
          <NavLink to="/upload" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            URL lists
          </NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Site Audit">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>On Page &amp; Tech SEO<NavBadge count={3} /></div>
          <NavLink to="/site-audit" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Site Audit</NavLink>
          <NavLink to="/onpage-seo-checker" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>On-Page SEO Checker</NavLink>
          <NavLink to="/position-tracking" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Position Tracking</NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Competitive Analysis">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Competitive Analysis<NavBadge count={7} /></div>
          <NavLink to="/domain-overview" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Domain Overview</NavLink>
          <NavLink to="/organic-rankings" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Organic Rankings</NavLink>
          <NavLink to="/top-pages" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Top Pages</NavLink>
          <NavLink to="/compare-domains" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Compare Domains</NavLink>
          <NavLink to="/keyword-gap" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Keyword Gap</NavLink>
          <NavLink to="/backlink-gap" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Backlink Gap</NavLink>
          <NavLink to="/traffic-analytics" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Traffic Analytics</NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Keyword Research">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Keyword Research<NavBadge count={4} /></div>
          <NavLink to="/keyword-overview" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Keyword Overview</NavLink>
          <NavLink to="/keyword-magic-tool" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Keyword Magic Tool</NavLink>
          <NavLink to="/keyword-strategy" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Keyword Strategy Builder</NavLink>
          <NavLink to="/keyword-manager" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Keyword Manager</NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Content Marketing">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Content Marketing<NavBadge count={5} /></div>
          <NavLink to="/seo-writing-assistant" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>SEO Writing Assistant</NavLink>
          <NavLink to="/topic-research" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Topic Research</NavLink>
          <NavLink to="/seo-content-template" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>SEO Content Template</NavLink>
          <NavLink to="/content-audit" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Content Audit</NavLink>
          <NavLink to="/post-tracking" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Post Tracking</NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Link Building">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>Link Building<NavBadge count={3} /></div>
          <NavLink to="/backlinks" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Backlinks</NavLink>
          <NavLink to="/referring-domains" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Referring Domains</NavLink>
          <NavLink to="/backlink-audit" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Backlink Audit</NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="AI Tools">
          <div className="qa-nav-section" style={{ display: "flex", alignItems: "center" }}>AI Tools<NavBadge count={3} /></div>
          <NavLink to="/query-lab" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Query Lab
          </NavLink>
          <NavLink to="/serp-analyzer" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            SERP Analyzer
          </NavLink>
          <NavLink to="/agentic-crawl" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Agentic Crawl
          </NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Monitoring">
          <div className="qa-nav-section">Monitoring</div>
          <NavLink to="/brand-monitoring" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Brand Monitoring</NavLink>
          <NavLink to="/log-file-analyzer" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Log File Analyzer</NavLink>
        </nav>

        <nav style={{ marginTop: 6 }} aria-label="Local SEO">
          <div className="qa-nav-section">Local SEO</div>
          <NavLink to="/local-seo" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>Local SEO Tools</NavLink>
        </nav>

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
