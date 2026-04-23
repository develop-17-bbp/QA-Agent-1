export interface BrokenLinkRecord {
  /**
   * Page where the bad link was found. When the crawler parses a page's HTML
   * and finds an `<a href>` that resolves to a broken target, this is that
   * page's URL. Special placeholder values still exist for older records:
   *   "(crawl)" — the page itself failed to load (no origin exists)
   *   "(listed URL)" — URL came from the user's input list, not discovered
   *   "(discovered, not crawled)" — legacy fallback when origin map was empty
   */
  foundOn: string;
  /** Resolved target URL */
  target: string;
  status?: number;
  error?: string;
  /** Wall-clock time for the HTTP request that detected the issue (ms). */
  durationMs?: number;
  /** Visible text of the `<a>` tag that referenced the broken target (when available). */
  anchorText?: string;
  /** Short plain-text context: ~60 chars of text around the `<a>` tag for SEO-team review. */
  linkContext?: string;
  /** The `<a>` tag's outer HTML as it appears on the origin page (capped at 400 chars). */
  outerHtml?: string;
}

/**
 * When both mobile and desktop PageSpeed runs are enabled, stored per page.
 * Legacy reports use a single `PageSpeedInsightRecord` on `insights` instead.
 */
export interface PageSpeedInsightsBundle {
  mobile?: PageSpeedInsightRecord;
  desktop?: PageSpeedInsightRecord;
}

/** Lighthouse lab scores/metrics from Google PageSpeed Insights API (optional per page). */
export interface PageSpeedInsightRecord {
  url: string;
  strategy: "mobile" | "desktop";
  /** Time for the PageSpeed API request (ms). */
  durationMs: number;
  scores?: {
    performance?: number;
    accessibility?: number;
    bestPractices?: number;
    seo?: number;
  };
  metrics?: {
    fcpMs?: number;
    lcpMs?: number;
    tbtMs?: number;
    cls?: number;
    speedIndexMs?: number;
    ttiMs?: number;
  };
  display?: {
    fcp?: string;
    lcp?: string;
    tbt?: string;
    cls?: string;
    speedIndex?: string;
    tti?: string;
  };
  /** Top Lighthouse “opportunities” (savings / issues), when present in API response. */
  opportunities?: { title: string; displayValue?: string }[];
  error?: string;
}

export interface PageFetchRecord {
  url: string;
  status: number;
  ok: boolean;
  /** Wall-clock time for this page fetch (headers + body read) (ms). */
  durationMs: number;
  error?: string;
  /** Primary MIME type from Content-Type (no charset), when the response was received. */
  contentType?: string;
  /** UTF-8 byte length of the HTML body when read (for sizing transfer). */
  bodyBytes?: number;
  /** True when the browser stack followed redirects to reach the final URL. */
  redirected?: boolean;
  /** Final URL after redirects (may differ from `url`). */
  finalUrl?: string;
  /** Parsed from HTML `<title>` when a body was read (truncated in crawl). */
  documentTitle?: string;
  /** Character length of meta description (name=description or og:description); set when HTML was parsed. */
  metaDescriptionLength?: number;
  /** Count of `<h1>` elements when HTML was parsed. */
  h1Count?: number;
  /** `<html lang>` when present. */
  documentLang?: string;
  /** Absolute URL from `<link rel="canonical">` when present and resolvable. */
  canonicalUrl?: string;
  /** Populated when health run uses --pagespeed and this URL was analyzed. */
  insights?: PageSpeedInsightRecord | PageSpeedInsightsBundle;
  /** Raw HTML body, retained only when crawlSite() was called with
   *  `retainBodies: true` (set by orchestrator when post-crawl enrichment is
   *  on). Dropped from the persisted report after enrichers finish to keep
   *  artifact size bounded. Never appears in durable JSON on disk. */
  retainedBody?: string;
}

/** Playwright-based load check for mobile vs desktop viewports (optional per run). */
export interface ViewportCheckRecord {
  url: string;
  mobile: {
    width: number;
    height: number;
    loadMs: number;
    ok: boolean;
    httpStatus?: number;
    consoleErrorCount: number;
    error?: string;
  };
  desktop: {
    width: number;
    height: number;
    loadMs: number;
    ok: boolean;
    httpStatus?: number;
    consoleErrorCount: number;
    error?: string;
  };
}

/** HEAD/GET verification for same-origin URLs discovered but not fetched as HTML in BFS. */
export interface LinkCheckRecord {
  target: string;
  status: number;
  ok: boolean;
  durationMs: number;
  method: "HEAD" | "GET_RANGE";
}

export interface CrawlSiteResult {
  startUrl: string;
  siteId: string;
  hostname: string;
  pagesVisited: number;
  uniqueUrlsChecked: number;
  pages: PageFetchRecord[];
  brokenLinks: BrokenLinkRecord[];
  /** Discovered internal URLs checked with HEAD/GET (not crawled as full pages). Omitted in older report.json files. */
  linkChecks?: LinkCheckRecord[];
  /** Set when PageSpeed Insights was run for this crawl. */
  pageSpeedInsightsMeta?: {
    strategies: ("mobile" | "desktop")[];
    /** @deprecated Old reports used a single strategy string. */
    strategy?: "mobile" | "desktop";
    totalDurationMs: number;
    urlsAnalyzed: number;
  };
  /** Optional Chromium checks: same URLs, mobile vs desktop viewports. */
  viewportChecks?: ViewportCheckRecord[];
  viewportMeta?: {
    totalDurationMs: number;
    urlsChecked: number;
  };
  /** PNGs of the start URL (PC, tablet, phone) taken with headless Chromium. */
  startPageScreenshot?: StartPageScreenshotMeta;
  durationMs: number;
}

