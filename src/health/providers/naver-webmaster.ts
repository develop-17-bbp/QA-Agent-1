/**
 * Naver Search Advisor — free indexing + inbound-link data for sites
 * verified in Naver (South Korean market, where Naver holds ~60% search share).
 *
 * Any SEO targeting Korean-language audiences needs Naver the same way
 * Russian-language SEO needs Yandex. Naver's API is smaller in scope than
 * Bing/Yandex (fewer endpoints exposed) but it covers what matters:
 *   - verified-host list
 *   - indexed-page count
 *   - robots.txt / sitemap / site-verification status
 *
 * Naver does NOT expose inbound-link data via API (paid audits only). For
 * that you'd fall back to Common Crawl + URLScan (already integrated).
 *
 * Setup:
 *   1. Sign up at https://searchadvisor.naver.com/
 *   2. Verify your site (meta tag / HTML file / DNS TXT)
 *   3. Open https://developers.naver.com/apps — Create Application
 *      - API Permissions: "Search Advisor"
 *   4. Copy the Client ID + Client Secret
 *   5. Put them in .env:
 *        NAVER_CLIENT_ID=<from apps page>
 *        NAVER_CLIENT_SECRET=<from apps page>
 *
 * Free; Naver self-documents 25k req/day as a soft ceiling.
 *
 * Docs: https://developers.naver.com/docs/utils/searchadvisor/
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";
import { resolveKey } from "../modules/runtime-keys.js";

const PROVIDER = "naver-webmaster";
registerLimit(PROVIDER, 60, 60_000);
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

const API_BASE = "https://openapi.naver.com/v1/search-advisor";

function resolveClientId(): string | undefined {
  return resolveKey("NAVER_CLIENT_ID");
}

function resolveClientSecret(): string | undefined {
  return resolveKey("NAVER_CLIENT_SECRET");
}

export function isNaverWebmasterConfigured(): boolean {
  return !!(resolveClientId() && resolveClientSecret());
}

function authHeaders(): Record<string, string> {
  const id = resolveClientId();
  const secret = resolveClientSecret();
  if (!id || !secret) throw new ProviderError(PROVIDER, "NAVER_CLIENT_ID + NAVER_CLIENT_SECRET not set");
  return {
    "X-Naver-Client-Id": id,
    "X-Naver-Client-Secret": secret,
    Accept: "application/json",
  };
}

export interface NaverSite {
  siteUrl: string;
  verified: boolean;
  robotsTxtValid?: boolean;
  sitemapRegistered?: boolean;
}

export interface NaverIndexSnapshot {
  indexedPages: number;
  crawledPages?: number;
  averageResponseMs?: number;
}

interface SitesListResponse {
  sites?: Array<{
    site_url?: string;
    verified?: boolean;
    robots_txt?: { valid?: boolean };
    sitemap?: { registered?: boolean };
  }>;
}

export async function fetchNaverSites(): Promise<DataPoint<NaverSite[]>> {
  if (!isNaverWebmasterConfigured()) {
    throw new ProviderError(PROVIDER, "NAVER_CLIENT_ID + NAVER_CLIENT_SECRET not set");
  }

  const cacheKey = `${PROVIDER}:sites`;
  const cached = cacheGet<NaverSite[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) throw new ProviderError(PROVIDER, "Rate limit exhausted");

  const url = `${API_BASE}/sites`;
  const res = await httpGet(url, { headers: authHeaders(), timeoutMs: 20_000 });
  if (!res) throw new ProviderError(PROVIDER, "Network error");
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(PROVIDER, "401/403: invalid Naver credentials or Search Advisor scope missing");
  }
  if (!res.ok) throw new ProviderError(PROVIDER, `HTTP ${res.status}`);

  let data: SitesListResponse;
  try { data = (await res.json()) as SitesListResponse; }
  catch { throw new ProviderError(PROVIDER, "Invalid JSON"); }

  const sites: NaverSite[] = (data.sites ?? [])
    .map((s) => ({
      siteUrl: String(s.site_url ?? ""),
      verified: s.verified === true,
      robotsTxtValid: s.robots_txt?.valid,
      sitemapRegistered: s.sitemap?.registered,
    }))
    .filter((s) => s.siteUrl);

  cacheSet(cacheKey, sites, TTL_MS);
  return dp(sites, PROVIDER, "high", TTL_MS, "Naver Search Advisor verified sites");
}

interface IndexSnapshotResponse {
  indexing?: {
    indexed_count?: number;
    crawled_count?: number;
  };
  performance?: {
    avg_response_ms?: number;
  };
}

export async function fetchNaverIndexSnapshot(siteUrl: string): Promise<DataPoint<NaverIndexSnapshot>> {
  if (!isNaverWebmasterConfigured()) {
    throw new ProviderError(PROVIDER, "NAVER_CLIENT_ID + NAVER_CLIENT_SECRET not set");
  }
  if (!siteUrl) throw new ProviderError(PROVIDER, "siteUrl required");

  const cacheKey = `${PROVIDER}:index:${siteUrl}`;
  const cached = cacheGet<NaverIndexSnapshot>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) throw new ProviderError(PROVIDER, "Rate limit exhausted");

  const url = `${API_BASE}/sites/${encodeURIComponent(siteUrl)}/summary`;
  const res = await httpGet(url, { headers: authHeaders(), timeoutMs: 20_000 });
  if (!res) throw new ProviderError(PROVIDER, "Network error");
  if (res.status === 404) throw new ProviderError(PROVIDER, `Site ${siteUrl} not verified under this Naver account`);
  if (!res.ok) throw new ProviderError(PROVIDER, `HTTP ${res.status}`);

  let data: IndexSnapshotResponse;
  try { data = (await res.json()) as IndexSnapshotResponse; }
  catch { throw new ProviderError(PROVIDER, "Invalid JSON"); }

  const snap: NaverIndexSnapshot = {
    indexedPages: Number(data.indexing?.indexed_count ?? 0),
    crawledPages: data.indexing?.crawled_count != null ? Number(data.indexing.crawled_count) : undefined,
    averageResponseMs: data.performance?.avg_response_ms != null ? Number(data.performance.avg_response_ms) : undefined,
  };
  cacheSet(cacheKey, snap, TTL_MS);
  return dp(snap, PROVIDER, "high", TTL_MS, "Naver Search Advisor index snapshot");
}
