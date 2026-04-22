/**
 * Daily SEO report CLI — calls the running QA-Agent dashboard and either
 * POSTs the bundle to an n8n webhook or prints it to stdout. Use this when
 * you'd rather run the schedule from Windows Task Scheduler / cron than
 * host an n8n instance.
 *
 * Usage:
 *   tsx scripts/daily-report.ts \
 *     --sites=https://www.realdrseattle.com/ \
 *     --include-pagespeed \
 *     --include-form-tests \
 *     --dashboard=http://localhost:3847 \
 *     --out=report.html
 *
 *   tsx scripts/daily-report.ts --webhook=https://n8n.example.com/webhook/abc
 *
 * Scheduling examples:
 *   Windows Task Scheduler (05:30 UTC daily):
 *     Program:  node
 *     Args:     --import tsx scripts/daily-report.ts --webhook=<url>
 *     Trigger:  daily at 05:30 UTC
 *
 *   Linux cron:
 *     30 5 * * *  cd /path/to/QA-Agent && npx tsx scripts/daily-report.ts --webhook=<url>
 */

import { writeFileSync } from "node:fs";

type Args = {
  dashboard: string;
  sites: string[];
  includePageSpeed: boolean;
  includeFormTests: boolean;
  formTestSiteIds?: string[];
  maxPages: number;
  webhook?: string;
  out?: string;
  token?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dashboard: process.env.QA_AGENT_BASE_URL ?? "http://localhost:3847",
    sites: [],
    includePageSpeed: false,
    includeFormTests: false,
    maxPages: 50,
    webhook: process.env.DAILY_REPORT_WEBHOOK,
    token: process.env.DAILY_REPORT_TOKEN,
  };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith("--dashboard=")) args.dashboard = raw.slice("--dashboard=".length);
    else if (raw.startsWith("--sites=")) args.sites = raw.slice("--sites=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (raw === "--include-pagespeed") args.includePageSpeed = true;
    else if (raw === "--include-form-tests") args.includeFormTests = true;
    else if (raw.startsWith("--form-test-ids=")) args.formTestSiteIds = raw.slice("--form-test-ids=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (raw.startsWith("--max-pages=")) args.maxPages = Number.parseInt(raw.slice("--max-pages=".length), 10) || 50;
    else if (raw.startsWith("--webhook=")) args.webhook = raw.slice("--webhook=".length);
    else if (raw.startsWith("--out=")) args.out = raw.slice("--out=".length);
    else if (raw.startsWith("--token=")) args.token = raw.slice("--token=".length);
  }
  if (args.sites.length === 0 && process.env.DAILY_REPORT_SITES) {
    args.sites = process.env.DAILY_REPORT_SITES.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.sites.length === 0) {
    console.error("Usage: tsx scripts/daily-report.ts --sites=https://a.com,https://b.com [--include-pagespeed] [--include-form-tests] [--out=report.html] [--webhook=<url>]");
    console.error("Or set DAILY_REPORT_SITES in .env.");
    process.exit(1);
  }

  const url = `${args.dashboard.replace(/\/$/, "")}/api/daily-report`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.token) headers.Authorization = `Bearer ${args.token}`;

  console.log(`[daily-report] POST ${url} — ${args.sites.length} site(s), maxPages=${args.maxPages}…`);
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sites: args.sites,
      includePageSpeed: args.includePageSpeed,
      includeFormTests: args.includeFormTests,
      formTestSiteIds: args.formTestSiteIds,
      maxPages: args.maxPages,
    }),
    signal: AbortSignal.timeout(20 * 60_000),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[daily-report] Dashboard returned ${res.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  const report = await res.json();
  console.log(`[daily-report] Report built in ${((Date.now() - started) / 1000).toFixed(1)}s — ${report.subject}`);

  if (args.out) {
    writeFileSync(args.out, report.html, "utf8");
    console.log(`[daily-report] HTML written to ${args.out}`);
  }

  if (args.webhook) {
    console.log(`[daily-report] Forwarding to webhook ${args.webhook}`);
    const wr = await fetch(args.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(60_000),
    });
    if (!wr.ok) {
      const t = await wr.text();
      console.error(`[daily-report] Webhook returned ${wr.status}: ${t.slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`[daily-report] Webhook accepted.`);
  }

  if (!args.out && !args.webhook) {
    // Print the summary for humans when no output target specified.
    console.log("\n" + report.text);
  }
}

main().catch((e) => {
  console.error("[daily-report] fatal:", e);
  process.exit(1);
});
