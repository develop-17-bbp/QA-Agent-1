/**
 * Scheduled position tracking.
 *
 * Checks a set of (domain, keyword) pairs against DuckDuckGo's real SERP and
 * appends the observed rank to the local history DB. Run once on demand or
 * via a cron/scheduled job. Every invocation adds one sample per keyword, so
 * running it daily builds a ranking history.
 *
 * This is the ONLY way to get historical ranking data without paying — you
 * build it yourself over time. No free provider gives you "April 2023 rank
 * for keyword X" retroactively.
 */

import { searchSerp } from "./agentic/duckduckgo-serp.js";
import { recordKeywordPosition } from "./history-db.js";

export interface TrackPair {
  domain: string;
  keyword: string;
  /**
   * When false (default), matches the target domain OR any of its subdomains —
   * so tracking `wikipedia.org` for "claude shannon" correctly matches
   * `en.wikipedia.org`. When true, only an exact hostname equality counts.
   */
  strictHost?: boolean;
}

export interface TrackResult {
  domain: string;
  keyword: string;
  position: number | null;
  url: string | null;
  topUrl: string | null;
  error?: string;
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Host match for position tracking. Default mode treats the target as the
 * registrable parent and allows any subdomain to count (e.g. `wikipedia.org`
 * matches `en.wikipedia.org`). Strict mode requires an exact equality. The
 * old code used strict equality and silently returned `position: null` for
 * legitimate subdomain hits.
 */
function hostMatches(resultHost: string, targetHost: string, strict: boolean): boolean {
  if (!resultHost || !targetHost) return false;
  if (strict) return resultHost === targetHost;
  return resultHost === targetHost || resultHost.endsWith("." + targetHost);
}

/**
 * Check a single (domain, keyword) pair.
 */
export async function trackOne(pair: TrackPair): Promise<TrackResult> {
  const targetHost = pair.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const strict = pair.strictHost === true;
  try {
    const serp = await searchSerp(pair.keyword);
    const matchIdx = serp.results.findIndex((r) => hostMatches(normalizeHost(r.url), targetHost, strict));
    const matched = matchIdx >= 0 ? serp.results[matchIdx]! : null;
    const topResult = serp.results[0] ?? null;
    const result: TrackResult = {
      domain: targetHost,
      keyword: pair.keyword,
      position: matched ? matched.position ?? matchIdx + 1 : null,
      url: matched?.url ?? null,
      topUrl: topResult?.url ?? null,
    };
    await recordKeywordPosition(targetHost, pair.keyword, {
      position: result.position,
      url: result.url,
      topUrl: result.topUrl,
      provider: "duckduckgo",
    });
    return result;
  } catch (e) {
    return {
      domain: targetHost,
      keyword: pair.keyword,
      position: null,
      url: null,
      topUrl: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run a full sweep over a list of (domain, keyword) pairs with gentle pacing
 * so we don't trip DuckDuckGo's rate limiter.
 */
export async function trackBatch(pairs: TrackPair[], options?: { delayMs?: number }): Promise<TrackResult[]> {
  const delay = options?.delayMs ?? 1500;
  const results: TrackResult[] = [];
  for (const p of pairs) {
    const r = await trackOne(p);
    results.push(r);
    if (delay > 0) await new Promise((res) => setTimeout(res, delay));
  }
  return results;
}
