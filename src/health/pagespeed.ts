import type { PageSpeedMetrics } from "./types.js";

/**
 * Uses the public PageSpeed Insights API (same data as https://pagespeed.web.dev/ ).
 * Requires GOOGLE_PAGESPEED_API_KEY or options.apiKey.
 * @see https://developers.google.com/speed/docs/insights/v5/get-started
 */
export async function fetchPageSpeedScores(options: {
  url: string;
  apiKey: string;
  strategy: "mobile" | "desktop";
  timeoutMs?: number;
}): Promise<PageSpeedMetrics> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const u = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  u.searchParams.set("url", options.url);
  u.searchParams.set("key", options.apiKey);
  u.searchParams.set("strategy", options.strategy);
  u.searchParams.append("category", "PERFORMANCE");
  u.searchParams.append("category", "ACCESSIBILITY");
  u.searchParams.append("category", "BEST_PRACTICES");
  u.searchParams.append("category", "SEO");

  try {
    const res = await fetch(u.href, { signal: AbortSignal.timeout(timeoutMs) });
    const json = (await res.json()) as {
      error?: { message?: string };
      lighthouseResult?: {
        categories?: Record<string, { score: number | null }>;
      };
    };
    if (!res.ok) {
      return {
        url: options.url,
        strategy: options.strategy,
        performanceScore: null,
        accessibilityScore: null,
        seoScore: null,
        bestPracticesScore: null,
        error: json.error?.message ?? `HTTP ${res.status}`,
      };
    }
    const cats = json.lighthouseResult?.categories ?? {};
    const score = (id: string) => {
      const s = cats[id]?.score;
      return s == null ? null : Math.round(s * 100);
    };
    return {
      url: options.url,
      strategy: options.strategy,
      performanceScore: score("performance"),
      accessibilityScore: score("accessibility"),
      seoScore: score("seo"),
      bestPracticesScore: score("best-practices"),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      url: options.url,
      strategy: options.strategy,
      performanceScore: null,
      accessibilityScore: null,
      seoScore: null,
      bestPracticesScore: null,
      error: msg,
    };
  }
}
