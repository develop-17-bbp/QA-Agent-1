#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { Command } from "commander";
import { loadSitesConfig } from "./config/load.js";
import { orchestrateRun } from "./orchestrate.js";
import { deliverReport } from "./notify/email.js";
import { buildTextSummary } from "./report/build-summary.js";

const program = new Command();

program
  .name("qa-agent")
  .description("Run config-driven form checks across many websites")
  .version("0.1.0");

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
