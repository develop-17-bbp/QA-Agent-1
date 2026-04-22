/**
 * Response-level in-memory cache — keyed on (endpoint + clientKey + payload
 * hash) so repeat requests for the same thing within the TTL window skip
 * the expensive work entirely.
 *
 * Why at the endpoint boundary and not at the provider: provider-level
 * caches already exist (rate-limit.ts has cacheGet/cacheSet) but they're
 * per-provider. A single /api/council call fans out to 4-5 providers and
 * the total still takes seconds because each provider's cache lookup is
 * its own network-or-compute hop. Cacheing the whole response means a
 * user flipping between tabs or hitting refresh sees <50ms instead of
 * 8-45s.
 *
 * Concurrency: if two callers ask for the same thing at the same time
 * (user double-clicks a button, or two tabs hit the same /api/council),
 * we collapse them onto a single in-flight promise. Otherwise you'd do
 * the work twice and the second caller would miss the cache window.
 *
 * TTL default: 5 minutes. Callers can override per-endpoint — e.g.
 * Council uses 5 min, keyword-research uses 10 min (keywords drift slower
 * than SERP ranks), brand-mentions uses 15 min (RSS feeds refresh hourly).
 *
 * No disk persistence. Cache is lost on restart, which is fine —
 * correctness > warm cache after deploy. The durable layer is the
 * per-provider rate-limit cache which is already disk-backed.
 */

import { createHash } from "node:crypto";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

let hits = 0;
let misses = 0;
let collapsedWaits = 0;

function now(): number { return Date.now(); }

/** Build a stable cache key from endpoint + arbitrary payload. The hash
 *  is deterministic across restarts (process-independent). */
export function buildCacheKey(endpoint: string, payload: unknown, clientKey = "_"): string {
  const normalized = JSON.stringify(payload, Object.keys(payload && typeof payload === "object" ? (payload as object) : {}).sort());
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 16);
  return `${endpoint}::${clientKey}::${hash}`;
}

/** Primary helper — wrap any async compute in this. If a fresh cached
 *  value exists, it's returned instantly. If an identical call is already
 *  in flight, both callers share its promise (no duplicate work). */
export async function cachedResponse<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<{ value: T; hit: boolean; fromInflight: boolean }> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > now()) {
    hits++;
    return { value: entry.value, hit: true, fromInflight: false };
  }
  // Collapse concurrent duplicate callers onto a single promise.
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    collapsedWaits++;
    const value = await pending;
    return { value, hit: false, fromInflight: true };
  }

  misses++;
  const promise = compute()
    .then((value) => {
      cache.set(key, { value, expiresAt: now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  const value = await promise;
  return { value, hit: false, fromInflight: false };
}

/** Invalidate a single key — used when a write endpoint should bust a
 *  corresponding read endpoint (e.g. saving runtime keys busts status). */
export function invalidateCacheKey(key: string): void {
  cache.delete(key);
}

/** Invalidate every key whose endpoint matches the prefix. Useful after
 *  mutations — e.g. POST /api/integrations/keys invalidates /api/integrations/*. */
export function invalidateByPrefix(endpointPrefix: string): number {
  let n = 0;
  for (const k of cache.keys()) {
    if (k.startsWith(`${endpointPrefix}::`)) { cache.delete(k); n++; }
  }
  return n;
}

/** Periodic prune of expired entries so the map doesn't grow unbounded
 *  in long-running processes. Fine to call on every miss; amortized cheap. */
export function pruneExpired(): number {
  const t = now();
  let n = 0;
  for (const [k, v] of cache.entries()) {
    if (v.expiresAt <= t) { cache.delete(k); n++; }
  }
  return n;
}

export function getCacheStats(): { size: number; hits: number; misses: number; collapsedWaits: number; hitRate: number } {
  const total = hits + misses;
  return {
    size: cache.size,
    hits,
    misses,
    collapsedWaits,
    hitRate: total === 0 ? 0 : +(hits / total).toFixed(3),
  };
}

export function clearCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
  collapsedWaits = 0;
}
