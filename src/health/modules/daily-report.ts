/**
 * Daily SEO report composer.
 *
 * Produces a self-contained JSON + HTML + plain-text bundle covering the
 * three things the SEO team cares about every morning:
 *   1. Broken links per site (count + top samples + status breakdown)
 *   2. PageSpeed Insights summary (mobile/desktop avg + slowest pages)
 *   3. Form & flow tests (pass/fail per configured site)
 *
 * Designed to be called by n8n's HTTP Request node on a daily cron at
 * 05:30 UTC (or any other schedule). The response is ready-to-email:
 * `subject` + `html` fields are pre-formatted so n8n can pipe them
 * straight into a Gmail / SMTP node with zero transformation.
 *
 * Can also be invoked directly via scripts/daily-report.ts — useful for
 * local testing, Windows Task Scheduler, or Linux cron if you'd rather
 * not run n8n.
 */

import type { HealthDashboardOrchestrateOptions } from "./daily-report-types.js";
import type { SiteHealthReport } from "../types.js";
import { flattenInsights } from "../insight-utils.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DailyReportOptions {
  /** Site URLs to crawl + analyze. Required. */
  sites: string[];
  /** When true, run PageSpeed Insights on each crawled start URL. Default true. */
  includePageSpeed?: boolean;
  /** When true, run all enabled config/sites.json form tests. Default true. */
  includeFormTests?: boolean;
  /** Subset of form-test site IDs to run (matches config/sites.json `id`). When
   *  omitted, runs every enabled site. */
  formTestSiteIds?: string[];
  /** Max pages per site. Default 50 — bounds total report build time. */
  maxPages?: number;
  /** When provided, use this existing runId instead of triggering a fresh
   *  crawl. Useful when n8n has already started a run upstream. */
  existingRunId?: string;
}

export interface DailyReportSitePart {
  hostname: string;
  startUrl: string;
  pagesVisited: number;
  brokenLinks: {
    total: number;
    byStatus: Record<string, number>;
    topSamples: Array<{ foundOn: string; target: string; status?: number; error?: string }>;
  };
  pageSpeed?: {
    mobileAvg: number | null;
    desktopAvg: number | null;
    slowestPages: Array<{ url: string; mobile?: number; desktop?: number }>;
  };
  crawlDurationMs: number;
  failed: boolean;
  failureReason?: string;
}

export interface DailyReportFormTest {
  siteId: string;
  siteName: string;
  url: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  errorMessage?: string;
}

export interface DailyReport {
  generatedAt: string;
  runId?: string;
  window: { from: string; to: string };
  summary: {
    totalSites: number;
    totalPagesVisited: number;
    totalBrokenLinks: number;
    brokenByStatus: Record<string, number>;
    formTestsTotal: number;
    formTestsPassed: number;
    formTestsFailed: number;
    pageSpeedMobileAvg: number | null;
    pageSpeedDesktopAvg: number | null;
  };
  sites: DailyReportSitePart[];
  formTests: DailyReportFormTest[];
  /** Ready-to-email subject line, e.g. "[QA-Agent] Daily SEO report · 2 sites · 42 broken · 3/4 forms passing". */
  subject: string;
  /** Ready-to-email HTML body (self-contained, inline CSS). */
  html: string;
  /** Plain-text fallback for mail clients that strip HTML. */
  text: string;
}

// ── Report composer ─────────────────────────────────────────────────────────

