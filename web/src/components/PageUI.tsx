import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";

/**
 * Shared page-level UI primitives. Every feature page should import these
 * instead of hand-rolling headers / panels / stat cards / empty states —
 * that's what led to the inconsistent look SEO teams were complaining about.
 *
 *   <PageShell title desc purpose sources>…</PageShell>   — top of every page
 *   <StatGrid stats=[…]/>                                 — summary number row
 *   <SectionCard title actions>…</SectionCard>            — any boxed section
 *   <EmptyState title hint action/>                       — "no data yet"
 *   <DataSourceChips hit=[…] failed=[…]/>                 — provenance badges
 *   <PagePurpose question sources/>                       — plain-English intro
 */

// ─── PageShell ───────────────────────────────────────────────────────────────

export interface PageShellProps {
  title: string;
  /** 1-sentence description shown under the title. */
  desc?: ReactNode;
  /** "This page answers: …" — shown as a highlighted strip for SEO teams. */
  purpose?: string;
  /** Primary data source chips shown inline in the purpose strip. */
  sources?: string[];
  /** Optional controls rendered on the right of the header row. */
  actions?: ReactNode;
  children: ReactNode;
}

export function PageShell({ title, desc, purpose, sources, actions, children }: PageShellProps) {
  return (
    <motion.div
      className="qa-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ padding: 32, maxWidth: 1600, margin: "0 auto" }}
    >
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: purpose ? 12 : 18 }}
      >
        <div>
          <h1 className="qa-page-title" style={{ margin: 0 }}>{title}</h1>
          {desc && <p className="qa-page-desc" style={{ marginTop: 6, marginBottom: 0 }}>{desc}</p>}
        </div>
        {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
      </motion.div>
      {purpose && <PagePurpose question={purpose} sources={sources} />}
      {children}
    </motion.div>
  );
}

// ─── PagePurpose ─────────────────────────────────────────────────────────────

