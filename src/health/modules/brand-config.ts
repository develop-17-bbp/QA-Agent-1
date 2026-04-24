/**
 * Brand config — logo + name + primary color for white-label PDF reports
 * and the dashboard topbar. Stored in the existing runtime-keys store so
 * operators can configure via /integrations without touching .env.
 *
 * Whitelisted keys (added to runtime-keys.ts whitelist):
 *   BRAND_NAME        — display name shown in PDF header + dashboard (default: "QA Agent")
 *   BRAND_LOGO_URL    — absolute URL to a logo image (PNG/SVG); displayed top-left
 *   BRAND_PRIMARY_HEX — accent color, e.g. "#4f46e5"; used in PDF banner
 */

import { resolveKey } from "./runtime-keys.js";

export interface BrandConfig {
  name: string;
  logoUrl?: string;
  primaryHex: string;
  isCustom: boolean;
}

export function getBrandConfig(): BrandConfig {
  const name = resolveKey("BRAND_NAME") || "QA Agent";
  const logoUrl = resolveKey("BRAND_LOGO_URL") || undefined;
  const primaryHex = resolveKey("BRAND_PRIMARY_HEX") || "#111111";
  const isCustom = !!(resolveKey("BRAND_NAME") || resolveKey("BRAND_LOGO_URL") || resolveKey("BRAND_PRIMARY_HEX"));
  return { name, logoUrl, primaryHex, isCustom };
}

/** Inline brand banner HTML — injected at the top of PDF renders so the
 *  operator's logo + name appear on every exported page. Returns an
 *  empty string when no custom brand is set (default QA-Agent look stays). */
export function brandBannerHtml(): string {
  const cfg = getBrandConfig();
  if (!cfg.isCustom) return "";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const logoImg = cfg.logoUrl ? `<img src="${esc(cfg.logoUrl)}" alt="${esc(cfg.name)}" style="max-height:32px;max-width:160px;object-fit:contain" />` : "";
  return `
<div class="qa-brand-banner" style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:2px solid ${esc(cfg.primaryHex)};background:#ffffff;margin-bottom:18px">
  ${logoImg}
  <div style="flex:1;font-family:-apple-system,Segoe UI,sans-serif">
    <div style="font-weight:800;font-size:15px;letter-spacing:-0.02em;color:${esc(cfg.primaryHex)}">${esc(cfg.name)}</div>
    <div style="font-size:10px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase;font-weight:600">SEO Intelligence Report</div>
  </div>
  <div style="font-size:10px;color:#94a3b8;text-align:right">${new Date().toISOString().slice(0, 10)}</div>
</div>
`;
}
