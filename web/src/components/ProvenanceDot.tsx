/**
 * ProvenanceDot + ProvenanceBadge + DataPointValue — shared components
 * that render a numeric DataPoint with its source/confidence/note visible.
 *
 * This is the honest-data spine: when a user hovers a number anywhere in
 * the product, they should see WHERE the number came from (google-ads /
 * bing-webmaster / crux / llm-estimate / etc.), how confident we are
 * (high / medium / low), and an optional note describing the caveat
 * (e.g. "GSC · 2-day delay" or "estimated via trends × wikipedia blend").
 *
 * Three progressive shapes for callers to pick from:
 *
 *   <ProvenanceDot source="google-ads" confidence="high" />
 *     Just a 8px colored dot with a tooltip — minimal footprint. Drop
 *     next to any number.
 *
 *   <ProvenanceBadge source="google-ads" confidence="high" note="…" />
 *     Colored pill with the source name spelled out — use in tables.
 *
 *   <DataPointValue dataPoint={{ value, source, confidence, note }} format="compact" />
 *     Wraps a number + dot in one span. Handles format + null rendering.
 *
 * Color conventions mirror the existing source-honesty legend:
 *   high confidence  → green (#22c55e)
 *   medium           → amber (#eab308)
 *   low              → gray  (#94a3b8)
 *   LLM-only         → blue  (#3b82f6)  — when source contains "llm" / "ollama" / "estimate"
 */

import type { CSSProperties } from "react";

export type Confidence = "high" | "medium" | "low";

export interface ProvenanceInfo {
  source?: string;
  confidence?: Confidence;
  note?: string;
}

function isLlmSource(source: string | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return s.includes("llm") || s.includes("ollama") || s.includes("estimate") || s.includes("inferred");
}

function dotColor(info: ProvenanceInfo): string {
  if (isLlmSource(info.source)) return "#3b82f6";
  const c = info.confidence ?? "low";
  return c === "high" ? "#22c55e" : c === "medium" ? "#eab308" : "#94a3b8";
}

function tooltipText(info: ProvenanceInfo): string {
  const parts: string[] = [];
  if (info.source) parts.push(`Source: ${info.source}`);
  if (info.confidence) parts.push(`Confidence: ${info.confidence}`);
  if (info.note) parts.push(info.note);
  if (parts.length === 0) return "No provenance recorded";
  return parts.join(" · ");
}

export function ProvenanceDot({ source, confidence, note, size = 8 }: ProvenanceInfo & { size?: number }) {
  const title = tooltipText({ source, confidence, note });
  return (
    <span
      aria-label={title}
      title={title}
      style={{
        display: "inline-block",
        width: size, height: size,
        borderRadius: "50%",
        background: dotColor({ source, confidence }),
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    />
  );
}

export function ProvenanceBadge({ source, confidence, note, style }: ProvenanceInfo & { style?: CSSProperties }) {
  if (!source) return null;
  const title = tooltipText({ source, confidence, note });
  const color = dotColor({ source, confidence });
  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
        padding: "1px 6px", borderRadius: 8,
        background: `${color}20`, color,
        ...style,
      }}
    >
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {source}
    </span>
  );
}

export type DataPointLike<T = unknown> = { value: T; source?: string; confidence?: Confidence; note?: string } | null | undefined;

function formatValue(v: unknown, format?: "raw" | "compact" | "percent" | "currency" | "ms"): string {
  if (v == null || v === "") return "—";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  switch (format) {
    case "percent": return `${v.toFixed(v >= 10 ? 0 : 1)}%`;
    case "compact":
      if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
      if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
      return String(Math.round(v));
    case "currency": return `$${v.toFixed(2)}`;
    case "ms":
      if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(2)}s`;
      return `${Math.round(v)}ms`;
    case "raw":
    default:
      return v.toLocaleString();
  }
}

export interface DataPointValueProps {
  dataPoint: DataPointLike;
  format?: "raw" | "compact" | "percent" | "currency" | "ms";
  /** When the DataPoint is missing entirely, fall back to this literal. */
  fallback?: React.ReactNode;
  style?: CSSProperties;
  /** Dot size — 0 to hide the dot (useful when context already says the source). */
  dotSize?: number;
}

export function DataPointValue({ dataPoint, format = "raw", fallback = "—", style, dotSize = 7 }: DataPointValueProps) {
  if (!dataPoint) return <>{fallback}</>;
  const info: ProvenanceInfo = { source: dataPoint.source, confidence: dataPoint.confidence, note: dataPoint.note };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...style }}>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatValue(dataPoint.value, format)}</span>
      {dotSize > 0 && <ProvenanceDot {...info} size={dotSize} />}
    </span>
  );
}
