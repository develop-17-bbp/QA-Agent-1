/**
 * OpenPageRank — free domain authority scoring.
 *
 * https://www.domcop.com/openpagerank/
 *
 * Requires a free API key (OPR_API_KEY env var). 1000 req/day free tier.
 * Returns a "Page Rank decimal" 0-10 and an integer rank across all domains.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "open-page-rank";
registerLimit(PROVIDER, 1000, 24 * 60 * 60 * 1000);
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d cache — DA changes slowly

interface OprResponse {
  status_code: number;
  response: {
    status_code: number;
    error?: string;
    domain: string;
    page_rank_integer: number;
    page_rank_decimal: number;
    rank: string; // string like "123456"
  }[];
}

function resolveKey(): string | undefined {
  return (
    process.env.OPR_API_KEY?.trim() ||
    process.env.OPEN_PAGERANK_API_KEY?.trim() ||
    process.env.OPEN_PAGE_RANK_API_KEY?.trim()
  );
}

export function isOpenPageRankConfigured(): boolean {
  return !!resolveKey();
}

export interface DomainAuthority {
  domain: string;
  /** 0-10 decimal (OpenPageRank scale). */
  pageRankDecimal: DataPoint<number>;
  /** 0-100 rescaled (so it matches common "domain authority" UIs). */
  authority0to100: DataPoint<number>;
  /** Global integer rank — lower is better. Empty if OPR returned no rank. */
  globalRank?: DataPoint<number>;
}

export async function fetchDomainAuthority(domain: string): Promise<DomainAuthority> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) throw new ProviderError(PROVIDER, "Empty domain");

  const key = resolveKey();
  if (!key) {
    throw new ProviderError(
      PROVIDER,
      "OPR_API_KEY not set. Get a free key at https://www.domcop.com/openpagerank/",
    );
  }

  const cacheKey = `${PROVIDER}:${clean}`;
  const cached = cacheGet<DomainAuthority>(cacheKey);
  if (cached) return cached;

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted (1000/day)");
  }

  const url = `https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(clean)}`;
  const res = await httpGet(url, { headers: { "API-OPR": key } });
  if (!res || !res.ok) throw new ProviderError(PROVIDER, `HTTP ${res?.status ?? "???"}`);

  let data: OprResponse;
  try {
    data = (await res.json()) as OprResponse;
  } catch {
    throw new ProviderError(PROVIDER, "Invalid JSON response");
  }
  const row = data.response?.[0];
  if (!row || row.status_code !== 200) {
    throw new ProviderError(PROVIDER, row?.error ?? "Domain not in OPR index");
  }

  const rank = Number.parseInt(row.rank, 10);
  const result: DomainAuthority = {
    domain: clean,
    pageRankDecimal: dp(row.page_rank_decimal, PROVIDER, "high", TTL_MS, "0-10 scale"),
    authority0to100: dp(
      Math.round(row.page_rank_decimal * 10),
      PROVIDER,
      "high",
      TTL_MS,
      "OPR decimal rescaled to 0-100",
    ),
    globalRank: Number.isFinite(rank)
      ? dp(rank, PROVIDER, "medium", TTL_MS, "lower is better")
      : undefined,
  };

  cacheSet(cacheKey, result, TTL_MS);
  return result;
}
