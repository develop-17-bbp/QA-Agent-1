import { motion } from "framer-motion";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

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
          width: 260,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--sidebar-bg)",
          padding: "16px 0 24px",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          minHeight: "100vh",
          boxShadow: "1px 0 0 rgba(9, 30, 66, 0.04)",
        }}
      >
        <div className="qa-sidebar-brand">
          <Link to="/" className="qa-sidebar-brand-title">
            QA Agent
          </Link>
          <span className="qa-sidebar-brand-sub">Health crawl workspace</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }} aria-label="Main">
          <div className="qa-nav-section">Navigate</div>
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

        <nav style={{ marginTop: 4 }} aria-label="Import">
          <div className="qa-nav-section">Data</div>
          <NavLink to="/upload" className={({ isActive }) => `qa-nav-link${isActive ? " qa-nav-link--active" : ""}`}>
            Import URLs
          </NavLink>
        </nav>

        <div
          style={{
            marginTop: "auto",
            padding: "20px 20px 0",
            fontSize: "0.75rem",
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          Times use your device timezone. Runs appear when the health server finishes writing artifacts.
        </div>
      </motion.aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <main
          style={{
            flex: 1,
            padding: "28px 32px 64px",
            maxWidth: 1200,
            width: "100%",
            margin: "0 auto",
            minHeight: 0,
          }}
        >
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
