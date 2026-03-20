import type { RunSummary } from "../types.js";

export function buildTextSummary(summary: RunSummary): string {
  const lines: string[] = [
    `QA-Agent run ${summary.runId}`,
    `Config: ${summary.configPath}`,
    `Started: ${summary.startedAt}`,
    `Finished: ${summary.finishedAt}`,
    "",
  ];

  for (const r of summary.results) {
    const extra = r.errorMessage ? ` — ${r.errorMessage}` : "";
    const shot = r.screenshotPath ? ` [screenshot: ${r.screenshotPath}]` : "";
    lines.push(`${r.status.toUpperCase()}  ${r.siteName} (${r.siteId})  ${r.durationMs}ms${extra}${shot}`);
  }

  const passed = summary.results.filter((r) => r.status === "passed").length;
  const failed = summary.results.filter((r) => r.status === "failed").length;
  const skipped = summary.results.filter((r) => r.status === "skipped").length;
  lines.push("", `Totals: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  return lines.join("\n");
}

export function buildHtmlSummary(summary: RunSummary): string {
  const rows = summary.results
    .map((r) => {
      const statusClass =
        r.status === "passed" ? "ok" : r.status === "failed" ? "fail" : "skip";
      const err = r.errorMessage ? `<pre class="err">${escapeHtml(r.errorMessage)}</pre>` : "";
      const shot = r.screenshotPath
        ? `<div class="muted">${escapeHtml(r.screenshotPath)}</div>`
        : "";
      return `<tr class="${statusClass}">
  <td>${escapeHtml(r.status)}</td>
  <td>${escapeHtml(r.siteName)}</td>
  <td><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></td>
  <td>${r.durationMs}ms</td>
  <td>${err}${shot}</td>
</tr>`;
    })
    .join("\n");

  const passed = summary.results.filter((r) => r.status === "passed").length;
  const failed = summary.results.filter((r) => r.status === "failed").length;
  const skipped = summary.results.filter((r) => r.status === "skipped").length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>QA-Agent ${escapeHtml(summary.runId)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 1.25rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #ccc; padding: 8px 10px; vertical-align: top; text-align: left; }
    th { background: #f4f4f4; }
    tr.ok td:first-child { color: #0a7a2d; font-weight: 600; }
    tr.fail td:first-child { color: #b00020; font-weight: 600; }
    .err { white-space: pre-wrap; font-size: 0.85rem; margin: 0; }
    .muted { font-size: 0.8rem; color: #555; margin-top: 6px; }
  </style>
</head>
<body>
  <h1>QA-Agent run</h1>
  <p><strong>Run ID:</strong> ${escapeHtml(summary.runId)}</p>
  <p><strong>Config:</strong> ${escapeHtml(summary.configPath)}</p>
  <p><strong>Window:</strong> ${escapeHtml(summary.startedAt)} → ${escapeHtml(summary.finishedAt)}</p>
  <p><strong>Totals:</strong> ${passed} passed, ${failed} failed, ${skipped} skipped</p>
  <table>
    <thead><tr><th>Status</th><th>Site</th><th>URL</th><th>Duration</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
