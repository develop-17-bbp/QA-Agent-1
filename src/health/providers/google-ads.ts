/**
 * Google Ads Keyword Planner — real monthly search volume.
 *
 * Uses the Google Ads REST API v21 KeywordPlanIdeaService.
 *
 * Token strategy (tries in order):
 *   1. Shared Google OAuth token (data/google-tokens.json) — if user
 *      connected Google via /google-connections (adwords scope is included).
 *   2. Dedicated Google Ads OAuth (GOOGLE_ADS_CLIENT_ID / SECRET /
 *      REFRESH_TOKEN in .env) — standalone fallback.
 *
 * Required in .env regardless of token source:
 *   GOOGLE_ADS_DEVELOPER_TOKEN — from Google Ads API Center
 *   GOOGLE_ADS_CUSTOMER_ID     — 10-digit number from Ads dashboard
 *
 * Optional:
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — set to MCC ID if using a Manager Account
 *   GOOGLE_ADS_CLIENT_ID         — fallback OAuth client
 *   GOOGLE_ADS_CLIENT_SECRET     — fallback OAuth secret
 *   GOOGLE_ADS_REFRESH_TOKEN     — fallback refresh token
 *
 * Rate limits: 15,000 operations/day on basic access (free tier).
 * Cache: 24 hours per keyword to stay well within limits.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";
import { getAccessToken } from "./google-auth.js";

const PROVIDER = "google-ads";
registerLimit(PROVIDER, 500, 24 * 60 * 60 * 1000);
const TTL_MS = 24 * 60 * 60 * 1000;

export interface KeywordVolumeResult {
  keyword: string;
  avgMonthlySearches: DataPoint<number | null>;
  competition: DataPoint<string | null>;
  competitionIndex: DataPoint<number | null>;
  lowTopOfPageBidMicros: DataPoint<number | null>;
  highTopOfPageBidMicros: DataPoint<number | null>;
  monthlyBreakdown: DataPoint<{ year: number; month: number; searches: number }[]>;
}

// ── Token resolution ────────────────────────────────────────────────────────

let _fallbackToken: { value: string; expiresAt: number } | null = null;

/** Try shared token first, fall back to dedicated Ads OAuth credentials. */
async function resolveAccessToken(): Promise<string> {
  // 1. Try the shared GSC/GA4 token (includes adwords scope if reconnected)
  const shared = await getAccessToken();
  if (shared) return shared;

  // 2. Fall back to dedicated Ads credentials from .env
  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new ProviderError(
      PROVIDER,
      "Google not connected. Either connect at /google-connections, or set GOOGLE_ADS_CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN in .env",
    );
  }

  if (_fallbackToken && Date.now() < _fallbackToken.expiresAt - 60_000) {
    return _fallbackToken.value;
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
  _fallbackToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fallbackToken.value;
}

// ── Public API ──────────────────────────────────────────────────────────────

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
      "Set GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID in .env",
    );
  }

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.trim().replace(/-/g, "");
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim().replace(/-/g, "") || customerId;

  // Check cache
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

  const accessToken = await resolveAccessToken();

  // Batch up to 20 keywords per API call
  const batches: string[][] = [];
  for (let i = 0; i < uncached.length; i += 20) {
    batches.push(uncached.slice(i, i + 20));
  }

  for (const batch of batches) {
    const res = await fetch(
      `https://googleads.googleapis.com/v21/customers/${customerId}:generateKeywordIdeas`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": devToken,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: `languageConstants/${lang}`,
          geoTargetConstants: [`geoTargetConstants/${geoToTargetId(geo)}`],
          keywordSeed: { keywords: batch },
          keywordPlanNetwork: "GOOGLE_SEARCH",
          includeAdultKeywords: false,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new ProviderError(PROVIDER, `Google Ads API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { results?: any[] };
    for (const row of data.results ?? []) {
      const kw = (row.text ?? "").toLowerCase().trim();
      if (!kw) continue;

      const m = row.keywordIdeaMetrics ?? {};
      const result: KeywordVolumeResult = {
        keyword: kw,
        avgMonthlySearches: dp(m.avgMonthlySearches != null ? Number(m.avgMonthlySearches) : null, PROVIDER, "high", TTL_MS, "Google Ads Keyword Planner"),
        competition: dp(m.competition ?? null, PROVIDER, "high", TTL_MS),
        competitionIndex: dp(m.competitionIndex != null ? Number(m.competitionIndex) : null, PROVIDER, "high", TTL_MS, "0=low, 100=high"),
        lowTopOfPageBidMicros: dp(m.lowTopOfPageBidMicros != null ? Number(m.lowTopOfPageBidMicros) / 1_000_000 : null, PROVIDER, "high", TTL_MS, "USD"),
        highTopOfPageBidMicros: dp(m.highTopOfPageBidMicros != null ? Number(m.highTopOfPageBidMicros) / 1_000_000 : null, PROVIDER, "high", TTL_MS, "USD"),
        monthlyBreakdown: dp(
          (m.monthlySearchVolumes ?? []).map((v: any) => ({ year: v.year, month: v.month, searches: Number(v.monthlySearches ?? 0) })),
          PROVIDER, "high", TTL_MS, "last 12 months",
        ),
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
  return MAP[geo.toUpperCase()] ?? 2840;
}
