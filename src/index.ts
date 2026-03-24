#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { Command } from "commander";
import { loadSitesConfig } from "./config/load.js";
import { orchestrateRun } from "./orchestrate.js";
import { runHealthDashboard } from "./health/health-dashboard-server.js";
import { orchestrateHealthCheck } from "./health/orchestrate-health.js";
import { deliverReport } from "./notify/email.js";
import { buildTextSummary } from "./report/build-summary.js";

const program = new Command();

program
  .name("qa-agent")
  .description(
    "Site health: crawl + internal link checks (see `health`). Legacy: `run` for form tests.",
  )
  .version("0.2.1");

program
  .command("health")
  .description(
    "Read root URLs from a .txt file, crawl same-origin pages, verify internal links — write per-site HTML/JSON under --out/<runId>/",
  )
  .requiredOption("--urls <file>", "Text file: one https URL per line (# comments allowed)")
  .option("--out <dir>", "Output root folder (default: artifacts/health)", "artifacts/health")
  .option(
    "--concurrency <n>",
    "How many sites to crawl at once (default 1 = one URL line after another; raise for parallel sites)",
    "1",
  )
  .option(
    "--max-pages <n>",
    "Max HTML pages to fetch per site (BFS crawl); default 0 = no limit (full same-origin crawl). Set a positive number to cap.",
    "0",
  )
  .option(
    "--max-link-checks <n>",
    "Max extra internal URLs to HEAD-check when not visited in BFS; default 0 = no limit. Set a positive number to cap.",
    "0",
  )
  .option(
    "--timeout-ms <n>",
    "Per-request timeout (ms) for crawl and link checks; slow CMS pages often need 45s+ under parallel load",
    "45000",
  )
  .option(
    "--fetch-concurrency <n>",
    "Parallel HTTP requests per site while crawling and checking links (lower = fewer timeouts on slow hosts; default 4)",
    "4",
  )
  .option(
    "--serve",
    "Start a live dashboard (HTTP + SSE) on localhost while the run executes; open /reports/… in the same origin",
    false,
  )
  .option("--port <n>", "Port for --serve (default 3847)", "3847")
  .option("--no-browser", "With --serve, do not open a browser tab", false)
  .option(
    "--pagespeed",
    "After crawl, run Google PageSpeed Insights (Lighthouse lab) on crawled pages; set PAGESPEED_API_KEY",
    false,
  )
  .option("--pagespeed-strategy <mobile|desktop>", "PageSpeed API device strategy", "desktop")
  .option(
    "--pagespeed-max-urls <n>",
    "Max URLs per site to analyze with PageSpeed (0 = up to 500; default 25)",
    "25",
  )
  .option("--pagespeed-concurrency <n>", "Parallel PageSpeed API calls per site", "1")
  .option("--pagespeed-timeout-ms <n>", "Timeout per PageSpeed API request (ms)", "120000")
  .action(
    async (opts: {
      urls: string;
      out: string;
      concurrency: string;
      maxPages: string;
      maxLinkChecks: string;
      timeoutMs: string;
      fetchConcurrency: string;
      serve?: boolean;
      port: string;
      noBrowser?: boolean;
      pagespeed?: boolean;
      pagespeedStrategy: string;
      pagespeedMaxUrls: string;
      pagespeedConcurrency: string;
      pagespeedTimeoutMs: string;
    }) => {
      const concurrency = Number.parseInt(opts.concurrency, 10);
      const maxPages = Number.parseInt(opts.maxPages, 10);
      const maxLinkChecks = Number.parseInt(opts.maxLinkChecks, 10);
      const requestTimeoutMs = Number.parseInt(opts.timeoutMs, 10);
      const fetchConcurrency = Number.parseInt(opts.fetchConcurrency, 10);
      const servePort = Number.parseInt(opts.port, 10);
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        throw new Error(`Invalid concurrency: ${opts.concurrency}`);
      }
      if (!Number.isFinite(maxPages) || maxPages < 0) {
        throw new Error(`Invalid max-pages: ${opts.maxPages} (use 0 for unlimited)`);
      }
      if (!Number.isFinite(maxLinkChecks) || maxLinkChecks < 0) {
        throw new Error(`Invalid max-link-checks: ${opts.maxLinkChecks} (use 0 for unlimited)`);
      }
      if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1) {
        throw new Error(`Invalid timeout-ms: ${opts.timeoutMs}`);
      }
      if (!Number.isFinite(fetchConcurrency) || fetchConcurrency < 1) {
        throw new Error(`Invalid fetch-concurrency: ${opts.fetchConcurrency}`);
      }
      if (!Number.isFinite(servePort) || servePort < 1) {
        throw new Error(`Invalid port: ${opts.port}`);
      }

      const pagespeedMaxUrls = Number.parseInt(opts.pagespeedMaxUrls, 10);
      const pagespeedConcurrency = Number.parseInt(opts.pagespeedConcurrency, 10);
      const pagespeedTimeoutMs = Number.parseInt(opts.pagespeedTimeoutMs, 10);
      if (opts.pagespeed) {
        if (opts.pagespeedStrategy !== "mobile" && opts.pagespeedStrategy !== "desktop") {
          throw new Error(`Invalid pagespeed-strategy: ${opts.pagespeedStrategy} (use mobile or desktop)`);
        }
        if (!Number.isFinite(pagespeedMaxUrls) || pagespeedMaxUrls < 0) {
          throw new Error(`Invalid pagespeed-max-urls: ${opts.pagespeedMaxUrls}`);
        }
        if (!Number.isFinite(pagespeedConcurrency) || pagespeedConcurrency < 1) {
          throw new Error(`Invalid pagespeed-concurrency: ${opts.pagespeedConcurrency}`);
        }
        if (!Number.isFinite(pagespeedTimeoutMs) || pagespeedTimeoutMs < 1) {
          throw new Error(`Invalid pagespeed-timeout-ms: ${opts.pagespeedTimeoutMs}`);
        }
      }

      const orchestrateBase = {
        urlsFile: path.resolve(opts.urls),
        outRoot: path.resolve(opts.out),
        maxPages,
        maxLinkChecks,
        concurrency,
        fetchConcurrency,
        requestTimeoutMs,
        ...(opts.pagespeed
          ? {
              pageSpeed: {
                enabled: true,
                strategy: opts.pagespeedStrategy as "mobile" | "desktop",
                maxUrls: pagespeedMaxUrls,
                concurrency: pagespeedConcurrency,
                timeoutMs: pagespeedTimeoutMs,
              },
            }
          : {}),
      };

      const { runId, runDir, siteFailures } = opts.serve
        ? await runHealthDashboard({
            port: servePort,
            openBrowser: opts.noBrowser !== true,
            orchestrate: orchestrateBase,
          })
        : await orchestrateHealthCheck(orchestrateBase);

      console.log(`\nHealth run ${runId} complete.`);
      console.log(`Index: ${runDir}/index.html (per-site + combined MASTER-all-sites-… reports)`);
      console.log(`Summary: ${runDir}/summary.txt`);
      if (opts.serve) {
        console.log(`Live UI was on http://127.0.0.1:${servePort}/ (same origin as /reports/…)`);
      }
      process.exitCode = siteFailures > 0 ? 1 : 0;
    },
  );

