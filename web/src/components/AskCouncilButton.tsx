/**
 * AskCouncilButton — shared CTA that deep-links to /term-intel for any
 * feature page's primary entity (keyword / domain / topic). Standardizes
 * the visual + the query-string shape so every page feels like the
 * Council is a tap away, not a separate app.
 *
 * Usage:
 *   <AskCouncilButton term={kw} />                // keyword
 *   <AskCouncilButton term={kw} domain={dom} />   // scope anchors + GSC to this domain
 *   <AskCouncilButton term={dom} compact />       // domain-only (uses compact styling for nav bars)
 */

import type { CSSProperties } from "react";

export interface AskCouncilButtonProps {
  term: string | undefined | null;
  domain?: string | undefined | null;
  /** Compact pill-style button for crowded toolbars. Default is a full CTA. */
  compact?: boolean;
  /** Override label when the default "Ask the Council about X" is too long. */
  label?: string;
  style?: CSSProperties;
}

export default function AskCouncilButton({ term, domain, compact, label, style }: AskCouncilButtonProps) {
  const t = (term ?? "").trim();
  if (!t) return null;
  const href = `/term-intel?term=${encodeURIComponent(t)}${domain ? `&domain=${encodeURIComponent(domain.trim())}` : ""}`;
  const defaultLabel = compact
    ? "🧭 Council"
    : `🧭 Ask the Council about "${t.length > 28 ? t.slice(0, 28) + "…" : t}"`;

  const base: CSSProperties = compact
    ? {
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--glass2, #f8fafc)",
        color: "var(--accent)",
        fontWeight: 600,
        fontSize: 11.5,
        textDecoration: "none",
        whiteSpace: "nowrap",
        lineHeight: 1.4,
      }
    : {
        padding: "8px 14px",
        borderRadius: 8,
        background: "var(--accent-light)",
        color: "var(--accent)",
        border: "1px solid var(--accent-muted)",
        fontWeight: 600,
        fontSize: 12.5,
        textDecoration: "none",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      };

  return (
    <a
      href={href}
      title={`Query every configured source (Ads, Trends, GSC, Bing/Yandex/Ahrefs anchors, RSS, SERPs) for "${t}" and run the 4 AI advisors`}
      style={{ ...base, ...style }}
    >
      {label ?? defaultLabel}
    </a>
  );
}