export function PagePurpose({ question, sources }: { question: string; sources?: string[] }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        padding: "10px 14px",
        background: "var(--accent-light)",
        border: "1px solid var(--accent-muted)",
        borderRadius: "var(--radius-sm)",
        marginBottom: 18,
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--accent-hover)" }}>This page answers:</span>
      <span style={{ color: "var(--text)" }}>{question}</span>
      {sources && sources.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
          {sources.map((s) => (
            <span
              key={s}
              style={{
                fontSize: 10.5,
                padding: "2px 8px",
                borderRadius: 10,
                background: "#fff",
                border: "1px solid var(--accent-muted)",
                color: "var(--accent-hover)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── StatGrid / StatCard ─────────────────────────────────────────────────────

export interface StatItem {
  label: string;
  value: ReactNode;
  /** Delta indicator (e.g. "+5%"). Auto-colored by sign if numeric prefix detected. */
  delta?: string;
  /** "real" / "derived" / "estimated" — shown as a confidence dot. */
  confidence?: "real" | "derived" | "estimated" | "high" | "medium" | "low";
  /** Tooltip content. */
  hint?: string;
  /** Optional color for the main value (CSS var or hex). */
  valueColor?: string;
}

export function StatGrid({ stats }: { stats: StatItem[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 12,
        marginBottom: 16,
      }}
    >
      {stats.map((s, i) => (
        <StatCard key={i} {...s} />
      ))}
    </div>
  );
}

export function StatCard({ label, value, delta, confidence, hint, valueColor }: StatItem) {
  return (
    <div
      className="qa-panel"
      title={hint}
      style={{
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minHeight: 78,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>{label}</span>
        {confidence && <ConfidenceDot confidence={confidence} />}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor ?? "var(--text)", lineHeight: 1.1 }}>
        {value}
      </div>
      {delta && <DeltaChip delta={delta} />}
    </div>
  );
}

function DeltaChip({ delta }: { delta: string }) {
  const trimmed = delta.trim();
  const neg = trimmed.startsWith("-") || trimmed.startsWith("−");
  const pos = trimmed.startsWith("+");
  const color = neg ? "var(--bad)" : pos ? "var(--ok)" : "var(--muted)";
  return <span style={{ fontSize: 11, fontWeight: 600, color }}>{delta}</span>;
}

// ─── ConfidenceDot ───────────────────────────────────────────────────────────

const CONF_COLOR: Record<string, string> = {
  real: "var(--ok)",
  high: "var(--ok)",
  derived: "var(--warn)",
  medium: "var(--warn)",
  estimated: "var(--muted-light)",
  low: "var(--muted-light)",
};
const CONF_LABEL: Record<string, string> = {
  real: "real data",
  high: "real data",
  derived: "derived from real data",
  medium: "derived from real data",
  estimated: "estimated",
  low: "estimated",
};

export function ConfidenceDot({ confidence, note }: { confidence: string; note?: string }) {
  return (
    <span
      title={note ? `${CONF_LABEL[confidence] ?? confidence} · ${note}` : CONF_LABEL[confidence] ?? confidence}
      aria-label={CONF_LABEL[confidence] ?? confidence}
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        backgroundColor: CONF_COLOR[confidence] ?? "var(--muted-light)",
      }}
    />
  );
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

export interface SectionCardProps {
  title?: ReactNode;
  /** Small text under the title (e.g. "last 28 days"). */
  subtitle?: ReactNode;
  /** Elements right-aligned in the header (e.g. "Export CSV" button). */
  actions?: ReactNode;
  /** Optional CSS. */
  style?: CSSProperties;
  /** Override inner content padding. */
  bodyPadding?: CSSProperties["padding"];
  children: ReactNode;
}

export function SectionCard({ title, subtitle, actions, style, bodyPadding = 14, children }: SectionCardProps) {
  return (
    <section className="qa-panel" style={{ marginBottom: 16, ...style }}>
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            gap: 12,
          }}
        >
          <div>
            {title && <div className="qa-panel-title" style={{ margin: 0 }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{subtitle}</div>}
          </div>
          {actions && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>}
        </div>
      )}
      <div style={{ padding: bodyPadding }}>{children}</div>
    </section>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

export function EmptyState({
  title = "No data yet",
  hint,
  /** Backwards-compat alias for `hint`. The original UI.tsx EmptyState
   *  (now removed) used `description` — keep the prop accepted so legacy
   *  call sites don't break. */
  description,
  icon,
  action,
}: {
  title?: string;
  hint?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  const body = hint ?? description;
  // Strings render with the soft icon style; ReactNodes render as-is.
  const iconNode = typeof icon === "string"
    ? <div style={{ fontSize: 32, opacity: 0.6 }}>{icon}</div>
    : icon ? <div style={{ fontSize: 32, color: "var(--muted-light)" }}>{icon}</div> : null;
  return (
    <div
      className="qa-panel"
      style={{
        padding: 40,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      {iconNode}
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {body && <div style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 420 }}>{body}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

// ─── DataSourceChips ─────────────────────────────────────────────────────────

export function DataSourceChips({
  hit,
  failed,
  note,
}: {
  hit?: string[];
  failed?: string[];
  note?: string;
}) {
  if ((!hit || hit.length === 0) && (!failed || failed.length === 0)) return null;
  return (
    <div
      className="qa-panel"
      style={{
        padding: "8px 12px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
        fontSize: 11,
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
        Data sources
      </span>
      {(hit ?? []).map((p) => (
        <span
          key={`hit-${p}`}
          style={{
            padding: "2px 9px",
            borderRadius: 10,
            background: "var(--ok-bg)",
            color: "var(--ok)",
            border: "1px solid var(--ok-border)",
            fontWeight: 600,
          }}
        >
          ● {p}
        </span>
      ))}
      {(failed ?? []).map((p) => (
        <span
          key={`fail-${p}`}
          style={{
            padding: "2px 9px",
            borderRadius: 10,
            background: "var(--bad-bg)",
            color: "var(--bad)",
            border: "1px solid var(--bad-border)",
            fontWeight: 600,
          }}
        >
          ✕ {p} unavailable
        </span>
      ))}
      {note && <span style={{ color: "var(--muted)", marginLeft: 6 }}>{note}</span>}
    </div>
  );
}

// ─── ThemeToggle ─────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

/** Light / dark mode toggle — reads + persists in localStorage under "qa-theme". */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("qa-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("qa-theme", theme);
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      style={{
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "6px 10px",
        cursor: "pointer",
        fontSize: 14,
        color: "var(--text)",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {theme === "light" ? "🌙" : "☀"}
    </button>
  );
}