program
  .command("run")
  .description("Execute all enabled sites from a JSON config file")
  .requiredOption("-c, --config <path>", "Path to sites JSON config")
  .option("--concurrency <n>", "Max parallel browser jobs", "3")
  .option(
    "--artifacts <dir>",
    "Directory for run artifacts (screenshots, reports)",
    "artifacts",
  )
  .option("--headed", "Run browser with UI (not headless)", false)
  .option("--skip-email", "Skip SMTP delivery (still writes report files)")
  .action(async (opts: {
    config: string;
    concurrency: string;
    artifacts: string;
    headed: boolean;
    skipEmail?: boolean;
  }) => {
    const configPath = path.resolve(opts.config);
    const config = await loadSitesConfig(configPath);
    const concurrency = Number.parseInt(opts.concurrency, 10);
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new Error(`Invalid concurrency: ${opts.concurrency}`);
    }

    const summary = await orchestrateRun({
      config,
      configPath,
      concurrency,
      artifactsRoot: path.resolve(opts.artifacts),
      headless: !opts.headed,
    });

    console.log(buildTextSummary(summary));

    const { reportDir, emailSent } = await deliverReport({
      summary,
      config,
      artifactsRoot: path.resolve(opts.artifacts),
      sendEmail: !opts.skipEmail,
    });
    console.log(`\nReports written under: ${reportDir}`);
    if (!opts.skipEmail) {
      console.log(emailSent ? "Email sent." : "Email not sent (see SMTP env or QA_AGENT_NOTIFY_EMAILS).");
    }

    const failed = summary.results.filter((r) => r.status === "failed").length;
    process.exitCode = failed > 0 ? 1 : 0;
  });

program.parse();
