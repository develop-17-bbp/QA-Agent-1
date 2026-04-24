/**
 * DataTableCells — shared cell renderers that raise the information
 * density of tables without adding columns. Use inside FilterableTable
 * column `render` functions.
 *
 *   <SparklineCell values={[3, 5, 4, 7, 6, 8]} />
 *   <BarCell value={72} max={100} tone="warn" />
 *   <DeltaCell value={-4.2} />
 *
 * Each component is self-contained SVG + CSS — no Recharts dependency
 * for these tiny visualizations (Recharts is heavy and has ResponsiveContainer
 * overhead that hurts in dense tables).
 */

import type { CSSProperties } from "react";
import { Icon } from "./Icon";

type Tone = "default" | "ok" | "warn" | "bad" | "accent";
const TONE_COLORS: Record<Tone, string> = {
  default: "var(--text-secondary)",
  ok:      "var(--ok)",
  warn:    "var(--warn)",
  bad:     "var(--bad)",
  accent:  "var(--accent)",
};

// ── SparklineCell ──────────────────────────────────────────────────────

export interface SparklineCellProps {
  values: number[];
  /** Fixed pixel width for the sparkline. Default 100. */
  width?: number;
  /** Fixed pixel height. Default 24. */
  height?: number;
  /** Color override. Default current text color. */
  color?: string;
  /** Hide the last-value pill shown to the right of the sparkline. */
  hideValue?: boolean;
  /** Tone for the last-value pill. */
  tone?: Tone;
}

export function SparklineCell({ values, width = 100, height = 24, color, hideValue, tone = "default" }: SparklineCellProps) {
  if (!values || values.length === 0) return <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>;
  const safe = values.filter((v) => Number.isFinite(v));
  if (safe.length === 0) return <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>;
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;
  const step = safe.length > 1 ? width / (safe.length - 1) : width;
  const pts = safe.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`);
  const path = pts.length > 1 ? `M ${pts.join(" L ")}` : `M 0,${height / 2} L ${width},${height / 2}`;
  const area = pts.length > 1 ? `M 0,${height} L ${pts.join(" L ")} L ${width},${height} Z` : null;
  const strokeColor = color ?? TONE_COLORS[tone];
  const last = safe[safe.length - 1]!;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, verticalAlign: "middle" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: "block" }}>
        {area && <path d={area} fill={strokeColor} opacity={0.14} />}
        <path d={path} stroke={strokeColor} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={(safe.length - 1) * step} cy={height - ((last - min) / range) * height} r={2.25} fill={strokeColor} />
      </svg>
      {!hideValue && (
        <span style={{ fontSize: 11, fontWeight: 600, color: TONE_COLORS[tone], fontVariantNumeric: "tabular-nums" }}>{fmt(last)}</span>
      )}
    </span>
  );
}

// ── BarCell ────────────────────────────────────────────────────────────

export interface BarCellProps {
  value: number | null | undefined;
  /** Max reference for the bar. Default 100. */
  max?: number;
  /** Explicit tone for the bar color. If omitted, computed from the value
   *  relative to max (higher = bad for some metrics like KD — flip via
   *  `invert`). */
  tone?: Tone;
  /** Treat high values as bad (for difficulty) vs good (for scores). Default "high-is-bad". */
  invert?: boolean;
  width?: number;
  height?: number;
  /** Show the numeric value next to the bar. Default true. */
  showValue?: boolean;
  format?: "percent" | "raw";
  style?: CSSProperties;
}

export function BarCell({ value, max = 100, tone, invert, width = 80, height = 6, showValue = true, format = "raw", style }: BarCellProps) {
  if (value == null || !Number.isFinite(value)) {
    return <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>;
  }
  const pct = Math.max(0, Math.min(1, value / max));
  const computedTone: Tone = tone ?? ((): Tone => {
    // invert=true means high is bad (keyword difficulty style)
    if (invert === false) {
      if (pct >= 0.8) return "ok";
      if (pct >= 0.5) return "warn";
      return "bad";
    }
    if (pct >= 0.8) return "bad";
    if (pct >= 0.5) return "warn";
    return "ok";
  })();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, verticalAlign: "middle", ...style }}>
      <span style={{ position: "relative", width, height, background: "var(--border)", borderRadius: 999, overflow: "hidden", display: "inline-block" }}>
        <span style={{
          position: "absolute", left: 0, top: 0, height: "100%",
          width: `${pct * 100}%`,
          background: TONE_COLORS[computedTone],
          borderRadius: 999,
          transition: "width 0.28s ease-out",
        }} />
      </span>
      {showValue && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: TONE_COLORS[computedTone], fontVariantNumeric: "tabular-nums", minWidth: 24 }}>
          {format === "percent" ? `${Math.round(value)}%` : fmt(value)}
        </span>
      )}
    </span>
  );
}

// ── DeltaCell ──────────────────────────────────────────────────────────

export interface DeltaCellProps {
  /** Signed delta. Positive → up/gain; negative → down/drop. */
  value: number | null | undefined;
  /** Flip the semantics (used for rank where lower = better). */
  invert?: boolean;
  /** Format: `"number"` (raw), `"percent"`, or `"rank"` (e.g. "↓ 4 positions"). */
  format?: "number" | "percent" | "rank";
  /** Zero rendering — "dash" shows em-dash, "hidden" shows nothing. */
  zeroAs?: "dash" | "hidden";
}

export function DeltaCell({ value, invert, format = "number", zeroAs = "dash" }: DeltaCellProps) {
  if (value == null || !Number.isFinite(value)) {
    return <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>;
  }
  if (value === 0) {
    if (zeroAs === "hidden") return null;
    return <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>;
  }
  // Positive = up semantically; invert flips whether up is good or bad.
  const semanticallyGood = invert ? value < 0 : value > 0;
  const color = semanticallyGood ? "var(--ok)" : "var(--bad)";
  const iconName = invert
    ? (value < 0 ? "trending-up" : "trending-down")
    : (value > 0 ? "trending-up" : "trending-down");
  const abs = Math.abs(value);
  const display = format === "percent"
    ? `${abs.toFixed(abs >= 10 ? 0 : 1)}%`
    : format === "rank"
      ? `${Math.round(abs)} ${abs === 1 ? "position" : "positions"}`
      : fmt(abs);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 12, fontWeight: 700, color,
      fontVariantNumeric: "tabular-nums",
    }}>
      <Icon name={iconName} size={13} />
      {display}
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}
