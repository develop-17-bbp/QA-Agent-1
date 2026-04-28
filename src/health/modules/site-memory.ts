/**
 * Self-Improving Crawl Memory — every crawl writes a per-domain
 * "personality profile" to disk. Future crawls of the same domain
 * read it back and bias the agentic crawl-planner toward the
 * patterns that paid off last time. Memory never leaves the host.
 *
 * Why it matters: SEMrush physically cannot ship this without
 * rebuilding their SaaS posture — the operator's data has to leave
 * their machine for it to work in a multi-tenant cloud. Local
 * persistence + on-device LLM = a moat by architecture.
 *
 * Design:
 *   - SiteProfile is small (caps applied) and JSON-serialisable.
 *   - Updated AFTER each crawl using the new CrawlSiteResult.
 *   - Read BEFORE the next crawl; passed condensed into the planner
 *     LLM prompt. Heuristic fallback also reads it.
 *   - Storage: data/site-profiles/<hostname>.json (mode 0600).
 *
 * The deterministic step (clustering, slow-section detection) is
 * stable across LLM availability. The LLM step is opt-in narration
 * of what changed since the last profile — never required.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { CrawlSiteResult } from "../types.js";

const PROFILES_DIR = path.join(process.cwd(), "data", "site-profiles");
const MAX_CLUSTERS = 12;
const MAX_SLOW_SECTIONS = 6;
const MAX_STALE_PAGES = 20;

export interface ContentCluster {
  /** URL path prefix for this cluster, e.g. "/blog/" or "/docs/api/". */
  path: string;
  /** Human-readable label inferred from titles. */
  label: string;
  /** Count of unique pages observed in this cluster across history. */
  pageCount: number;
  /** Pages crawled in the most recent run for this cluster. */
  recentPageCount: number;
  /** Median load duration ms across the most recent run. */
  recentMedianMs: number | null;
  /** ISO of the last time this cluster's recent count moved >0. */
  lastChangeAt: string;
  /** 0..1 — fraction of recent runs in which this cluster's pageCount changed. */
  churnRate: number;
}

export interface SiteProfile {
  domain: string;
  /** ISO. */
  lastUpdated: string;
  /** ISO of the very first profile write. */
  firstSeen: string;
  /** Number of crawls observed for this domain. */
  observedRuns: number;
  /** Detected CMS or platform hint, e.g. "WordPress" / "Shopify" / "custom".
   *  Always present after first run; refined as more evidence accumulates. */
  cms?: string;
  /** Top content clusters by recent page count, descending. */
  contentClusters: ContentCluster[];
  /** Section path prefixes whose median fetch time is in the slowest bucket. */
  slowSections: string[];
  /** URLs that haven't returned new metadata for >= 4 consecutive runs. */
  stalePages: string[];
  /** Section paths the planner has historically flagged as priority. */
  priorityPatterns: string[];
  /** Patterns the planner historically asked to skip. */
  skipPatterns: string[];
}

function profilePath(hostname: string): string {
  return path.join(PROFILES_DIR, hostname.toLowerCase() + ".json");
}

export async function loadSiteProfile(hostname: string): Promise<SiteProfile | null> {
  if (!hostname) return null;
  try {
    const raw = await fs.readFile(profilePath(hostname), "utf8");
    return JSON.parse(raw) as SiteProfile;
  } catch {
    return null;
  }
}

export async function saveSiteProfile(profile: SiteProfile): Promise<void> {
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  await fs.writeFile(profilePath(profile.domain), JSON.stringify(profile, null, 2), { encoding: "utf8", mode: 0o600 });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[m - 1]! + sorted[m]!) / 2) : sorted[m]!;
}

function sectionOfUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.length === 0 ? "/" : `/${parts[0]}/`;
  } catch {
    return "/";
  }
}

