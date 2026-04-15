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
  buildGeminiPayloadFromReports,
  generateGeminiRunAnswer,
} from "./gemini-report.js";
import { orchestrateHealthCheck } from "./orchestrate-health.js";
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
      metas.push(JSON.parse(raw) as HealthRunMeta);
    } catch {
      const legacy = await loadLegacyRunMeta(runDir, ent.name);
      if (legacy) metas.push(legacy);
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

async function loadGeminiPayloadForRun(outRoot: string, runId: string) {
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
  return buildGeminiPayloadFromReports(data.sites, runId, generatedAt, {
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

      if (
        req.method === "GET" &&
        (url.pathname === "/api/ai-summary" || url.pathname === "/api/gemini-summary")
      ) {
        const runId = url.searchParams.get("runId");
        if (!runId || !isSafeRunIdSegment(runId)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad runId");
          return;
        }
        const p = path.join(outRoot, runId, "gemini-summary.md");
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

      if (
        req.method === "POST" &&
        (url.pathname === "/api/ai-run-chat" || url.pathname === "/api/gemini-run-chat")
      ) {
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
        const qaPayload = await loadGeminiPayloadForRun(outRoot, runIdParam);
        if (!qaPayload) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Run data not found (missing MASTER JSON)" }));
          return;
        }
        try {
          const answer = await generateGeminiRunAnswer(qaPayload, question);
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
          const pdf = await renderHtmlFileToPdf(absHtml, { runRoot });
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

      // Keyword Magic (Gemini-powered, seed keyword only)
      if (req.method === "POST" && url.pathname === "/api/keyword-magic") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { seedKeyword?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const seed = typeof payload.seedKeyword === "string" ? payload.seedKeyword.trim() : "";
        if (!seed) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "seedKeyword required" })); return; }
        try {
          const result = await generateMagicKeywords(seed);
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

      // SEO Content Template (Gemini-powered, keyword only)
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

      // Topic Research (Gemini-powered, optional runId)
      if (req.method === "POST" && url.pathname === "/api/topic-research") {
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { topic?: string; runId?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
        if (!topic) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "topic required" })); return; }
        try {
          let reports: SiteHealthReport[] | undefined;
          const runIdP = typeof payload.runId === "string" ? payload.runId : "";
          if (runIdP && isSafeRunIdSegment(runIdP)) {
            const raw = await loadRawReportsForRun(outRoot, runIdP);
            if (raw) reports = raw.reports;
          }
          const result = await researchTopic(topic, reports);
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

      // Local SEO (Gemini-powered, optional runId)
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
        let payload: { keywords?: string[] };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const keywords = Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string") : [];
        if (keywords.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keywords required" })); return; }
        try {
          const result = await analyzeKeywordList(keywords);
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
        let payload: { keywords?: string[]; targetDomain?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const keywords = Array.isArray(payload.keywords) ? payload.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0) : [];
        if (keywords.length === 0) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keywords required" })); return; }
        try {
          const result = await runSerpAnalysis(keywords, typeof payload.targetDomain === "string" ? payload.targetDomain.trim() : undefined);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // Single SERP search
      if (req.method === "POST" && url.pathname === "/api/serp-search") {
        let body: string;
        try { body = await readBody(req, 8_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { query?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const query = typeof payload.query === "string" ? payload.query.trim() : "";
        if (!query) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "query required" })); return; }
        try {
          const result = await searchSerp(query);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: String(e) })); }
        return;
      }

      // LLM Router stats
      if (req.method === "GET" && url.pathname === "/api/llm-stats") {
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
        let body: string;
        try { body = await readBody(req, 32_000); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Bad request" })); return; }
        let payload: { keyword?: string };
        try { payload = JSON.parse(body); } catch { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
        const kw = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
        if (!kw) { res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "keyword required" })); return; }
        try {
          const { researchKeyword } = await import("./modules/keyword-research.js");
          const result = await researchKeyword(kw);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }

      // ── External Backlinks (free provider mix: OPR + Common Crawl + URLScan + Wayback) ──
      if (req.method === "POST" && url.pathname === "/api/external-backlinks") {
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
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: msg }));
        }
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
          /** Preferred name for the AI summary toggle. */
          aiSummary?: boolean;
          /** @deprecated Legacy alias for `aiSummary`. */
          gemini?: boolean;
          seoAudit?: boolean;
          useFirecrawl?: boolean;
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
        if (payload.aiSummary || payload.gemini) {
          runExtra.gemini = true;
        }
        // seoAudit: requires seo-audit module (available on main branch)
        if (payload.useFirecrawl) runExtra.useFirecrawl = true;
        if (payload.smartAnalysis) runExtra.smartAnalysis = true;
        if (typeof payload.maxPages === "number" && payload.maxPages > 0) {
          runExtra.maxPages = payload.maxPages;
        }

        runInFlight = true;
        res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: true, urlCount: urls.length }));
        void runOrchestrate(runExtra)
          .then((r) => {
            lastResult = r;
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            broadcast({ type: "run_error", message });
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
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${options.port}/`;
  console.log(`[qa-agent] Live dashboard: ${baseUrl}`);
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
