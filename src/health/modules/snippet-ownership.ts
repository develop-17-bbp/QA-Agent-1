/**
 * Featured Snippet Ownership — for a list of tracked keywords, queries
 * Google SERP and reports which featured-snippet ("position zero")
 * boxes the operator's domain owns vs which a competitor owns.
 *
 * Position zero is worth ~3x the click-through of position 1 — owning
 * one is enormously valuable. SEMrush charges separately for snippet
 * tracking.
 *
 * Free path (default): Playwright headless scrape of google.com/search
 * — captures the featured-snippet box + organic top-30. No API key
 * needed; Playwright is already a project dep.
 *
 * Paid upgrade (opt-in via `useDfs: true`): DataForSEO live SERP API
 * — faster, more reliable at scale, supports city-level location
 * targeting. BYOK.
 */

import { fetchDfsLiveSerp, isDfsConfigured } from "../providers/dataforseo.js";

export interface SnippetRow {
  keyword: string;
  /** Featured snippet present at all? */
  hasSnippet: boolean;
  /** Domain that owns the snippet (null when no snippet). */
  ownerDomain: string | null;
  /** True when ownerDomain matches operator's domain. */
  operatorOwns: boolean;
  /** Operator's organic position when not owning the snippet. 0 = not in top 30. */
  operatorPosition: number;
  /** Snippet preview text (truncated). */
  preview: string | null;
  /** Snippet URL. */
  ownerUrl: string | null;
}

export interface SnippetOwnershipResult {
  operatorDomain: string;
  region: string;
  device: "desktop" | "mobile";
  rows: SnippetRow[];
  summary: {
    totalKeywords: number;
    snippetsAvailable: number;
    operatorOwned: number;
    competitorOwned: number;
    /** Count of snippets currently owned by competitors where operator ranks in top 5 — high-leverage steal targets. */
    stealOpportunities: number;
  };
  generatedAt: string;
}

export interface SnippetOwnershipInput {
  operatorDomain: string;
  keywords: string[];
  region?: string;
  device?: "desktop" | "mobile";
  /** When true AND DataForSEO is configured, use the paid live-SERP API
   *  (faster, more accurate). Default false — uses free Playwright
   *  scrape of google.com/search. */
  useDfs?: boolean;
}

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

interface SerpProbeResult {
  hasSnippet: boolean;
  ownerDomain: string | null;
  ownerUrl: string | null;
  preview: string | null;
  /** Operator's organic position (0 = not in top 30). */
  operatorPosition: number;
}

/** Free path: Playwright scrape of google.com/search. Captures the
 *  featured-snippet box (when shown) + the operator's organic position
 *  in the top-30 list. */
