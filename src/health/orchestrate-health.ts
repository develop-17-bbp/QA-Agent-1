import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { crawlSite } from "./crawl-site.js";
import { healthSiteOutputDirName, loadUrlsFromTxt, siteIdFromUrl } from "./load-urls.js";
import { attachPageSpeedInsights, resolvePageSpeedApiKey } from "./pagespeed-insights.js";
import type { HealthProgressEvent } from "./progress-events.js";
import { masterReportBaseName, perSiteReportBaseName } from "./report-names.js";
import { buildHealthIndexHtml, writeMasterHealthReports, writeSiteHealthReports } from "./report-site.js";
import type { SiteHealthReport } from "./types.js";

function runId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface HealthRunMeta {
  runId: string;
  generatedAt: string;
  urlsSource: "file" | "inline";
  urlsFile?: string;
  totalSites: number;
  siteFailures: number;
  sites: {
    hostname: string;
    startUrl: string;
    failed: boolean;
    pagesVisited: number;
    brokenLinks: number;
    durationMs: number;
    reportHtmlHref: string;
  }[];
  masterHtmlHref: string;
  indexHtmlHref: string;
}

export async function orchestrateHealthCheck(options: {
  /** Read URLs from this file (mutually exclusive with `urls`). */
  urlsFile?: string;
  /** Use these URLs directly (mutually exclusive with `urlsFile`). */
  urls?: string[];
  outRoot: string;
  maxPages: number;
  maxLinkChecks: number;
  concurrency: number;
  /** Parallel HTTP requests per site (crawl + link checks). */
  fetchConcurrency: number;
  requestTimeoutMs: number;
  /** Optional Lighthouse lab data via Google PageSpeed Insights API. */
  pageSpeed?: {
    enabled: boolean;
    strategy: "mobile" | "desktop";
    maxUrls: number;
    concurrency: number;
    timeoutMs: number;
  };
  onProgress?: (event: HealthProgressEvent) => void;
}): Promise<{ runId: string; runDir: string; siteFailures: number }> {
  const rid = runId();
  const runDir = path.resolve(options.outRoot, rid);
  await mkdir(runDir, { recursive: true });

  let urls: string[];
  let urlsSource: "file" | "inline";
  let resolvedUrlsFile: string | undefined;
  if (options.urls && options.urls.length > 0) {
    urls = [...options.urls];
    urlsSource = "inline";
  } else if (options.urlsFile) {
    urls = await loadUrlsFromTxt(options.urlsFile);
    urlsSource = "file";
    resolvedUrlsFile = path.resolve(options.urlsFile);
  } else {
    throw new Error("orchestrateHealthCheck: pass either urlsFile or a non-empty urls array");
  }
  if (urls.length === 0) {
    throw new Error(urlsSource === "file" ? `No URLs found in ${resolvedUrlsFile}` : "No valid URLs in request");
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

  async function runOneSite(idx: number, startUrl: string): Promise<SiteHealthReport & { failed: boolean }> {
    const index = idx + 1;
    const siteId = siteIdFromUrl(startUrl);
    const hostname = new URL(startUrl).hostname;
    const outputDirName = healthSiteOutputDirName(idx, startUrl);

    emit?.({
      type: "site_start",
      runId: rid,
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
        fetchConcurrency: options.fetchConcurrency,
      });
      const ps = options.pageSpeed;
      if (ps?.enabled) {
        const apiKey = resolvePageSpeedApiKey();
        if (!apiKey) {
          throw new Error(
            "PageSpeed Insights enabled but no API key found. Set PAGESPEED_API_KEY or GOOGLE_PAGESPEED_API_KEY (or GOOGLE_API_KEY) in the environment.",
          );
        }
        await attachPageSpeedInsights(crawl, {
          apiKey,
          strategy: ps.strategy,
          maxUrls: ps.maxUrls,
          concurrency: ps.concurrency,
          timeoutMs: ps.timeoutMs,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit?.({
        type: "site_error",
        runId: rid,
        siteId,
        hostname,
        startUrl,
        index,
        totalSites: urls.length,
        message,
      });
      throw err;
    }

    const finishedAt = new Date().toISOString();

    const report: SiteHealthReport = {
      siteId: crawl.siteId,
      hostname: crawl.hostname,
      startUrl,
      startedAt,
      finishedAt,
      crawl,
    };

    const siteDir = path.join(runDir, outputDirName);
    const siteFileBase = perSiteReportBaseName(report.hostname, report.finishedAt);
    await writeSiteHealthReports({ report, outDir: siteDir, fileBaseName: siteFileBase });

    const failed = crawl.brokenLinks.length > 0 || crawl.pages.some((p) => !p.ok);
    const reportHtmlHref = `${outputDirName}/report.html`;

    emit?.({
      type: "site_complete",
      runId: rid,
      siteId: crawl.siteId,
      hostname: crawl.hostname,
      startUrl,
      index,
      totalSites: urls.length,
      failed,
      pagesVisited: crawl.pagesVisited,
      brokenLinks: crawl.brokenLinks.length,
      durationMs: crawl.durationMs,
      reportHtmlHref,
    });

    return { ...report, failed };
  }

  const results: (SiteHealthReport & { failed: boolean })[] = [];

  if (options.concurrency <= 1) {
    for (let idx = 0; idx < urls.length; idx++) {
      results.push(await runOneSite(idx, urls[idx]));
    }
  } else {
    const limit = pLimit(options.concurrency);
    const tasks = urls.map((startUrl, idx) => limit(() => runOneSite(idx, startUrl)));
    results.push(...(await Promise.all(tasks)));
  }
  const siteFailures = results.filter((r) => r.failed).length;

  const runFinishedAt = new Date().toISOString();
  const masterBase = masterReportBaseName(runFinishedAt);
  await writeMasterHealthReports({
    reports: results.map((r) => {
      const { failed: _f, ...rep } = r;
      return rep;
    }),
    runDir,
    fileBaseName: masterBase,
    meta: {
      runId: rid,
      urlsFile: urlsSource === "file" && resolvedUrlsFile ? resolvedUrlsFile : "(inline)",
      generatedAt: runFinishedAt,
    },
  });

  const indexItems = results.map((r, i) => {
    const folder = healthSiteOutputDirName(i, r.startUrl);
    const base = perSiteReportBaseName(r.hostname, r.finishedAt);
    return {
      hostname: r.hostname,
      htmlHref: `./${folder}/${base}.html`,
      jsonHref: `./${folder}/${base}.json`,
      label: `${base}.html`,
    };
  });
  const urlsLabel =
    urlsSource === "file" && resolvedUrlsFile ? resolvedUrlsFile : "URLs from UI / inline";

  await writeFile(
    path.join(runDir, "index.html"),
    buildHealthIndexHtml({
      runId: rid,
      generatedAt: runFinishedAt,
      urlsFile: urlsLabel,
      masterHtmlPath: `./${masterBase}.html`,
      masterJsonPath: `./${masterBase}.json`,
      items: indexItems,
    }),
    "utf8",
  );

  const runMeta: HealthRunMeta = {
    runId: rid,
    generatedAt: runFinishedAt,
    urlsSource,
    urlsFile: resolvedUrlsFile,
    totalSites: urls.length,
    siteFailures,
    sites: results.map((r, i) => ({
      hostname: r.hostname,
      startUrl: r.startUrl,
      failed: r.failed,
      pagesVisited: r.crawl.pagesVisited,
      brokenLinks: r.crawl.brokenLinks.length,
      durationMs: r.crawl.durationMs,
      reportHtmlHref: `${healthSiteOutputDirName(i, r.startUrl)}/report.html`,
    })),
    masterHtmlHref: `./${masterBase}.html`,
    indexHtmlHref: "./index.html",
  };
  await writeFile(path.join(runDir, "run-meta.json"), JSON.stringify(runMeta, null, 2), "utf8");

  const summaryTxt = [
    `QA-Agent health run ${rid}`,
    `URLs: ${urlsLabel}`,
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
