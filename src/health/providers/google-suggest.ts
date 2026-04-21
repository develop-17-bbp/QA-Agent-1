/**
 * Google Suggest — free autocomplete endpoint.
 *
 * Returns real long-tail completions that Google shows in its search box.
 * These are real queries people type, not LLM guesses. No API key required.
 *
 * Endpoint (public, unauthenticated):
 *   https://www.google.com/complete/search?client=chrome&gl=&hl=&q=...
 *
 * We deliberately use www.google.com (not suggestqueries.google.com): the
 * latter ignores the `gl` param and geolocates by IP, which on an Indian-IP
 * server returns Noida/CP/Indiranagar suggestions even when the caller asked
 * for US. www.google.com with client=chrome respects `gl` correctly.
 *
 * Response format: ["query", ["suggestion1", "suggestion2", ...], ...]
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGetJson } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "google-suggest";
registerLimit(PROVIDER, 300, 60_000); // ~5 req/s — well within soft limits
const TTL_MS = 24 * 60 * 60 * 1000;   // 24h cache — suggestions don't change often

export async function fetchSuggestions(keyword: string, locale = "en", country = ""): Promise<DataPoint<string[]>> {
  const clean = keyword.trim().toLowerCase();
  if (!clean) throw new ProviderError(PROVIDER, "Empty keyword");

  const gl = country.trim().toLowerCase(); // ISO 2-letter, lowercased for Google's gl param
  const cacheKey = `${PROVIDER}:${locale}:${gl}:${clean}`;
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  // gl = country hint (two-letter ISO). Without it Google geolocates by IP,
  // which on an Indian dev machine leaks Noida/India-biased suggestions even
  // when the user explicitly picked another region. NOTE: we intentionally
  // hit www.google.com rather than suggestqueries.google.com — the latter
  // ignores `gl` and always uses IP geolocation.
  const glParam = gl ? `&gl=${encodeURIComponent(gl)}` : "";
  const url = `https://www.google.com/complete/search?client=chrome&hl=${encodeURIComponent(locale)}${glParam}&q=${encodeURIComponent(clean)}`;
  const data = await httpGetJson<[string, string[]]>(url);
  if (!data || !Array.isArray(data) || !Array.isArray(data[1])) {
    throw new ProviderError(PROVIDER, "Unexpected response shape");
  }

  const suggestions = data[1].filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 20);
  cacheSet(cacheKey, suggestions, TTL_MS);
  return dp(suggestions, PROVIDER, "high", TTL_MS);
}

/**
 * Expand a seed keyword with question-shaped autocomplete completions
 * (who / what / why / how / when / where / is / can / will / do).
 */
export async function fetchQuestionSuggestions(keyword: string, locale = "en", country = ""): Promise<DataPoint<string[]>> {
  const prefixes = ["who", "what", "why", "how", "when", "where", "is", "can", "will", "do"];
  const results: string[] = [];
  for (const p of prefixes) {
    try {
      const sugg = await fetchSuggestions(`${p} ${keyword}`, locale, country);
      for (const s of sugg.value) {
        if (s.includes("?") || /^(who|what|why|how|when|where|is|can|will|do)\b/i.test(s)) {
          results.push(s);
        }
      }
      if (results.length >= 30) break;
    } catch {
      // continue with next prefix
    }
  }
  const unique = Array.from(new Set(results)).slice(0, 30);
  return dp(unique, PROVIDER, "high", TTL_MS, "from question-prefix expansion");
}
