/**
 * Brave Search API — free 2000 queries/month, no credit card required.
 *
 * Used as a second-opinion SERP source alongside the DuckDuckGo HTML scraper.
 * When both are available, the Competitor Rank Tracker reports each domain's
 * rank on both engines and flags a >10-position gap as a discrepancy.
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search/get-started
 * Endpoint: GET https://api.search.brave.com/res/v1/web/search?q=...&country=US
 * Auth: header "X-Subscription-Token: <key>"
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "brave-search";
// 1 request/sec on the free tier + 2000/month. We enforce the per-second limit
// locally so a burst doesn't slam the API.
registerLimit(PROVIDER, 1, 1_100);
const TTL_MS = 60 * 60 * 1000; // 1h cache

export interface BraveResult {
  position: number;
  title: string;
  url: string;
  description?: string;
}

interface BraveApiResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
}

function resolveKey(): string | undefined {
  return process.env.BRAVE_SEARCH_API_KEY?.trim();
}

export function isBraveConfigured(): boolean {
  return !!resolveKey();
}

export interface BraveSerpResponse {
  query: string;
  country: string;
  results: BraveResult[];
  fetchedAt: string;
}

/**
 * Run a Brave Search query. `country` is a 2-letter ISO code (e.g. "US", "IN").
 * Returns an empty results array on 401 (invalid key) rather than throwing,
 * so callers degrade gracefully.
 */
export async function searchBrave(query: string, country = "US"): Promise<DataPoint<BraveSerpResponse>> {
  const q = query.trim();
  if (!q) throw new ProviderError(PROVIDER, "Empty query");
  const key = resolveKey();
  if (!key) throw new ProviderError(PROVIDER, "BRAVE_SEARCH_API_KEY not set");

  const cacheKey = `${PROVIDER}:${country}:${q.toLowerCase()}`;
  const cached = cacheGet<BraveSerpResponse>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Brave rate limit (1 req/sec) — wait and retry");
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}&count=20`;
  const res = await httpGet(url, {
    timeoutMs: 15_000,
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": key,
    },
  });
  if (!res) throw new ProviderError(PROVIDER, "Network error");
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(PROVIDER, `${res.status}: key invalid or quota exhausted`);
  }
  if (res.status === 429) {
    throw new ProviderError(PROVIDER, "429: rate limit — monthly free tier may be exhausted");
  }
  if (!res.ok) throw new ProviderError(PROVIDER, `HTTP ${res.status}`);

  let data: BraveApiResponse;
  try { data = (await res.json()) as BraveApiResponse; } catch { throw new ProviderError(PROVIDER, "Invalid JSON"); }

  const raw = data.web?.results ?? [];
  const results: BraveResult[] = raw.map((r, i) => ({
    position: i + 1,
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    description: typeof r.description === "string" ? r.description : undefined,
  })).filter((r) => r.url);

  const out: BraveSerpResponse = {
    query: q,
    country,
    results,
    fetchedAt: new Date().toISOString(),
  };
  cacheSet(cacheKey, out, TTL_MS);
  return dp(out, PROVIDER, "high", TTL_MS, `${results.length} results`);
}

/**
 * Find the position (1-based) of a domain in a Brave SERP. Returns `null` if
 * the domain is not in the top 20. Hostname match is tolerant of `www.`.
 */
export async function findDomainRankBrave(query: string, domain: string, country = "US"): Promise<number | null> {
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!cleanDomain) return null;
  const serp = await searchBrave(query, country);
  for (const r of serp.value.results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
      if (host === cleanDomain || host.endsWith(`.${cleanDomain}`)) return r.position;
    } catch { /* skip bad url */ }
  }
  return null;
}
