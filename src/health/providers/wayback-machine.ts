/**
 * Internet Archive Wayback Machine — free historical snapshots.
 *
 * Two endpoints we use:
 *   - /wayback/available         → "is this URL archived?"
 *   - /cdx/search/cdx            → list of snapshots for a URL (with timestamp)
 *
 * No auth. Very generous rate limits but we cache aggressively because the
 * CDX endpoint can be slow.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGetJson, httpGetText } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "wayback-machine";
registerLimit(PROVIDER, 60, 60_000);
const TTL_MS = 24 * 60 * 60 * 1000;

interface AvailableResponse {
  archived_snapshots?: {
    closest?: { available: boolean; url: string; timestamp: string; status: string };
  };
}

export interface Snapshot {
  timestamp: string; // "20200115103000"
  url: string;       // archive.org/web/<ts>/<original>
  original: string;
}

/**
 * Quickest check: is there *any* snapshot near `timestamp`?
 */
export async function fetchClosestSnapshot(
  url: string,
  timestamp?: string,
): Promise<DataPoint<Snapshot | null>> {
  if (!url.trim()) throw new ProviderError(PROVIDER, "Empty URL");

  const cacheKey = `${PROVIDER}:closest:${timestamp ?? "now"}:${url}`;
  const cached = cacheGet<Snapshot | null>(cacheKey);
  if (cached !== undefined) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  const params = new URLSearchParams({ url });
  if (timestamp) params.set("timestamp", timestamp);
  const apiUrl = `https://archive.org/wayback/available?${params.toString()}`;
  const data = await httpGetJson<AvailableResponse>(apiUrl);
  const closest = data?.archived_snapshots?.closest;
  if (!closest?.available || !closest.url) {
    cacheSet(cacheKey, null, TTL_MS);
    return dp(null, PROVIDER, "high", TTL_MS, "no snapshots found");
  }
  const snap: Snapshot = { timestamp: closest.timestamp, url: closest.url, original: url };
  cacheSet(cacheKey, snap, TTL_MS);
  return dp(snap, PROVIDER, "high", TTL_MS);
}

/**
 * Fetch a list of historical snapshots for a URL (paginated CDX endpoint).
 *
 * Output is rolled up to one snapshot per year for trend views.
 */
export async function fetchSnapshotHistory(url: string, limit = 24): Promise<DataPoint<Snapshot[]>> {
  if (!url.trim()) throw new ProviderError(PROVIDER, "Empty URL");

  const cacheKey = `${PROVIDER}:history:${url}:${limit}`;
  const cached = cacheGet<Snapshot[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  const cdxUrl =
    `https://web.archive.org/cdx/search/cdx?` +
    new URLSearchParams({
      url,
      output: "json",
      fl: "timestamp,original,statuscode",
      filter: "statuscode:200",
      collapse: "timestamp:4", // one snapshot per year
      limit: String(limit),
    }).toString();

  const raw = await httpGetText(cdxUrl, { timeoutMs: 30_000 });
  if (!raw) {
    cacheSet(cacheKey, [], TTL_MS);
    return dp([], PROVIDER, "low", TTL_MS, "no response");
  }

  let rows: string[][];
  try {
    rows = JSON.parse(raw) as string[][];
  } catch {
    cacheSet(cacheKey, [], TTL_MS);
    return dp([], PROVIDER, "low", TTL_MS, "CDX parse failed");
  }

  // First row is a header
  const snapshots: Snapshot[] = rows
    .slice(1)
    .map((row) => ({
      timestamp: row[0] ?? "",
      original: row[1] ?? "",
      url: `https://web.archive.org/web/${row[0]}/${row[1]}`,
    }))
    .filter((s) => s.timestamp && s.original);

  cacheSet(cacheKey, snapshots, TTL_MS);
  return dp(snapshots, PROVIDER, "high", TTL_MS, `one per year, up to ${limit}`);
}
