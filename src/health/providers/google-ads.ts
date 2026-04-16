/**
 * Google Ads Keyword Planner — real monthly search volume.
 *
 * Uses the Google Ads REST API v17 KeywordPlanIdeaService.
 * This is the ONLY fully free source of real keyword volume data.
 *
 * Setup (one-time):
 *   1. Create a Google Ads account at ads.google.com (no spend required)
 *   2. Apply for a developer token at:
 *      https://developers.google.com/google-ads/api/docs/get-started/dev-token
 *      (Basic access is free and approved in minutes for non-production use)
 *   3. Get your customer ID from the Ads dashboard (10-digit number, no dashes)
 *   4. Add to .env:
 *        GOOGLE_ADS_DEVELOPER_TOKEN=your_token
 *        GOOGLE_ADS_CUSTOMER_ID=1234567890
 *
 * The existing Google OAuth tokens (stored in data/google-tokens.json) are
 * reused — no additional OAuth setup needed if you've already connected Google.
 *
 * Rate limits: 15,000 operations/day on basic access (free tier).
 * Cache: 24 hours per keyword to stay well within limits.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PROVIDER = "google-ads";
registerLimit(PROVIDER, 500, 24 * 60 * 60 * 1000); // conservative: 500/day
const TTL_MS = 24 * 60 * 60 * 1000; // 24h cache

export interface KeywordVolumeResult {
  keyword: string;
  /** Average monthly searches. null if keyword not in index. */
  avgMonthlySearches: DataPoint<number | null>;
  /** Competition level: LOW / MEDIUM / HIGH */
  competition: DataPoint<string | null>;
  /** Competition index 0–100 */
  competitionIndex: DataPoint<number | null>;
  /** Low end of bid range (USD) */
  lowTopOfPageBidMicros: DataPoint<number | null>;
  /** High end of bid range (USD) */
  highTopOfPageBidMicros: DataPoint<number | null>;
  /** Monthly breakdown for the last 12 months */
  monthlyBreakdown: DataPoint<{ year: number; month: number; searches: number }[]>;
}

interface TokenFile {
  access_token: string;
  refresh_token: string;
  expiry?: number;
}

async function loadAccessToken(): Promise<string> {
  const tokenPath = path.join(process.cwd(), "data", "google-tokens.json");
  let tokens: TokenFile;
  try {
    const raw = await readFile(tokenPath, "utf8");
    tokens = JSON.parse(raw) as TokenFile;
  } catch {
    throw new ProviderError(PROVIDER, "Google not connected — run OAuth flow first via /google-connections");
  }

  // Refresh if expired or expiring in 60s
  if (!tokens.expiry || Date.now() > tokens.expiry - 60_000) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new ProviderError(PROVIDER, "GOOGLE_OAUTH_CLIENT_ID / SECRET not set — can't refresh token");
    }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) throw new ProviderError(PROVIDER, `Token refresh failed: ${res.status}`);
    const refreshed = await res.json() as { access_token: string; expires_in: number };
    tokens.access_token = refreshed.access_token;
    tokens.expiry = Date.now() + refreshed.expires_in * 1000;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(tokenPath, JSON.stringify(tokens, null, 2), "utf8");
  }

  return tokens.access_token;
}

export function isGoogleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() &&
    process.env.GOOGLE_ADS_CUSTOMER_ID?.trim()
  );
}

export async function fetchKeywordVolume(keywords: string[], geo = "US", lang = "1000"): Promise<KeywordVolumeResult[]> {
  if (!isGoogleAdsConfigured()) {
    throw new ProviderError(
      PROVIDER,
      "Set GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID in .env — see src/health/providers/google-ads.ts for setup instructions",
    );
  }

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.trim().replace(/-/g, "");

  // Check cache for all keywords
  const results: KeywordVolumeResult[] = [];
  const uncached: string[] = [];

  for (const kw of keywords) {
    const cacheKey = `${PROVIDER}:${geo}:${kw.toLowerCase().trim()}`;
    const cached = cacheGet<KeywordVolumeResult>(cacheKey);
    if (cached) {
      results.push(cached);
    } else {
      uncached.push(kw);
    }
  }

  if (uncached.length === 0) return results;

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Google Ads rate limit reached (500/day)");
  }

  const accessToken = await loadAccessToken();

  // Batch up to 20 keywords per API call
  const batches: string[][] = [];
  for (let i = 0; i < uncached.length; i += 20) {
    batches.push(uncached.slice(i, i + 20));
  }

  for (const batch of batches) {
    const requestBody = {
      language: `languageConstants/${lang}`,
      geoTargetConstants: [`geoTargetConstants/${geoToTargetId(geo)}`],
      keywordSeed: { keywords: batch },
      keywordPlanNetwork: "GOOGLE_SEARCH",
      includeAdultKeywords: false,
    };

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}:generateKeywordIdeas`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": devToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new ProviderError(PROVIDER, `Google Ads API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { results?: any[] };
    const rows = data.results ?? [];

    for (const row of rows) {
      const kw = (row.text ?? "").toLowerCase().trim();
      if (!kw) continue;

      const monthly = row.keywordIdeaMetrics?.avgMonthlySearches ?? null;
      const comp = row.keywordIdeaMetrics?.competition ?? null;
      const compIdx = row.keywordIdeaMetrics?.competitionIndex ?? null;
      const lowBid = row.keywordIdeaMetrics?.lowTopOfPageBidMicros ?? null;
      const highBid = row.keywordIdeaMetrics?.highTopOfPageBidMicros ?? null;
      const breakdown = (row.keywordIdeaMetrics?.monthlySearchVolumes ?? []).map((m: any) => ({
        year: m.year,
        month: m.month,
        searches: Number(m.monthlySearches ?? 0),
      }));

      const result: KeywordVolumeResult = {
        keyword: kw,
        avgMonthlySearches: dp(monthly !== null ? Number(monthly) : null, PROVIDER, "high", TTL_MS, "Google Ads Keyword Planner"),
        competition: dp(comp, PROVIDER, "high", TTL_MS),
        competitionIndex: dp(compIdx !== null ? Number(compIdx) : null, PROVIDER, "high", TTL_MS, "0=low, 100=high"),
        lowTopOfPageBidMicros: dp(lowBid !== null ? Number(lowBid) / 1_000_000 : null, PROVIDER, "high", TTL_MS, "USD"),
        highTopOfPageBidMicros: dp(highBid !== null ? Number(highBid) / 1_000_000 : null, PROVIDER, "high", TTL_MS, "USD"),
        monthlyBreakdown: dp(breakdown, PROVIDER, "high", TTL_MS, "last 12 months"),
      };

      cacheSet(`${PROVIDER}:${geo}:${kw}`, result, TTL_MS);
      results.push(result);
    }
  }

  return results;
}

/** Maps ISO country code to Google Ads geo target constant ID */
function geoToTargetId(geo: string): number {
  const MAP: Record<string, number> = {
    US: 2840, GB: 2826, IN: 2356, CA: 2124, AU: 2036,
    DE: 2276, FR: 2250, JP: 2392, BR: 2076, SG: 2702,
    NZ: 2554, ZA: 2710, AE: 2784, PH: 2608, NG: 2566,
  };
  return MAP[geo.toUpperCase()] ?? 2840; // default US
}
