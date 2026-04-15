/**
 * Wikipedia Pageviews API — free, no auth.
 *
 * Provides real monthly pageview counts for Wikipedia articles. Useful as a
 * calibration anchor for Google Trends relative values and as a traffic proxy
 * for topic-level keywords.
 *
 * Docs: https://wikimedia.org/api/rest_v1/
 * Endpoint:
 *   /metrics/pageviews/per-article/{project}/all-access/all-agents/{article}/{granularity}/{start}/{end}
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGetJson } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "wikipedia-pageviews";
registerLimit(PROVIDER, 100, 60_000);
const TTL_MS = 24 * 60 * 60 * 1000;

interface PageviewsResponse {
  items?: { project: string; article: string; timestamp: string; views: number }[];
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}00`;
}

function toArticleSlug(title: string): string {
  return encodeURIComponent(title.trim().replace(/\s+/g, "_"));
}

/**
 * Monthly pageviews for a Wikipedia article, averaged over the past 12 months.
 * Returns 0 if the article does not exist.
 */
export async function fetchArticlePageviews(title: string, project = "en.wikipedia"): Promise<DataPoint<number>> {
  const clean = title.trim();
  if (!clean) throw new ProviderError(PROVIDER, "Empty article title");

  const cacheKey = `${PROVIDER}:${project}:${clean}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached !== undefined) {
    return dp(cached, PROVIDER, "high", TTL_MS, "cached monthly-avg pageviews");
  }

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  const end = new Date();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - 1); // last complete month
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 11);

  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/` +
    `${project}/all-access/all-agents/${toArticleSlug(clean)}/monthly/` +
    `${yyyymmdd(start)}/${yyyymmdd(end)}`;

  const data = await httpGetJson<PageviewsResponse>(url);
  if (!data?.items || data.items.length === 0) {
    cacheSet(cacheKey, 0, TTL_MS);
    return dp(0, PROVIDER, "low", TTL_MS, "no pageview data / article missing");
  }

  const total = data.items.reduce((a, it) => a + (it.views ?? 0), 0);
  const monthlyAvg = Math.round(total / data.items.length);
  cacheSet(cacheKey, monthlyAvg, TTL_MS);
  return dp(monthlyAvg, PROVIDER, "high", TTL_MS, "monthly average over 12 months");
}

/**
 * Try multiple candidate article titles and return the first one that has
 * pageview data. Useful when the exact article slug is unknown.
 */
export async function fetchBestMatchPageviews(candidates: string[]): Promise<DataPoint<number> | undefined> {
  for (const c of candidates) {
    try {
      const res = await fetchArticlePageviews(c);
      if (res.value > 0) return res;
    } catch {
      // try next
    }
  }
  return undefined;
}
