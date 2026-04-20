/**
 * Google Trends — real relative search volume, trends, and related queries.
 *
 * Trends exposes two useful public (unofficial) endpoints:
 *   - /trends/api/explore            → returns widget tokens
 *   - /trends/api/widgetdata/multiline → 12-month interest-over-time curve
 *   - /trends/api/widgetdata/relatedsearches → related / rising queries
 *
 * Responses are prefixed with ")]}'" garbage that we strip before parsing.
 *
 * No API key, but the endpoint throttles by IP so we cache aggressively.
 * Output is *relative* volume (0-100). Calibrate to absolute volume via
 * `calibrateVolume()` against a known anchor keyword.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGetText } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "google-trends";
registerLimit(PROVIDER, 30, 60_000); // ~1 req every 2s avg
const TTL_MS = 6 * 60 * 60 * 1000;   // 6h cache

const EXPLORE_URL = "https://trends.google.com/trends/api/explore";

interface TrendsWidget {
  id: string;
  token: string;
  request: unknown;
}

interface ExploreResponse {
  widgets: TrendsWidget[];
}

interface TimelineResponse {
  default: {
    timelineData: { formattedAxisTime: string; value: number[] }[];
  };
}

interface RelatedResponse {
  default: {
    rankedList: {
      rankedKeyword: { query: string; value: number }[];
    }[];
  };
}

function stripTrendsJunk(body: string): string {
  // Google Trends prefixes JSON responses with ")]}',\n"
  const idx = body.indexOf("{");
  return idx >= 0 ? body.slice(idx) : body;
}

async function fetchTrendsJson<T>(url: string): Promise<T | undefined> {
  const body = await httpGetText(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://trends.google.com/trends/",
    },
    timeoutMs: 20_000,
  });
  if (!body) return undefined;
  try {
    return JSON.parse(stripTrendsJunk(body)) as T;
  } catch {
    return undefined;
  }
}

export interface KeywordTrendResult {
  trend12mo: DataPoint<{ month: string; value: number }[]>;
  peakValue: DataPoint<number>;
  avgValue: DataPoint<number>;
  relatedQueries?: DataPoint<string[]>;
}

/**
 * Fetch the 12-month interest curve and related queries for a keyword.
 */
export async function fetchKeywordTrend(keyword: string, geo = ""): Promise<KeywordTrendResult> {
  const clean = keyword.trim();
  if (!clean) throw new ProviderError(PROVIDER, "Empty keyword");

  const cacheKey = `${PROVIDER}:${geo}:${clean}`;
  const cached = cacheGet<KeywordTrendResult>(cacheKey);
  if (cached) return cached;

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  // Step 1: explore → widgets + tokens.
  // Google Trends aggressively throttles datacenter IPs — we retry once after
  // a short backoff, then return a soft-empty result instead of throwing so
  // consumers (Keyword Impact, Keyword Overview) can degrade gracefully
  // rather than propagating a hard failure to the UI.
  const reqBody = {
    comparisonItem: [{ keyword: clean, geo, time: "today 12-m" }],
    category: 0,
    property: "",
  };
  const exploreUrl = `${EXPLORE_URL}?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(reqBody))}&tz=0`;
  let explore = await fetchTrendsJson<ExploreResponse>(exploreUrl);
  if (!explore || !Array.isArray(explore.widgets)) {
    await new Promise((r) => setTimeout(r, 1500));
    explore = await fetchTrendsJson<ExploreResponse>(exploreUrl);
  }
  if (!explore || !Array.isArray(explore.widgets)) {
    const fallback: KeywordTrendResult = {
      trend12mo: dp([], PROVIDER, "low", TTL_MS, "Google Trends throttled — empty series returned"),
      peakValue: dp(0, PROVIDER, "low", TTL_MS),
      avgValue: dp(0, PROVIDER, "low", TTL_MS),
    };
    cacheSet(cacheKey, fallback, 10 * 60 * 1000); // short cache so we retry in 10 min
    return fallback;
  }

  // Find timeline and related_queries widgets
  const timelineWidget = explore.widgets.find((w) => w.id === "TIMESERIES");
  const relatedWidget = explore.widgets.find((w) => w.id === "RELATED_QUERIES");

  // Step 2: timeline data
  let trend12mo: { month: string; value: number }[] = [];
  if (timelineWidget) {
    const timelineUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(timelineWidget.request))}&token=${encodeURIComponent(timelineWidget.token)}&tz=0`;
    const timeline = await fetchTrendsJson<TimelineResponse>(timelineUrl);
    if (timeline?.default?.timelineData) {
      trend12mo = timeline.default.timelineData.map((d) => ({
        month: d.formattedAxisTime,
        value: d.value?.[0] ?? 0,
      }));
    }
  }

  // Step 3: related queries
  let relatedQueries: string[] | undefined;
  if (relatedWidget) {
    const relatedUrl = `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(relatedWidget.request))}&token=${encodeURIComponent(relatedWidget.token)}&tz=0`;
    const related = await fetchTrendsJson<RelatedResponse>(relatedUrl);
    const ranked = related?.default?.rankedList?.[0]?.rankedKeyword ?? [];
    if (ranked.length > 0) {
      relatedQueries = ranked.map((r) => r.query).slice(0, 20);
    }
  }

  const values = trend12mo.map((d) => d.value);
  const peak = values.length > 0 ? Math.max(...values) : 0;
  const avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

  const result: KeywordTrendResult = {
    trend12mo: dp(trend12mo, PROVIDER, "high", TTL_MS, "12-month interest-over-time (relative 0-100)"),
    peakValue: dp(peak, PROVIDER, "high", TTL_MS),
    avgValue: dp(avg, PROVIDER, "medium", TTL_MS, "average over 12 months"),
    relatedQueries: relatedQueries
      ? dp(relatedQueries, PROVIDER, "high", TTL_MS)
      : undefined,
  };

  cacheSet(cacheKey, result, TTL_MS);
  return result;
}

/**
 * Convert Google Trends relative value (0-100) into an absolute monthly
 * search-volume estimate by anchoring against a keyword with a known volume.
 *
 * Example: if "iphone" has a known Trends peak of 92 and a known volume of
 * ~5,000,000/mo, we can scale any other Trends value proportionally.
 */
export function calibrateVolume(relativeValue: number, anchorRel: number, anchorAbs: number): number {
  if (anchorRel <= 0 || anchorAbs <= 0) return 0;
  return Math.round((relativeValue / anchorRel) * anchorAbs);
}
