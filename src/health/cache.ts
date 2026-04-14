/**
 * Generic TTL cache utilities for QA-Agent
 *
 * ReportCache — LRU cache for parsed crawl reports (keyed by runId)
 * LlmCache   — Content-hash cache for LLM responses (keyed by prompt hash)
 */

import type { SiteHealthReport } from "./types.js";

// ── Generic TTL Map ──────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  accessedAt: number;
}

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    entry.accessedAt = Date.now();
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evict least-recently-accessed if full
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.map) {
        if (v.accessedAt < oldestTime) {
          oldestTime = v.accessedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs, accessedAt: Date.now() });
  }

  invalidate(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ── Report Cache ─────────────────────────────────────────────────────────────

export interface CachedReportData {
  reports: SiteHealthReport[];
  generatedAt: string;
}

const REPORT_MAX_ENTRIES = 20;
const REPORT_TTL_MS = 5 * 60 * 1000; // 5 minutes

const reportCache = new TtlCache<CachedReportData>(REPORT_MAX_ENTRIES, REPORT_TTL_MS);

export const ReportCache = {
  get(runId: string): CachedReportData | undefined {
    return reportCache.get(runId);
  },
  set(runId: string, data: CachedReportData): void {
    reportCache.set(runId, data);
  },
  invalidate(runId: string): boolean {
    return reportCache.invalidate(runId);
  },
  clear(): void {
    reportCache.clear();
  },
  get size(): number {
    return reportCache.size;
  },
};

// ── LLM Response Cache ───────────────────────────────────────────────────────

const LLM_MAX_ENTRIES = 100;
const LLM_TTL_MS = 15 * 60 * 1000; // 15 minutes

const llmCache = new TtlCache<string>(LLM_MAX_ENTRIES, LLM_TTL_MS);

/** Fast content hash from prompt — uses prefix+suffix+length to avoid hashing megabytes. */
function promptHash(prompt: string): string {
  const prefix = prompt.slice(0, 500);
  const suffix = prompt.slice(-200);
  const len = prompt.length;
  // Simple FNV-1a-like hash on the combined string
  let h = 0x811c9dc5;
  const combined = `${len}:${prefix}::${suffix}`;
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const LlmCache = {
  get(prompt: string): string | undefined {
    return llmCache.get(promptHash(prompt));
  },
  set(prompt: string, response: string): void {
    llmCache.set(promptHash(prompt), response);
  },
  invalidate(prompt: string): boolean {
    return llmCache.invalidate(promptHash(prompt));
  },
  clear(): void {
    llmCache.clear();
  },
  get size(): number {
    return llmCache.size;
  },
};
