/**
 * Tranco — research-grade list of the top 1M most-popular domains.
 *
 * https://tranco-list.eu/
 *
 * Tranco publishes a new top-1M list daily. We ship a lightweight HTTP
 * lookup against their "top-million" endpoint rather than downloading the
 * entire CSV, so the binary stays small.
 *
 * They expose: https://tranco-list.eu/api/ranks/domain/<domain>
 * which returns JSON with the current rank and a history of rank changes
 * over the past 28 days.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGetJson } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "tranco";
registerLimit(PROVIDER, 200, 60 * 60 * 1000);
const TTL_MS = 24 * 60 * 60 * 1000;

interface TrancoResponse {
  domain: string;
  ranks?: { date: string; rank: number }[];
  latestRank?: number;
}

export interface TrancoRank {
  domain: string;
  currentRank: DataPoint<number>;
  /** 0-100: higher means more-trafficked (top 1M = 100, rank 1M = ~0). */
  percentile: DataPoint<number>;
  history30d?: DataPoint<{ date: string; rank: number }[]>;
}

function rankToPercentile(rank: number): number {
  // Tranco lists the top 1M. A rank of 1 = 100th percentile, 1_000_000 = ~0.
  if (rank <= 0) return 0;
  const capped = Math.min(rank, 1_000_000);
  return +(100 - (capped / 1_000_000) * 100).toFixed(2);
}

export async function fetchDomainRank(domain: string): Promise<TrancoRank | undefined> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) throw new ProviderError(PROVIDER, "Empty domain");

  const cacheKey = `${PROVIDER}:${clean}`;
  const cached = cacheGet<TrancoRank | "miss">(cacheKey);
  if (cached === "miss") return undefined;
  if (cached) return cached;

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  const url = `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(clean)}`;
  const data = await httpGetJson<TrancoResponse>(url);
  if (!data || (!data.latestRank && (!data.ranks || data.ranks.length === 0))) {
    cacheSet(cacheKey, "miss", TTL_MS);
    return undefined;
  }

  const current = data.latestRank ?? data.ranks?.[data.ranks.length - 1]?.rank ?? 0;
  if (current <= 0) {
    cacheSet(cacheKey, "miss", TTL_MS);
    return undefined;
  }

  const result: TrancoRank = {
    domain: clean,
    currentRank: dp(current, PROVIDER, "high", TTL_MS, "lower is better"),
    percentile: dp(rankToPercentile(current), PROVIDER, "high", TTL_MS, "0-100 (100=most-trafficked)"),
    history30d: data.ranks
      ? dp(data.ranks.slice(-30), PROVIDER, "high", TTL_MS, "last 30d rank history")
      : undefined,
  };

  cacheSet(cacheKey, result, TTL_MS);
  return result;
}
