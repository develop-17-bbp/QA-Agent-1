/**
 * Shared skeleton placeholders — shape-matched to the real widgets so the
 * page doesn't shift layout when data arrives. Every skeleton uses the
 * `qa-skeleton` class for the shimmer animation (defined in index.css);
 * that class already respects prefers-reduced-motion.
 *
 * See MetricCard.tsx for MetricCardSkeleton / SkeletonRow / SkeletonCard —
 * this file adds the larger page-level skeletons.
 */

import type { CSSProperties } from "react";

/** Mimics a <PageHero /> while the real hero hydrates. */
export function HeroSkeleton({ showKpis = true, showAccent = true }: { showKpis?: boolean; showAccent?: boolean } = {}) {
  return (
    <div
      className="qa-skeleton"
      style={{
        position: "relative",
        padding: "22px 24px",
        marginBottom: 22,
        background: "var(--glass)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {showAccent && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "0 0 auto 0",
            height: 3,
            background: "var(--border)",
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flex: 1, minWidth: 260 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--border)" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 10, width: 90, borderRadius: 3, background: "var(--border)" }} />
            <div style={{ height: 24, width: 220, borderRadius: 4, background: "var(--border)" }} />
            <div style={{ height: 12, width: "80%", maxWidth: 520, borderRadius: 3, background: "var(--border)", opacity: 0.7 }} />
          </div>
        </div>
        {showKpis && (
          <div style={{ display: "flex", gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 110, height: 58, borderRadius: 8, background: "var(--border)" }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Mimics a trend chart while it loads. */
export function ChartSkeleton({ height = 240, style }: { height?: number; style?: CSSProperties } = {}) {
  return (
    <div
      className="qa-skeleton qa-panel"
      style={{
        padding: 16,
        height,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ height: 12, width: 140, borderRadius: 3, background: "var(--border)" }} />
        <div style={{ height: 10, width: 80, borderRadius: 3, background: "var(--border)", opacity: 0.6 }} />
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 8, paddingTop: 12 }}>
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: "var(--border)",
              borderRadius: 3,
              height: `${30 + ((i * 37) % 60)}%`,
              opacity: 0.75,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Mimics a multi-column data table while rows load. */
export function TableSkeleton({ rows = 6, cols = 5, showHeader = true }: { rows?: number; cols?: number; showHeader?: boolean } = {}) {
  return (
    <div
      className="qa-skeleton qa-panel"
      style={{ padding: 0, overflow: "hidden" }}
    >
      {showHeader && (
        <div style={{ display: "flex", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--glass2)" }}>
          {Array.from({ length: cols }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 10,
                flex: i === 0 ? 2 : 1,
                borderRadius: 3,
                background: "var(--border)",
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              style={{
                height: 12,
                flex: c === 0 ? 2 : 1,
                borderRadius: 3,
                background: "var(--border)",
                opacity: 0.85 - (c * 0.08),
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
