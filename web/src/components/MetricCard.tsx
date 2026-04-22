/**
 * Uniform KPI card — the SEMrush-style metric tile this product was
 * missing. Use for any "big number + trend direction + provenance"
 * surface.
 *
 *   <MetricCard
 *     label="Monthly volume"
 *     value={24_000}
 *     format="compact"
 *     delta={+12.4}
 *     sparkline={[800, 1200, 900, 1600, 1400, 1800, 2000]}
 *     source="google-ads"
 *     tone="accent"
 *   />
 *
 * Value is any number or string. Format controls how numbers render
 * (compact = "24K", percent = "12.4%", raw = "24000"). Delta is an
 * optional signed percent — positive renders green ↑, negative red ↓.
 * Sparkline is an optional inline mini-chart (pure SVG, no recharts to
 * keep the card light on bundle). Source renders as a small provenance
 * chip so users can tell at a glance whether the number is from Google
 * Ads (definitive), estimation, or a third-party scrape.
 *
 * The Skeleton variant mimics the same layout with shimmering gradients
 * so perceived latency is lower on slow pages — users see the shape of
 * the answer before the numbers arrive.
 */

import { useMemo } from "react";

export type MetricCardTone = "default" | "accent" | "ok" | "warn" | "bad";
export type MetricCardFormat = "raw" | "compact" | "percent" | "currency" | "ms";

export interface MetricCardProps {
  label: string;
  value: number | string | undefined;
  format?: MetricCardFormat;
  delta?: number; // signed percent (e.g., +12.4 = up 12.4%)
  deltaLabel?: string; // e.g., "vs last 28d"
  sparkline?: number[];
  source?: string;
  tone?: MetricCardTone;
  /** Secondary caption under the value (e.g., "across 12 keywords"). */
  caption?: string;
  /** Make the card feel clickable when it drills to another page. */
  onClick?: () => void;
}

const TONE_ACCENT: Record<MetricCardTone, { bar: string; accent: string; valueColor: string }> = {
  default: { bar: "var(--accent, #111)", accent: "var(--accent, #111)", valueColor: "var(--text)" },
  accent:  { bar: "#4f46e5",               accent: "#4f46e5",               valueColor: "var(--text)" },
  ok:      { bar: "#16a34a",               accent: "#16a34a",               valueColor: "#15803d" },
  warn:    { bar: "#d97706",               accent: "#d97706",               valueColor: "#b45309" },
  bad:     { bar: "#dc2626",               accent: "#dc2626",               valueColor: "#b91c1c" },
};

function formatValue(v: number | string | undefined, fmt: MetricCardFormat): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "—";
  switch (fmt) {
    case "percent":
      return `${v.toFixed(v >= 10 ? 0 : 1)}%`;
    case "compact":
      if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
      if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
      return String(Math.round(v));
    case "currency":
      return `$${v.toFixed(2)}`;
    case "ms":
      if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(2)}s`;
      return `${Math.round(v)}ms`;
    case "raw":
    default:
      return v.toLocaleString();
  }
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const { path, area } = useMemo(() => {
    if (data.length < 2) return { path: "", area: "" };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const W = 120;
    const H = 32;
    const step = W / (data.length - 1);
    const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`);
    return {
      path: `M ${pts.join(" L ")}`,
      area: `M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`,
    };
  }, [data]);
  if (!path) return null;
  return (
    <svg width="120" height="32" viewBox="0 0 120 32" aria-hidden style={{ display: "block" }}>
      <path d={area} fill={color} opacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MetricCard({
  label,
  value,
  format = "raw",
  delta,
  deltaLabel,
  sparkline,
  source,
  tone = "default",
  caption,
  onClick,
}: MetricCardProps) {
  const tones = TONE_ACCENT[tone];
  const deltaUp = typeof delta === "number" && delta > 0;
  const deltaDown = typeof delta === "number" && delta < 0;
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="qa-panel"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 120,
        borderTop: `3px solid ${tones.bar}`,
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)" }}>
          {label}
        </div>
        {source && (
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, padding: "2px 6px", borderRadius: 8, background: "#f8fafc", color: "var(--muted)", border: "1px solid var(--border)" }}>
            {source}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: tones.valueColor, lineHeight: 1.1 }}>
          {formatValue(value, format)}
        </div>
        {typeof delta === "number" && Number.isFinite(delta) && (
          <div style={{
            fontSize: 12, fontWeight: 700,
            color: deltaUp ? "#15803d" : deltaDown ? "#b91c1c" : "var(--muted)",
            display: "inline-flex", alignItems: "center", gap: 2,
          }}>
            <span>{deltaUp ? "↑" : deltaDown ? "↓" : "→"}</span>
            <span>{Math.abs(delta).toFixed(1)}%</span>
            {deltaLabel && <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: 4 }}>{deltaLabel}</span>}
          </div>
        )}
      </div>
      {caption && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{caption}</div>}
      {sparkline && sparkline.length >= 2 && (
        <div style={{ marginTop: "auto" }}>
          <Sparkline data={sparkline} color={tones.accent} />
        </div>
      )}
    </div>
  );
}

/** Skeleton placeholder with the exact MetricCard shape so layout doesn't
 *  jump when real data arrives. Uses a gradient-animation that respects
 *  prefers-reduced-motion. */
export function MetricCardSkeleton({ tone = "default" }: { tone?: MetricCardTone } = {}) {
  const tones = TONE_ACCENT[tone];
  return (
    <div className="qa-panel qa-skeleton" style={{
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minHeight: 120,
      borderTop: `3px solid ${tones.bar}`,
    }}>
      <div style={{ height: 10, width: 80, borderRadius: 3, background: "var(--border)" }} />
      <div style={{ height: 28, width: 120, borderRadius: 4, background: "var(--border)" }} />
      <div style={{ height: 10, width: 140, borderRadius: 3, background: "var(--border)" }} />
      <div style={{ height: 22, width: "100%", borderRadius: 3, background: "var(--border)", marginTop: "auto" }} />
    </div>
  );
}

/** Skeleton row for tabular views. */
export function SkeletonRow({ cols = 4 }: { cols?: number } = {}) {
  return (
    <div className="qa-skeleton" style={{ display: "flex", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} style={{ height: 12, flex: i === 0 ? 2 : 1, borderRadius: 3, background: "var(--border)" }} />
      ))}
    </div>
  );
}

/** Generic wide skeleton card for "console is working…" states. */
export function SkeletonCard({ rows = 4, minHeight = 180 }: { rows?: number; minHeight?: number } = {}) {
  return (
    <div className="qa-panel qa-skeleton" style={{ padding: 16, minHeight, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ height: 14, width: 180, borderRadius: 3, background: "var(--border)" }} />
      <div style={{ height: 10, width: 260, borderRadius: 3, background: "var(--border)", opacity: 0.7 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ height: 10, width: `${70 + (i % 3) * 10}%`, borderRadius: 3, background: "var(--border)" }} />
        ))}
      </div>
    </div>
  );
}