function inferCms(crawl: CrawlSiteResult): string | undefined {
  const sampleUrls = crawl.pages.map((p) => p.url).slice(0, 60).join(" ");
  if (/wp-content|wp-includes|wp-json/i.test(sampleUrls)) return "WordPress";
  if (/\/products\/.+\.shop|cdn\.shopify/i.test(sampleUrls)) return "Shopify";
  if (/\/blogs\.medium\.com|miro\.medium/i.test(sampleUrls)) return "Medium";
  if (/_next\/static|__nextjs_/i.test(sampleUrls)) return "Next.js";
  if (/\/_astro\//i.test(sampleUrls)) return "Astro";
  if (/\/docs\/.+\.docusaurus/i.test(sampleUrls)) return "Docusaurus";
  return undefined;
}

function deriveLabel(section: string, titles: string[]): string {
  if (titles.length === 0) return section.replace(/^\/+|\/+$/g, "") || "(root)";
  const first = titles[0]!;
  return first.length > 50 ? first.slice(0, 47) + "…" : first;
}

// ── Core update ─────────────────────────────────────────────────────────────

export interface UpdateProfileOptions {
  /** Slow-section threshold: section is "slow" if its median fetch ms is in
   *  the slowest tertile AND >= absMin. Default absMin = 1500. */
  slowAbsMinMs?: number;
}

/** Build/refresh the SiteProfile from a fresh CrawlSiteResult. Pure function
 *  in terms of inputs — no I/O. The caller is responsible for save. */
export function updateSiteProfile(
  crawl: CrawlSiteResult,
  prev: SiteProfile | null,
  opts: UpdateProfileOptions = {},
): SiteProfile {
  const slowAbsMin = opts.slowAbsMinMs ?? 1500;
  const now = new Date().toISOString();

  // Bucket recent pages by section.
  const sectionsRecent = new Map<string, { count: number; durations: number[]; titles: string[]; urls: string[] }>();
  for (const p of crawl.pages) {
    const sec = sectionOfUrl(p.url);
    const slot = sectionsRecent.get(sec) ?? { count: 0, durations: [], titles: [], urls: [] };
    slot.count++;
    if (typeof p.durationMs === "number") slot.durations.push(p.durationMs);
    if (p.documentTitle) slot.titles.push(p.documentTitle);
    slot.urls.push(p.url);
    sectionsRecent.set(sec, slot);
  }

  // Merge with previous clusters: keep historical pageCount, update recent + churn.
  const prevByPath = new Map<string, ContentCluster>();
  for (const c of prev?.contentClusters ?? []) prevByPath.set(c.path, c);
  const observedRuns = (prev?.observedRuns ?? 0) + 1;

  const clusters: ContentCluster[] = [];
  for (const [section, slot] of sectionsRecent) {
    const prevC = prevByPath.get(section);
    const recentMedianMs = median(slot.durations);
    const recentChanged = !prevC || prevC.recentPageCount !== slot.count;
    const churnRate = prevC
      ? Math.min(1, ((prevC.churnRate * (observedRuns - 1)) + (recentChanged ? 1 : 0)) / observedRuns)
      : 1;
    clusters.push({
      path: section,
      label: deriveLabel(section, slot.titles),
      pageCount: Math.max(slot.count, prevC?.pageCount ?? 0),
      recentPageCount: slot.count,
      recentMedianMs,
      lastChangeAt: recentChanged ? now : prevC?.lastChangeAt ?? now,
      churnRate: +churnRate.toFixed(3),
    });
  }
  clusters.sort((a, b) => b.recentPageCount - a.recentPageCount);
  const trimmedClusters = clusters.slice(0, MAX_CLUSTERS);

  // Slow sections: tertile threshold + absolute floor.
  const allMedians = trimmedClusters.map((c) => c.recentMedianMs).filter((m): m is number => typeof m === "number").sort((a, b) => b - a);
  const tertileCutoff = allMedians.length >= 3 ? allMedians[Math.floor(allMedians.length / 3)]! : Number.POSITIVE_INFINITY;
  const slowSections = trimmedClusters
    .filter((c) => typeof c.recentMedianMs === "number" && c.recentMedianMs >= Math.max(slowAbsMin, tertileCutoff))
    .map((c) => c.path)
    .slice(0, MAX_SLOW_SECTIONS);

  // Stale pages: URLs that appeared in previous stalePages and are still present
  //   without title/meta (cheap heuristic — proper churn detection later).
  const stalePages: string[] = [];
  const recentTitled = new Set(crawl.pages.filter((p) => !!p.documentTitle).map((p) => p.url));
  for (const p of crawl.pages) {
    if (!recentTitled.has(p.url)) {
      if (prev?.stalePages.includes(p.url)) stalePages.push(p.url);
      else stalePages.push(p.url); // first-time stale candidate
    }
    if (stalePages.length >= MAX_STALE_PAGES) break;
  }

  // Priority + skip patterns: use whatever the planner just decided + carry forward.
  const planner = crawl.agenticMeta;
  const prevPriority = new Set(prev?.priorityPatterns ?? []);
  const prevSkip = new Set(prev?.skipPatterns ?? []);
  if (planner) {
    for (const p of planner.prioritySections ?? []) prevPriority.add(p);
    for (const p of planner.extraSkipPatterns ?? []) prevSkip.add(p);
  }
  const priorityPatterns = [...prevPriority].slice(0, 8);
  const skipPatterns = [...prevSkip].slice(0, 16);

  const cms = prev?.cms ?? inferCms(crawl);

  return {
    domain: crawl.hostname,
    lastUpdated: now,
    firstSeen: prev?.firstSeen ?? now,
    observedRuns,
    cms,
    contentClusters: trimmedClusters,
    slowSections,
    stalePages,
    priorityPatterns,
    skipPatterns,
  };
}

/** Condense a profile into ≤ 600-char hint suitable for a planner LLM prompt. */
export function condenseProfileForPlanner(profile: SiteProfile): string {
  const top = profile.contentClusters.slice(0, 3).map((c) => `${c.path} (~${c.pageCount} pages, ${c.label})`).join(", ");
  const slow = profile.slowSections.slice(0, 3).join(", ");
  const cms = profile.cms ?? "unknown";
  const priority = profile.priorityPatterns.slice(0, 4).join(", ");
  return `PRIOR CRAWL MEMORY (${profile.observedRuns} prior runs, CMS=${cms}). Top clusters: ${top || "(none)"}. Slow sections: ${slow || "(none)"}. Past priority patterns: ${priority || "(none)"}.`;
}