function summarizeCrawlReport(r: SiteHealthReport): DailyReportSitePart {
  const byStatus: Record<string, number> = {};
  for (const b of r.crawl.brokenLinks) {
    const key = typeof b.status === "number"
      ? `${Math.floor(b.status / 100)}xx (${b.status})`
      : b.error
        ? "network"
        : "other";
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  const topSamples = r.crawl.brokenLinks.slice(0, 10).map((b) => ({
    foundOn: b.foundOn,
    target: b.target,
    status: b.status,
    error: b.error,
  }));

  let pageSpeed: DailyReportSitePart["pageSpeed"];
  const pagesWithInsights = r.crawl.pages.filter((p) => {
    const fi = flattenInsights(p.insights);
    return Array.isArray(fi) && fi.length > 0;
  });
  if (pagesWithInsights.length > 0) {
    const mobileScores: number[] = [];
    const desktopScores: number[] = [];
    const slowest: { url: string; mobile?: number; desktop?: number }[] = [];
    for (const p of pagesWithInsights) {
      const fi = flattenInsights(p.insights);
      const m = fi.find((i) => i.strategy === "mobile")?.scores?.performance;
      const d = fi.find((i) => i.strategy === "desktop")?.scores?.performance;
      if (typeof m === "number") mobileScores.push(m);
      if (typeof d === "number") desktopScores.push(d);
      const low = typeof m === "number" && typeof d === "number" ? Math.min(m, d) : (m ?? d);
      if (typeof low === "number" && low < 70) {
        slowest.push({ url: p.url, mobile: m, desktop: d });
      }
    }
    slowest.sort((a, b) => {
      const av = Math.min(a.mobile ?? 100, a.desktop ?? 100);
      const bv = Math.min(b.mobile ?? 100, b.desktop ?? 100);
      return av - bv;
    });
    pageSpeed = {
      mobileAvg: mobileScores.length > 0 ? Math.round(mobileScores.reduce((a, b) => a + b, 0) / mobileScores.length) : null,
      desktopAvg: desktopScores.length > 0 ? Math.round(desktopScores.reduce((a, b) => a + b, 0) / desktopScores.length) : null,
      slowestPages: slowest.slice(0, 5),
    };
  }

  return {
    hostname: r.hostname,
    startUrl: r.startUrl,
    pagesVisited: r.crawl.pagesVisited,
    brokenLinks: {
      total: r.crawl.brokenLinks.length,
      byStatus,
      topSamples,
    },
    pageSpeed,
    crawlDurationMs: r.crawl.durationMs,
    failed: false,
  };
}

function buildSubject(summary: DailyReport["summary"]): string {
  const parts: string[] = [];
  parts.push(`${summary.totalSites} site${summary.totalSites === 1 ? "" : "s"}`);
  parts.push(`${summary.totalBrokenLinks.toLocaleString()} broken`);
  if (summary.formTestsTotal > 0) {
    parts.push(`${summary.formTestsPassed}/${summary.formTestsTotal} forms passing`);
  }
  if (summary.pageSpeedMobileAvg !== null) {
    parts.push(`mobile PSI ${summary.pageSpeedMobileAvg}/100`);
  }
  return `[QA-Agent] Daily SEO report · ${parts.join(" · ")}`;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function colorForScore(n: number | null | undefined): string {
  if (n == null) return "#94a3b8";
  if (n >= 90) return "#16a34a";
  if (n >= 70) return "#d97706";
  return "#dc2626";
}

function buildHtml(report: DailyReport): string {
  const s = report.summary;
  const headerCell = (label: string, value: string, color?: string) =>
    `<td style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:600">${esc(label)}</div>
      <div style="font-size:22px;font-weight:700;color:${color ?? "#0f172a"};margin-top:2px">${esc(value)}</div>
    </td>`;
  const statHtml = `<table role="presentation" style="width:100%;border-spacing:8px 0;margin:12px 0"><tr>
    ${headerCell("Sites", String(s.totalSites))}
    ${headerCell("Pages visited", s.totalPagesVisited.toLocaleString())}
    ${headerCell("Broken links", s.totalBrokenLinks.toLocaleString(), s.totalBrokenLinks > 0 ? "#dc2626" : "#16a34a")}
    ${headerCell("Forms pass", `${s.formTestsPassed} / ${s.formTestsTotal}`, s.formTestsFailed === 0 ? "#16a34a" : "#dc2626")}
    ${headerCell("Mobile PSI", s.pageSpeedMobileAvg === null ? "—" : `${s.pageSpeedMobileAvg}/100`, colorForScore(s.pageSpeedMobileAvg))}
    ${headerCell("Desktop PSI", s.pageSpeedDesktopAvg === null ? "—" : `${s.pageSpeedDesktopAvg}/100`, colorForScore(s.pageSpeedDesktopAvg))}
  </tr></table>`;

  const siteRows = report.sites.map((site) => {
    const topRows = site.brokenLinks.topSamples.length === 0
      ? `<tr><td colspan="3" style="padding:8px;color:#64748b;font-style:italic">No broken links — site is clean.</td></tr>`
      : site.brokenLinks.topSamples.map((b) => `<tr>
        <td style="padding:6px 10px;font-size:12px;word-break:break-all"><a href="${esc(b.foundOn)}">${esc(b.foundOn)}</a></td>
        <td style="padding:6px 10px;font-size:12px;word-break:break-all"><a href="${esc(b.target)}" style="color:#dc2626">${esc(b.target)}</a></td>
        <td style="padding:6px 10px;font-size:12px;text-align:center;font-weight:600;color:#dc2626">${esc(b.status ?? b.error ?? "—")}</td>
      </tr>`).join("");

    const statusLines = Object.entries(site.brokenLinks.byStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:600;margin-right:4px">${esc(k)}: ${v}</span>`)
      .join("");

    const psi = site.pageSpeed;
    const psiBlock = !psi ? "" : `<div style="margin-top:12px">
      <div style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:6px">PageSpeed Insights — ${site.pagesVisited.toLocaleString()} pages</div>
      <div style="display:flex;gap:12px;font-size:12px">
        <div>Mobile avg: <strong style="color:${colorForScore(psi.mobileAvg)}">${psi.mobileAvg === null ? "—" : psi.mobileAvg}/100</strong></div>
        <div>Desktop avg: <strong style="color:${colorForScore(psi.desktopAvg)}">${psi.desktopAvg === null ? "—" : psi.desktopAvg}/100</strong></div>
      </div>
      ${psi.slowestPages.length === 0 ? "" : `<div style="margin-top:8px;font-size:12px"><strong>Slowest pages (under 70):</strong>
        <ul style="margin:4px 0 0;padding-left:18px;color:#374151">
          ${psi.slowestPages.map((sp) => `<li style="margin-bottom:2px"><a href="${esc(sp.url)}" style="color:#2563eb">${esc(sp.url)}</a> — mobile ${sp.mobile ?? "—"} / desktop ${sp.desktop ?? "—"}</li>`).join("")}
        </ul></div>`}
    </div>`;

    return `<table role="presentation" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;margin:14px 0">
      <tr><td style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
        <div style="font-size:15px;font-weight:700;color:#0f172a">${esc(site.hostname)}</div>
        <div style="font-size:12px;color:#64748b">${esc(site.startUrl)} · ${site.pagesVisited.toLocaleString()} pages crawled in ${(site.crawlDurationMs / 1000).toFixed(1)}s</div>
      </td></tr>
      <tr><td style="padding:14px 16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">Broken links: <span style="color:${site.brokenLinks.total === 0 ? "#16a34a" : "#dc2626"}">${site.brokenLinks.total.toLocaleString()}</span></div>
        <div style="margin-bottom:10px">${statusLines || `<span style="color:#16a34a;font-size:11px">All links healthy ✓</span>`}</div>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif">
          <thead><tr style="background:#f8fafc">
            <th style="padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;border-bottom:1px solid #e2e8f0">Found on</th>
            <th style="padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;border-bottom:1px solid #e2e8f0">Broken target</th>
            <th style="padding:6px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;border-bottom:1px solid #e2e8f0;width:90px">Status</th>
          </tr></thead>
          <tbody>${topRows}</tbody>
        </table>
        ${site.brokenLinks.total > site.brokenLinks.topSamples.length ? `<div style="font-size:11px;color:#64748b;margin-top:6px">Showing top ${site.brokenLinks.topSamples.length} of ${site.brokenLinks.total.toLocaleString()} — open the Dashboard for the full list.</div>` : ""}
        ${psiBlock}
      </td></tr>
    </table>`;
  }).join("");

  const formRows = report.formTests.length === 0 ? "" : `
    <h2 style="font-size:16px;font-weight:700;margin:18px 0 8px;color:#0f172a">Form &amp; flow tests</h2>
    <table role="presentation" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569">Site</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569">URL</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;width:80px">Status</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;width:80px">Took</th>
      </tr></thead>
      <tbody>${report.formTests.map((f) => {
        const colour = f.status === "passed" ? "#16a34a" : f.status === "failed" ? "#dc2626" : "#64748b";
        return `<tr>
          <td style="padding:8px 12px;font-size:13px;font-weight:600;border-top:1px solid #e2e8f0">${esc(f.siteName)}</td>
          <td style="padding:8px 12px;font-size:12px;border-top:1px solid #e2e8f0"><a href="${esc(f.url)}">${esc(f.url)}</a></td>
          <td style="padding:8px 12px;text-align:center;font-size:12px;font-weight:700;color:${colour};border-top:1px solid #e2e8f0;text-transform:uppercase;letter-spacing:.04em">${esc(f.status)}</td>
          <td style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0">${(f.durationMs / 1000).toFixed(1)}s</td>
        </tr>${f.errorMessage ? `<tr><td colspan="4" style="padding:6px 12px;font-size:11px;color:#dc2626;background:#fef2f2;border-top:1px solid #fecaca">${esc(f.errorMessage)}</td></tr>` : ""}`;
      }).join("")}</tbody>
    </table>`;

  const header = `<div style="background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);padding:20px 24px;border-radius:12px;margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1d4ed8">QA-Agent · Daily SEO Report</div>
    <h1 style="font-size:24px;font-weight:800;margin:6px 0 4px;color:#0f172a;letter-spacing:-.02em">${esc(report.subject.replace(/^\[QA-Agent\] /, ""))}</h1>
    <div style="font-size:12px;color:#475569">Generated ${esc(report.generatedAt)} · Run <code style="background:#fff;padding:1px 6px;border-radius:4px;font-size:11px">${esc(report.runId ?? "standalone")}</code></div>
  </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="color-scheme" content="light"/></head>
<body style="margin:0;padding:20px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a">
<div style="max-width:780px;margin:0 auto;background:#fff;padding:22px 26px;border-radius:12px;box-shadow:0 2px 10px rgba(15,23,42,.06)">
  ${header}
  ${statHtml}
  ${siteRows}
  ${formRows}
  <p style="font-size:11px;color:#94a3b8;margin-top:20px;padding-top:14px;border-top:1px solid #e2e8f0">
    Sent by QA-Agent · All data comes from live providers (crawl, Google PageSpeed, Playwright). No AI-generated metrics.
  </p>
</div>
</body></html>`;
}

function buildText(report: DailyReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`QA-Agent Daily SEO Report — ${report.generatedAt}`);
  lines.push("=".repeat(60));
  lines.push(`Sites:            ${s.totalSites}`);
  lines.push(`Pages visited:    ${s.totalPagesVisited.toLocaleString()}`);
  lines.push(`Broken links:     ${s.totalBrokenLinks.toLocaleString()}`);
  lines.push(`Form tests:       ${s.formTestsPassed}/${s.formTestsTotal} passing`);
  if (s.pageSpeedMobileAvg !== null) lines.push(`Mobile PSI avg:   ${s.pageSpeedMobileAvg}/100`);
  if (s.pageSpeedDesktopAvg !== null) lines.push(`Desktop PSI avg:  ${s.pageSpeedDesktopAvg}/100`);
  lines.push("");
  for (const site of report.sites) {
    lines.push(`--- ${site.hostname} ---`);
    lines.push(`  pages: ${site.pagesVisited} · broken: ${site.brokenLinks.total} · took ${(site.crawlDurationMs / 1000).toFixed(1)}s`);
    for (const b of site.brokenLinks.topSamples.slice(0, 5)) {
      lines.push(`    [${b.status ?? b.error ?? "—"}] ${b.target}`);
      lines.push(`        on: ${b.foundOn}`);
    }
    if (site.pageSpeed) {
      lines.push(`  PSI mobile: ${site.pageSpeed.mobileAvg ?? "—"} · desktop: ${site.pageSpeed.desktopAvg ?? "—"}`);
    }
    lines.push("");
  }
  if (report.formTests.length > 0) {
    lines.push("Form tests:");
    for (const f of report.formTests) {
      lines.push(`  ${f.status.toUpperCase().padEnd(8)} ${f.siteName} (${(f.durationMs / 1000).toFixed(1)}s)`);
      if (f.errorMessage) lines.push(`    ERROR: ${f.errorMessage}`);
    }
  }
  return lines.join("\n");
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface DailyReportInputs {
  reports: SiteHealthReport[];
  runId?: string;
  runStartedAt?: string;
  runFinishedAt?: string;
  formTests?: DailyReportFormTest[];
}

export function composeDailyReport(inputs: DailyReportInputs): DailyReport {
  const now = new Date().toISOString();
  const sitesParts = inputs.reports.map(summarizeCrawlReport);

  // Aggregate summary
  const brokenByStatus: Record<string, number> = {};
  let totalBroken = 0;
  let totalPages = 0;
  let mobileSum = 0;
  let mobileCount = 0;
  let desktopSum = 0;
  let desktopCount = 0;
  for (const s of sitesParts) {
    totalBroken += s.brokenLinks.total;
    totalPages += s.pagesVisited;
    for (const [k, v] of Object.entries(s.brokenLinks.byStatus)) {
      brokenByStatus[k] = (brokenByStatus[k] ?? 0) + v;
    }
    if (s.pageSpeed?.mobileAvg != null) { mobileSum += s.pageSpeed.mobileAvg; mobileCount++; }
    if (s.pageSpeed?.desktopAvg != null) { desktopSum += s.pageSpeed.desktopAvg; desktopCount++; }
  }

  const formTests = inputs.formTests ?? [];
  const formPassed = formTests.filter((f) => f.status === "passed").length;
  const formFailed = formTests.filter((f) => f.status === "failed").length;

  const summary: DailyReport["summary"] = {
    totalSites: sitesParts.length,
    totalPagesVisited: totalPages,
    totalBrokenLinks: totalBroken,
    brokenByStatus,
    formTestsTotal: formTests.length,
    formTestsPassed: formPassed,
    formTestsFailed: formFailed,
    pageSpeedMobileAvg: mobileCount > 0 ? Math.round(mobileSum / mobileCount) : null,
    pageSpeedDesktopAvg: desktopCount > 0 ? Math.round(desktopSum / desktopCount) : null,
  };

  const report: DailyReport = {
    generatedAt: now,
    runId: inputs.runId,
    window: { from: inputs.runStartedAt ?? now, to: inputs.runFinishedAt ?? now },
    summary,
    sites: sitesParts,
    formTests,
    subject: "",
    html: "",
    text: "",
  };
  report.subject = buildSubject(summary);
  report.html = buildHtml(report);
  report.text = buildText(report);
  return report;
}

/** Unused re-export to keep orchestrator options addressable by name. */
export type DailyReportOrchestrateOverrides = Pick<HealthDashboardOrchestrateOptions, "maxPages" | "pageSpeed">;
