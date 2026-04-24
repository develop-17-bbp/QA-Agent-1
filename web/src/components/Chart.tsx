/**
 * Chart — Recharts presets with the "premium SaaS" polish details that
 * default Recharts skips: gradient fills, refined grid lines, custom
 * tooltip cards, proper empty states, and colors sourced from our CSS
 * palette tokens (so dark-mode flips automatically).
 *
 * Usage:
 *   <TrendChart
 *     height={260}
 *     data={rows}
 *     xKey="at"
 *     series={[{ key: "position", label: "Rank", color: "var(--chart-1)" }]}
 *   />
 *
 * All components accept an `emptyState` prop to render instead of an
 * axis-only chart when data is empty.
 */

import type { CSSProperties, ReactNode } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export interface ChartSeries {
  key: string;
  label?: string;
  /** Any CSS color — defaults rotate through --chart-1..8. */
  color?: string;
  /** Reverse Y-axis semantics for this series? (Used in rank charts.) */
  yReversed?: boolean;
}

const DEFAULT_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
];

interface CommonChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: ChartSeries[];
  height?: number;
  emptyState?: ReactNode;
  yReversed?: boolean;
  /** ISO domain values for Y-axis; defaults to auto. */
  yDomain?: [number | "auto", number | "auto"];
  style?: CSSProperties;
  /** When true, hide the legend (useful for 1-series charts). */
  hideLegend?: boolean;
  /** Formatter for X-axis tick labels. */
  xTickFormatter?: (v: unknown) => string;
  /** Formatter for Y-axis tick labels. */
  yTickFormatter?: (v: number) => string;
  /** Formatter for tooltip value. */
  tooltipValueFormatter?: (v: unknown, series: ChartSeries) => string;
}

/** Custom tooltip — card with shadow and colored series rows. Replaces
 *  Recharts' default white box with black text. */
interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: { name: string; value: unknown; color: string; dataKey: string }[];
}
function makeTooltipFormatter(valueFormatter?: (v: unknown, series: ChartSeries) => string, xTickFormatter?: (v: unknown) => string, series?: ChartSeries[]) {
  return function CustomTooltip({ active, label, payload }: TooltipProps) {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div style={{
        background: "var(--glass)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        boxShadow: "var(--shadow-md)",
        fontSize: 12,
        minWidth: 140,
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
          {xTickFormatter ? xTickFormatter(label) : String(label ?? "")}
        </div>
        {payload.map((p) => {
          const s = series?.find((ss) => ss.key === p.dataKey);
          const formatted = valueFormatter && s ? valueFormatter(p.value, s) : String(p.value ?? "—");
          return (
            <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
              <span style={{ color: "var(--text-secondary)", flex: 1 }}>{p.name}</span>
              <span style={{ fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{formatted}</span>
            </div>
          );
        })}
      </div>
    );
  };
}

function commonAxisStyle() {
  return { fontSize: 11, fill: "var(--muted)" } as const;
}

function Empty({ children, height }: { children: ReactNode; height: number }) {
  return (
    <div style={{
      height, display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--muted)", fontSize: 13, background: "var(--glass2)",
      border: "1px dashed var(--border)", borderRadius: 8, padding: 20, textAlign: "center",
    }}>
      {children}
    </div>
  );
}

// ── Area (gradient fill) ────────────────────────────────────────────────

export function AreaTrendChart(props: CommonChartProps) {
  const { data, xKey, series, height = 240, emptyState, yReversed, yDomain, hideLegend, xTickFormatter, yTickFormatter, tooltipValueFormatter, style } = props;
  if (data.length === 0) return emptyState ? <>{emptyState}</> : <Empty height={height}>No data</Empty>;
  const gradientPrefix = `chart-grad-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div style={style}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => {
              const color = s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!;
              return (
                <linearGradient key={s.key} id={`${gradientPrefix}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.03} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={commonAxisStyle()} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={xTickFormatter as ((v: any) => string) | undefined} />
          <YAxis tick={commonAxisStyle()} tickLine={false} axisLine={false} reversed={yReversed} domain={yDomain} tickFormatter={yTickFormatter} width={48} />
          <Tooltip content={makeTooltipFormatter(tooltipValueFormatter, xTickFormatter, series) as unknown as never} />
          {!hideLegend && series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => {
            const color = s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!;
            return (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={color} strokeWidth={2} fill={`url(#${gradientPrefix}-${i})`} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Line ────────────────────────────────────────────────────────────────

export function LineTrendChart(props: CommonChartProps) {
  const { data, xKey, series, height = 240, emptyState, yReversed, yDomain, hideLegend, xTickFormatter, yTickFormatter, tooltipValueFormatter, style } = props;
  if (data.length === 0) return emptyState ? <>{emptyState}</> : <Empty height={height}>No data</Empty>;
  return (
    <div style={style}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={commonAxisStyle()} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={xTickFormatter as ((v: any) => string) | undefined} />
          <YAxis tick={commonAxisStyle()} tickLine={false} axisLine={false} reversed={yReversed} domain={yDomain} tickFormatter={yTickFormatter} width={48} />
          <Tooltip content={makeTooltipFormatter(tooltipValueFormatter, xTickFormatter, series) as unknown as never} />
          {!hideLegend && series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => {
            const color = s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!;
            return (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Bar ─────────────────────────────────────────────────────────────────

export function BarTrendChart(props: CommonChartProps) {
  const { data, xKey, series, height = 240, emptyState, yTickFormatter, xTickFormatter, tooltipValueFormatter, hideLegend, style } = props;
  if (data.length === 0) return emptyState ? <>{emptyState}</> : <Empty height={height}>No data</Empty>;
  return (
    <div style={style}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={commonAxisStyle()} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={xTickFormatter as ((v: any) => string) | undefined} />
          <YAxis tick={commonAxisStyle()} tickLine={false} axisLine={false} tickFormatter={yTickFormatter} width={48} />
          <Tooltip content={makeTooltipFormatter(tooltipValueFormatter, xTickFormatter, series) as unknown as never} cursor={{ fill: "var(--glass2)" }} />
          {!hideLegend && series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => {
            const color = s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!;
            return <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={color} radius={[4, 4, 0, 0]} />;
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { Empty as ChartEmpty };
