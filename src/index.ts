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
    "Site health: crawl + internal link checks + optional PageSpeed (see `health`). Legacy: `run` for form tests.",
  )
  .version("0.2.1");

program
  .command("health")
  .description(
    "Read root URLs from a .txt file, crawl same-origin pages, verify internal links, optional PageSpeed Insights API — write per-site HTML/JSON under --out/<runId>/",
  )
  .requiredOption("--urls <file>", "Text file: one https URL per line (# comments allowed)")
  .option("--out <dir>", "Output root folder (default: artifacts/health)", "artifacts/health")
  .option("--concurrency <n>", "Max sites in parallel", "3")
  .option("--max-pages <n>", "Max HTML pages to fetch per site (BFS crawl)", "100")
  .option("--max-link-checks <n>", "Max extra internal URLs to HEAD-check (not visited in BFS)", "2000")
  .option("--timeout-ms <n>", "Per-request timeout (ms)", "15000")
  .option("--skip-pagespeed", "Do not call Google PageSpeed Insights API")
  .option("--pagespeed-strategy <s>", "mobile or desktop", "mobile")
  .option(
    "--serve",
    "Start a live dashboard (HTTP + SSE) on localhost while the run executes; open /reports/… in the same origin",
    false,
  )
  .option("--port <n>", "Port for --serve (default 3847)", "3847")
  .option("--no-browser", "With --serve, do not open a browser tab", false)
  .action(
    async (opts: {
      urls: string;
      out: string;
      concurrency: string;
      maxPages: string;
      maxLinkChecks: string;
      timeoutMs: string;
      skipPagespeed?: boolean;
      pagespeedStrategy: string;
      serve?: boolean;
      port: string;
      noBrowser?: boolean;
    }) => {
      const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY?.trim() || undefined;
      const skipPs = opts.skipPagespeed === true;
      const pageSpeedStrategy: "mobile" | "desktop" =
        opts.pagespeedStrategy === "desktop" ? "desktop" : "mobile";
      const concurrency = Number.parseInt(opts.concurrency, 10);
      const maxPages = Number.parseInt(opts.maxPages, 10);
      const maxLinkChecks = Number.parseInt(opts.maxLinkChecks, 10);
      const requestTimeoutMs = Number.parseInt(opts.timeoutMs, 10);
      const servePort = Number.parseInt(opts.port, 10);
      for (const [name, v] of [
        ["concurrency", concurrency],
        ["max-pages", maxPages],
        ["max-link-checks", maxLinkChecks],
        ["timeout-ms", requestTimeoutMs],
        ["port", servePort],
      ] as const) {
        if (!Number.isFinite(v) || v < 1) throw new Error(`Invalid ${name}`);
      }

      const orchestrateBase = {
        urlsFile: path.resolve(opts.urls),
        outRoot: path.resolve(opts.out),
        maxPages,
        maxLinkChecks,
        concurrency,
        requestTimeoutMs,
        pageSpeedApiKey: apiKey,
        pageSpeedStrategy,
        skipPageSpeed: skipPs || !apiKey,
      };

      const { runId, runDir, siteFailures } = opts.serve
        ? await runHealthDashboard({
            port: servePort,
            openBrowser: opts.noBrowser !== true,
            orchestrate: orchestrateBase,
          })
        : await orchestrateHealthCheck(orchestrateBase);

      if (!skipPs && !apiKey) {
        console.warn(
          "[qa-agent] GOOGLE_PAGESPEED_API_KEY not set — PageSpeed skipped. Get a key: https://developers.google.com/speed/docs/insights/v5/get-started",
        );
      }

      console.log(`\nHealth run ${runId} complete.`);
      console.log(`Reports: ${runDir}/index.html`);
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