async function probeViaGoogleScrape(query: string, operator: string, region: string, device: "desktop" | "mobile"): Promise<SerpProbeResult> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      viewport: device === "mobile" ? { width: 412, height: 915 } : { width: 1280, height: 900 },
      userAgent: device === "mobile"
        ? "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    // Region hint via gl param. region accepts ISO country names; map "United States" → "us" loosely.
    const gl = region.toLowerCase().includes("united states") || region.toLowerCase() === "us" ? "us"
      : region.length === 2 ? region.toLowerCase() : "";
    const glParam = gl ? `&gl=${encodeURIComponent(gl)}` : "";
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en${glParam}`, { waitUntil: "domcontentloaded", timeout: 25_000 });

    // Extract featured snippet + organic results in one DOM read.
    const result = await page.evaluate(`(() => {
      const out = { hasSnippet: false, ownerDomain: null, ownerUrl: null, preview: null, organic: [] };
      // Featured snippet — Google rotates classes; try several common patterns.
      const fsEl = document.querySelector(
        'div[data-attrid="wa:/description"], div.kp-blk:not([data-hveid="CAQ"]) div.IZ6rdc, ' +
        'div[data-snhf="0"] div.hgKElc, div.xpdopen[data-hveid] div.LGOjhe'
      );
      if (fsEl) {
        const text = (fsEl).innerText || "";
        const a = (fsEl).querySelector('a[href*="://"]') || (fsEl).closest('div').querySelector('cite');
        let url = null;
        if (a && a.href) url = a.href;
        else {
          // Fallback: look for the citation link in the parent block.
          const parent = (fsEl).closest('div[data-hveid]');
          const link = parent ? parent.querySelector('a[href*="://"]') : null;
          if (link) url = (link).href;
        }
        if (url && /^https?:\\/\\//.test(url)) {
          let host = '';
          try { host = new URL(url).hostname.replace(/^www\\./, ''); } catch (e) {}
          out.hasSnippet = true;
          out.ownerDomain = host || null;
          out.ownerUrl = url;
          out.preview = text.slice(0, 240);
        }
      }
      // Organic results: the standard #search div with .g containers.
      const organicLinks = Array.from(document.querySelectorAll('div.g a[href^="https://"], div.MjjYud a[href^="https://"]'));
      let position = 0;
      const seenHosts = new Set();
      for (const el of organicLinks) {
        const href = (el).href;
        if (!href || /\\/url\\?/.test(href) || /accounts\\.google\\.com|google\\.com\\/search|webcache\\./.test(href)) continue;
        let host = '';
        try { host = new URL(href).hostname.replace(/^www\\./, ''); } catch (e) { continue; }
        if (seenHosts.has(host)) continue;
        seenHosts.add(host);
        position++;
        out.organic.push({ position, url: href, domain: host });
        if (position >= 30) break;
      }
      return out;
    })()`) as { hasSnippet: boolean; ownerDomain: string | null; ownerUrl: string | null; preview: string | null; organic: { position: number; url: string; domain: string }[] };

    await context.close();
    const operatorOrganic = result.organic.find((o) => o.domain === operator || o.domain.endsWith("." + operator));
    return {
      hasSnippet: result.hasSnippet,
      ownerDomain: result.ownerDomain,
      ownerUrl: result.ownerUrl,
      preview: result.preview,
      operatorPosition: operatorOrganic?.position ?? 0,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Paid path: DataForSEO live SERP. */
async function probeViaDfs(query: string, operator: string, region: string, device: "desktop" | "mobile"): Promise<SerpProbeResult> {
  const serp = await fetchDfsLiveSerp(query, { locationName: region, device, depth: 30 });
  const featured = serp.items.find((it) => it.isFeaturedSnippet || it.itemType === "featured_snippet");
  const operatorOrganic = serp.items.find((it) => {
    try { return normalizeDomain(it.domain) === operator; } catch { return false; }
  });
  const ownerDomain = featured ? normalizeDomain(featured.domain) : null;
  return {
    hasSnippet: !!featured,
    ownerDomain,
    ownerUrl: featured?.url ?? null,
    preview: featured?.description?.slice(0, 240) ?? null,
    operatorPosition: operatorOrganic?.rank ?? 0,
  };
}

export async function trackSnippetOwnership(input: SnippetOwnershipInput): Promise<SnippetOwnershipResult> {
  const operator = normalizeDomain(input.operatorDomain);
  const keywords = input.keywords.filter((k) => typeof k === "string" && k.trim()).slice(0, 50);
  if (keywords.length === 0) throw new Error("at least one keyword required");
  const region = input.region ?? "United States";
  const device = input.device ?? "desktop";
  const useDfs = input.useDfs === true && isDfsConfigured();

  const rows: SnippetRow[] = [];
  // Bounded concurrency — 4 for DFS (rate limit), 2 for Playwright (browser footprint).
  const concurrency = useDfs ? 4 : 2;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, keywords.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= keywords.length) return;
        const kw = keywords[i]!;
        try {
          const probe = useDfs
            ? await probeViaDfs(kw, operator, region, device)
            : await probeViaGoogleScrape(kw, operator, region, device);
          rows.push({
            keyword: kw,
            hasSnippet: probe.hasSnippet,
            ownerDomain: probe.ownerDomain,
            operatorOwns: !!probe.ownerDomain && probe.ownerDomain === operator,
            operatorPosition: probe.operatorPosition,
            preview: probe.preview,
            ownerUrl: probe.ownerUrl,
          });
        } catch {
          rows.push({ keyword: kw, hasSnippet: false, ownerDomain: null, operatorOwns: false, operatorPosition: 0, preview: null, ownerUrl: null });
        }
      }
    }),
  );
  rows.sort((a, b) => a.keyword.localeCompare(b.keyword));

  const operatorOwned = rows.filter((r) => r.operatorOwns).length;
  const snippetsAvailable = rows.filter((r) => r.hasSnippet).length;
  const competitorOwned = snippetsAvailable - operatorOwned;
  const stealOpportunities = rows.filter((r) => r.hasSnippet && !r.operatorOwns && r.operatorPosition > 0 && r.operatorPosition <= 5).length;

  return {
    operatorDomain: operator,
    region,
    device,
    rows,
    summary: {
      totalKeywords: rows.length,
      snippetsAvailable,
      operatorOwned,
      competitorOwned,
      stealOpportunities,
    },
    generatedAt: new Date().toISOString(),
  };
}
