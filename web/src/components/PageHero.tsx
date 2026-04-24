/**
 * PageHero — richer flagship-page header with an icon, optional KPI strip
 * on the right, and an optional gradient accent. Use on pages where the
 * "headline numbers" matter at a glance (Dashboard, Forecast, Council).
 *
 * For workaday pages, keep using <PageShell /> — this is additive.
 *
 *   <PageHero
 *     icon="sparkles"
 *     eyebrow="Predictive"
 *     title="Forecast"
 *     subtitle="30-day rank projections grounded in YOUR tracked history."
 *     kpis={[
 *       { label: "Avg Δ rank", value: -2.4, tone: "ok" },
 *       { label: "At-risk",    value: 7,    tone: "bad" },
 *     ]}
 *     actions={<button className="qa-button">Run forecast</button>}
 *     accent
 *   />
 */

import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface PageHeroKpi {
  label: string;
  value: ReactNode;
  tone?: "default" | "ok" | "warn" | "bad" | "accent";
  caption?: string;
}

export interface PageHeroProps {
  icon?: IconName;
  /** Small uppercase label above the title (e.g. "Predictive", "Intelligence"). */
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  /** Inline KPIs rendered to the right of the title block. */
  kpis?: PageHeroKpi[];
  /** Right-aligned action buttons (rendered under KPIs, or next to title if no KPIs). */
  actions?: ReactNode;
  /** Show a subtle accent gradient stripe on the top edge. */
  accent?: boolean;
}

const TONE_COLORS: Record<NonNullable<PageHeroKpi["tone"]>, string> = {
  default: "var(--text)",
  ok:      "var(--ok)",
  warn:    "var(--warn)",
  bad:     "var(--bad)",
  accent:  "var(--accent)",
};

export function PageHero({ icon, eyebrow, title, subtitle, kpis, actions, accent }: PageHeroProps) {
  return (
    <div
      style={{
        position: "relative",
        padding: "22px 24px",
        marginBottom: 22,
        background: "var(--glass)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      {accent && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "0 0 auto 0",
            height: 3,
            background: "linear-gradient(90deg, var(--chart-1), var(--chart-5), var(--chart-2))",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flex: 1, minWidth: 260 }}>
          {icon && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "var(--accent-light)",
                color: "var(--accent)",
                flexShrink: 0,
              }}
              aria-hidden
            >
              <Icon name={icon} size={22} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--accent)", marginBottom: 4 }}>
                {eyebrow}
              </div>
            )}
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)", lineHeight: 1.15 }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5, maxWidth: 720 }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {(kpis && kpis.length > 0) || actions ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
            {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
            {kpis && kpis.length > 0 && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {kpis.map((k, i) => (
                  <div
                    key={`${k.label}-${i}`}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "var(--glass2)",
                      border: "1px solid var(--border)",
                      minWidth: 96,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)" }}>
                      {k.label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: TONE_COLORS[k.tone ?? "default"], fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                      {k.value}
                    </div>
                    {k.caption && (
                      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{k.caption}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
