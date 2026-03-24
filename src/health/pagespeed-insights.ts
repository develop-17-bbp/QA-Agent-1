import pLimit from "p-limit";
import type { CrawlSiteResult, PageFetchRecord, PageSpeedInsightRecord } from "./types.js";

const PSI_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function score01To100(score: number | null | undefined): number | undefined {
  if (score == null || Number.isNaN(score)) return undefined;
  return Math.round(score * 100);
}

function auditMs(audits: Record<string, { numericValue?: number }> | undefined, id: string): number | undefined {
  const v = audits?.[id]?.numericValue;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function auditDisplay(audits: Record<string, { displayValue?: string }> | undefined, id: string): string | undefined {
  const d = audits?.[id]?.displayValue;
  return typeof d === "string" && d.length > 0 ? d : undefined;
}

/**
 * Lab data from Google PageSpeed Insights API v5 (Lighthouse).
 * Requires `PAGESPEED_API_KEY` or `GOOGLE_PAGESPEED_API_KEY`.
 */
export async function fetchPageSpeedInsights(
  pageUrl: string,
  options: {
    apiKey: string;
    strategy: "mobile" | "desktop";
    timeoutMs: number;
  },
): Promise<PageSpeedInsightRecord> {
  const t0 = Date.now();
  const params = new URLSearchParams();
  params.set("url", pageUrl);
  params.set("key", options.apiKey);
  params.set("strategy", options.strategy);
  for (const c of ["performance", "accessibility", "best-practices", "seo"] as const) {
    params.append("category", c);
  }

  try {
    const res = await fetch(`${PSI_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const durationMs = Date.now() - t0;
    const text = await res.text();
    if (!res.ok) {
      return {
        url: pageUrl,
        strategy: options.strategy,
        durationMs,
        error: `PageSpeed API HTTP ${res.status}: ${text.slice(0, 280)}`,
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { url: pageUrl, strategy: options.strategy, durationMs, error: "Invalid JSON from PageSpeed API" };
    }
    const err = (json as { error?: { message?: string } }).error;
    if (err?.message) {
      return { url: pageUrl, strategy: options.strategy, durationMs, error: err.message };
    }
    const lh = (json as { lighthouseResult?: unknown }).lighthouseResult as
      | {
          categories?: Record<string, { score?: number | null }>;
          audits?: Record<string, { numericValue?: number; displayValue?: string }>;
        }
      | undefined;
    if (!lh) {
      return { url: pageUrl, strategy: options.strategy, durationMs, error: "No lighthouseResult in API response" };
    }

    const cat = lh.categories ?? {};
    const audits = lh.audits ?? {};

    const scores = {
      performance: score01To100(cat.performance?.score ?? undefined),
      accessibility: score01To100(cat.accessibility?.score ?? undefined),
      bestPractices: score01To100(cat["best-practices"]?.score ?? undefined),
      seo: score01To100(cat.seo?.score ?? undefined),
    };

    const metrics = {
      fcpMs: auditMs(audits, "first-contentful-paint"),
      lcpMs: auditMs(audits, "largest-contentful-paint"),
      tbtMs: auditMs(audits, "total-blocking-time"),
      cls: auditMs(audits, "cumulative-layout-shift"),
      speedIndexMs: auditMs(audits, "speed-index"),
      ttiMs: auditMs(audits, "interactive"),
    };

    const display = {
      fcp: auditDisplay(audits, "first-contentful-paint"),
      lcp: auditDisplay(audits, "largest-contentful-paint"),
      tbt: auditDisplay(audits, "total-blocking-time"),
      cls: auditDisplay(audits, "cumulative-layout-shift"),
      speedIndex: auditDisplay(audits, "speed-index"),
      tti: auditDisplay(audits, "interactive"),
    };

    /** Known Lighthouse audits that often surface as “opportunities” in the PSI UI. */
    const OPPORTUNITY_AUDIT_IDS = [
      "render-blocking-resources",
      "unused-javascript",
      "unused-css-rules",
      "uses-long-cache-ttl",
      "uses-text-compression",
      "uses-optimized-images",
      "modern-image-formats",
      "offscreen-images",
      "uses-rel-preconnect",
      "uses-rel-preload",
      "efficient-animated-content",
      "legacy-javascript",
      "third-party-summary",
      "total-byte-weight",
      "dom-size",
      "largest-contentful-paint-element",
    ];
    const opportunities: { title: string; displayValue?: string }[] = [];
    for (const id of OPPORTUNITY_AUDIT_IDS) {
      const a = audits[id] as
        | { score?: number | null; title?: string; displayValue?: string }
        | undefined;
      if (!a?.title) continue;
      if (a.score == null || a.score >= 0.9) continue;
      opportunities.push({ title: a.title, displayValue: a.displayValue });
    }

    return {
      url: pageUrl,
      strategy: options.strategy,
      durationMs,
      scores,
      metrics,
      display,
      opportunities: opportunities.length > 0 ? opportunities.slice(0, 8) : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      url: pageUrl,
      strategy: options.strategy,
      durationMs: Date.now() - t0,
      error: msg,
    };
  }
}

/** Resolve API key from environment (same names Google docs often use). */
export function resolvePageSpeedApiKey(): string | undefined {
  return (
    process.env.PAGESPEED_API_KEY?.trim() ||
    process.env.GOOGLE_PAGESPEED_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim()
  );
}

const PSI_MAX_URLS_CAP = 500;

/**
 * Runs PageSpeed Insights for up to `maxUrls` successfully crawled HTML pages (HTTP 200, ok).
 * Mutates each matching `PageFetchRecord` with `insights`.
 */
export async function attachPageSpeedInsights(
  crawl: CrawlSiteResult,
  options: {
    apiKey: string;
    strategy: "mobile" | "desktop";
    maxUrls: number;
    concurrency: number;
    timeoutMs: number;
  },
): Promise<{ totalDurationMs: number; urlsAnalyzed: number }> {
  const t0 = Date.now();
  const cap = Math.min(options.maxUrls <= 0 ? PSI_MAX_URLS_CAP : options.maxUrls, PSI_MAX_URLS_CAP);
  const candidates = crawl.pages.filter((p) => p.ok && p.status === 200).slice(0, cap);
  const limit = pLimit(Math.max(1, options.concurrency));
  await Promise.all(
    candidates.map((p: PageFetchRecord) =>
      limit(async () => {
        p.insights = await fetchPageSpeedInsights(p.url, {
          apiKey: options.apiKey,
          strategy: options.strategy,
          timeoutMs: options.timeoutMs,
        });
      }),
    ),
  );
  const totalDurationMs = Date.now() - t0;
  crawl.pageSpeedInsightsMeta = {
    strategy: options.strategy,
    totalDurationMs,
    urlsAnalyzed: candidates.length,
  };
  return { totalDurationMs, urlsAnalyzed: candidates.length };
}
