import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SiteHealthReport } from "./types.js";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildSiteHealthHtml(report: SiteHealthReport): string {
  const ps = report.pageSpeed;
  const c = report.crawl;
  const brokenRows =
    c.brokenLinks.length === 0
      ? `<tr><td colspan="4" class="ok">No broken internal links detected in this run.</td></tr>`
      : c.brokenLinks
          .map(
            (b) => `<tr>
  <td>${esc(b.foundOn)}</td>
  <td><a href="${esc(b.target)}">${esc(b.target)}</a></td>
  <td>${b.status ?? "—"}</td>
  <td class="err">${esc(b.error ?? "")}</td>
</tr>`,
          )
          .join("\n");

  const psBlock = ps
    ? `<section>
  <h2>PageSpeed Insights (${esc(ps.strategy)})</h2>
  <p class="meta">Comparable to <a href="https://pagespeed.web.dev/">PageSpeed Insights</a> (requires API key).</p>
  ${
    ps.error
      ? `<p class="err">PageSpeed error: ${esc(ps.error)}</p>
  <p class="meta">If the key is “not valid”: (1) In Google Cloud, enable <strong>PageSpeed Insights API</strong> for the project that owns the key. (2) Under Credentials → your API key → <strong>Application restrictions</strong>, use <em>None</em> or <em>IP addresses</em> (this CLI is not a browser — <strong>HTTP referrers</strong> restrictions will fail). (3) Under <strong>API restrictions</strong>, allow <em>PageSpeed Insights API</em> (or don’t restrict APIs while testing). See <a href="https://developers.google.com/speed/docs/insights/v5/get-started">get started</a>.</p>`
      : `<table>
    <tr><th>Performance</th><th>Accessibility</th><th>Best practices</th><th>SEO</th></tr>
    <tr>
      <td>${ps.performanceScore ?? "—"}</td>
      <td>${ps.accessibilityScore ?? "—"}</td>
      <td>${ps.bestPracticesScore ?? "—"}</td>
      <td>${ps.seoScore ?? "—"}</td>
    </tr>
  </table><p class="meta">Scores are 0–100 (Lighthouse).</p>`
  }
</section>`
    : `<section><h2>PageSpeed Insights</h2><p class="meta">Skipped (no <code>GOOGLE_PAGESPEED_API_KEY</code>).</p></section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Health — ${esc(c.hostname)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #111; max-width: 960px; }
    h1 { font-size: 1.25rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 0.9rem; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; vertical-align: top; word-break: break-all; }
    th { background: #f4f4f4; }
    .ok { color: #0a7a2d; }
    .err { color: #b00020; }
    .meta { color: #555; font-size: 0.85rem; }
    section { margin-top: 28px; }
  </style>
</head>
<body>
  <h1>Site health: ${esc(c.hostname)}</h1>
  <p><strong>Start URL:</strong> <a href="${esc(c.startUrl)}">${esc(c.startUrl)}</a></p>
  <p><strong>Run window:</strong> ${esc(report.startedAt)} → ${esc(report.finishedAt)}</p>
  <p><strong>Crawl duration:</strong> ${c.durationMs}ms · <strong>Pages fetched (BFS):</strong> ${c.pagesVisited} · <strong>Unique URLs checked:</strong> ${c.uniqueUrlsChecked}</p>

  ${psBlock}

  <section>
    <h2>Broken internal links</h2>
    <table>
      <thead><tr><th>Found on</th><th>Target</th><th>HTTP</th><th>Detail</th></tr></thead>
      <tbody>${brokenRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Pages fetched</h2>
    <table>
      <thead><tr><th>URL</th><th>Status</th><th>OK</th></tr></thead>
      <tbody>
        ${c.pages
          .map(
            (p) => `<tr class="${p.ok ? "ok" : "err"}">
          <td><a href="${esc(p.url)}">${esc(p.url)}</a></td>
          <td>${p.status}</td>
          <td>${p.ok ? "yes" : "no"}</td>
        </tr>`,
          )
          .join("\n")}
      </tbody>
    </table>
  </section>
</body>
</html>`;
}

export async function writeSiteHealthReports(options: {
  report: SiteHealthReport;
  outDir: string;
}): Promise<{ htmlPath: string; jsonPath: string }> {
  await mkdir(options.outDir, { recursive: true });
  const htmlPath = path.join(options.outDir, "report.html");
  const jsonPath = path.join(options.outDir, "report.json");
  await writeFile(htmlPath, buildSiteHealthHtml(options.report), "utf8");
  await writeFile(jsonPath, JSON.stringify(options.report, null, 2), "utf8");
  return { htmlPath, jsonPath };
}

export function buildHealthIndexHtml(items: { siteId: string; hostname: string; reportPath: string }[]): string {
  const rows = items
    .map(
      (i) => `<tr>
  <td>${esc(i.hostname)}</td>
  <td><a href="${esc(i.reportPath)}">report.html</a></td>
</tr>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>QA-Agent — health run index</title>
<style>body{font-family:system-ui;margin:24px;} table{border-collapse:collapse;} th,td{border:1px solid #ccc;padding:8px;}</style>
</head>
<body>
<h1>Health check run</h1>
<table><thead><tr><th>Site</th><th>Report</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
