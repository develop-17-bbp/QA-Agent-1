import { mkdir } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import type { SitesConfig } from "./config/schema.js";
import { runSite } from "./runner/run-site.js";
import type { RunSummary, SiteRunResult } from "./types.js";

function skippedResult(site: { id: string; name: string; url: string }): SiteRunResult {
  return {
    siteId: site.id,
    siteName: site.name,
    url: site.url,
    status: "skipped",
    durationMs: 0,
    errorMessage: "disabled in config (enabled: false)",
  };
}

function randomRunId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function orchestrateRun(options: {
  config: SitesConfig;
  configPath: string;
  concurrency: number;
  artifactsRoot: string;
  headless?: boolean;
}): Promise<RunSummary> {
  const runId = randomRunId();
  const startedAt = new Date().toISOString();
  const root = path.resolve(options.artifactsRoot, runId);
  await mkdir(root, { recursive: true });

  const active = options.config.sites.filter((s) => s.enabled !== false);
  const limit = pLimit(Math.max(1, options.concurrency));

  const tasks = active.map((site) =>
    limit(async (): Promise<SiteRunResult> => {
      const dir = path.join(root, site.id);
      return runSite(site, {
        artifactsDir: dir,
        runId,
        headless: options.headless,
      });
    }),
  );

  const runResults = await Promise.all(tasks);
  const byId = new Map(runResults.map((r) => [r.siteId, r] as const));
  const results = options.config.sites.map((site) => {
    if (site.enabled === false) return skippedResult(site);
    const r = byId.get(site.id);
    if (!r) throw new Error(`Internal error: missing result for site "${site.id}"`);
    return r;
  });
  const finishedAt = new Date().toISOString();

  return {
    runId,
    startedAt,
    finishedAt,
    results,
    configPath: options.configPath,
  };
}
