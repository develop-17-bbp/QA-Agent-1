/**
 * Google Ads Keyword Planner — real monthly search volume.
 *
 * Uses the Google Ads REST API v17 KeywordPlanIdeaService.
 * This is the ONLY fully free source of real keyword volume data.
 *
 * Google Ads uses its OWN OAuth credentials — completely separate from
 * the GSC / GA4 OAuth connection. Do NOT reuse those tokens here.
 *
 * Setup (one-time):
 *   1. Create / use a Google Ads account at ads.google.com (no spend required)
 *   2. Apply for a developer token:
 *      https://developers.google.com/google-ads/api/docs/get-started/dev-token
 *   3. Create OAuth credentials for "Desktop app" in the SAME Google Cloud
 *      project that has the Google Ads API enabled:
 *      https://console.cloud.google.com/apis/credentials
 *   4. Get a refresh token via OAuth Playground:
 *      https://developers.google.com/oauthplayground
 *      — scope: https://www.googleapis.com/auth/adwords
 *   5. Add ALL of these to .env:
 *        GOOGLE_ADS_DEVELOPER_TOKEN=your_dev_token
 *        GOOGLE_ADS_CUSTOMER_ID=1234567890
 *        GOOGLE_ADS_CLIENT_ID=your_oauth_client_id.apps.googleusercontent.com
 *        GOOGLE_ADS_CLIENT_SECRET=your_oauth_client_secret
 *        GOOGLE_ADS_REFRESH_TOKEN=your_refresh_token
 *
 * Rate limits: 15,000 operations/day on basic access (free tier).
 * Cache: 24 hours per keyword to stay well within limits.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

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

// In-memory cache for the current access token
let _cachedToken: { value: string; expiresAt: number } | null = null;

async function loadAccessToken(): Promise<string> {
  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new ProviderError(
      PROVIDER,
      "Set GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_REFRESH_TOKEN in .env — see src/health/providers/google-ads.ts for setup instructions",
    );
  }

  // Return cached token if still valid (60s buffer)
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.value;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new ProviderError(PROVIDER, `Google Ads token refresh failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  _cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _cachedToken.value;
}

export function isGoogleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() &&
    process.env.GOOGLE_ADS_CUSTOMER_ID?.trim() &&
    process.env.GOOGLE_ADS_CLIENT_ID?.trim() &&
    process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim()
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

    // If using a Manager Account (MCC), login-customer-id must be the MCC ID
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim().replace(/-/g, "") || customerId;

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}:generateKeywordIdeas`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": devToken,
          "login-customer-id": loginCustomerId,
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