/** One viewport capture for the crawl start URL. */
export interface StartPageScreenshotVariant {
  label: "PC" | "Tablet" | "Phone";
  /** Relative to the site folder, e.g. `start-page-pc.png`. Omitted if capture failed. */
  fileName?: string;
  viewportWidth: number;
  viewportHeight: number;
  /** When true, captured full scrollable height (typically PC only). */
  fullPage: boolean;
  durationMs: number;
  error?: string;
}

/** Current reports: three viewports (PC, tablet, phone). */
export interface StartPageScreenshotBundle {
  totalDurationMs: number;
  variants: StartPageScreenshotVariant[];
}

/**
 * Legacy single PNG (`start-page.png`) from older QA-Agent runs.
 * New runs use {@link StartPageScreenshotBundle}.
 */
export interface StartPageScreenshotLegacy {
  fileName?: string;
  durationMs: number;
  viewportWidth: number;
  viewportHeight: number;
  fullPage: boolean;
  error?: string;
}

export type StartPageScreenshotMeta = StartPageScreenshotBundle | StartPageScreenshotLegacy;

export interface SiteHealthReport {
  siteId: string;
  hostname: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  crawl: CrawlSiteResult;
  /** Post-crawl enrichment findings (Googlebot-grade audits that run after
   *  BFS completes). Every field is optional so older reports and cheaper
   *  runs stay valid. See src/health/crawl-enrichers/*.ts for producers. */
  enrichments?: {
    robots?: RobotsFindings;
    redirectChains?: RedirectChainFindings;
    structuredData?: StructuredDataFindings;
    hreflang?: HreflangFindings;
    sitemapDiff?: SitemapDiffFindings;
    canonicalChains?: CanonicalChainFindings;
    /** Per-enricher runtime + error summary so the UI can show gracefully
     *  when an enricher failed or was skipped. */
    status?: { name: string; ok: boolean; durationMs: number; error?: string; skipped?: string }[];
  };
}

// ─── Enrichment findings ────────────────────────────────────────────────────
// Each interface matches the return shape of src/health/crawl-enrichers/<name>.ts.

export interface RobotsFindings {
  fetched: boolean;
  /** Robots.txt URL we tried to fetch. */
  url: string;
  /** Sitemap URLs declared in robots.txt Sitemap: directives. */
  declaredSitemaps: string[];
  /** Groups: one per User-agent block. `paths` are effective rules. */
  groups: { userAgent: string; disallow: string[]; allow: string[]; crawlDelay?: number }[];
  /** Crawled URLs that a compliant Googlebot would have been blocked from
   *  (our crawler ignores robots.txt by default — this is a compliance hint). */
  disallowedButCrawled: { url: string; matchedRule: string; userAgent: string }[];
  /** Free-text error when the fetch failed. */
  error?: string;
}

export interface RedirectChainFindings {
  /** Chains with >1 hop (single redirects ignored — they're normal). */
  chains: { startUrl: string; hops: { url: string; status: number; location?: string }[]; loop: boolean }[];
  longestChainHops: number;
  loopCount: number;
}

export interface StructuredDataFindings {
  /** Pages we successfully parsed JSON-LD from. */
  pagesWithSchema: number;
  pagesScanned: number;
  /** Count of each @type seen across the whole site. */
  byType: Record<string, number>;
  /** Per-page findings for pages with issues or with schema. */
  pages: {
    url: string;
    types: string[];
    issues: string[];
    blocksTotal: number;
    blocksInvalidJson: number;
  }[];
  /** JSON blocks that failed to parse — site-wide rollup. */
  invalidJsonBlocks: number;
}

export interface HreflangFindings {
  pagesWithHreflang: number;
  pagesScanned: number;
  /** Non-reciprocal pairs: A declares B as alternate but B doesn't declare A. */
  nonMutualPairs: { from: string; to: string; lang: string }[];
  /** Pages missing x-default. */
  missingXDefault: string[];
  /** Invalid ISO language-region codes found. */
  invalidLangs: { url: string; lang: string }[];
  /** Self-targeting hreflang (page points to itself with a lang other than
   *  its actual lang — usually a CMS bug). */
  selfTargetingMismatches: { url: string; declaredLang: string; actualLang?: string }[];
}

export interface SitemapDiffFindings {
  /** Sitemap URLs that worked (subset of robots-declared + /sitemap.xml fallbacks). */
  sitemapsFetched: string[];
  /** Total URLs declared across all sitemaps. */
  declaredUrlCount: number;
  /** Declared URL set that our crawl never visited. */
  declaredNotCrawled: string[];
  /** Crawled URLs that aren't declared in any sitemap (true orphans from
   *  sitemap perspective — might be indexable but invisible to search bots
   *  that rely on sitemap discovery). */
  crawledNotDeclared: string[];
  error?: string;
}

export interface CanonicalChainFindings {
  /** Pages with canonicalUrl pointing somewhere other than themselves. */
  nonSelfCanonicalCount: number;
  /** Chains longer than 1 (A → B → C …). */
  chains: { startUrl: string; chain: string[]; loop: boolean }[];
  /** Canonical targets that 404'd or otherwise weren't in the crawl. */
  danglingTargets: { from: string; to: string; reason: string }[];
  longestChain: number;
  loopCount: number;
}
