import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { crawlSite } from "./crawl-site.js";
import { fetchPageSpeedScores } from "./pagespeed.js";
import { loadUrlsFromTxt, siteIdFromUrl } from "./load-urls.js";
import type { HealthProgressEvent } from "./progress-events.js";
import { buildHealthIndexHtml, writeSiteHealthReports } from "./report-site.js";
import type { SiteHealthReport } from "./types.js";

function runId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function orchestrateHealthCheck(options: {
  urlsFile: string;
  outRoot: string;
  maxPages: number;
  maxLinkChecks: number;
  concurrency: number;
  requestTimeoutMs: number;
  pageSpeedApiKey?: string;
  pageSpeedStrategy: "mobile" | "desktop";
  skipPageSpeed: boolean;
  onProgress?: (event: HealthProgressEvent) => void;
}): Promise<{ runId: string; runDir: string; siteFailures: number }> {
  const rid = runId();
  const runDir = path.resolve(options.outRoot, rid);
  await mkdir(runDir, { recursive: true });

  const urls = await loadUrlsFromTxt(options.urlsFile);
  if (urls.length === 0) {
    throw new Error(`No URLs found in ${options.urlsFile}`);
  }

  const emit = options.onProgress;
  const sitesMeta = urls.map((u) => ({
    siteId: siteIdFromUrl(u),
    hostname: new URL(u).hostname,
    startUrl: u,
  }));
  emit?.({
    type: "run_start",
    runId: rid,
    runDir,
    totalSites: urls.length,
    sites: sitesMeta,
  });

  const limit = pLimit(Math.max(1, options.concurrency));
  const tasks = urls.map((startUrl, idx) =>
    limit(async (): Promise<SiteHealthReport & { failed: boolean }> => {
      const index = idx + 1;
      const siteId = siteIdFromUrl(startUrl);
      const hostname = new URL(startUrl).hostname;
      emit?.({
        type: "site_start",
        siteId,
        hostname,
        startUrl,
        index,
        totalSites: urls.length,
      });

      const startedAt = new Date().toISOString();
      let crawl;
      try {
        crawl = await crawlSite({
          startUrl,
          maxPages: options.maxPages,
          maxLinkChecks: options.maxLinkChecks,
          requestTimeoutMs: options.requestTimeoutMs,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit?.({
          type: "site_error",
          siteId,
          hostname,
          startUrl,
          index,
          totalSites: urls.length,
          message,
        });
        throw err;
      }

      let pageSpeed: SiteHealthReport["pageSpeed"];
      if (!options.skipPageSpeed && options.pageSpeedApiKey) {
        pageSpeed = await fetchPageSpeedScores({
          url: startUrl,
          apiKey: options.pageSpeedApiKey,
          strategy: options.pageSpeedStrategy,
        });
      }

      const finishedAt = new Date().toISOString();
      const report: SiteHealthReport = {
        siteId: crawl.siteId,
        hostname: crawl.hostname,
        startUrl,
        startedAt,
        finishedAt,
        crawl,
        pageSpeed,
      };

      const siteDir = path.join(runDir, crawl.siteId);
      await writeSiteHealthReports({ report, outDir: siteDir });

      const failed = crawl.brokenLinks.length > 0 || crawl.pages.some((p) => !p.ok);

      emit?.({
        type: "site_complete",
        siteId: crawl.siteId,
        hostname: crawl.hostname,
        startUrl,
        index,
        totalSites: urls.length,
        failed,
        pagesVisited: crawl.pagesVisited,
        brokenLinks: crawl.brokenLinks.length,
        durationMs: crawl.durationMs,
      });

      return { ...report, failed };
    }),
  );

  const results = await Promise.all(tasks);
  const siteFailures = results.filter((r) => r.failed).length;

  const indexItems = results.map((r) => ({
    siteId: r.siteId,
    hostname: r.hostname,
    reportPath: `./${r.siteId}/report.html`,
  }));
  await writeFile(path.join(runDir, "index.html"), buildHealthIndexHtml(indexItems), "utf8");

  const summaryTxt = [
    `QA-Agent health run ${rid}`,
    `URLs file: ${path.resolve(options.urlsFile)}`,
    `Sites: ${urls.length} · Failed (issues found): ${siteFailures}`,
    "",
    ...results.map(
      (r) =>
        `${r.hostname}: pages=${r.crawl.pagesVisited} brokenLinks=${r.crawl.brokenLinks.length} ${r.failed ? "FAIL" : "OK"}`,
    ),
  ].join("\n");
  await writeFile(path.join(runDir, "summary.txt"), summaryTxt, "utf8");

  emit?.({
    type: "run_complete",
    runId: rid,
    runDir,
    siteFailures,
    totalSites: urls.length,
  });

  return { runId: rid, runDir, siteFailures };
}
