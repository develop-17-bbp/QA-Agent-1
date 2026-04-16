/**
 * Shared UI primitives — import from here instead of duplicating inline.
 *
 * Components:
 *   <Spinner />             — spinning ring (sizes: sm | md | lg)
 *   <LoadingPanel />        — centered spinner + message
 *   <SkeletonCard />        — shimmer placeholder for a card
 *   <SkeletonTable />       — shimmer placeholder for a table
 *   <EmptyState />          — icon + title + description for empty lists
 *   <ErrorBanner />         — red alert for API errors
 *   <StatCard />            — metric display (label + big number + optional sub)
 *   <SectionHeader />       — page title + description
 *   <Badge />               — coloured pill label
 *   <ProvBadge />           — data provenance source chip
 */

import type { CSSProperties, ReactNode } from "react";

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls = size === "sm" ? "qa-spinner qa-spinner--sm"
             : size === "lg" ? "qa-spinner qa-spinner--lg"
             : "qa-spinner";
  return <span className={cls} />;
}

// ─── Loading panel ────────────────────────────────────────────────────────────
export function LoadingPanel({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="qa-loading-panel">
      <Spinner size="lg" />
      <span style={{ color: "var(--muted)", fontSize: 13.5 }}>{message}</span>
    </div>
  );
}

// ─── Skeleton shimmer ─────────────────────────────────────────────────────────
export function SkeletonCard({ rows = 4, height }: { rows?: number; height?: number }) {
  if (height) {
    return <div className="qa-skeleton-block" style={{ height }} />;
  }
  return (
    <div style={{ padding: "18px 20px" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="qa-skeleton-line"
          style={{ width: i === rows - 1 ? "55%" : i % 3 === 0 ? "85%" : "72%" }}
        />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: "0 0 4px" }}>
      {/* header */}
      <div style={{ display: "flex", gap: 16, padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--glass2)" }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="qa-skeleton-line" style={{ flex: i === 0 ? 2 : 1, height: 10, marginBottom: 0 }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: 16, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="qa-skeleton-line" style={{ flex: c === 0 ? 2 : 1, height: 10, marginBottom: 0, width: undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({
  icon = "📭",
  title = "No data yet",
  description,
  action,
}: {
  icon?: string;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="qa-empty" style={{ padding: "48px 24px" }}>
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.6 }}>{icon}</div>
      <div style={{ fontWeight: 700, color: "var(--text-secondary)", fontSize: 14, marginBottom: description ? 6 : 0 }}>
        {title}
      </div>
      {description && (
        <div style={{ color: "var(--muted)", fontSize: 13, maxWidth: 380, margin: "0 auto" }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────
export function ErrorBanner({ error, style }: { error: string; style?: CSSProperties }) {
  return (
    <div className="qa-alert qa-alert--error" style={{ marginTop: 16, ...style }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>⚠</span>
      <span>{error}</span>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
type StatColor = "blue" | "green" | "red" | "amber" | "gray";

export function StatCard({
  label,
  value,
  sub,
  color = "gray",
  style,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: StatColor;
  style?: CSSProperties;
}) {
  return (
    <div className={`qa-stat-card qa-stat-card--${color}`} style={style}>
      <div className="qa-stat-card__label">{label}</div>
      <div className="qa-stat-card__value">{value}</div>
      {sub && <div className="qa-stat-card__sub">{sub}</div>}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
      <div>
        <h1 className="qa-page-title">{title}</h1>
        {description && <p className="qa-page-desc">{description}</p>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
type BadgeColor = "blue" | "green" | "red" | "amber" | "gray" | "outline";

export function Badge({ children, color = "gray" }: { children: ReactNode; color?: BadgeColor }) {
  return <span className={`qa-badge qa-badge--${color}`}>{children}</span>;
}

// ─── Provenance badge ─────────────────────────────────────────────────────────
export function ProvBadge({ dp }: { dp: any }) {
  if (!dp || typeof dp !== "object" || !("source" in dp)) return null;
  const conf: string = dp.confidence ?? "medium";
  const color: BadgeColor = conf === "high" ? "green" : conf === "medium" ? "amber" : "gray";
  return <Badge color={color}>{dp.source}</Badge>;
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────
export function Panel({
  title,
  icon,
  children,
  style,
  action,
}: {
  title?: string;
  icon?: string;
  children: ReactNode;
  style?: CSSProperties;
  action?: ReactNode;
}) {
  return (
    <div className="qa-panel" style={style}>
      {title && (
        <div className="qa-panel-header">
          {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", flex: 1 }}>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── KV row ───────────────────────────────────────────────────────────────────
export function KVRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: "1px solid var(--border)",
      gap: 12,
    }}>
      <span style={{ fontSize: 13, color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
