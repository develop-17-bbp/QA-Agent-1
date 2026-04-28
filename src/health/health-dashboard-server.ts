import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import formidable from "formidable";
import type { HealthRunMeta } from "./orchestrate-health.js";
import type { HealthProgressEvent } from "./progress-events.js";
import { renderHtmlFileToPdf } from "./html-to-pdf.js";
import { parseUrlsFromText } from "./load-urls.js";
import {
  buildRunSummaryPayload,
  generateRunAnswer,
} from "./run-summary-ai.js";
import { orchestrateHealthCheck, computeRunLabel } from "./orchestrate-health.js";
import { routeQuery, loadRawReportsForRun, type NlpQueryRequest } from "./nlp-query-engine.js";
import { analyzeSiteAudit } from "./modules/site-audit-analyzer.js";
import { analyzePositions } from "./modules/position-tracker.js";
import { analyzeDomain, analyzeOrganicRankings } from "./modules/domain-analyzer.js";
import { analyzeTopPages, compareDomains } from "./modules/competitive-analyzer.js";
import { analyzeKeywordGap, analyzeBacklinkGap } from "./modules/gap-analyzer.js";
import { extractKeywords, generateMagicKeywords } from "./modules/keyword-analyzer.js";
import { buildKeywordStrategy } from "./modules/keyword-strategy.js";
import { analyzeWritingAssistant, generateContentTemplate } from "./modules/content-optimizer.js";
import { researchTopic } from "./modules/topic-researcher.js";
import { analyzeBacklinks, analyzeReferringDomains, auditBacklinks } from "./modules/link-analyzer.js";
import { analyzeTraffic } from "./modules/traffic-analyzer.js";
import { auditContent } from "./modules/content-auditor.js";
import { trackPosts } from "./modules/post-tracker.js";
import { analyzeBrandPresence } from "./modules/brand-monitor.js";
import { analyzeLogFile } from "./modules/log-analyzer.js";
import { analyzeLocalSeo } from "./modules/local-seo-analyzer.js";
import { checkOnPageSeo } from "./modules/onpage-seo-checker.js";
import { loadKeywordLists, saveKeywordList, deleteKeywordList, analyzeKeywordList } from "./modules/keyword-manager.js";
import {
  buildAuthorizeUrl,
  clearTokens,
  exchangeCodeForTokens,
  getConnectionStatus,
  getRedirectUri,
  isOauthConfigured,
} from "./providers/google-auth.js";
import {
  getGscKeywordStats,
  getGscPageStats,
  getGscPageStatsBatch,
  listGscSites,
  queryGscAnalytics,
} from "./providers/google-search-console.js";
import {
  getGa4PageTraffic,
  getGa4PageTrafficBatch,
  getGa4PropertyTotals,
  listGa4Properties,
  runGa4Report,
} from "./providers/google-analytics-4.js";
import { extractUrlsFromPdfBuffer } from "./pdf-urls.js";
import type { SiteHealthReport } from "./types.js";
import { runAgenticPipeline, runSerpAnalysis, getSession as getAgenticSession, listSessions as listAgenticSessions, deleteSession as deleteAgenticSession, type AgenticSessionConfig } from "./agentic/agent-coordinator.js";
import { searchSerp, searchSerpBatch, analyzeCompetitors, getSerpCacheStats, clearSerpCache } from "./agentic/duckduckgo-serp.js";
import { getRouterStats as getLlmRouterStats, checkOllamaAvailable, resetRouterStats } from "./agentic/llm-router.js";
import { ReportCache, type CachedReportData } from "./cache.js";
import { fetchSuggestions, fetchQuestionSuggestions } from "./providers/google-suggest.js";
import { fetchKeywordTrend } from "./providers/google-trends.js";
import { fetchKeywordVolume, isGoogleAdsConfigured } from "./providers/google-ads.js";
import { fetchCruxRecord, isCruxConfigured, type CruxFormFactor } from "./providers/crux.js";
import { GEO_TARGETS } from "./providers/geo-targets.js";
import { recommendLinkFixes, type BrokenLinkInput } from "./modules/link-fix-advisor.js";
import { predictKeywordImpact } from "./modules/keyword-impact-predictor.js";
import { estimateCompetitive } from "./modules/competitive-estimator.js";
import { ingestGscLinksCsv, fetchGscLinksBundle } from "./providers/gsc-links-csv.js";
import { ingestAwtBacklinksCsv, fetchAwtBundle } from "./providers/ahrefs-webmaster-csv.js";
import { fetchBrandMentions } from "./providers/rss-aggregator.js";
import { searchStartpage } from "./providers/startpage-serp.js";
import { composeDailyReport, type DailyReport, type DailyReportFormTest } from "./modules/daily-report.js";
import { recordUsage, deriveClientKey, getUsageSnapshot } from "./modules/usage-meter.js";
import { primeRuntimeKeys, setRuntimeKeys, clearRuntimeKey, listRuntimeKeyNames } from "./modules/runtime-keys.js";
import { buildCacheKey, cachedResponse, getCacheStats, invalidateByPrefix } from "./modules/response-cache.js";
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, nextRun, startScheduler } from "./modules/scheduler.js";
import { runAlertsCheck, readRecentAlerts, startAlertsTicker } from "./modules/alerts.js";
import {
  isBingOAuthClientConfigured,
  buildBingOAuthAuthorizeUrl,
  exchangeBingOAuthCode,
  loadBingTokens,
  clearBingTokens,
} from "./providers/bing-webmaster-oauth.js";
import {
  isYandexOAuthClientConfigured,
  buildYandexOAuthAuthorizeUrl,
  exchangeYandexOAuthCode,
  loadYandexTokens,
  clearYandexTokens,
} from "./providers/yandex-oauth.js";
import {
  addCompetitorPair,
  removeCompetitorPair,
  listCompetitorPairs as listCompetitorRankPairs,
  checkAndRecord as checkAndRecordCompetitorRank,
  getAllCompetitorStats,
  getCompetitorHistory,
} from "./modules/competitor-rank.js";
import { fetchSecurityGrade } from "./providers/mozilla-observatory.js";
import { fetchClosestSnapshot, fetchSnapshotHistory } from "./providers/wayback-machine.js";
import {
  loadTrackedPairs, saveTrackedPairs, addTrackedPair, removeTrackedPair,
  appendSnapshot, getHistoryForKeyword, getHistoryForDomain, getAllStats,
  type TrackedPair,
} from "./position-db.js";
import { sitesConfigSchema } from "../config/schema.js";
import { orchestrateRun } from "../orchestrate.js";
import { runAdHocFormTest } from "../runner/ad-hoc-form-test.js";

function webDistRoot(): string {
  return path.join(process.cwd(), "web", "dist");
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const f = path.resolve(candidate);
  return f === r || f.startsWith(r + path.sep);
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const m: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
  };
  return m[ext] ?? "application/octet-stream";
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/** Run folder names from orchestrate (timestamp + short id). */
function isSafeRunIdSegment(name: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(name) && !name.includes("..");
}

/** Relative path under a run dir (only .html report files). */
function isAllowedReportHtmlRel(rel: string): boolean {
  if (!rel || rel.includes("..")) return false;
  const norm = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm.endsWith(".html")) return false;
  return true;
}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface HealthHistoryDay {
  date: string;
  runs: HealthRunMeta[];
}

function parseSummarySiteLine(line: string): {
  hostname: string;
  pages: number;
  broken: number;
  failed: boolean;
} | null {
  const m = line.match(/^([^:]+):\s*pages=(\d+)\s+brokenLinks=(\d+)\s+(OK|FAIL)\s*$/);
  if (!m) return null;
  return {
    hostname: m[1],
    pages: Number(m[2]),
    broken: Number(m[3]),
    failed: m[4] === "FAIL",
  };
}

/**
 * Older runs have no run-meta.json — rebuild a compatible shape from summary.txt + folder layout.
 */
async function loadLegacyRunMeta(runDir: string, runId: string): Promise<HealthRunMeta | null> {
  const summaryPath = path.join(runDir, "summary.txt");
  let raw: string;
  try {
    raw = await readFile(summaryPath, "utf8");
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/);
  let urlsFile: string | undefined;
  const urlLine = lines.find((l) => l.startsWith("URLs file:"));
  if (urlLine) {
    urlsFile = urlLine.replace(/^URLs file:\s*/i, "").trim();
  }

  let totalSites = 0;
  let siteFailures = 0;
  const metaLine = lines.find((l) => /Sites:\s*\d+/.test(l) && /Failed/i.test(l));
  if (metaLine) {
    const m = metaLine.match(/Sites:\s*(\d+)\s*·\s*Failed\s*\(issues found\):\s*(\d+)/i);
    if (m) {
      totalSites = Number(m[1]);
      siteFailures = Number(m[2]);
    }
  }

  let generatedAt: string;
  try {
    const st = await stat(path.join(runDir, "index.html"));
    generatedAt = st.mtime.toISOString();
  } catch {
    try {
      const st = await stat(summaryPath);
      generatedAt = st.mtime.toISOString();
    } catch {
      generatedAt = new Date(0).toISOString();
    }
  }

  const dirents = await readdir(runDir, { withFileTypes: true });
  const siteDirs = dirents
    .filter((e) => e.isDirectory() && /^\d{3}-/.test(e.name))
    .map((e) => e.name)
    .sort();

  const usedLine = new Set<number>();
  const sites: HealthRunMeta["sites"] = [];
  for (const folder of siteDirs) {
    const hostname = folder.replace(/^\d{3}-/, "");
    let pagesVisited = 0;
    let brokenLinks = 0;
    let failed = false;
    for (let i = 0; i < lines.length; i++) {
      if (usedLine.has(i)) continue;
      const parsed = parseSummarySiteLine(lines[i]);
      if (parsed && parsed.hostname === hostname) {
        usedLine.add(i);
        pagesVisited = parsed.pages;
        brokenLinks = parsed.broken;
        failed = parsed.failed;
        break;
      }
    }
    sites.push({
      hostname,
      startUrl: `https://${hostname}/`,
      failed,
      pagesVisited,
      brokenLinks,
      durationMs: 0,
      reportHtmlHref: `${folder}/report.html`,
    });
  }

  const masterFiles = dirents
    .filter((e) => e.isFile() && e.name.startsWith("MASTER-all-sites-") && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort();
  const masterHtmlHref = masterFiles.length > 0 ? `./${masterFiles[0]}` : "./MASTER-all-sites.html";

  return {
    runId,
    generatedAt,
    urlsSource: "file",
    urlsFile,
    totalSites: totalSites || sites.length,
    siteFailures: siteFailures || sites.filter((s) => s.failed).length,
    sites,
    masterHtmlHref,
    indexHtmlHref: "./index.html",
  };
}

async function listHealthHistory(outRoot: string): Promise<{ days: HealthHistoryDay[] }> {
  let entries;
  try {
    entries = await readdir(outRoot, { withFileTypes: true });
  } catch {
    return { days: [] };
  }

  const metas: HealthRunMeta[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (!isSafeRunIdSegment(ent.name)) continue;
    const runDir = path.join(outRoot, ent.name);
    const metaPath = path.join(runDir, "run-meta.json");
    try {
      const raw = await readFile(metaPath, "utf8");
      const m = JSON.parse(raw) as HealthRunMeta;
      // Back-fill label for runs written before this feature landed.
      if (!m.label) m.label = computeRunLabel(m.startedAt ?? m.generatedAt, m.sites ?? []);
      metas.push(m);
    } catch {
      const legacy = await loadLegacyRunMeta(runDir, ent.name);
      if (legacy) {
        if (!legacy.label) legacy.label = computeRunLabel(legacy.startedAt ?? legacy.generatedAt, legacy.sites ?? []);
        metas.push(legacy);
      }
    }
  }

  const byDay = new Map<string, HealthRunMeta[]>();
  for (const m of metas) {
    const day = m.generatedAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(m);
    byDay.set(day, list);
  }

  const days: HealthHistoryDay[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, runs]) => ({
      date,
      runs: runs.sort((x, y) => (x.generatedAt < y.generatedAt ? 1 : -1)),
    }));

  return { days };
}

/**
 * Legacy `run-meta.json` could point `masterHtmlHref` at `./master.html` (redirect stub). Resolve to
 * `MASTER-all-sites-*.html` when present. `run-summary.html` is the real file for new runs — no resolution.
 */
