/**
 * URLScan.io — free API (API key required but free tier generous).
 *
 * https://urlscan.io/docs/api/
 *
 * Useful for:
 *   - Recent scan data for a domain → shows linked resources and third-party
 *     references = real inbound link signal.
 *   - Technology fingerprints and request graphs.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGetJson } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "urlscan";
registerLimit(PROVIDER, 100, 60_000);
const TTL_MS = 24 * 60 * 60 * 1000;

interface UrlscanSearchResult {
  results: {
    task: { url: string; time: string; domain: string };
    page: { url: string; domain: string; title?: string };
  }[];
  total: number;
}

function resolveKey(): string | undefined {
  return process.env.URLSCAN_API_KEY?.trim();
}

export function isUrlscanConfigured(): boolean {
  return !!resolveKey();
}

export interface UrlscanHit {
  url: string;
  domain: string;
  title?: string;
  time: string;
}

/**
 * Search for scans that reference a given domain. Returns a deduped list of
 * URLs mentioning the domain in Recent scans.
 */
export async function searchDomainReferences(domain: string, limit = 50): Promise<DataPoint<UrlscanHit[]>> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) throw new ProviderError(PROVIDER, "Empty domain");

  const cacheKey = `${PROVIDER}:${clean}:${limit}`;
  const cached = cacheGet<UrlscanHit[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  const apiKey = resolveKey();
  const headers: Record<string, string> = {};
  if (apiKey) headers["API-Key"] = apiKey;

  const q = encodeURIComponent(`page.domain:${clean} OR task.url:${clean}`);
  const url = `https://urlscan.io/api/v1/search/?q=${q}&size=${limit}`;
  const data = await httpGetJson<UrlscanSearchResult>(url, { headers });
  if (!data?.results) {
    throw new ProviderError(PROVIDER, "No results or rate limited (401/429)");
  }

  const hits: UrlscanHit[] = data.results.slice(0, limit).map((r) => ({
    url: r.page?.url ?? r.task?.url ?? "",
    domain: r.page?.domain ?? r.task?.domain ?? "",
    title: r.page?.title,
    time: r.task?.time ?? "",
  }));

  cacheSet(cacheKey, hits, TTL_MS);
  return dp(hits, PROVIDER, apiKey ? "high" : "medium", TTL_MS, apiKey ? "authed" : "anonymous");
}
