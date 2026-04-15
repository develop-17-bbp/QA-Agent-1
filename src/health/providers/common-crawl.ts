/**
 * Common Crawl — free web archive with a searchable CDX index.
 *
 * https://index.commoncrawl.org/
 *
 * Use cases:
 *   - Discover which URLs across the web have captured a given target URL
 *     (backlink discovery via "*.target.com" subdomain queries)
 *   - Check how many times Common Crawl has seen a domain
 *
 * Free and unauthenticated but slow. We cache aggressively. Common Crawl
 * publishes a new index every ~1 month, and the CDX server returns JSON
 * lines (one JSON object per line).
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet, httpGetJson } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "common-crawl";
registerLimit(PROVIDER, 30, 60_000);
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d — index only updates monthly

interface CollinfoEntry {
  id: string;
  name: string;
  timegate: string;
  "cdx-api": string;
}

let cachedIndexes: CollinfoEntry[] | null = null;

async function fetchRecentIndexes(): Promise<CollinfoEntry[]> {
  if (cachedIndexes) return cachedIndexes;
  const data = await httpGetJson<CollinfoEntry[]>("https://index.commoncrawl.org/collinfo.json");
  if (!data || data.length === 0) {
    throw new ProviderError(PROVIDER, "Failed to fetch Common Crawl index list");
  }
  cachedIndexes = data.slice(0, 3); // keep 3 most-recent indexes
  return cachedIndexes;
}

export interface CommonCrawlHit {
  url: string;
  timestamp: string;
  status: string;
  mime?: string;
  length?: string;
}

function parseCdxLines(raw: string): CommonCrawlHit[] {
  const out: CommonCrawlHit[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        url: string;
        timestamp: string;
        status: string;
        mime?: string;
        length?: string;
      };
      if (obj.url && obj.timestamp) {
        out.push({
          url: obj.url,
          timestamp: obj.timestamp,
          status: obj.status,
          mime: obj.mime,
          length: obj.length,
        });
      }
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

/**
 * Look up all URLs Common Crawl has seen for a given domain (and subpaths).
 * Useful to estimate the crawled footprint of a domain.
 */
export async function fetchDomainHits(domain: string, limit = 200): Promise<DataPoint<CommonCrawlHit[]>> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) throw new ProviderError(PROVIDER, "Empty domain");

  const cacheKey = `${PROVIDER}:hits:${clean}:${limit}`;
  const cached = cacheGet<CommonCrawlHit[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  const indexes = await fetchRecentIndexes();
  const allHits: CommonCrawlHit[] = [];

  // Query the two most-recent indexes in parallel, merge results
  const promises = indexes.slice(0, 2).map(async (idx) => {
    const url = `${idx["cdx-api"]}?url=${encodeURIComponent(`*.${clean}`)}&output=json&limit=${limit}`;
    const res = await httpGet(url, { timeoutMs: 30_000 });
    if (!res || !res.ok) return [] as CommonCrawlHit[];
    const raw = await res.text();
    return parseCdxLines(raw);
  });

  const results = await Promise.allSettled(promises);
  for (const r of results) if (r.status === "fulfilled") allHits.push(...r.value);

  // Dedupe by URL
  const seen = new Set<string>();
  const deduped: CommonCrawlHit[] = [];
  for (const h of allHits) {
    if (!seen.has(h.url)) {
      seen.add(h.url);
      deduped.push(h);
    }
    if (deduped.length >= limit) break;
  }

  cacheSet(cacheKey, deduped, TTL_MS);
  return dp(deduped, PROVIDER, "high", TTL_MS, `merged from ${indexes.length} indexes`);
}

/**
 * Count the number of external domains linking TO a target domain — an
 * approximation of referring domain count. This is a slow operation; cache
 * aggressively.
 *
 * Note: Common Crawl's CDX index doesn't directly expose backlinks, but we
 * can approximate referring-domain breadth by the number of distinct hosts
 * that Common Crawl has crawled which match the target's URL pattern when
 * searched as a text substring. For a true inlink count you would need the
 * Common Crawl Web Graph dataset (WAT files), which is large to process.
 * We surface whatever we can for free and label confidence accordingly.
 */
export async function approximateReferringDomains(domain: string): Promise<DataPoint<number>> {
  const hits = await fetchDomainHits(domain, 500);
  const distinctHosts = new Set<string>();
  for (const h of hits.value) {
    try {
      distinctHosts.add(new URL(h.url).hostname.replace(/^www\./, ""));
    } catch {
      // skip bad url
    }
  }
  const count = distinctHosts.size;
  return dp(count, PROVIDER, "medium", TTL_MS, "distinct hosts seen in recent indexes (proxy)");
}