async function resolveMasterHtmlIfRedirectStub(runDir: string, meta: HealthRunMeta): Promise<HealthRunMeta> {
  const href = meta.masterHtmlHref?.trim() ?? "";
  const norm = href.replace(/^\.\//, "").replace(/\\/g, "/");
  if (norm === "run-summary.html" || norm.endsWith("/run-summary.html")) return meta;
  if (norm !== "master.html" && !norm.endsWith("/master.html")) return meta;
  let dirents;
  try {
    dirents = await readdir(runDir, { withFileTypes: true });
  } catch {
    return meta;
  }
  const masterFiles = dirents
    .filter((e) => e.isFile() && e.name.startsWith("MASTER-all-sites-") && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort();
  if (masterFiles.length === 0) return meta;
  const pick = masterFiles[masterFiles.length - 1] ?? masterFiles[0];
  return { ...meta, masterHtmlHref: `./${pick}` };
}

/** Load a single run’s `run-meta.json` (or legacy summary) — used by the SPA workspace so it does not depend on history list matching. */
async function loadRunMetaById(outRoot: string, runId: string): Promise<HealthRunMeta | null> {
  if (!isSafeRunIdSegment(runId)) return null;
  const runDir = path.join(outRoot, runId);
  if (!isPathInsideRoot(outRoot, runDir)) return null;
  try {
    const st = await stat(runDir);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  const metaPath = path.join(runDir, "run-meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(raw) as HealthRunMeta;
    return await resolveMasterHtmlIfRedirectStub(runDir, meta);
  } catch {
    return await loadLegacyRunMeta(runDir, runId);
  }
}

/** Combined MASTER report JSON next to the HTML (or latest MASTER-all-sites-*.json). */
async function resolveMasterJsonPath(runDir: string, meta: HealthRunMeta): Promise<string | null> {
  const href = meta.masterHtmlHref?.trim() ?? "";
  const norm = href.replace(/^\.\//, "").replace(/\\/g, "/");
  if (norm.endsWith(".html")) {
    const jsonRel = `${norm.slice(0, -".html".length)}.json`;
    const p = path.join(runDir, jsonRel);
    if (isPathInsideRoot(runDir, p)) {
      try {
        const st = await stat(p);
        if (st.isFile()) return p;
      } catch {
        /* fall through */
      }
    }
  }
  let dirents;
  try {
    dirents = await readdir(runDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const jsonFiles = dirents
    .filter((e) => e.isFile() && e.name.startsWith("MASTER-all-sites-") && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();
  if (jsonFiles.length === 0) return null;
  const pick = jsonFiles[jsonFiles.length - 1] ?? jsonFiles[0];
  return path.join(runDir, pick);
}

async function loadRunSummaryPayloadForRun(outRoot: string, runId: string) {
  const meta = await loadRunMetaById(outRoot, runId);
  if (!meta) return null;
  const runDir = path.join(outRoot, runId);
  const jsonPath = await resolveMasterJsonPath(runDir, meta);
  if (!jsonPath || !isPathInsideRoot(runDir, jsonPath)) return null;
  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return null;
  }
  let data: { generatedAt?: string; sites?: SiteHealthReport[] };
  try {
    data = JSON.parse(raw) as { generatedAt?: string; sites?: SiteHealthReport[] };
  } catch {
    return null;
  }
  if (!Array.isArray(data.sites) || data.sites.length === 0) return null;
  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : meta.generatedAt;
  return buildRunSummaryPayload(data.sites, runId, generatedAt, {
    pageSpeedSampleLimit: 80,
    pageSpeedPreferAnalyzed: true,
  });
}

const BUFFER_CAP = 2500;

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>QA-Agent — health dashboard</title>
  <style>
    :root {
      --bg: #f5f5f7;
      --surface: rgba(255, 255, 255, 0.9);
      --surface-solid: #ffffff;
      --border: rgba(0, 0, 0, 0.08);
      --text: #1d1d1f;
      --muted: #86868b;
      --accent: #0071e3;
      --ok: #34c759;
      --warn: #ff9500;
      --bad: #ff3b30;
      --run: #5856d6;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      margin: 0;
      background: linear-gradient(180deg, #e8e8ed 0%, var(--bg) 32%, var(--bg) 100%);
      color: var(--text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      letter-spacing: -0.022em;
    }
    header {
      padding: 28px 28px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
    }
    h1 { font-size: 1.75rem; font-weight: 600; margin: 0 0 8px 0; letter-spacing: -0.03em; }
    .sub { font-size: 0.9375rem; color: var(--muted); margin: 0; line-height: 1.4; }
    main { padding: 28px 24px 52px; max-width: 1100px; margin: 0 auto; }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0;
    }
    .tab {
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 10px 16px;
      border: none;
      border-radius: 8px 8px 0 0;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .tab:hover { color: var(--text); }
    .tab[aria-selected="true"] {
      background: var(--surface-solid);
      color: var(--accent);
      border: 1px solid var(--border);
      border-bottom-color: var(--surface-solid);
      margin-bottom: -1px;
    }
    .panel { display: none; }
    .panel.active { display: block; }
    label.lbl { display: block; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
    textarea.urls {
      width: 100%;
      min-height: 120px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface-solid);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      line-height: 1.45;
      resize: vertical;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }
    .row-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
    button.primary {
      font: inherit;
      font-weight: 600;
      padding: 11px 22px;
      border-radius: 980px;
      border: none;
      background: var(--accent);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 113, 227, 0.25);
    }
    button.primary:disabled { opacity: 0.45; cursor: not-allowed; }
    button.ghost {
      font: inherit;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
    }
    .hint { font-size: 0.82rem; color: var(--muted); margin: 10px 0 0 0; }
    .banner {
      padding: 14px 18px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--surface-solid);
      margin-bottom: 20px;
      font-size: 0.9375rem;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
    }
    .banner a { color: var(--accent); font-weight: 500; }
    .banner.err { border-color: rgba(255, 59, 48, 0.35); background: rgba(255, 59, 48, 0.06); }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; }
    tr:hover td { background: rgba(0, 113, 227, 0.04); }
    .hostname { font-weight: 600; word-break: break-all; }
    .url { font-size: 0.8rem; color: var(--muted); word-break: break-all; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.pending { background: rgba(0, 0, 0, 0.06); color: var(--muted); }
    .badge.running { background: rgba(88, 86, 214, 0.12); color: var(--run); }
    .badge.ok { background: rgba(52, 199, 89, 0.15); color: #1d7a42; }
    .badge.fail { background: rgba(255, 59, 48, 0.12); color: var(--bad); }
    .badge.err { background: rgba(255, 59, 48, 0.12); color: var(--bad); }
    .rep-link { margin-left: 8px; font-size: 0.8rem; font-weight: 600; }
    #log {
      margin-top: 24px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.03);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      color: var(--muted);
      max-height: 180px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .job-card {
      border: 1px solid var(--border);
      border-radius: 16px;
      margin-bottom: 12px;
      background: var(--surface-solid);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .job-card__head {
      width: 100%;
      text-align: left;
      padding: 14px 18px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      font: inherit;
      color: inherit;
    }
    .job-card__head:hover { background: rgba(0, 113, 227, 0.05); }
    .job-card__head:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .job-card__head-main { min-width: 0; flex: 1; }
    .job-card__title {
      margin: 0 0 4px 0;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--accent);
      word-break: break-all;
      line-height: 1.35;
    }
    .job-card__sub {
      font-size: 0.8rem;
      color: var(--muted);
      margin: 0;
      line-height: 1.4;
    }
    .job-card__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .job-card__chip {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      background: rgba(0, 0, 0, 0.05);
      color: var(--muted);
    }
    .job-card__chip--bad { background: rgba(255, 59, 48, 0.1); color: var(--bad); }
    .job-card__chip--ok { background: rgba(52, 199, 89, 0.12); color: #1d7a42; }
    .job-card__chevron {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      margin-top: 2px;
      color: var(--muted);
      transition: transform 0.2s ease;
    }
    .job-card--open .job-card__chevron { transform: rotate(180deg); color: var(--accent); }
    .job-card__body {
      padding: 0 18px 18px 18px;
      border-top: 1px solid var(--border);
    }
    .job-card__body[hidden] { display: none !important; }
    .run-meta { font-size: 0.8rem; color: var(--muted); margin-bottom: 10px; }
    .run-links { font-size: 0.85rem; margin-bottom: 10px; }
    .run-links a { color: var(--accent); font-weight: 600; text-decoration: none; margin-right: 12px; }
    .run-links a:hover { text-decoration: underline; }
    .btn-pdf {
      display: inline-block;
      margin-left: 8px;
      padding: 3px 8px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-radius: 6px;
      border: 1px solid var(--border);
      color: var(--muted);
      text-decoration: none;
    }
    .btn-pdf:hover { color: var(--accent); border-color: var(--accent); }
    .mini-table { width: 100%; font-size: 0.8rem; margin-top: 8px; }
    .mini-table th { font-size: 0.68rem; }
    .mini-table td { padding: 6px 8px; }
    .status-ok { color: var(--ok); font-weight: 600; }
    .status-bad { color: var(--bad); font-weight: 600; }
    .history-empty { color: var(--muted); font-size: 0.9rem; padding: 16px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Site health dashboard</h1>
    <p class="sub">Run <code>npm run health -- --serve</code> (no <code>--urls</code> required). Paste root URLs below to crawl, generate HTML/JSON reports, and download PDFs. Open <strong>Past runs</strong> for a list of job cards — click a card to expand links and per-site results.</p>
    <p class="sub" style="margin-top:10px">Each finished run is served at <code>/reports/&lt;runId&gt;/index.html</code> (run index), with per-site folders, a <strong>Combined report</strong> (full analytics), and a <strong>Stats summary</strong> page for compact PDFs. Use the sticky bar to move between the run index, reports, and this dashboard.</p>
  </header>
  <main>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" id="tab-run" aria-selected="true" aria-controls="panel-run">New run</button>
      <button type="button" class="tab" role="tab" id="tab-history" aria-selected="false" aria-controls="panel-history">Past runs</button>
    </div>

    <section id="panel-run" class="panel active" role="tabpanel" aria-labelledby="tab-run">
      <label class="lbl" for="urls-input">URLs (one https URL per line; lines starting with # ignored)</label>
      <textarea id="urls-input" class="urls" placeholder="https://www.example.com&#10;https://another.org"></textarea>
      <div class="row-actions">
        <button type="button" class="primary" id="btn-start">Start health check</button>
        <span id="busy-hint" class="hint" style="display:none">A run is in progress…</span>
      </div>
      <p class="hint">Uses the same crawl options as the CLI (timeouts, fetch concurrency, PageSpeed if enabled). If you launched with <code>--urls path/to/urls.txt</code>, that crawl may already be running or finished below.</p>

      <div id="banner" class="banner">Connecting to live stream…</div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Site</th>
            <th>Status</th>
            <th>Pages</th>
            <th>Broken</th>
            <th>Duration</th>
            <th>HTML / PDF</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="log"></div>
    </section>

    <section id="panel-history" class="panel" role="tabpanel" aria-labelledby="tab-history" hidden>
      <p class="hint" style="margin-top:0">Runs are stored under your artifacts folder. Each row is a <strong>job card</strong> — click the header to show run index / combined report links and the site table.</p>
      <div id="history-root"><p class="history-empty">Loading…</p></div>
    </section>
  </main>
  <script>
    const banner = document.getElementById("banner");
    const rowsEl = document.getElementById("rows");
    const logEl = document.getElementById("log");
    const rows = new Map();
    const tabRun = document.getElementById("tab-run");
    const tabHistory = document.getElementById("tab-history");
    const panelRun = document.getElementById("panel-run");
    const panelHistory = document.getElementById("panel-history");
    const historyRoot = document.getElementById("history-root");
    const urlsInput = document.getElementById("urls-input");
    const btnStart = document.getElementById("btn-start");
    const busyHint = document.getElementById("busy-hint");

    let runBusy = false;

    function log(line) {
      logEl.textContent += line + String.fromCharCode(10);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setBanner(html, isErr) {
      banner.className = "banner" + (isErr ? " err" : "");
      banner.innerHTML = html;
    }

    function reportHref(runId, reportHtmlHref) {
      var parts = String(reportHtmlHref).split("/").map(encodeURIComponent).join("/");
      return "/reports/" + encodeURIComponent(runId) + "/" + parts;
    }

    function pdfHref(runId, fileRel) {
      return "/api/pdf?runId=" + encodeURIComponent(runId) + "&file=" + encodeURIComponent(fileRel);
    }

    function ensureRow(siteId, index, hostname, startUrl) {
      if (rows.has(siteId)) return rows.get(siteId);
      var tr = document.createElement("tr");
      tr.dataset.siteId = siteId;
      tr.innerHTML =
        '<td class="idx"></td>' +
        '<td><div class="hostname"></div><div class="url"></div></td>' +
        '<td class="status"></td>' +
        '<td class="pages">—</td>' +
        '<td class="broken">—</td>' +
        '<td class="dur">—</td>' +
        '<td class="rep"></td>';
      rowsEl.appendChild(tr);
      var o = { tr: tr, siteId: siteId, index: index, hostname: hostname, startUrl: startUrl };
      rows.set(siteId, o);
      return o;
    }

    function paintRow(o) {
      var tr = o.tr;
      tr.querySelector(".idx").textContent = String(o.index ?? "");
      tr.querySelector(".hostname").textContent = o.hostname;
      tr.querySelector(".url").textContent = o.startUrl;
      var st = o.state || "pending";
      var statusCell = tr.querySelector(".status");
      var repCell = tr.querySelector(".rep");
      var labels = {
        pending: ["Pending", "pending"],
        running: ["Checking…", "running"],
        ok: ["OK", "ok"],
        fail: ["Issues", "fail"],
        err: ["Error", "err"],
      };
      var pair = labels[st] || labels.pending;
      var label = pair[0];
      var cls = pair[1];
      statusCell.innerHTML = '<span class="badge ' + cls + '">' + label + "</span>";
      if (o.pagesVisited != null) tr.querySelector(".pages").textContent = String(o.pagesVisited);
      if (o.brokenLinks != null) tr.querySelector(".broken").textContent = String(o.brokenLinks);
      if (o.durationMs != null) tr.querySelector(".dur").textContent = o.durationMs + " ms";
      if (o.reportHref && o.runId && o.reportFileRel) {
        repCell.innerHTML =
          '<a class="rep-link" href="' +
          escapeAttr(o.reportHref) +
          '">HTML</a>' +
          '<a class="btn-pdf" href="' +
          escapeAttr(pdfHref(o.runId, o.reportFileRel)) +
          '" download>PDF</a>';
      } else if (o.reportHref) {
        repCell.innerHTML = '<a class="rep-link" href="' + escapeAttr(o.reportHref) + '">HTML</a>';
      } else {
        repCell.textContent = "—";
      }
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    function escapeAttr(s) {
      return escapeHtml(s);
    }

    function selectTab(which) {
      var run = which === "run";
      tabRun.setAttribute("aria-selected", run ? "true" : "false");
      tabHistory.setAttribute("aria-selected", run ? "false" : "true");
      panelRun.classList.toggle("active", run);
      panelHistory.classList.toggle("active", !run);
      panelRun.hidden = !run;
      panelHistory.hidden = run;
      if (!run) loadHistory();
    }
    tabRun.addEventListener("click", function () { selectTab("run"); });
    tabHistory.addEventListener("click", function () { selectTab("history"); });

    async function loadHistory() {
      historyRoot.innerHTML = '<p class="history-empty">Loading…</p>';
      try {
        var res = await fetch("/api/history");
        var data = await res.json();
        renderHistory(data);
      } catch (e) {
        historyRoot.innerHTML = '<p class="history-empty">Could not load history.</p>';
      }
    }

    function flattenRuns(data) {
      var runs = [];
      if (!data.days) return runs;
      data.days.forEach(function (day) {
        (day.runs || []).forEach(function (run) {
          runs.push(run);
        });
      });
      runs.sort(function (a, b) {
        var ta = String(a.generatedAt || "");
        var tb = String(b.generatedAt || "");
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
      return runs;
    }

    function renderHistory(data) {
      if (!data.days || data.days.length === 0) {
        historyRoot.innerHTML = '<p class="history-empty">No runs found under artifacts. Each run folder needs <code>run-meta.json</code> (new runs) or at least <code>summary.txt</code> + per-site folders (older runs).</p>';
        return;
      }
      var runs = flattenRuns(data);
      if (runs.length === 0) {
        historyRoot.innerHTML = '<p class="history-empty">No runs in history.</p>';
        return;
      }
      var frag = document.createDocumentFragment();
      runs.forEach(function (run) {
        frag.appendChild(jobCard(run));
      });
      historyRoot.textContent = "";
      historyRoot.appendChild(frag);
    }

    function jobCard(run) {
      var wrap = document.createElement("div");
      wrap.className = "job-card";
      var idx = "/reports/" + encodeURIComponent(run.runId) + "/index.html";
      var mh = run.masterHtmlHref || "";
      if (mh.slice(0, 2) === "./") mh = mh.slice(2);
      var master = "/reports/" + encodeURIComponent(run.runId) + "/" + mh.split("/").map(encodeURIComponent).join("/");
      var sitesRows = (run.sites || []).map(function (s) {
        var href = reportHref(run.runId, s.reportHtmlHref);
        var pdf = pdfHref(run.runId, s.reportHtmlHref);
        var st = s.failed ? '<span class="status-bad">Issues</span>' : '<span class="status-ok">OK</span>';
        return (
          "<tr><td>" +
          escapeHtml(s.hostname) +
          "</td><td>" +
          st +
          "</td><td>" +
          String(s.pagesVisited) +
          "</td><td>" +
          String(s.brokenLinks) +
          '</td><td><a href="' +
          escapeAttr(href) +
          '">HTML</a> <a class="btn-pdf" href="' +
          escapeAttr(pdf) +
          '">PDF</a></td></tr>'
        );
      }).join("");
      var masterPdf = pdfHref(run.runId, mh);
      var hasIssues = Number(run.siteFailures) > 0;
      var chipClass = hasIssues ? "job-card__chip job-card__chip--bad" : "job-card__chip job-card__chip--ok";
      var chipLabel = hasIssues ? String(run.siteFailures) + " site(s) with issues" : "All sites OK";

      var head = document.createElement("button");
      head.type = "button";
      head.className = "job-card__head";
      head.setAttribute("aria-expanded", "false");
      head.innerHTML =
        '<span class="job-card__head-main">' +
        '<p class="job-card__title">' +
        escapeHtml(run.runId) +
        "</p>" +
        '<p class="job-card__sub">' +
        escapeHtml(run.generatedAt || "") +
        " · " +
        escapeHtml(run.urlsSource || "") +
        "</p>" +
        '<div class="job-card__chips">' +
        '<span class="job-card__chip">' +
        String(run.totalSites || 0) +
        " site(s)</span>" +
        '<span class="' +
        chipClass +
        '">' +
        chipLabel +
        "</span>" +
        "</div>" +
        '<span class="job-card__hint" style="font-size:0.75rem;color:var(--muted);margin-top:8px;display:block">Click to show links and details</span>' +
        "</span>" +
        '<svg class="job-card__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

      var body = document.createElement("div");
      body.className = "job-card__body";
      body.hidden = true;
      body.setAttribute("hidden", "");
      body.innerHTML =
        '<div class="run-meta"><strong>URLs</strong> · ' +
        (run.urlsFile ? escapeHtml(String(run.urlsFile)) : "—") +
        "</div>" +
        '<div class="run-links"><a href="' +
        escapeAttr(idx) +
        '">Run index</a><a href="' +
        escapeAttr(master) +
        '">Combined HTML</a><a class="btn-pdf" href="' +
        escapeAttr(masterPdf) +
        '">Combined PDF</a></div>' +
        (sitesRows
          ? '<table class="mini-table data-table"><thead><tr><th>Site</th><th>Status</th><th>Pages</th><th>Broken</th><th>HTML / PDF</th></tr></thead><tbody>' +
            sitesRows +
            "</tbody></table>"
          : '<p class="run-meta">No per-site rows in metadata.</p>');

      head.addEventListener("click", function () {
        var open = !wrap.classList.contains("job-card--open");
        wrap.classList.toggle("job-card--open", open);
        head.setAttribute("aria-expanded", open ? "true" : "false");
        body.hidden = !open;
        if (open) body.removeAttribute("hidden");
        else body.setAttribute("hidden", "");
      });

      wrap.appendChild(head);
      wrap.appendChild(body);
      return wrap;
    }

    const es = new EventSource("/api/stream");
    es.onopen = function () {
      log("Connected to event stream.");
      setBanner("Listening for runs… Start a check from this page or wait for the CLI-launched run.", false);
    };

    es.onmessage = function (ev) {
      var data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        log("Bad JSON: " + ev.data);
        return;
      }

      if (data.type === "run_start") {
        rows.clear();
        rowsEl.textContent = "";
        btnStart.disabled = true;
        busyHint.style.display = "inline";
        runBusy = true;
        setBanner(
          "Run <code>" +
            escapeHtml(data.runId) +
            "</code> — " +
            data.totalSites +
            ' site(s). <a href="/reports/' +
            encodeURIComponent(data.runId) +
            '/index.html">Open run index</a>',
          false
        );
        log("run_start: " + data.totalSites + " sites");
        data.sites.forEach(function (s, i) {
          var o = ensureRow(s.siteId, i + 1, s.hostname, s.startUrl);
          o.state = "pending";
          paintRow(o);
        });
        return;
      }

      if (data.type === "site_start") {
        var o = ensureRow(data.siteId, data.index, data.hostname, data.startUrl);
        o.state = "running";
        paintRow(o);
        log("site_start: " + data.hostname);
        return;
      }

      if (data.type === "site_complete") {
        var oc = rows.get(data.siteId);
        if (oc) {
          oc.state = data.failed ? "fail" : "ok";
          oc.pagesVisited = data.pagesVisited;
          oc.brokenLinks = data.brokenLinks;
          oc.durationMs = data.durationMs;
          oc.runId = data.runId;
          oc.reportFileRel = data.reportHtmlHref;
          oc.reportHref = reportHref(data.runId, data.reportHtmlHref);
          paintRow(oc);
        }
        log("site_complete: " + data.hostname + " → " + (data.failed ? "issues" : "ok"));
        return;
      }

      if (data.type === "site_error") {
        var oe = rows.get(data.siteId);
        if (oe) {
          oe.state = "err";
          paintRow(oe);
        }
        log("site_error: " + data.hostname + " — " + data.message);
        return;
      }

      if (data.type === "run_complete") {
        var fail = data.siteFailures > 0;
        setBanner(
          (fail ? "<strong>Finished with issues.</strong> " : "<strong>Finished.</strong> ") +
            data.siteFailures +
            " site(s) with crawl/link problems. " +
            '<a href="/reports/' +
            encodeURIComponent(data.runId) +
            '/index.html">Run index</a> · <code>' +
            escapeHtml(data.runDir) +
            "</code>",
          fail
        );
        log("run_complete: failures=" + data.siteFailures);
        runBusy = false;
        btnStart.disabled = false;
        busyHint.style.display = "none";
        loadHistory();
        return;
      }

      if (data.type === "run_error") {
        setBanner("<strong>Run failed.</strong> " + escapeHtml(data.message), true);
        log("run_error: " + data.message);
        runBusy = false;
        btnStart.disabled = false;
        busyHint.style.display = "none";
      }
    };

    es.onerror = function () {
      log("EventSource error (connection may retry).");
    };

    btnStart.addEventListener("click", async function () {
      if (runBusy) return;
      var text = urlsInput.value || "";
      try {
        btnStart.disabled = true;
        var res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urlsText: text }),
        });
        if (res.status === 409) {
          alert("A run is already in progress.");
          btnStart.disabled = false;
          return;
        }
        if (!res.ok) {
          var errText = await res.text();
          alert("Could not start: " + errText);
          btnStart.disabled = false;
          return;
        }
        runBusy = true;
        busyHint.style.display = "inline";
        log("Requested new run from UI.");
      } catch (e) {
        alert(String(e));
        btnStart.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export type HealthDashboardOrchestrateOptions = Omit<
  Parameters<typeof orchestrateHealthCheck>[0],
  "onProgress"
>;

/**
 * Serves a live dashboard on HTTP and streams progress via SSE.
 * Reports are served at `/reports/:runId/...` under the artifacts root.
 */
export async function runHealthDashboard(options: {
  port: number;
  openBrowser: boolean;
  orchestrate: HealthDashboardOrchestrateOptions;
}): Promise<{ runId: string; runDir: string; siteFailures: number }> {
  const buffer: HealthProgressEvent[] = [];
  const clients = new Set<http.ServerResponse>();
  const outRoot = path.resolve(options.orchestrate.outRoot);

  function broadcast(ev: HealthProgressEvent): void {
    buffer.push(ev);
    if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) {
      try {
        res.write(line);
      } catch {
        /* client gone */
      }
    }
  }

  const baseOrchestrate = options.orchestrate;
  let runInFlight = false;
  let lastResult: { runId: string; runDir: string; siteFailures: number } | null = null;

  async function runOrchestrate(
    extra: Partial<HealthDashboardOrchestrateOptions>,
  ): Promise<{ runId: string; runDir: string; siteFailures: number }> {
    return await orchestrateHealthCheck({
      ...baseOrchestrate,
      ...extra,
      onProgress: broadcast,
    });
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);

      if (req.method === "GET" && !url.pathname.startsWith("/api") && !url.pathname.startsWith("/reports/")) {
        const dist = webDistRoot();
        let spaHtml: string | null = null;
        try {
          spaHtml = await readFile(path.join(dist, "index.html"), "utf8");
        } catch {
          spaHtml = null;
        }
        if (spaHtml) {
          const decoded = decodeURIComponent(url.pathname);
          const rel = decoded.replace(/^\/+/, "") || "index.html";
          const norm = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
          const abs = path.join(dist, norm);
          if (isPathInsideRoot(dist, abs)) {
            try {
              const st = await stat(abs);
              if (st.isFile()) {
                res.writeHead(200, { "Content-Type": mimeFor(abs) });
                createReadStream(abs).pipe(res);
                return;
              }
            } catch {
              /* SPA fallback */
            }
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(spaHtml);
          return;
        }
        if (url.pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(dashboardHtml());
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/cache-stats") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(getCacheStats()));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        const data = await listHealthHistory(outRoot);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(data));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/run-meta") {
        const runIdParam = url.searchParams.get("runId");
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const meta = await loadRunMetaById(outRoot, runIdParam);
        if (!meta) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Run not found" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(meta));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ai-summary") {
        const runId = url.searchParams.get("runId");
        if (!runId || !isSafeRunIdSegment(runId)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const p = path.join(outRoot, runId, "ai-summary.md");
        if (!isPathInsideRoot(outRoot, p)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          const text = await readFile(p, "utf8");
          res.writeHead(200, {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(text);
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/ai-run-chat") {
        let body: string;
        try {
          body = await readBody(req, 32_000);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Bad request" }));
          return;
        }
        let payload: { runId?: unknown; question?: unknown };
        try {
          payload = JSON.parse(body) as { runId?: unknown; question?: unknown };
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }
        const runIdParam = typeof payload.runId === "string" ? payload.runId : "";
        const question =
          typeof payload.question === "string" ? payload.question.trim().slice(0, 4000) : "";
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Bad runId" }));
          return;
        }
        if (!question) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "question required" }));
          return;
        }
        const { checkOllamaAvailable } = await import("./llm.js");
        if (!(await checkOllamaAvailable())) {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              error: "Local Ollama not available. Start Ollama and pull the llama3.2 model (ollama pull llama3.2).",
            }),
          );
          return;
        }
        const qaPayload = await loadRunSummaryPayloadForRun(outRoot, runIdParam);
        if (!qaPayload) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Run data not found (missing MASTER JSON)" }));
          return;
        }
        try {
          const answer = await generateRunAnswer(qaPayload, question);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ answer }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/parse-urls-file") {
        const form = formidable({
          maxFileSize: 25 * 1024 * 1024,
          allowEmptyFiles: false,
        });
        let files: formidable.Files;
        try {
          [, files] = await form.parse(req);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
          return;
        }
        const fileList = files.file ?? files.upload ?? [];
        const first = Array.isArray(fileList) ? fileList[0] : fileList;
        if (!first || !first.filepath) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Expected multipart field 'file'" }));
          return;
        }
        const buf = await readFile(first.filepath);
        const name = (first.originalFilename ?? "").toLowerCase();
        let urls: string[];
        if (name.endsWith(".pdf")) {
          urls = await extractUrlsFromPdfBuffer(buf);
        } else {
          urls = parseUrlsFromText(buf.toString("utf8"));
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ urls, count: urls.length }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/pdf") {
        const runId = url.searchParams.get("runId");
        const file = url.searchParams.get("file");
        if (!runId || !file || !isSafeRunIdSegment(runId) || !isAllowedReportHtmlRel(file)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request: need runId and file (relative .html path under the run folder)");
          return;
        }
        const runRoot = path.join(outRoot, runId);
        if (!isPathInsideRoot(outRoot, runRoot)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        const relFs = file
          .replace(/\\/g, "/")
          .split("/")
          .filter(Boolean)
          .join(path.sep);
        const absHtml = path.join(runRoot, relFs);
        if (!isPathInsideRoot(runRoot, absHtml)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          const st = await stat(absHtml);
          if (!st.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
          }
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        try {
          const { brandBannerHtml } = await import("./modules/brand-config.js");
          const pdf = await renderHtmlFileToPdf(absHtml, { runRoot, brandBannerHtml: brandBannerHtml() });
          const base = path.basename(file, ".html").replace(/[^a-zA-Z0-9._-]+/g, "_");
          const download =
            url.searchParams.get("download") === "1" || url.searchParams.get("download") === "true";
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `${download ? "attachment" : "inline"}; filename="health-${runId}-${base}.pdf"`,
            "Cache-Control": "no-store",
          });
          res.end(pdf);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(
            `PDF generation failed: ${msg}\n\n` +
              `If Chromium is missing, run: npx playwright install chromium\n` +
              `Large reports are retried with a fresh browser and lighter print settings (several attempts). ` +
              `Docker/Linux: QA_AGENT_PDF_NO_SANDBOX=1. If PDFs look wrong on Apple Silicon, try QA_AGENT_PDF_DISABLE_GPU=1.\n`,
          );
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/issue-overrides") {
        let body: string;
        try {
          body = await readBody(req, 512_000);
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request");
          return;
        }
        let payload: { runId?: unknown; overrides?: unknown };
        try {
          payload = JSON.parse(body) as { runId?: unknown; overrides?: unknown };
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }
        const runIdParam =
          typeof payload.runId === "string" ? payload.runId : String(payload.runId ?? "");
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const rawOv = payload.overrides;
        if (!rawOv || typeof rawOv !== "object" || Array.isArray(rawOv)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("overrides must be an object");
          return;
        }
        const allowed = new Set(["open", "ok", "working", "resolved"]);
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawOv as Record<string, unknown>)) {
          if (typeof k !== "string" || k.length > 128) continue;
          if (typeof v !== "string" || !allowed.has(v)) continue;
          cleaned[k] = v;
        }
        const runRoot = path.join(outRoot, runIdParam);
        if (!isPathInsideRoot(outRoot, runRoot)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        const outPath = path.join(runRoot, "issue-overrides.json");
        if (!isPathInsideRoot(runRoot, outPath)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          await mkdir(runRoot, { recursive: true });
          await writeFile(
            outPath,
            JSON.stringify(
              {
                runId: runIdParam,
                savedAt: new Date().toISOString(),
                overrides: cleaned,
              },
              null,
              2,
            ),
            "utf8",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(msg);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, overrides: cleaned, savedAt: new Date().toISOString() }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/site-status-overrides") {
        let body: string;
        try {
          body = await readBody(req, 512_000);
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request");
          return;
        }
        let payload: { runId?: unknown; sites?: unknown };
        try {
          payload = JSON.parse(body) as { runId?: unknown; sites?: unknown };
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }
        const runIdParam =
          typeof payload.runId === "string" ? payload.runId : String(payload.runId ?? "");
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const rawSites = payload.sites;
        if (!rawSites || typeof rawSites !== "object" || Array.isArray(rawSites)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("sites must be an object");
          return;
        }
        const allowed = new Set(["open", "ok", "working", "resolved"]);
        const cleanedSites: Record<string, { status: string; editedAt: string }> = {};
        const now = new Date().toISOString();
        for (const [k, v] of Object.entries(rawSites as Record<string, unknown>)) {
          if (typeof k !== "string" || k.length > 256 || k.includes("..") || k.includes("/") || k.includes("\\")) continue;
          if (!v || typeof v !== "object" || Array.isArray(v)) continue;
          const st = (v as { status?: unknown }).status;
          if (typeof st !== "string" || !allowed.has(st)) continue;
          cleanedSites[k] = { status: st, editedAt: now };
        }
        const runRoot = path.join(outRoot, runIdParam);
        if (!isPathInsideRoot(outRoot, runRoot)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        const outPath = path.join(runRoot, "site-status-overrides.json");
        if (!isPathInsideRoot(runRoot, outPath)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          await mkdir(runRoot, { recursive: true });
          await writeFile(
            outPath,
            JSON.stringify(
              {
                runId: runIdParam,
                savedAt: now,
                sites: cleanedSites,
              },
              null,
              2,
            ),
            "utf8",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(msg);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, sites: cleanedSites, savedAt: now }));
        return;
      }

      // ── SEMrush Feature Endpoints ──────────────────────────────────

      // Helper: load reports for a runId from POST body
      const semrushEndpoint = async (
        pathname: string,
        handler: (reports: SiteHealthReport[], payload: any) => any | Promise<any>,
      ) => {
        if (req.method === "POST" && url.pathname === pathname) {
          let body: string;
          try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return true; }
          let payload: any;
          try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }

          try {
            let reports: SiteHealthReport[] = [];
            const runIdParam = typeof payload.runId === "string" ? payload.runId : "";
            if (!runIdParam || !isSafeRunIdSegment(runIdParam)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad runId" })); return true; }
            // Cache-first: check ReportCache before reading disk
            let cached = ReportCache.get(runIdParam);
            if (!cached) {
              const raw = await loadRawReportsForRun(outRoot, runIdParam);
              if (!raw) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run not found" })); return true; }
              cached = { reports: raw.reports, generatedAt: raw.generatedAt };
              ReportCache.set(runIdParam, cached);
            }
            reports = cached.reports;
            const result = await handler(reports, payload);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=60" });
            res.end(JSON.stringify(result));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: msg }));
          }
          return true;
        }
        return false;
      };

      if (await semrushEndpoint("/api/site-audit", (reports) => analyzeSiteAudit(reports))) return;
      if (await semrushEndpoint("/api/position-tracking", (reports) => analyzePositions(reports))) return;
      if (await semrushEndpoint("/api/domain-overview", (reports) => analyzeDomain(reports))) return;
      if (await semrushEndpoint("/api/organic-rankings", (reports) => analyzeOrganicRankings(reports))) return;
      if (await semrushEndpoint("/api/top-pages", (reports) => analyzeTopPages(reports))) return;
      if (await semrushEndpoint("/api/backlinks", (reports) => analyzeBacklinks(reports))) return;
      if (await semrushEndpoint("/api/referring-domains", (reports) => analyzeReferringDomains(reports))) return;
      if (await semrushEndpoint("/api/backlink-audit", (reports) => auditBacklinks(reports))) return;
      if (await semrushEndpoint("/api/keyword-overview", (reports) => extractKeywords(reports))) return;
      if (await semrushEndpoint("/api/keyword-strategy", (reports) => buildKeywordStrategy(reports))) return;
      if (await semrushEndpoint("/api/traffic-analytics", (reports) => analyzeTraffic(reports))) return;
      if (await semrushEndpoint("/api/content-audit", (reports) => auditContent(reports))) return;

      // Compare domains (multi-run)
      if (req.method === "POST" && url.pathname === "/api/compare-domains") {
        let body: string;
        try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { runIds?: string[] };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const runIds = Array.isArray(payload.runIds) ? payload.runIds.filter((id): id is string => typeof id === "string" && isSafeRunIdSegment(id)) : [];
        if (runIds.length < 2) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Need at least 2 runIds" })); return; }
        try {
          const sets = [];
          for (const rid of runIds) {
            const raw = await loadRawReportsForRun(outRoot, rid);
            if (raw) sets.push({ runId: rid, reports: raw.reports });
          }
          const result = compareDomains(sets);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Gap endpoints (need two runs)
      for (const [ep, fn] of [["/api/keyword-gap", analyzeKeywordGap], ["/api/backlink-gap", analyzeBacklinkGap]] as const) {
        if (req.method === "POST" && url.pathname === ep) {
          let body: string;
          try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
          let payload: { runIdA?: string; runIdB?: string };
          try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
          const ridA = typeof payload.runIdA === "string" ? payload.runIdA : "";
          const ridB = typeof payload.runIdB === "string" ? payload.runIdB : "";
          if (!ridA || !ridB || !isSafeRunIdSegment(ridA) || !isSafeRunIdSegment(ridB)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Need runIdA and runIdB" })); return; }
          try {
            const rawA = await loadRawReportsForRun(outRoot, ridA);
            const rawB = await loadRawReportsForRun(outRoot, ridB);
            if (!rawA || !rawB) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run not found" })); return; }
            const result = fn(rawA.reports, rawB.reports);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify(result));
          } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
          return;
        }
      }

      // Keyword Suggestions (Google Autocomplete — no key needed)
      if (req.method === "POST" && url.pathname === "/api/keyword-suggestions") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keyword?: string; locale?: string; country?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const kw = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        if (!kw) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keyword required" })); return; }
        const locale = typeof payload.locale === "string" ? payload.locale : "en";
        const country = typeof payload.country === "string" ? payload.country : "";
        try {
          const [sugg, questions] = await Promise.allSettled([
            fetchSuggestions(kw, locale, country),
            fetchQuestionSuggestions(kw, locale, country),
          ]);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=86400" });
          res.end(JSON.stringify({
            suggestions: sugg.status === "fulfilled" ? sugg.value.value : [],
            questions: questions.status === "fulfilled" ? questions.value.value : [],
            source: "google-suggest",
          }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Keyword Trends (Google Trends — no key needed)
      if (req.method === "POST" && url.pathname === "/api/keyword-trends") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keyword?: string; geo?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const kw = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        if (!kw) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keyword required" })); return; }
        const geo = typeof payload.geo === "string" ? payload.geo : "";
        try {
          const trend = await fetchKeywordTrend(kw, geo);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
          res.end(JSON.stringify(trend));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Keyword Magic (Ollama-powered, seed keyword only)
      if (req.method === "POST" && url.pathname === "/api/keyword-magic") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { seedKeyword?: string; region?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const seed = typeof payload.seedKeyword === "string" ? payload.seedKeyword.trim() : "";
        const region = typeof payload.region === "string" && payload.region.trim() ? payload.region.trim() : "US";
        if (!seed) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "seedKeyword required" })); return; }
        try {
          const result = await generateMagicKeywords(seed, region);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // SEO Writing Assistant (needs runId + url)
      if (req.method === "POST" && url.pathname === "/api/seo-writing-assistant") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { runId?: string; url?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const runIdP = typeof payload.runId === "string" ? payload.runId : "";
        const urlP = typeof payload.url === "string" ? payload.url.trim() : "";
        if (!runIdP || !isSafeRunIdSegment(runIdP) || !urlP) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "runId and url required" })); return; }
        try {
          const raw = await loadRawReportsForRun(outRoot, runIdP);
          if (!raw) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run not found" })); return; }
          const result = await analyzeWritingAssistant(urlP, raw.reports);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // SEO Content Template (Ollama-powered, keyword only)
      if (req.method === "POST" && url.pathname === "/api/seo-content-template") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keyword?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const kw = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        if (!kw) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keyword required" })); return; }
        try {
          const result = await generateContentTemplate(kw);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Topic Research (Ollama-powered, optional runId)
      if (req.method === "POST" && url.pathname === "/api/topic-research") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { topic?: string; runId?: string; region?: string; country?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
        if (!topic) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "topic required" })); return; }
        const region = typeof payload.region === "string" && payload.region.trim()
          ? payload.region.trim()
          : typeof payload.country === "string" ? payload.country.trim() : "";
        try {
          let reports: SiteHealthReport[] | undefined;
          const runIdP = typeof payload.runId === "string" ? payload.runId : "";
          if (runIdP && isSafeRunIdSegment(runIdP)) {
            const raw = await loadRawReportsForRun(outRoot, runIdP);
            if (raw) reports = raw.reports;
          }
          const result = await researchTopic(topic, reports, region);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // On-Page SEO Checker (needs runId + url)
      if (req.method === "POST" && url.pathname === "/api/onpage-seo-checker") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { runId?: string; url?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const runIdP = typeof payload.runId === "string" ? payload.runId : "";
        const urlP = typeof payload.url === "string" ? payload.url.trim() : "";
        if (!runIdP || !isSafeRunIdSegment(runIdP)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "runId required" })); return; }
        try {
          const raw = await loadRawReportsForRun(outRoot, runIdP);
          if (!raw) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run not found" })); return; }
          const result = await checkOnPageSeo(urlP, raw.reports);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Post Tracking (needs runId, optional baselineRunId)
      if (req.method === "POST" && url.pathname === "/api/post-tracking") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { runId?: string; baselineRunId?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const runIdP = typeof payload.runId === "string" ? payload.runId : "";
        if (!runIdP || !isSafeRunIdSegment(runIdP)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "runId required" })); return; }
        try {
          const raw = await loadRawReportsForRun(outRoot, runIdP);
          if (!raw) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run not found" })); return; }
          let baseline: SiteHealthReport[] | undefined;
          const bId = typeof payload.baselineRunId === "string" ? payload.baselineRunId : "";
          if (bId && isSafeRunIdSegment(bId)) {
            const rawB = await loadRawReportsForRun(outRoot, bId);
            if (rawB) baseline = rawB.reports;
          }
          const result = await trackPosts(raw.reports, baseline);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Brand Monitoring (needs brandName + runId)
      if (req.method === "POST" && url.pathname === "/api/brand-monitor") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { brandName?: string; runId?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const brand = typeof payload.brandName === "string" ? payload.brandName.trim() : "";
        const runIdP = typeof payload.runId === "string" ? payload.runId : "";
        if (!brand || !runIdP || !isSafeRunIdSegment(runIdP)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "brandName and runId required" })); return; }
        try {
          const raw = await loadRawReportsForRun(outRoot, runIdP);
          if (!raw) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run not found" })); return; }
          const result = await analyzeBrandPresence(brand, raw.reports);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Google OAuth + GSC + GA4 ─────────────────────────────────────
      //
      // Connect flow: GET /api/auth/google/start → redirects the browser to
      // Google's consent screen. Google redirects back to
      // /api/auth/google/callback with ?code which we exchange for
      // access + refresh tokens stored at data/google-tokens.json.
      //
      // All data endpoints accept JSON POST bodies and call the providers,
      // which go through googleApiFetch() (automatic refresh).

      if (req.method === "GET" && url.pathname === "/api/auth/google/status") {
        try {
          const status = await getConnectionStatus();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(status));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/google/start") {
        if (!isOauthConfigured()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env" }));
          return;
        }
        try {
          const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
          const redirectUri = getRedirectUri(req);
          const authUrl = buildAuthorizeUrl(state, redirectUri);
          res.writeHead(302, { Location: authUrl, "Cache-Control": "no-store" });
          res.end();
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/google/callback") {
        const code = url.searchParams.get("code");
        const errParam = url.searchParams.get("error");
        if (errParam) {
          res.writeHead(302, { Location: `/google-connections?err=${encodeURIComponent(errParam)}` });
          res.end();
          return;
        }
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing authorization code");
          return;
        }
        try {
          const redirectUri = getRedirectUri(req);
          await exchangeCodeForTokens(code, redirectUri);
          res.writeHead(302, { Location: "/google-connections?connected=1" });
          res.end();
        } catch (e) {
          const msg = encodeURIComponent(e instanceof Error ? e.message : String(e));
          res.writeHead(302, { Location: `/google-connections?err=${msg}` });
          res.end();
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/google/disconnect") {
        try {
          await clearTokens();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Google Ads OAuth (separate from GSC/GA4) ──────────────────────

      if (req.method === "GET" && url.pathname === "/api/auth/gads/start") {
        const clientId     = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
        const redirectUri  = process.env.GOOGLE_ADS_REDIRECT_URI?.trim() || `http://localhost:${options.port}/api/auth/gads/callback`;
        if (!clientId) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "GOOGLE_ADS_CLIENT_ID not set in .env" }));
          return;
        }
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "https://www.googleapis.com/auth/adwords",
          access_type: "offline",
          prompt: "consent",
        });
        res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, "Cache-Control": "no-store" });
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/gads/callback") {
        const code     = url.searchParams.get("code");
        const errParam = url.searchParams.get("error");
        if (errParam) {
          res.writeHead(302, { Location: `/google-connections?gads_err=${encodeURIComponent(errParam)}` });
          res.end();
          return;
        }
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing authorization code");
          return;
        }
        try {
          const clientId     = process.env.GOOGLE_ADS_CLIENT_ID!.trim();
          const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET!.trim();
          const redirectUri  = process.env.GOOGLE_ADS_REDIRECT_URI?.trim() || `http://localhost:${options.port}/api/auth/gads/callback`;
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
          });
          const tokenData = await tokenRes.json() as { refresh_token?: string; error?: string };
          if (!tokenData.refresh_token) {
            throw new Error(tokenData.error ?? "No refresh token returned — ensure prompt=consent was set");
          }
          // Write refresh token to .env file at runtime so it persists
          const envPath = path.join(process.cwd(), ".env");
          let envContent = await readFile(envPath, "utf8").catch(() => "");
          if (envContent.includes("GOOGLE_ADS_REFRESH_TOKEN=")) {
            envContent = envContent.replace(/^GOOGLE_ADS_REFRESH_TOKEN=.*$/m, `GOOGLE_ADS_REFRESH_TOKEN=${tokenData.refresh_token}`);
          } else {
            envContent += `\nGOOGLE_ADS_REFRESH_TOKEN=${tokenData.refresh_token}\n`;
          }
          await writeFile(envPath, envContent, "utf8");
          process.env.GOOGLE_ADS_REFRESH_TOKEN = tokenData.refresh_token;
          res.writeHead(302, { Location: "/google-connections?gads_connected=1" });
          res.end();
        } catch (e) {
          const msg = encodeURIComponent(e instanceof Error ? e.message : String(e));
          res.writeHead(302, { Location: `/google-connections?gads_err=${msg}` });
          res.end();
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/gads/status") {
        const configured = !!(process.env.GOOGLE_ADS_CLIENT_ID?.trim() && process.env.GOOGLE_ADS_CLIENT_SECRET?.trim());
        const connected  = !!process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ configured, connected }));
        return;
      }

      // ── GSC ───────────────────────────────────────────────────────────

      if (req.method === "GET" && url.pathname === "/api/gsc/sites") {
        try {
          const sites = await listGscSites();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ sites }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gsc/query") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { siteUrl?: string; startDate?: string; endDate?: string; dimensions?: string[]; rowLimit?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const siteUrl = typeof payload.siteUrl === "string" ? payload.siteUrl : "";
        if (!siteUrl) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "siteUrl required" })); return; }
        try {
          const validDims = new Set(["query", "page", "country", "device", "searchAppearance"]);
          const dims = Array.isArray(payload.dimensions)
            ? (payload.dimensions.filter((d) => typeof d === "string" && validDims.has(d)) as ("query" | "page" | "country" | "device" | "searchAppearance")[])
            : undefined;
          const rows = await queryGscAnalytics({
            siteUrl,
            startDate: payload.startDate,
            endDate: payload.endDate,
            dimensions: dims,
            rowLimit: payload.rowLimit,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ rows, siteUrl }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gsc/keyword") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { siteUrl?: string; keyword?: string; daysBack?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const siteUrl = typeof payload.siteUrl === "string" ? payload.siteUrl : "";
        const keyword = typeof payload.keyword === "string" ? payload.keyword : "";
        if (!siteUrl || !keyword) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "siteUrl and keyword required" })); return; }
        try {
          const stats = await getGscKeywordStats(siteUrl, keyword, payload.daysBack);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ stats, siteUrl, keyword }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gsc/page") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { siteUrl?: string; pageUrl?: string; daysBack?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const siteUrl = typeof payload.siteUrl === "string" ? payload.siteUrl : "";
        const pageUrl = typeof payload.pageUrl === "string" ? payload.pageUrl : "";
        if (!siteUrl || !pageUrl) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "siteUrl and pageUrl required" })); return; }
        try {
          const stats = await getGscPageStats(siteUrl, pageUrl, payload.daysBack);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ stats, siteUrl, pageUrl }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gsc/pages-batch") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { siteUrl?: string; daysBack?: number; rowLimit?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const siteUrl = typeof payload.siteUrl === "string" ? payload.siteUrl : "";
        if (!siteUrl) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "siteUrl required" })); return; }
        try {
          const map = await getGscPageStatsBatch(siteUrl, payload.daysBack, payload.rowLimit);
          // Map values already carry `page` from GscPageStats.
          const pages = Array.from(map.values());
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ pages, siteUrl }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── GA4 ───────────────────────────────────────────────────────────

      if (req.method === "GET" && url.pathname === "/api/ga4/properties") {
        try {
          const properties = await listGa4Properties();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ properties }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/ga4/report") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { propertyId?: string; startDate?: string; endDate?: string; dimensions?: string[]; metrics?: string[]; limit?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const propertyId = typeof payload.propertyId === "string" ? payload.propertyId : "";
        if (!propertyId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "propertyId required" })); return; }
        try {
          const rows = await runGa4Report({
            propertyId,
            startDate: payload.startDate,
            endDate: payload.endDate,
            dimensions: Array.isArray(payload.dimensions) ? payload.dimensions.filter((d) => typeof d === "string") : undefined,
            metrics: Array.isArray(payload.metrics) ? payload.metrics.filter((m) => typeof m === "string") : undefined,
            limit: payload.limit,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ rows, propertyId }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/ga4/page") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { propertyId?: string; pagePath?: string; daysBack?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const propertyId = typeof payload.propertyId === "string" ? payload.propertyId : "";
        const pagePath = typeof payload.pagePath === "string" ? payload.pagePath : "";
        if (!propertyId || !pagePath) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "propertyId and pagePath required" })); return; }
        try {
          const traffic = await getGa4PageTraffic(propertyId, pagePath, payload.daysBack);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ traffic, propertyId, pagePath }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/ga4/pages-batch") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { propertyId?: string; daysBack?: number; limit?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const propertyId = typeof payload.propertyId === "string" ? payload.propertyId : "";
        if (!propertyId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "propertyId required" })); return; }
        try {
          const map = await getGa4PageTrafficBatch(propertyId, payload.daysBack, payload.limit);
          // Map values already carry `page` from Ga4PageTraffic.
          const pages = Array.from(map.values());
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ pages, propertyId }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/ga4/totals") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { propertyId?: string; daysBack?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const propertyId = typeof payload.propertyId === "string" ? payload.propertyId : "";
        if (!propertyId) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "propertyId required" })); return; }
        try {
          const totals = await getGa4PropertyTotals(propertyId, payload.daysBack);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ totals, propertyId }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // Log File Analyzer (no run needed)
      if (req.method === "POST" && url.pathname === "/api/log-analyzer") {
        let body: string;
        try { body = await readBody(req, 1_000_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { logContent?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const content = typeof payload.logContent === "string" ? payload.logContent : "";
        if (!content.trim()) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "logContent required" })); return; }
        try {
          const result = await analyzeLogFile(content);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Local SEO (Ollama-powered, optional runId)
      if (req.method === "POST" && url.pathname === "/api/local-seo") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { businessName?: string; location?: string; runId?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const biz = typeof payload.businessName === "string" ? payload.businessName.trim() : "";
        const loc = typeof payload.location === "string" ? payload.location.trim() : "";
        if (!biz || !loc) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "businessName and location required" })); return; }
        try {
          let reports: SiteHealthReport[] | undefined;
          const runIdP = typeof payload.runId === "string" ? payload.runId : "";
          if (runIdP && isSafeRunIdSegment(runIdP)) {
            const raw = await loadRawReportsForRun(outRoot, runIdP);
            if (raw) reports = raw.reports;
          }
          const result = await analyzeLocalSeo(biz, loc, reports);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Keyword Manager endpoints
      if (req.method === "POST" && url.pathname === "/api/keyword-lists") {
        try {
          const result = await loadKeywordLists();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/keyword-lists/save") {
        let body: string;
        try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { name?: string; keywords?: string[] };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const name = typeof payload.name === "string" ? payload.name.trim() : "";
        const keywords = Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string") : [];
        if (!name) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "name required" })); return; }
        try {
          const result = await saveKeywordList(name, keywords);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/keyword-lists/delete") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { name?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const name = typeof payload.name === "string" ? payload.name.trim() : "";
        if (!name) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "name required" })); return; }
        try {
          const result = await deleteKeywordList(name);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/keyword-lists/analyze") {
        let body: string;
        try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keywords?: string[]; region?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const keywords = Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string") : [];
        if (keywords.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keywords required" })); return; }
        const region = typeof payload.region === "string" && payload.region.trim() ? payload.region.trim() : "US";
        try {
          const result = await analyzeKeywordList(keywords, region);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Agentic Pipeline Endpoints ────────────────────────────────

      // Start agentic pipeline
      if (req.method === "POST" && url.pathname === "/api/agentic/start") {
        let body: string;
        try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { targetUrl?: string; keywords?: string[]; maxPages?: number; enableSerp?: boolean; enableSmartCrawl?: boolean; enableAnalysis?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const targetUrl = typeof payload.targetUrl === "string" ? payload.targetUrl.trim() : "";
        if (!targetUrl) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "targetUrl required" })); return; }
        const config: AgenticSessionConfig = {
          targetUrl,
          keywords: Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0) : [],
          maxPages: typeof payload.maxPages === "number" ? payload.maxPages : undefined,
          enableSerp: payload.enableSerp,
          enableSmartCrawl: payload.enableSmartCrawl,
          enableAnalysis: payload.enableAnalysis,
        };
        // Run pipeline in background, return session ID immediately
        const sessionId = `agentic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ sessionId, status: "started" }));
        // Fire and forget — client polls /api/agentic/session
        runAgenticPipeline(config).catch(e => console.error("[agentic] pipeline error:", e));
        return;
      }

      // Get agentic session
      if (req.method === "POST" && url.pathname === "/api/agentic/session") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { sessionId?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const sid = typeof payload.sessionId === "string" ? payload.sessionId : "";
        if (!sid) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "sessionId required" })); return; }
        const session = getAgenticSession(sid);
        if (!session) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Session not found" })); return; }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(session));
        return;
      }

      // List agentic sessions
      if (req.method === "GET" && url.pathname === "/api/agentic/sessions") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(listAgenticSessions()));
        return;
      }

      // SERP Analysis (standalone)
      if (req.method === "POST" && url.pathname === "/api/serp-analysis") {
        let body: string;
        try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keywords?: string[]; targetDomain?: string; region?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const keywords = Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0) : [];
        if (keywords.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keywords required" })); return; }
        const { ddgRegionCode } = await import("./providers/geo-targets.js");
        const regionCode = ddgRegionCode(payload.region ?? "US");
        try {
          const result = await runSerpAnalysis(keywords, typeof payload.targetDomain === "string" ? payload.targetDomain.trim() : undefined, regionCode);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Single SERP search
      if (req.method === "POST" && url.pathname === "/api/serp-search") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { query?: string; region?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const query = typeof payload.query === "string" ? payload.query.trim() : "";
        if (!query) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "query required" })); return; }
        const { ddgRegionCode } = await import("./providers/geo-targets.js");
        const regionCode = ddgRegionCode(payload.region ?? "US");
        try {
          const result = await searchSerp(query, regionCode);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // LLM Router stats
      if (req.method === "GET" && url.pathname === "/api/llm-stats") {
        // Ensure Ollama availability is probed before returning stats
        await checkOllamaAvailable();
        const stats = getLlmRouterStats();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(stats));
        return;
      }

      // ── NLP Query Lab ─────────────────────────────────────────────
      if (req.method === "POST" && url.pathname === "/api/query") {
        let body: string;
        try { body = await readBody(req, 64_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: NlpQueryRequest;
        try { payload = JSON.parse(body) as NlpQueryRequest; } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const queryText = typeof payload.query === "string" ? payload.query.trim().slice(0, 4000) : "";
        const runIdParam = typeof payload.runId === "string" ? payload.runId : "";
        const history = Array.isArray(payload.history) ? payload.history.slice(-6) : [];
        if (!queryText) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "query required" })); return; }
        if (!runIdParam || !isSafeRunIdSegment(runIdParam)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad runId" })); return; }
        const { checkOllamaAvailable: _checkOllama } = await import("./llm.js");
        if (!(await _checkOllama())) { res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Local Ollama not available. Start Ollama and pull llama3.2." })); return; }
        const rawData = await loadRawReportsForRun(outRoot, runIdParam);
        if (!rawData) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run data not found" })); return; }
        try {
          const result = await routeQuery(queryText, runIdParam, rawData.reports, rawData.generatedAt, history);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }

      // ── Keyword Research (real free providers, no run needed) ─────
      if (req.method === "POST" && url.pathname === "/api/keyword-research") {
        const meterStart = Date.now();
        let meterOk = true;
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keyword?: string; region?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const kw = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        const region = typeof payload.region === "string" && payload.region.trim() ? payload.region.trim() : "US";
        if (!kw) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keyword required" })); return; }
        try {
          const { researchKeyword } = await import("./modules/keyword-research.js");
          const ck = buildCacheKey("/api/keyword-research", { kw, region });
          const { value: result, hit } = await cachedResponse(ck, 10 * 60_000, () => researchKeyword(kw, region));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify(result));
        } catch (e) {
          meterOk = false;
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        } finally {
          recordUsage({
            ts: new Date().toISOString(),
            clientKey: deriveClientKey(req),
            endpoint: "/api/keyword-research",
            category: "keyword-lookup",
            bytes: 0,
            durationMs: Date.now() - meterStart,
            ok: meterOk,
          });
        }
        return;
      }

      // ── External Backlinks (free provider mix: OPR + Common Crawl + URLScan + Wayback) ──
      if (req.method === "POST" && url.pathname === "/api/external-backlinks") {
        const meterStart = Date.now();
        let meterOk = true;
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { domain?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const { discoverExternalBacklinks } = await import("./modules/link-analyzer.js");
          const result = await discoverExternalBacklinks(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
          res.end(JSON.stringify(result));
        } catch (e) {
          meterOk = false;
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        } finally {
          recordUsage({
            ts: new Date().toISOString(),
            clientKey: deriveClientKey(req),
            endpoint: "/api/external-backlinks",
            category: "backlink-query",
            bytes: 0,
            durationMs: Date.now() - meterStart,
            ok: meterOk,
          });
        }
        return;
      }

      // ── Usage snapshot (for dashboard tile + debugging) ──
      if (req.method === "GET" && url.pathname === "/api/usage/snapshot") {
        const snap = getUsageSnapshot();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(snap));
        return;
      }

      // ── Domain Authority (OpenPageRank free tier) ──
      if (req.method === "POST" && url.pathname === "/api/domain-authority") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { domain?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const { fetchDomainAuthority, isOpenPageRankConfigured } = await import("./providers/open-page-rank.js");
          if (!isOpenPageRankConfigured()) {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ configured: false, pageRank: null, domainAuthority: null, source: "openPageRank — set OPR_API_KEY in .env" }));
            return;
          }
          const da = await fetchDomainAuthority(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
          res.end(JSON.stringify({
            configured: true,
            domain: da.domain,
            pageRankDecimal: da.pageRankDecimal.value,
            authority0to100: da.authority0to100.value,
            globalRank: da.globalRank?.value ?? null,
            source: "open-page-rank",
          }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Keyword Volume (Google Ads Keyword Planner) ──
      if (req.method === "POST" && url.pathname === "/api/keyword-volume") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keywords?: string[]; geo?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        if (!isGoogleAdsConfigured()) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ configured: false, error: "Set GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID in .env — see src/health/providers/google-ads.ts for setup instructions" }));
          return;
        }
        const keywords = Array.isArray(payload.keywords) ? payload.keywords.map(String).filter(Boolean).slice(0, 20) : [];
        if (keywords.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keywords array required" })); return; }
        try {
          const results = await fetchKeywordVolume(keywords, payload.geo ?? "US");
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=86400" });
          res.end(JSON.stringify({ configured: true, results }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── List broken links across a run (flat, with site hostname) ──
      if (req.method === "GET" && url.pathname.startsWith("/api/broken-links/")) {
        const runIdP = url.pathname.slice("/api/broken-links/".length);
        if (!runIdP || !isSafeRunIdSegment(runIdP)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad runId" })); return; }
        try {
          const raw = await loadRawReportsForRun(outRoot, runIdP);
          if (!raw) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Run not found" })); return; }
          const links: Array<{ siteHostname: string; foundOn: string; target: string; status?: number; error?: string; durationMs?: number; anchorText?: string; linkContext?: string; outerHtml?: string }> = [];
          for (const r of raw.reports) {
            for (const b of r.crawl.brokenLinks ?? []) {
              links.push({
                siteHostname: r.hostname,
                foundOn: b.foundOn,
                target: b.target,
                status: b.status,
                error: b.error,
                durationMs: b.durationMs,
                anchorText: b.anchorText,
                linkContext: b.linkContext,
                outerHtml: b.outerHtml,
              });
            }
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=120" });
          res.end(JSON.stringify({ runId: runIdP, generatedAt: raw.generatedAt, links }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── AI fix recommendations for a list of broken links ──
      if (req.method === "POST" && url.pathname === "/api/link-fix-recommendations") {
        let body: string;
        try { body = await readBody(req, 256_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { links?: BrokenLinkInput[] };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const links = Array.isArray(payload.links) ? payload.links.filter((l): l is BrokenLinkInput => !!l && typeof l.foundOn === "string" && typeof l.target === "string").slice(0, 100) : [];
        if (links.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "links array required" })); return; }
        try {
          const recommendations = await recommendLinkFixes(links);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
          res.end(JSON.stringify({ recommendations }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Keyword Impact Predictor ──
      if (req.method === "POST" && url.pathname === "/api/keyword-impact") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { url?: string; keyword?: string; region?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const targetUrl = typeof payload.url === "string" ? payload.url.trim() : "";
        const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        const region = typeof payload.region === "string" && payload.region.trim() ? payload.region.trim() : "US";
        if (!targetUrl || !keyword) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "url and keyword required" })); return; }
        try {
          const result = await predictKeywordImpact({ url: targetUrl, keyword, region });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── GSC Links CSV import (UI upload → persisted bundle → link-analyzer enrich) ──
      if (req.method === "POST" && url.pathname === "/api/gsc-links/upload") {
        let body: string;
        try { body = await readBody(req, 5_000_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Body too large (5 MB cap) or unreadable" })); return; }
        let payload: { domain?: string; csv?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        const csv = typeof payload.csv === "string" ? payload.csv : "";
        if (!domain || !csv) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain and csv required" })); return; }
        try {
          const result = await ingestGscLinksCsv(domain, csv);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, ...result }));
        } catch (e) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/gsc-links/")) {
        const domain = decodeURIComponent(url.pathname.slice("/api/gsc-links/".length));
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const bundle = await fetchGscLinksBundle(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ bundle: bundle ? bundle.value : null }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }

      // ── Unified /integrations status — aggregate every connection's state ──
      if (req.method === "GET" && url.pathname === "/api/integrations/status") {
        const googleConnected = await getConnectionStatus();
        const bingTokens = await loadBingTokens();
        const byok = (await import("./providers/byok-config.js")).listByokProviders();
        const status = {
          google: {
            connected: googleConnected.connected,
            configured: googleConnected.configured,
            email: googleConnected.email,
            scopes: googleConnected.scopes ?? [],
            connectedAt: googleConnected.connectedAt,
            connectUrl: "/api/auth/google/start",
            covers: ["Google Search Console", "Google Analytics 4", "Google Ads Keyword Planner", "PageSpeed Insights", "Chrome UX Report"],
            price: "Free",
          },
          bing: {
            connected: !!bingTokens || !!process.env.BING_WEBMASTER_API_KEY?.trim(),
            connectionKind: process.env.BING_WEBMASTER_API_KEY?.trim() ? "api-key" : (bingTokens ? "oauth" : "none"),
            oauthClientConfigured: isBingOAuthClientConfigured(),
            connectUrl: "/api/auth/bing/start",
            apiKeyVar: "BING_WEBMASTER_API_KEY",
            helpUrl: "https://www.bing.com/webmasters/",
            covers: ["Inbound links for verified sites (40-60% of Ahrefs)", "Anchor text extraction"],
            price: "Free",
          },
          yandex: await (async () => {
            const oauthTokens = await loadYandexTokens();
            const oauthConfigured = isYandexOAuthClientConfigured();
            const staticSet = !!(process.env.YANDEX_WEBMASTER_API_KEY?.trim() && process.env.YANDEX_WEBMASTER_USER_ID?.trim());
            return {
              connected: !!oauthTokens || staticSet,
              connectionKind: oauthConfigured ? "oauth" : "api-token",
              oauthClientConfigured: oauthConfigured,
              connectUrl: oauthConfigured ? "/api/auth/yandex/start" : undefined,
              email: oauthTokens?.displayName,
              connectedAt: oauthTokens?.connectedAt,
              apiKeyVar: "YANDEX_WEBMASTER_API_KEY",
              helpUrl: "https://oauth.yandex.com/client/new",
              covers: ["Russian-language markets (60%+ .ru share)", "Inbound links + indexing for verified sites"],
              price: "Free",
            };
          })(),
          naver: {
            connected: !!(process.env.NAVER_CLIENT_ID?.trim() && process.env.NAVER_CLIENT_SECRET?.trim()),
            connectionKind: "api-keys",
            apiKeyVar: "NAVER_CLIENT_ID",
            helpUrl: "https://searchadvisor.naver.com/",
            covers: ["Korean-language markets (60% .kr share)", "Indexing + robots/sitemap validation"],
            price: "Free",
          },
          ahrefsWebmaster: {
            connected: false, // Can't check without a specific domain; UI will reload on domain select
            connectionKind: "csv-upload",
            uploadFlowUrl: "/backlinks",
            helpUrl: "https://ahrefs.com/webmaster-tools",
            covers: ["95% of paid Ahrefs coverage for your own verified sites"],
            price: "Free",
          },
          pagespeed: {
            connected: !!(process.env.PAGESPEED_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || googleConnected.connected),
            connectionKind: process.env.PAGESPEED_API_KEY?.trim() ? "api-key" : "via-google-oauth",
            apiKeyVar: "PAGESPEED_API_KEY",
            helpUrl: "https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com",
            covers: ["Lab PageSpeed + Lighthouse scores"],
            price: "Free",
          },
          openPageRank: {
            connected: !!(process.env.OPR_API_KEY?.trim() || process.env.OPEN_PAGERANK_API_KEY?.trim() || process.env.OPEN_PAGE_RANK_API_KEY?.trim()),
            connectionKind: "api-key",
            apiKeyVar: "OPR_API_KEY",
            helpUrl: "https://www.domcop.com/openpagerank/",
            covers: ["Domain authority score 0-10 / 0-100"],
            price: "Free",
          },
          urlscan: {
            connected: !!process.env.URLSCAN_API_KEY?.trim(),
            connectionKind: "api-key",
            apiKeyVar: "URLSCAN_API_KEY",
            helpUrl: "https://urlscan.io/user/signup",
            covers: ["Brand monitor signals, recent scans, resource graphs"],
            price: "Free",
          },
          cloudflareRadar: {
            connected: !!(process.env.CLOUDFLARE_API_TOKEN?.trim() || process.env.CF_API_TOKEN?.trim()),
            connectionKind: "api-token",
            apiKeyVar: "CLOUDFLARE_API_TOKEN",
            helpUrl: "https://dash.cloudflare.com/profile/api-tokens",
            covers: ["Real domain traffic rank in Cloudflare dataset"],
            price: "Free",
          },
          ollama: {
            connected: true, // auto-started; if not running UI surfaces it separately
            connectionKind: "local",
            helpUrl: "https://ollama.com/",
            covers: ["All AI narrative, cluster labels, LLM content commentary"],
            price: "Free (local)",
          },
          byok: byok,
          runtimeKeys: listRuntimeKeyNames(),
        };
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(status));
        return;
      }

      // ── Runtime-keys (paste from UI instead of .env editing) ──────────────
      // Whitelist of accepted env-var names so a compromised client can't
      // stuff arbitrary keys into our runtime store.
      const RUNTIME_KEY_WHITELIST = new Set([
        "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD",
        "AHREFS_API_TOKEN",
        "SEMRUSH_API_KEY",
        "SERPAPI_KEY",
        "MOZ_ACCESS_ID", "MOZ_SECRET_KEY",
        "BING_WEBMASTER_API_KEY",
        "YANDEX_WEBMASTER_API_KEY", "YANDEX_WEBMASTER_USER_ID",
        "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET",
        "OPR_API_KEY", "OPEN_PAGERANK_API_KEY", "OPEN_PAGE_RANK_API_KEY",
        "URLSCAN_API_KEY",
        "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN",
        "PAGESPEED_API_KEY", "GOOGLE_PAGESPEED_API_KEY",
        "CRUX_API_KEY",
        // Branding for white-label PDF exports + dashboard
        "BRAND_NAME", "BRAND_LOGO_URL", "BRAND_PRIMARY_HEX",
        // Alerts webhook (Slack/Teams/custom endpoint URL)
        "ALERT_WEBHOOK_URL",
      ]);
      if (req.method === "POST" && url.pathname === "/api/integrations/keys") {
        let body: string;
        try { body = await readBody(req, 20_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "body too large" })); return; }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const rejected: string[] = [];
        const updates: Record<string, string> = {};
        for (const [k, v] of Object.entries(payload)) {
          if (!RUNTIME_KEY_WHITELIST.has(k)) { rejected.push(k); continue; }
          if (typeof v !== "string") { rejected.push(k); continue; }
          updates[k] = v;
        }
        try {
          await setRuntimeKeys(updates);
          // Bust any cached responses that depended on now-changed keys
          invalidateByPrefix("/api/integrations/status");
          invalidateByPrefix("/api/council");
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, saved: Object.keys(updates), rejected, active: listRuntimeKeyNames() }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/integrations/keys/")) {
        const name = decodeURIComponent(url.pathname.slice("/api/integrations/keys/".length));
        if (!RUNTIME_KEY_WHITELIST.has(name)) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "name not in whitelist" })); return; }
        await clearRuntimeKey(name);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, cleared: name, active: listRuntimeKeyNames() }));
        return;
      }

      // ── Bing WMT OAuth (alternative to API-key path) ─────────────────────
      // Optional: when BING_WMT_OAUTH_CLIENT_ID + BING_WMT_OAUTH_CLIENT_SECRET
      // are set in .env, users can connect via Azure AD OAuth consent instead
      // of pasting an API key. Tokens persist to data/bing-wmt-tokens.json.
      if (req.method === "GET" && url.pathname === "/api/auth/bing/status") {
        const tokens = await loadBingTokens();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({
          clientConfigured: isBingOAuthClientConfigured(),
          connected: !!tokens,
          connectedAt: tokens?.connectedAt,
          expiresAt: tokens?.expiresAt,
          apiKeyAlsoSet: !!process.env.BING_WEBMASTER_API_KEY?.trim(),
        }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/auth/bing/start") {
        if (!isBingOAuthClientConfigured()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "BING_WMT_OAUTH_CLIENT_ID / BING_WMT_OAUTH_CLIENT_SECRET not set in .env" }));
          return;
        }
        const state = Buffer.from(String(Date.now()) + "::" + Math.random().toString(36).slice(2)).toString("base64url");
        const authUrl = buildBingOAuthAuthorizeUrl(state, options.port);
        res.writeHead(302, { Location: authUrl, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/auth/bing/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><body><h1>Bing OAuth failed</h1><p>${error}: ${url.searchParams.get("error_description") ?? ""}</p><a href="/integrations">Back to Connections</a></body></html>`);
          return;
        }
        if (!code) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Missing ?code parameter from Microsoft OAuth callback" }));
          return;
        }
        try {
          await exchangeBingOAuthCode(code, options.port);
          res.writeHead(302, { Location: "/integrations?bing=connected", "Cache-Control": "no-store" });
          res.end();
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><body><h1>Bing OAuth exchange failed</h1><pre>${String(e instanceof Error ? e.message : e)}</pre><a href="/integrations">Back to Connections</a></body></html>`);
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/bing/disconnect") {
        await clearBingTokens();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // ── Yandex OAuth 2.0 (alternative to static OAuth-token + user_id env) ─
      if (req.method === "GET" && url.pathname === "/api/auth/yandex/status") {
        const tokens = await loadYandexTokens();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({
          clientConfigured: isYandexOAuthClientConfigured(),
          connected: !!tokens,
          connectedAt: tokens?.connectedAt,
          expiresAt: tokens?.expiresAt,
          displayName: tokens?.displayName,
          userId: tokens?.userId,
          staticTokenAlsoSet: !!(process.env.YANDEX_WEBMASTER_API_KEY?.trim() && process.env.YANDEX_WEBMASTER_USER_ID?.trim()),
        }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/auth/yandex/start") {
        if (!isYandexOAuthClientConfigured()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "YANDEX_OAUTH_CLIENT_ID / YANDEX_OAUTH_CLIENT_SECRET not set (operator must register an OAuth app at https://oauth.yandex.com/client/new)" }));
          return;
        }
        const state = Buffer.from(String(Date.now()) + "::" + Math.random().toString(36).slice(2)).toString("base64url");
        const authUrl = buildYandexOAuthAuthorizeUrl(state, options.port);
        res.writeHead(302, { Location: authUrl, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/auth/yandex/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><body><h1>Yandex OAuth failed</h1><p>${error}: ${url.searchParams.get("error_description") ?? ""}</p><a href="/integrations">Back to Connections</a></body></html>`);
          return;
        }
        if (!code) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Missing ?code parameter from Yandex OAuth callback" }));
          return;
        }
        try {
          await exchangeYandexOAuthCode(code, options.port);
          res.writeHead(302, { Location: "/integrations?yandex=connected", "Cache-Control": "no-store" });
          res.end();
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><body><h1>Yandex OAuth exchange failed</h1><pre>${String(e instanceof Error ? e.message : e)}</pre><a href="/integrations">Back to Connections</a></body></html>`);
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/yandex/disconnect") {
        await clearYandexTokens();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // ── Ahrefs Webmaster Tools CSV import (free — 95% paid Ahrefs parity for your own site) ──
      if (req.method === "POST" && url.pathname === "/api/awt/upload") {
        let body: string;
        try { body = await readBody(req, 20_000_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Body too large (20 MB cap) or unreadable" })); return; }
        let payload: { domain?: string; csv?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        const csv = typeof payload.csv === "string" ? payload.csv : "";
        if (!domain || !csv) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain and csv required" })); return; }
        try {
          const result = await ingestAwtBacklinksCsv(domain, csv);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, rowCount: result.rowCount, summary: result.bundle.summary }));
        } catch (e) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/awt/")) {
        const domain = decodeURIComponent(url.pathname.slice("/api/awt/".length));
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const bundle = await fetchAwtBundle(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ bundle: bundle ? bundle.value : null }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }

      // ── Free brand/topic monitor via 6-source RSS + API aggregation ──
      if (req.method === "POST" && url.pathname === "/api/brand-mentions") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { query?: string; sources?: string[]; googleNewsLocale?: string };
        try { payload = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const q = typeof payload.query === "string" ? payload.query.trim() : "";
        if (!q) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "query required" })); return; }
        try {
          const ck = buildCacheKey("/api/brand-mentions", { q, sources: payload.sources, loc: payload.googleNewsLocale });
          const { value: bundle, hit } = await cachedResponse(ck, 15 * 60_000, () => fetchBrandMentions({
            query: q,
            sources: Array.isArray(payload.sources) ? (payload.sources as never[]) : undefined,
            googleNewsLocale: typeof payload.googleNewsLocale === "string" ? payload.googleNewsLocale : undefined,
          }));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify(bundle));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }

      // ── Startpage SERP (~0.9 correlation with Google, free, Playwright-backed) ──
      if (req.method === "POST" && url.pathname === "/api/serp-startpage") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { query?: string; region?: string };
        try { payload = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const q = typeof payload.query === "string" ? payload.query.trim() : "";
        const region = typeof payload.region === "string" ? payload.region : "US";
        if (!q) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "query required" })); return; }
        try {
          const ck = buildCacheKey("/api/serp-startpage", { q, region });
          const { value, hit } = await cachedResponse(ck, 5 * 60_000, () => searchStartpage(q, region).then((dp) => dp.value));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify(value));
        } catch (e) { res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }

      // ── Competitor Rank Tracker (free-tier DDG + Brave) ──
      if (req.method === "GET" && url.pathname === "/api/competitor-rank") {
        try {
          const pairs = await listCompetitorRankPairs();
          const stats = await getAllCompetitorStats();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ pairs, stats }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/competitor-rank") {
        let body: string;
        try { body = await readBody(req, 4_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { domain?: string; keyword?: string; regionCode?: string; recordSnapshot?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        const region = typeof payload.regionCode === "string" && payload.regionCode.trim() ? payload.regionCode.trim() : "US";
        if (!domain || !keyword) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain and keyword required" })); return; }
        try {
          await addCompetitorPair(domain, keyword, region);
          const result = await checkAndRecordCompetitorRank(domain, keyword, region);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/competitor-rank/")) {
        const rest = url.pathname.slice("/api/competitor-rank/".length);
        const parts = rest.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain/keyword required in path" })); return; }
        const domain = decodeURIComponent(parts[0]);
        const keyword = decodeURIComponent(parts[1]);
        try {
          await removeCompetitorPair(domain, keyword);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/competitor-rank-history/")) {
        const rest = url.pathname.slice("/api/competitor-rank-history/".length);
        const parts = rest.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain/keyword required in path" })); return; }
        const domain = decodeURIComponent(parts[0]);
        const keyword = decodeURIComponent(parts[1]);
        try {
          const history = await getCompetitorHistory(domain, keyword);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ domain, keyword, history }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }

      // ── AI Competitive Estimator (free-tier only) ──
      if (req.method === "GET" && url.pathname === "/api/competitive-estimate") {
        const domain = (url.searchParams.get("domain") ?? "").trim();
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const result = await estimateCompetitive(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
        return;
      }

      // ── Wayback Machine snapshots (no auth) ──
      if (req.method === "GET" && url.pathname === "/api/wayback") {
        const target = url.searchParams.get("url") ?? "";
        if (!target) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "url required" })); return; }
        try {
          const [closest, history] = await Promise.allSettled([
            fetchClosestSnapshot(target),
            fetchSnapshotHistory(target, 24),
          ]);
          const firstSnap = history.status === "fulfilled" ? history.value.value[0] : undefined;
          const lastSnap = history.status === "fulfilled" ? history.value.value[history.value.value.length - 1] : undefined;
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=86400" });
          res.end(JSON.stringify({
            url: target,
            closest: closest.status === "fulfilled" ? closest.value.value : null,
            first: firstSnap ?? null,
            last: lastSnap ?? null,
            snapshotsByYear: history.status === "fulfilled"
              ? history.value.value.map((s) => ({ year: Number(s.timestamp.slice(0, 4)), url: s.url }))
              : [],
            totalTracked: history.status === "fulfilled" ? history.value.value.length : 0,
          }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Security grade (Mozilla Observatory — no auth) ──
      if (req.method === "GET" && url.pathname === "/api/security-grade") {
        const domain = url.searchParams.get("domain") ?? "";
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const grade = await fetchSecurityGrade(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
          res.end(JSON.stringify(grade));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Chrome UX Report (real-user Web Vitals) ──
      if (req.method === "GET" && url.pathname === "/api/crux") {
        const target = url.searchParams.get("url") ?? "";
        const formFactor = (url.searchParams.get("formFactor") ?? "PHONE") as CruxFormFactor;
        if (!target) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "url required" })); return; }
        if (!isCruxConfigured()) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ configured: false, error: "Set CRUX_API_KEY in .env (enable 'Chrome UX Report API' in Google Cloud)." }));
          return;
        }
        try {
          const record = await fetchCruxRecord(target, formFactor);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=86400" });
          res.end(JSON.stringify({ configured: true, record }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Geo targets (country list for region selector) ──
      if (req.method === "GET" && url.pathname === "/api/geo-targets") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=604800" });
        res.end(JSON.stringify({ targets: GEO_TARGETS.map(({ iso, name }) => ({ iso, name })) }));
        return;
      }

      // ── Form tests (legacy `qa-agent run` surfaced in dashboard) ──
      if (req.method === "GET" && url.pathname === "/api/form-tests/sites") {
        try {
          const configPath = path.join(process.cwd(), "config", "sites.json");
          const raw = await readFile(configPath, "utf8").catch(() => null);
          if (!raw) { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ configured: false, error: "config/sites.json not found. Copy config/sites.example.json to config/sites.json and edit it." })); return; }
          const parsed = sitesConfigSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ configured: false, error: `config/sites.json invalid: ${parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}` })); return; }
          const sites = parsed.data.sites.map((s) => ({
            id: s.id,
            name: s.name,
            enabled: s.enabled !== false,
            url: s.url,
            forms: s.forms.length,
            hasLiveAgent: !!s.liveAgent && s.liveAgent.enabled !== false,
            captcha: s.forms.find((f) => f.captcha && f.captcha.strategy !== "none")?.captcha?.strategy ?? null,
            success: s.success.type,
          }));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ configured: true, sites }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) }));
        }
        return;
      }

      // Ad-hoc form test — paste any URL, auto-detect and fill the form.
      if (req.method === "POST" && url.pathname === "/api/form-tests/ad-hoc") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { url?: string; headless?: boolean; dryRun?: boolean };
        try { payload = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const target = (payload.url ?? "").trim();
        if (!/^https?:\/\//i.test(target)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Provide a full http(s) URL" })); return;
        }
        try {
          const runId = new Date().toISOString().replace(/[:.]/g, "-");
          const artifactsRoot = path.join(process.cwd(), "artifacts", "form-tests", `ad-hoc-${runId}`);
          const screenshotPath = path.join(artifactsRoot, "screenshot.png");
          const result = await runAdHocFormTest({
            url: target,
            headless: payload.headless !== false,
            dryRun: payload.dryRun === true,
            screenshotPath,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ runId, ...result, screenshotPath: path.relative(process.cwd(), result.screenshotPath).replace(/\\/g, "/") }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/form-tests/run") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { siteId?: string; headless?: boolean };
        try { payload = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        try {
          const configPath = path.join(process.cwd(), "config", "sites.json");
          const raw = await readFile(configPath, "utf8").catch(() => null);
          if (!raw) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "config/sites.json not found" })); return; }
          const parsed = sitesConfigSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: `Invalid config: ${parsed.error.issues.map((i) => i.message).join("; ")}` })); return; }
          const filteredSites = payload.siteId ? parsed.data.sites.filter((s) => s.id === payload.siteId) : parsed.data.sites;
          if (filteredSites.length === 0) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: `No site with id "${payload.siteId}"` })); return; }
          const artifactsRoot = path.join(process.cwd(), "artifacts", "form-tests");
          const summary = await orchestrateRun({
            config: { sites: filteredSites, defaultNotify: parsed.data.defaultNotify },
            configPath,
            concurrency: Math.min(3, filteredSites.length),
            artifactsRoot,
            headless: payload.headless !== false,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(summary));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) }));
        }
        return;
      }

      // ── Forecast — 30-day rank projection per tracked keyword + council synthesis ──
      // POST /api/forecast
      // Body: { domain: string, windowDays?: number, projectDays?: number,
      //         riskThreshold?: number, breakoutThreshold?: number, includeLlm?: boolean }
      if (req.method === "POST" && url.pathname === "/api/forecast") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { domain?: string; windowDays?: number; projectDays?: number; riskThreshold?: number; breakoutThreshold?: number; includeLlm?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const ck = buildCacheKey("/api/forecast", { domain, windowDays: payload.windowDays, projectDays: payload.projectDays });
          const { value: result, hit } = await cachedResponse(ck, 30 * 60_000, async () => {
            const { buildForecast } = await import("./modules/forecast.js");
            return await buildForecast({
              domain,
              windowDays: typeof payload.windowDays === "number" ? payload.windowDays : undefined,
              projectDays: typeof payload.projectDays === "number" ? payload.projectDays : undefined,
              riskThreshold: typeof payload.riskThreshold === "number" ? payload.riskThreshold : undefined,
              breakoutThreshold: typeof payload.breakoutThreshold === "number" ? payload.breakoutThreshold : undefined,
              includeLlm: payload.includeLlm !== false,
            });
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Narrative Diff Engine ────────────────────────────────────────────
      // POST /api/narrative-diff
      // Body: { runIdA: string, runIdB: string, includeLlm?: boolean }
      // Returns NarrativeDiffResult — structural diff + council narration.
      // 30-min cache (run reports are immutable once written).
      if (req.method === "POST" && url.pathname === "/api/narrative-diff") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { runIdA?: string; runIdB?: string; includeLlm?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const runIdA = typeof payload.runIdA === "string" ? payload.runIdA.trim() : "";
        const runIdB = typeof payload.runIdB === "string" ? payload.runIdB.trim() : "";
        if (!runIdA || !runIdB) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "runIdA + runIdB required" })); return; }
        try {
          const ck = buildCacheKey("/api/narrative-diff", { runIdA, runIdB, includeLlm: payload.includeLlm });
          const { value: result, hit } = await cachedResponse(ck, 30 * 60_000, async () => {
            const { buildNarrativeDiff } = await import("./modules/narrative-diff.js");
            return await buildNarrativeDiff({ runIdA, runIdB, outRoot, includeLlm: payload.includeLlm !== false });
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Voice-of-SERP Analyzer ───────────────────────────────────────────
      // POST /api/voice-of-serp
      // Body: { keyword: string, region?: string, topN?: number }
      // Returns VoiceOfSerpResult — SERP top-N pages + LLM-extracted "what's
      // winning" synthesis. 60-min cache (SERP doesn't change minute-to-minute).
      if (req.method === "POST" && url.pathname === "/api/voice-of-serp") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keyword?: string; region?: string; topN?: number };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        if (!keyword) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keyword required" })); return; }
        try {
          const ck = buildCacheKey("/api/voice-of-serp", { keyword, region: payload.region, topN: payload.topN });
          const { value: result, hit } = await cachedResponse(ck, 60 * 60_000, async () => {
            const { analyzeVoiceOfSerp } = await import("./modules/voice-of-serp.js");
            return await analyzeVoiceOfSerp({
              keyword,
              region: payload.region,
              topN: typeof payload.topN === "number" ? payload.topN : undefined,
            });
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Term Intel — universal cross-source lookup for any term ─────────
      // POST /api/term-intel
      // Body: { term: string, region?: string, domain?: string, includeLlm?: boolean }
      // Returns: { intel: TermIntelResult, context: CouncilContext, council: CouncilResult | null, elapsed: {gatherMs, llmMs} }
      if (req.method === "POST" && url.pathname === "/api/term-intel") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { term?: string; region?: string; domain?: string; includeLlm?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const term = typeof payload.term === "string" ? payload.term.trim() : "";
        const region = typeof payload.region === "string" && payload.region.trim() ? payload.region.trim() : "US";
        const domain = typeof payload.domain === "string" && payload.domain.trim() ? payload.domain.trim() : undefined;
        const includeLlm = payload.includeLlm !== false;
        if (!term) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "term required" })); return; }
        try {
          const gatherStart = Date.now();
          const cacheKey = buildCacheKey("/api/term-intel", { term, region, domain });
          const { value: intel, hit } = await cachedResponse(cacheKey, 10 * 60_000, async () => {
            const { gatherTermIntel } = await import("./modules/term-intel.js");
            return await gatherTermIntel({ term, region, domain });
          });
          const gatherMs = Date.now() - gatherStart;

          const { buildTermIntelCouncilContext } = await import("./modules/term-intel.js");
          const context = buildTermIntelCouncilContext(intel, domain);

          let council: unknown = null;
          let llmMs = 0;
          if (includeLlm && context.tierTop.length + context.tierMid.length + context.tierBottom.length > 0) {
            const llmStart = Date.now();
            try {
              const { runCouncil } = await import("./modules/council-runner.js");
              council = await runCouncil(context);
            } catch (e) {
              council = { error: e instanceof Error ? e.message : String(e) };
            }
            llmMs = Date.now() - llmStart;
          }

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify({ intel, context, council, elapsed: { gatherMs, llmMs } }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Alerts — rank/backlink change feed ────────────────────────────
      if (req.method === "GET" && url.pathname === "/api/alerts") {
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const alerts = await readRecentAlerts(Number.isFinite(limit) ? Math.min(Math.max(1, limit), 500) : 100);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ alerts }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/alerts/run") {
        let body: string;
        try { body = await readBody(req, 2_000); } catch { body = "{}"; }
        let payload: Record<string, unknown> = {};
        try { payload = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
        try {
          const result = await runAlertsCheck({
            rankDropThreshold: typeof payload.rankDropThreshold === "number" ? payload.rankDropThreshold : undefined,
            rankGainThreshold: typeof payload.rankGainThreshold === "number" ? payload.rankGainThreshold : undefined,
            backlinkDropThreshold: typeof payload.backlinkDropThreshold === "number" ? payload.backlinkDropThreshold : undefined,
            backlinkGainThreshold: typeof payload.backlinkGainThreshold === "number" ? payload.backlinkGainThreshold : undefined,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Schedules — cron-driven audits (CRUD) ─────────────────────────
      if (req.method === "GET" && url.pathname === "/api/schedules") {
        const list = await listSchedules();
        const withNext = list.map((s) => ({ ...s, nextRunPreview: nextRun(s.cron)?.toISOString() }));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ schedules: withNext }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/schedules") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        try {
          const sched = await createSchedule({
            name: String(payload.name ?? "").trim(),
            cron: String(payload.cron ?? "").trim(),
            sites: Array.isArray(payload.sites) ? (payload.sites as unknown[]).filter((s): s is string => typeof s === "string") : [],
            includePageSpeed: payload.includePageSpeed === true,
            includeFormTests: payload.includeFormTests === true,
            maxPages: typeof payload.maxPages === "number" ? payload.maxPages : undefined,
            emailTo: Array.isArray(payload.emailTo) ? (payload.emailTo as unknown[]).filter((e): e is string => typeof e === "string") : undefined,
            paused: payload.paused === true,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(sched));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }
      if (req.method === "PATCH" && url.pathname.startsWith("/api/schedules/")) {
        const id = url.pathname.slice("/api/schedules/".length);
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        try {
          const updated = await updateSchedule(id, payload as Parameters<typeof updateSchedule>[1]);
          if (!updated) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "not found" })); return; }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(updated));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/schedules/")) {
        const id = url.pathname.slice("/api/schedules/".length);
        const ok = await deleteSchedule(id);
        res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok }));
        return;
      }

      // ── Brand config (read-only view — write via /api/integrations/keys) ──
      if (req.method === "GET" && url.pathname === "/api/brand") {
        const { getBrandConfig } = await import("./modules/brand-config.js");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(getBrandConfig()));
        return;
      }

      // ── Bulk Keyword Analyzer — paste up to 1000 keywords, get SEMrush-style table ──
      // POST /api/bulk-keywords
      // Body: { keywords: string[], region?: string, provider?: "google-ads"|"dataforseo"|"auto" }
      if (req.method === "POST" && url.pathname === "/api/bulk-keywords") {
        let body: string;
        try { body = await readBody(req, 128_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keywords?: unknown; region?: string; provider?: "google-ads" | "dataforseo" | "auto" };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const kws = Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string") : [];
        if (kws.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keywords array required" })); return; }
        try {
          const { analyzeBulkKeywords } = await import("./modules/bulk-keywords.js");
          const ck = buildCacheKey("/api/bulk-keywords", { keywords: kws.slice(0, 1000).sort(), region: payload.region, provider: payload.provider });
          const { value: result, hit } = await cachedResponse(ck, 30 * 60_000, () => analyzeBulkKeywords({
            keywords: kws,
            region: payload.region,
            provider: payload.provider,
          }));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": hit ? "HIT" : "MISS" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── GSC auto-track — register every query ≥N impressions as a tracked pair ──
      // POST /api/gsc/auto-track
      // Body: { impressionsFloor?: number, maxNewPairs?: number, daysBack?: number, filterHosts?: string[] }
      // Returns: { scanned: [...], totalAdded, totalScanned, totalSkipped, reason? }
      if (req.method === "POST" && url.pathname === "/api/gsc/auto-track") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { impressionsFloor?: number; maxNewPairs?: number; daysBack?: number; filterHosts?: string[] };
        try { payload = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        try {
          const { autoTrackGscQueries } = await import("./modules/gsc-auto-track.js");
          const result = await autoTrackGscQueries({
            impressionsFloor: typeof payload.impressionsFloor === "number" ? payload.impressionsFloor : undefined,
            maxNewPairs: typeof payload.maxNewPairs === "number" ? payload.maxNewPairs : undefined,
            daysBack: typeof payload.daysBack === "number" ? payload.daysBack : undefined,
            filterHosts: Array.isArray(payload.filterHosts) ? payload.filterHosts.filter((h): h is string => typeof h === "string") : undefined,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Daily report (for n8n cron / direct email / manual preview) ─────
      // ── Council — cross-source consensus + LLM advisor panel ─────────────
      // POST /api/council
      // Body: { feature: "keywords" | "backlinks" | "serp" | "authority" | "vitals",
      //         domain: string,
      //         keywords?: string[] /* serp only */,
      //         competitors?: string[] /* authority only */,
      //         urls?: string[] /* vitals only */,
      //         includeLlm?: boolean }
      // Returns: { context: CouncilContext, council: CouncilResult | null,
      //            elapsed: { aggregateMs, llmMs } }
      if (req.method === "POST" && url.pathname === "/api/council") {
        let body: string;
        try { body = await readBody(req, 16_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { feature?: string; domain?: string; keywords?: string[]; competitors?: string[]; urls?: string[]; runId?: string; includeLlm?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const feature = typeof payload.feature === "string" ? payload.feature : "";
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        const includeLlm = payload.includeLlm !== false;
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        if (!["keywords", "backlinks", "serp", "authority", "vitals", "site-audit"].includes(feature)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "feature must be one of: keywords, backlinks, serp, authority, vitals, site-audit" }));
          return;
        }
        if (feature === "site-audit" && (typeof payload.runId !== "string" || !payload.runId.trim() || !isSafeRunIdSegment(payload.runId))) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "runId required for site-audit (pick from /api/history)" }));
          return;
        }
        try {
          const aggregateStart = Date.now();
          // Cache the consensus aggregate only. LLM council runs outside the
          // cache because its cost (10-45s Ollama) justifies a hit even on
          // warm consensus, and users re-running the council typically want
          // fresh advisor commentary.
          const cacheKey = buildCacheKey(`/api/council:${feature}`, { domain, keywords: payload.keywords, competitors: payload.competitors, urls: payload.urls, runId: payload.runId });
          const { value: context, hit: consensusCacheHit } = await cachedResponse(cacheKey, 5 * 60_000, async () => {
            if (feature === "keywords") {
              const { buildKeywordCouncilContext } = await import("./modules/keyword-consensus.js");
              return await buildKeywordCouncilContext(domain);
            } else if (feature === "backlinks") {
              const { buildBacklinksCouncilContext } = await import("./modules/backlinks-consensus.js");
              return await buildBacklinksCouncilContext(domain);
            } else if (feature === "serp") {
              const { buildSerpCouncilContext } = await import("./modules/serp-consensus.js");
              const keywords = Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string") : [];
              return await buildSerpCouncilContext({ domain, keywords });
            } else if (feature === "authority") {
              const { buildAuthorityCouncilContext } = await import("./modules/authority-consensus.js");
              const competitors = Array.isArray(payload.competitors) ? payload.competitors.filter((c): c is string => typeof c === "string") : [];
              return await buildAuthorityCouncilContext({ domain, competitors });
            } else if (feature === "site-audit") {
              const { buildSiteAuditCouncilContext } = await import("./modules/site-audit-consensus.js");
              return await buildSiteAuditCouncilContext({ runId: payload.runId!, domain, outRoot });
            } else {
              const { buildVitalsCouncilContext } = await import("./modules/vitals-consensus.js");
              const urls = Array.isArray(payload.urls) ? payload.urls.filter((u): u is string => typeof u === "string") : [];
              return await buildVitalsCouncilContext({ domain, urls });
            }
          });
          void consensusCacheHit;
          const aggregateMs = Date.now() - aggregateStart;

          let council: unknown = null;
          let llmMs = 0;
          if (includeLlm && (context.tierTop.length > 0 || context.tierMid.length > 0)) {
            const llmStart = Date.now();
            try {
              const { runCouncil } = await import("./modules/council-runner.js");
              council = await runCouncil(context);
            } catch (e) {
              council = { error: e instanceof Error ? e.message : String(e) };
            }
            llmMs = Date.now() - llmStart;
          }

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ context, council, elapsed: { aggregateMs, llmMs } }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // POST /api/daily-report
      // Body: { sites: string[], includePageSpeed?: boolean,
      //         includeFormTests?: boolean, formTestSiteIds?: string[],
      //         maxPages?: number, existingRunId?: string }
      //
      // Returns: { subject, html, text, summary, sites[], formTests[] } ready
      // to hand to n8n's Send Email node. Requires DAILY_REPORT_TOKEN via
      // Authorization: Bearer header when set in .env (so public deployments
      // can't trigger crawls). Without the env var, endpoint is open (handy
      // for local testing).
      if (req.method === "POST" && url.pathname === "/api/daily-report") {
        const expectedToken = process.env.DAILY_REPORT_TOKEN?.trim();
        if (expectedToken) {
          const auth = req.headers["authorization"];
          if (typeof auth !== "string" || !auth.startsWith("Bearer ") || auth.slice("Bearer ".length) !== expectedToken) {
            res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Unauthorized — pass `Authorization: Bearer <DAILY_REPORT_TOKEN>`" }));
            return;
          }
        }
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: {
          sites?: string[];
          includePageSpeed?: boolean;
          includeFormTests?: boolean;
          formTestSiteIds?: string[];
          maxPages?: number;
          existingRunId?: string;
        };
        try { payload = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

        try {
          // Step 1: get crawl reports — either reuse an existing run or fire a
          // fresh capped crawl. Fresh crawl respects the request's maxPages
          // and only enables PageSpeed when asked (both PSI strategies).
          let runId: string | undefined;
          let runStartedAt: string | undefined;
          let runFinishedAt: string | undefined;
          let reports: SiteHealthReport[] = [];

          if (typeof payload.existingRunId === "string" && isSafeRunIdSegment(payload.existingRunId)) {
            const raw = await loadRawReportsForRun(outRoot, payload.existingRunId);
            if (!raw) {
              res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: `Run not found: ${payload.existingRunId}` }));
              return;
            }
            runId = payload.existingRunId;
            reports = raw.reports;
          } else {
            const sites = Array.isArray(payload.sites) ? payload.sites.map((u) => String(u).trim()).filter(Boolean) : [];
            if (sites.length === 0) {
              res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: "Provide `sites` (non-empty array of URLs) or `existingRunId`." }));
              return;
            }
            const extra: Partial<HealthDashboardOrchestrateOptions> = { urls: sites };
            if (typeof payload.maxPages === "number" && payload.maxPages > 0) extra.maxPages = payload.maxPages;
            else extra.maxPages = 50;
            if (payload.includePageSpeed === true) {
              const ps = baseOrchestrate.pageSpeed;
              extra.pageSpeed = { enabled: true, strategies: ["mobile", "desktop"], maxUrls: ps?.maxUrls ?? 10, concurrency: ps?.concurrency ?? 3, timeoutMs: ps?.timeoutMs ?? 90_000 };
            }
            const before = new Date().toISOString();
            runStartedAt = before;
            const result = await runOrchestrate(extra);
            runFinishedAt = new Date().toISOString();
            runId = result?.runId;
            if (runId) {
              const raw = await loadRawReportsForRun(outRoot, runId);
              if (raw) reports = raw.reports;
            }
          }

          // Step 2: run form tests when requested — use config/sites.json,
          // optionally filtered to formTestSiteIds.
          const formTests: DailyReportFormTest[] = [];
          if (payload.includeFormTests !== false) {
            try {
              const configPath = path.join(process.cwd(), "config", "sites.json");
              const raw = await readFile(configPath, "utf8").catch(() => null);
              if (raw) {
                const parsed = sitesConfigSchema.safeParse(JSON.parse(raw));
                if (parsed.success) {
                  const ids = Array.isArray(payload.formTestSiteIds) ? payload.formTestSiteIds : undefined;
                  const filtered = parsed.data.sites.filter((s) =>
                    s.enabled && (ids ? ids.includes(s.id) : true),
                  );
                  if (filtered.length > 0) {
                    const artifactsRoot = path.join(process.cwd(), "artifacts", "form-tests");
                    const summary = await orchestrateRun({
                      config: { sites: filtered, defaultNotify: parsed.data.defaultNotify },
                      configPath,
                      concurrency: Math.min(3, filtered.length),
                      artifactsRoot,
                      headless: true,
                    });
                    for (const r of summary.results) {
                      formTests.push({
                        siteId: r.siteId,
                        siteName: r.siteName,
                        url: r.url,
                        status: r.status,
                        durationMs: r.durationMs,
                        errorMessage: r.errorMessage,
                      });
                    }
                  }
                }
              }
            } catch {
              // Form-tests failure shouldn't nuke the whole report; we'll
              // still ship broken-link + PageSpeed data.
            }
          }

          const report: DailyReport = composeDailyReport({
            reports,
            runId,
            runStartedAt,
            runFinishedAt,
            formTests,
          });

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(report));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      // ── Position History CRUD ──────────────────────────────────────────────
      // GET /api/history/keyword?domain=...&keyword=...
      if (req.method === "GET" && url.pathname === "/api/history/keyword") {
        const domain = url.searchParams.get("domain") ?? "";
        const keyword = url.searchParams.get("keyword") ?? "";
        if (!domain || !keyword) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain and keyword required" })); return; }
        try {
          const series = await getHistoryForKeyword(domain, keyword);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(series));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // GET /api/history/domain?domain=...
      if (req.method === "GET" && url.pathname === "/api/history/domain") {
        const domain = url.searchParams.get("domain") ?? "";
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const series = await getHistoryForDomain(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(series));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // GET /api/history/stats — all tracked pairs with latest snapshot
      if (req.method === "GET" && url.pathname === "/api/history/stats") {
        try {
          const stats = await getAllStats();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(stats));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // POST /api/tracked-pairs — add a (domain, keyword) to track
      if (req.method === "POST" && url.pathname === "/api/tracked-pairs") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { domain?: string; keyword?: string; remove?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const domain = typeof payload.domain === "string" ? payload.domain.trim() : "";
        const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        if (!domain || !keyword) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain and keyword required" })); return; }
        try {
          if (payload.remove) {
            await removeTrackedPair(domain, keyword);
          } else {
            await addTrackedPair(domain, keyword);
          }
          const pairs = await loadTrackedPairs();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, pairs }));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // GET /api/tracked-pairs — list all tracked pairs
      if (req.method === "GET" && url.pathname === "/api/tracked-pairs") {
        try {
          const pairs = await loadTrackedPairs();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(pairs));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // ── Position Tracker: schedule a sweep and record into history-db ──
      if (req.method === "POST" && url.pathname === "/api/position-track") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { pairs?: { domain?: string; keyword?: string; strictHost?: boolean }[]; delayMs?: number; strictHost?: boolean };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const batchStrict = payload.strictHost === true;
        const pairs = Array.isArray(payload.pairs)
          ? payload.pairs
              .filter((p): p is { domain: string; keyword: string; strictHost?: boolean } =>
                !!p && typeof p.domain === "string" && p.domain.trim().length > 0 &&
                typeof p.keyword === "string" && p.keyword.trim().length > 0)
              .map((p) => ({
                domain: p.domain,
                keyword: p.keyword,
                strictHost: typeof p.strictHost === "boolean" ? p.strictHost : batchStrict,
              }))
          : [];
        if (pairs.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "pairs required" })); return; }
        if (pairs.length > 50) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Max 50 pairs per sweep" })); return; }
        try {
          const { trackBatch } = await import("./position-scheduler.js");
          const delayMs = typeof payload.delayMs === "number" ? Math.max(500, Math.min(10_000, payload.delayMs)) : 1500;
          const results = await trackBatch(pairs, { delayMs });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ results, sampledAt: new Date().toISOString() }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }

      // ── History read endpoints ────────────────────────────────────
      if (req.method === "GET" && url.pathname === "/api/history/keyword") {
        const domain = (url.searchParams.get("domain") ?? "").trim();
        const keyword = (url.searchParams.get("keyword") ?? "").trim();
        if (!domain || !keyword) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain and keyword required" })); return; }
        try {
          const { getKeywordHistory } = await import("./history-db.js");
          const hist = await getKeywordHistory(domain, keyword);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(hist ?? { domain, keyword, series: [] }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/history/backlinks") {
        const domain = (url.searchParams.get("domain") ?? "").trim();
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const { getBacklinkHistory } = await import("./history-db.js");
          const hist = await getBacklinkHistory(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(hist ?? { domain, series: [] }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/history/traffic") {
        const domain = (url.searchParams.get("domain") ?? "").trim();
        if (!domain) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "domain required" })); return; }
        try {
          const { getTrafficHistory } = await import("./history-db.js");
          const hist = await getTrafficHistory(domain);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(hist ?? { domain, series: [] }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/history/stats") {
        try {
          const { getHistoryStats } = await import("./history-db.js");
          const stats = await getHistoryStats();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(stats));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        if (runInFlight) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("A run is already in progress.");
          return;
        }
        let body: string;
        try {
          body = await readBody(req, 256_000);
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request");
          return;
        }
        let payload: {
          urlsText?: string;
          urls?: string[];
          pageSpeedBoth?: boolean;
          viewportCheck?: boolean;
          aiSummary?: boolean;
          seoAudit?: boolean;
          smartAnalysis?: boolean;
          maxPages?: number;
        };
        try {
          payload = JSON.parse(body) as typeof payload;
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }
        let urls: string[];
        if (Array.isArray(payload.urls) && payload.urls.length > 0) {
          urls = payload.urls.map((u) => String(u).trim()).filter(Boolean);
        } else if (typeof payload.urlsText === "string") {
          urls = parseUrlsFromText(payload.urlsText);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Provide urlsText (string) or urls (non-empty array)");
          return;
        }
        if (urls.length === 0) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("No valid http(s) URLs found");
          return;
        }

        const runExtra: Partial<HealthDashboardOrchestrateOptions> = { urls };
        const ps = baseOrchestrate.pageSpeed;
        if (payload.pageSpeedBoth) {
          runExtra.pageSpeed = {
            enabled: true,
            strategies: ["mobile", "desktop"],
            maxUrls: ps?.maxUrls ?? 25,
            concurrency: ps?.concurrency ?? 3,
            timeoutMs: ps?.timeoutMs ?? 120_000,
          };
        }
        const vc = baseOrchestrate.viewportCheck;
        if (payload.viewportCheck) {
          runExtra.viewportCheck = {
            enabled: true,
            maxUrls: vc?.maxUrls ?? 15,
            timeoutMs: vc?.timeoutMs ?? 60_000,
            concurrency: vc?.concurrency ?? 2,
          };
        }
        if (payload.aiSummary) {
          runExtra.aiSummary = true;
        }
        // seoAudit: requires seo-audit module (available on main branch)
        if (payload.smartAnalysis) runExtra.smartAnalysis = true;
        if (typeof payload.maxPages === "number" && payload.maxPages > 0) {
          runExtra.maxPages = payload.maxPages;
        }

        runInFlight = true;
        const runMeterStart = Date.now();
        const runMeterClient = deriveClientKey(req);
        const runMeterUrls = urls.length;
        res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: true, urlCount: urls.length }));
        void runOrchestrate(runExtra)
          .then((r) => {
            lastResult = r;
            recordUsage({
              ts: new Date().toISOString(),
              clientKey: runMeterClient,
              endpoint: "/api/run",
              category: "site-audit",
              bytes: runMeterUrls, // piggy-back the url count — not bytes, but useful debug signal
              durationMs: Date.now() - runMeterStart,
              ok: true,
            });
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            broadcast({ type: "run_error", message });
            recordUsage({
              ts: new Date().toISOString(),
              clientKey: runMeterClient,
              endpoint: "/api/run",
              category: "site-audit",
              bytes: runMeterUrls,
              durationMs: Date.now() - runMeterStart,
              ok: false,
            });
          })
          .finally(() => {
            runInFlight = false;
          });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
        const raw = url.pathname.slice("/reports/".length);
        const decoded = decodeURIComponent(raw);
        const norm = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
        const segments = norm.split(/[/\\]/).filter(Boolean);
        if (segments.length === 0) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        const runId = segments[0];
        if (!isSafeRunIdSegment(runId)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad run id");
          return;
        }
        const relPath = segments.slice(1).join(path.sep) || "index.html";
        const runRoot = path.join(outRoot, runId);
        const filePath = path.join(runRoot, relPath);
        if (!isPathInsideRoot(outRoot, runRoot) || !isPathInsideRoot(runRoot, filePath)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          const st = await stat(filePath);
          if (!st.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
          }
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": mimeFor(filePath) });
        createReadStream(filePath).pipe(res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        for (const ev of buffer) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
        clients.add(res);
        req.on("close", () => {
          clients.delete(res);
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    })().catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(err));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => {
      server.off("error", onError);
      const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${options.port} is already in use (another qa-agent dashboard still running?).\n` +
              `  • Stop it: focus the other terminal and press Ctrl+C, or run: npm run dashboard:kill\n` +
              `  • Or use another port: QA_AGENT_PORT=3848 npm start   or   npm run health -- --serve --port 3848`,
          ),
        );
        return;
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    server.once("error", onError);
    // Prime the runtime-keys cache BEFORE we start accepting connections so
    // the very first request already sees any UI-saved keys.
    void primeRuntimeKeys().finally(() => {
      server.listen(options.port, "127.0.0.1", () => {
        server.off("error", onError);
        // Start the cron scheduler tick after listen so fires can self-POST.
        startScheduler(`http://127.0.0.1:${options.port}`);
        // Start the alerts background ticker (every 15 min).
        startAlertsTicker();
        resolve();
      });
    });
  });

  const baseUrl = `http://127.0.0.1:${options.port}/`;
  console.log(`[qa-agent] Live dashboard: ${baseUrl}`);

  // ── Auto-start Ollama if installed but not running ───────────────────────
  let ollamaChildPid: number | null = null; // track so we can stop on shutdown
  let ollamaWasAlreadyRunning = false;

  void (async () => {
    const ollamaUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
    try {
      const probe = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (probe.ok) {
        console.log("[qa-agent] Ollama already running at", ollamaUrl);
        ollamaWasAlreadyRunning = true;
        return;
      }
    } catch {
      // not running — try to start it
    }
    try {
      const child = spawn("ollama", ["serve"], {
        detached: false, // keep attached so we can kill on exit
        stdio: "ignore",
        windowsHide: true,
      });
      ollamaChildPid = child.pid ?? null;
      console.log("[qa-agent] Started Ollama (pid", ollamaChildPid, ") — waiting for ready…");
      // Poll up to 10 s
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(800) });
          if (r.ok) { console.log("[qa-agent] Ollama ready"); return; }
        } catch { /* still starting */ }
      }
      console.warn("[qa-agent] Ollama did not respond within 10s — AI features may be limited");
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        console.log("[qa-agent] Ollama not installed — AI features unavailable. Install at https://ollama.com");
      } else {
        console.warn("[qa-agent] Could not start Ollama:", e?.message ?? e);
      }
    }
  })();

  // ── Graceful shutdown: stop Ollama if we started it ─────────────────────
  function shutdownOllama() {
    if (ollamaChildPid && !ollamaWasAlreadyRunning) {
      console.log("[qa-agent] Stopping Ollama (pid", ollamaChildPid, ")…");
      try {
        process.kill(ollamaChildPid);
      } catch { /* already stopped */ }
      ollamaChildPid = null;
    }
  }
  process.on("exit", shutdownOllama);
  process.on("SIGINT", () => { shutdownOllama(); process.exit(0); });
  process.on("SIGTERM", () => { shutdownOllama(); process.exit(0); });

  // ── Daily GSC position cron ──────────────────────────────────────────────
  // Runs once at startup (after 30s delay) and then every 24 hours.
  // Fetches GSC position data for all tracked (domain, keyword) pairs and
  // stores snapshots in data/position-history/.
  async function runPositionCron(): Promise<void> {
    try {
      const pairs = await loadTrackedPairs();
      if (pairs.length === 0) return;
      const { getConnectionStatus } = await import("./providers/google-auth.js");
      const status = await getConnectionStatus();
      if (!status.connected) return;
      const { queryGscAnalytics, listGscSites } = await import("./providers/google-search-console.js");
      const sites = await listGscSites();
      const today = new Date().toISOString().slice(0, 10);
      for (const pair of pairs) {
        try {
          const cleanDomain = pair.domain.toLowerCase().replace(/^www\./, "");
          const matchedSite = sites.find(s => {
            const url = s.siteUrl;
            let host = url.startsWith("sc-domain:") ? url.slice("sc-domain:".length) : "";
            if (!host) { try { host = new URL(url).hostname; } catch { return false; } }
            host = host.toLowerCase().replace(/^www\./, "");
            return host === cleanDomain || cleanDomain.endsWith("." + host) || host.endsWith("." + cleanDomain);
          });
          if (!matchedSite) continue;
          const rows = await queryGscAnalytics({
            siteUrl: matchedSite.siteUrl,
            dimensions: ["query"],
            filter: { dimension: "query", operator: "equals", expression: pair.keyword },
            rowLimit: 1,
          });
          const row = rows?.[0];
          const pos = row ? row.position.value : null;
          await appendSnapshot(pair.domain, pair.keyword, {
            at: today,
            position: pos !== null ? Math.round(pos * 10) / 10 : null,
            clicks: row?.clicks.value ?? 0,
            impressions: row?.impressions.value ?? 0,
            ctr: row?.ctr?.value ?? 0,
          });
        } catch {
          // Individual pair failures don't abort the cron
        }
      }
      console.log(`[qa-agent] Position cron: updated ${pairs.length} tracked keywords`);
    } catch (err) {
      console.error("[qa-agent] Position cron error:", err);
    }
  }
  // Run 30s after startup so GSC auth is ready, then every 24h
  setTimeout(() => { void runPositionCron(); }, 30_000);
  setInterval(() => { void runPositionCron(); }, 24 * 60 * 60 * 1000);
  if (options.openBrowser) {
    setTimeout(() => openBrowser(baseUrl), 400);
  }

  const hasInitialFile = Boolean(baseOrchestrate.urlsFile);
  if (hasInitialFile) {
    runInFlight = true;
    try {
      const result = await runOrchestrate({});
      lastResult = result;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcast({ type: "run_error", message });
      throw err;
    } finally {
      runInFlight = false;
    }
  }

  if (!lastResult) {
    return { runId: "", runDir: "", siteFailures: 0 };
  }
  return lastResult;
}
