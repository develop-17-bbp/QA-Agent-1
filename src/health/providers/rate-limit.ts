/**
 * Simple per-provider rate limiter + in-memory TTL cache.
 *
 * Each provider declares its free-tier budget and this module enforces it
 * across all callers in the current process. Values are cached so repeated
 * lookups (e.g. same keyword researched twice in an hour) don't burn quota.
 */

type Limiter = {
  windowMs: number;
  max: number;
  timestamps: number[];
};

const limiters = new Map<string, Limiter>();

/**
 * Register a provider with a rate limit budget. Safe to call multiple times.
 */
export function registerLimit(provider: string, max: number, windowMs: number): void {
  if (!limiters.has(provider)) {
    limiters.set(provider, { windowMs, max, timestamps: [] });
  }
}

/**
 * Check if a provider call is currently allowed. Consumes one token if so.
 * Returns `false` when the bucket is empty.
 */
export function tryConsume(provider: string): boolean {
  const l = limiters.get(provider);
  if (!l) return true; // unregistered → unlimited
  const now = Date.now();
  // prune expired timestamps
  while (l.timestamps.length > 0 && now - l.timestamps[0]! > l.windowMs) {
    l.timestamps.shift();
  }
  if (l.timestamps.length >= l.max) return false;
  l.timestamps.push(now);
  return true;
}

export function remaining(provider: string): number {
  const l = limiters.get(provider);
  if (!l) return Number.POSITIVE_INFINITY;
  const now = Date.now();
  let used = 0;
  for (const ts of l.timestamps) if (now - ts <= l.windowMs) used++;
  return Math.max(0, l.max - used);
}

// ── Provider response cache ─────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (cache.size > 500) {
    // naive prune: drop oldest 20% when cache grows large
    const keys = [...cache.keys()].slice(0, 100);
    for (const k of keys) cache.delete(k);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheSize(): number {
  return cache.size;
}
