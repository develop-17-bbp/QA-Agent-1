/**
 * Cloudflare Radar — free API with real traffic data for domains and ASNs.
 *
 * https://developers.cloudflare.com/radar/
 *
 * Auth: a free Cloudflare API token with "Account:Radar:Read" scope.
 * (Set CLOUDFLARE_API_TOKEN env var.)
 *
 * Rank endpoint returns the domain's *real* rank in Cloudflare's aggregated
 * traffic dataset. This is one of the best free domain-traffic signals.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";
import { resolveKey } from "../modules/runtime-keys.js";

const PROVIDER = "cloudflare-radar";
registerLimit(PROVIDER, 300, 24 * 60 * 60 * 1000);
const TTL_MS = 24 * 60 * 60 * 1000;

interface RankResponse {
  result?: {
    top_0?: { rank: number; domain: string; categories?: { name: string }[] }[];
    top?: { rank: number; domain: string; categories?: { name: string }[] }[];
  };
  success?: boolean;
  errors?: { message: string }[];
}

function resolveToken(): string | undefined {
  return resolveKey("CLOUDFLARE_API_TOKEN") || resolveKey("CF_API_TOKEN");
}

export function isCloudflareRadarConfigured(): boolean {
  return !!resolveToken();
}

export interface RadarDomainRank {
  domain: string;
  rank: DataPoint<number>;
  categories?: DataPoint<string[]>;
}

/**
 * Look up a domain in the Radar top-domains dataset. Not every domain is in
 * the top list — small sites will not be found and we return undefined.
 */
export async function fetchDomainRank(domain: string): Promise<RadarDomainRank | undefined> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) throw new ProviderError(PROVIDER, "Empty domain");

  const token = resolveToken();
  if (!token) throw new ProviderError(PROVIDER, "CLOUDFLARE_API_TOKEN not set");

  const cacheKey = `${PROVIDER}:${clean}`;
  const cached = cacheGet<RadarDomainRank | "miss">(cacheKey);
  if (cached === "miss") return undefined;
  if (cached) return cached;

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  // Radar's "domains/rank" endpoint
  const url = `https://api.cloudflare.com/client/v4/radar/ranking/domain/${encodeURIComponent(clean)}?limit=1`;
  const res = await httpGet(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res || !res.ok) {
    if (res && res.status === 404) {
      cacheSet(cacheKey, "miss", TTL_MS);
      return undefined;
    }
    throw new ProviderError(PROVIDER, `HTTP ${res?.status ?? "???"}`);
  }

  let data: RankResponse;
  try {
    data = (await res.json()) as RankResponse;
  } catch {
    throw new ProviderError(PROVIDER, "Invalid JSON");
  }

  const row = data.result?.top_0?.[0] ?? data.result?.top?.[0];
  if (!row) {
    cacheSet(cacheKey, "miss", TTL_MS);
    return undefined;
  }

  const result: RadarDomainRank = {
    domain: clean,
    rank: dp(row.rank, PROVIDER, "high", TTL_MS, "Cloudflare Radar global rank"),
    categories: row.categories
      ? dp(row.categories.map((c) => c.name), PROVIDER, "high", TTL_MS)
      : undefined,
  };

  cacheSet(cacheKey, result, TTL_MS);
  return result;
}
