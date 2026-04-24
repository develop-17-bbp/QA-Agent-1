/**
 * Icon — inline SVG icon set for the dashboard.
 *
 * Design rules all icons follow:
 *   - 24x24 viewBox
 *   - 1.75px stroke, round joins + caps
 *   - no fill, stroke-only (so `color` on the parent tints the icon)
 *   - minimal geometry (Lucide-inspired) so every icon reads at 14px+
 *
 * Usage:
 *   <Icon name="brain" size={16} />           // inherits currentColor
 *   <Icon name="chart" size={20} color="#16a34a" />
 *
 * Keep this file the single source for icons — don't add emoji or import
 * an icon library; both bloat the bundle or drift visually.
 */

import type { CSSProperties } from "react";

export type IconName =
  | "brain"        // agentic / council
  | "compass"      // council nav
  | "search"       // keyword / magic tool
  | "link"         // backlinks
  | "pen"          // content / writing
  | "eye"          // monitoring / positions
  | "sparkles"     // AI tools / generic
  | "plug"         // integrations
  | "home"         // dashboard / workspace
  | "history"      // run history
  | "file-text"    // reports
  | "upload"       // import
  | "bell"         // alerts
  | "clock"        // schedule
  | "trending-up"  // forecast / rising
  | "trending-down"// dropping
  | "check"        // ok / success
  | "x"            // fail / error
  | "alert"        // warn
  | "info"         // info
  | "bar-chart"    // analytics
  | "globe"        // region / worldwide
  | "external"     // external link
  | "chevron-right"
  | "chevron-down"
  | "arrow-right"
  | "filter"
  | "download"
  | "settings"
  | "refresh"
  | "play"
  | "pause"
  | "trash"
  | "zap"          // fast / agent-live
  | "target"
  | "menu"         // hamburger / mobile nav
  | "x-circle";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
  /** Screen-reader label; leaves the icon aria-hidden when omitted. */
  label?: string;
}

const PATHS: Record<IconName, string> = {
  "brain": "M9 4a3 3 0 0 0-3 3v.2a3 3 0 0 0-2 2.8v1a3 3 0 0 0 1 2.25V15a3 3 0 0 0 3 3h1v2 M15 4a3 3 0 0 1 3 3v.2a3 3 0 0 1 2 2.8v1a3 3 0 0 1-1 2.25V15a3 3 0 0 1-3 3h-1v2 M9 4a3 3 0 0 1 3 3v13 M15 4a3 3 0 0 0-3 3",
  "compass": "M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1 7 17 M17 7l2.1-2.1 M15 9l-2.5 5.5L7 15l2.5-5.5L15 9z",
  "search": "M11 2a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM21 21l-4-4",
  "link": "M10 13a4 4 0 0 0 5 1l3-3a4 4 0 0 0-5-6l-1 1 M14 11a4 4 0 0 0-5-1l-3 3a4 4 0 0 0 5 6l1-1",
  "pen": "M14 3l7 7-11 11H3v-7L14 3z M12 5l7 7",
  "eye": "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "sparkles": "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z M5 17l.75 2.25L8 20l-2.25.75L5 23l-.75-2.25L2 20l2.25-.75L5 17z M19 14l.5 1.5L21 16l-1.5.5L19 18l-.5-1.5L17 16l1.5-.5L19 14z",
  "plug": "M9 2v4 M15 2v4 M7 6h10v4a5 5 0 0 1-10 0V6z M12 15v7",
  "home": "M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H10v6H6a2 2 0 0 1-2-2v-9z",
  "history": "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 8v4l3 2",
  "file-text": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z M14 2v6h6 M8 13h8 M8 17h8 M8 9h3",
  "upload": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  "bell": "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z M10 21a2 2 0 0 0 4 0",
  "clock": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v6l4 2",
  "trending-up": "M3 17l6-6 4 4 8-8 M14 7h7v7",
  "trending-down": "M3 7l6 6 4-4 8 8 M14 17h7v-7",
  "check": "M5 12l5 5L20 7",
  "x": "M6 6l12 12 M18 6 6 18",
  "alert": "M12 3L2 21h20L12 3z M12 9v5 M12 17.5v.5",
  "info": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 8v.5 M12 12v4",
  "bar-chart": "M3 3v18h18 M7 16v-5 M12 16V8 M17 16v-3",
  "globe": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20",
  "external": "M7 17L17 7 M9 7h8v8",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "arrow-right": "M5 12h14 M13 6l6 6-6 6",
  "filter": "M3 6h18l-7 9v6l-4-2v-4L3 6z",
  "download": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  "settings": "M12 2l1.5 3 3.5-.5.5 3.5 3 1.5-1.5 3 1.5 3-3 1.5-.5 3.5-3.5-.5L12 22l-1.5-3-3.5.5-.5-3.5-3-1.5 1.5-3L3.5 8l3-1.5.5-3.5 3.5.5L12 2z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  "refresh": "M3 12a9 9 0 0 1 15-6.7L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15 6.7L3 16 M3 21v-5h5",
  "play": "M8 5v14l11-7L8 5z",
  "pause": "M6 4v16 M18 4v16",
  "trash": "M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6 M10 11v6 M14 11v6",
  "zap": "M13 2 3 14h7l-1 8 10-12h-7l1-8z",
  "target": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  "menu": "M3 6h18 M3 12h18 M3 18h18",
  "x-circle": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M15 9l-6 6 M9 9l6 6",
};

export function Icon({ name, size = 16, color, style, className, label }: IconProps) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
      className={className}
    >
      {d.split(" M").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}

export default Icon;
