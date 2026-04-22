/**
 * Usage metering — observe-only for now, enforcement layer comes later.
 *
 * Appends one JSONL line per metered API call to artifacts/usage-metering.jsonl.
 * Each line records {ts, clientKey, endpoint, bytes, durationMs, ok, category}.
 * Aggregates in-memory per (clientKey, category) so the dashboard / quota
 * enforcement can query current-window counts without reparsing the log.
 *
 * When the multi-tenant / tiered-billing layer lands, the quota enforcer
 * reads `getUsageCount(clientKey, category, windowMs)` and compares against
 * the workspace's tier quota. Exceeded → 429 with a clear upgrade hint.
 *
 * For this commit: no enforcement, no errors — purely observability so we
 * can size the tier caps against real customer behavior before enforcing
 * them. "Measure before you cap."
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const LOG_FILE = path.resolve("artifacts", "usage-metering.jsonl");

/** Buckets that quotas will eventually be sized per-tier against. */
export type UsageCategory =
  | "keyword-lookup"       // keyword-research, keyword-magic, keyword-overview
  | "backlink-query"       // external-backlinks, backlinks-per-run
  | "site-audit"           // /api/run crawl
  | "form-test"            // form-tests/ad-hoc + configured
  | "serp-query"           // serp-search, position-tracking, competitor-rank
  | "daily-report"         // /api/daily-report trigger
  | "brand-mentions"       // RSS aggregator
  | "domain-authority"     // opr lookup
  | "llm-call"             // surfaced separately since it's expensive
  | "other";

export interface UsageEvent {
  ts: string;
  clientKey: string;
  endpoint: string;
  category: UsageCategory;
  bytes: number;
  durationMs: number;
  ok: boolean;
}

type Counter = Map<string, { count: number; firstSeen: number; lastSeen: number }>;
const counters: Record<UsageCategory, Counter> = {
  "keyword-lookup": new Map(),
  "backlink-query": new Map(),
  "site-audit": new Map(),
  "form-test": new Map(),
  "serp-query": new Map(),
  "daily-report": new Map(),
  "brand-mentions": new Map(),
  "domain-authority": new Map(),
  "llm-call": new Map(),
  "other": new Map(),
};

let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  dirReady = true;
}

/** Derive a stable key from the request. Until workspaces ship, fall back
 *  to IP. When multi-tenant lands, swap in the workspace id. */
export function deriveClientKey(req: { socket?: { remoteAddress?: string | null }; headers: Record<string, unknown> }): string {
  const fromHeader = typeof req.headers["x-workspace-id"] === "string" ? (req.headers["x-workspace-id"] as string) : "";
  if (fromHeader) return `workspace:${fromHeader}`;
  const forwarded = typeof req.headers["x-forwarded-for"] === "string" ? (req.headers["x-forwarded-for"] as string).split(",")[0]?.trim() : undefined;
  const ip = forwarded || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

/** Record a usage event. Non-blocking — IO errors are swallowed (telemetry
 *  must never cause a real response to fail). */
export function recordUsage(event: UsageEvent): void {
  // In-memory counter
  const c = counters[event.category];
  const now = Date.now();
  const current = c.get(event.clientKey) ?? { count: 0, firstSeen: now, lastSeen: now };
  current.count++;
  current.lastSeen = now;
  c.set(event.clientKey, current);

  // Async append to disk — don't await
  void (async () => {
    try {
      await ensureDir();
      await fs.appendFile(LOG_FILE, JSON.stringify(event) + "\n", "utf8");
    } catch {
      /* ignore */
    }
  })();
}

/** Current in-process count of events for this (client, category) — used
 *  by the future quota enforcer. Window is the lookback in ms (default
 *  24 hours). Purely in-memory; restarts reset the counters. Disk log is
 *  the durable record. */
export function getUsageCount(clientKey: string, category: UsageCategory, windowMs = 24 * 60 * 60_000): number {
  const c = counters[category];
  const entry = c.get(clientKey);
  if (!entry) return 0;
  if (Date.now() - entry.firstSeen > windowMs) return 0; // window expired; counter stale
  return entry.count;
}

/** Snapshot all counters — useful for debug + dashboard tile. */
export function getUsageSnapshot(): Record<UsageCategory, { clientKey: string; count: number; firstSeen: string; lastSeen: string }[]> {
  const out: Record<string, { clientKey: string; count: number; firstSeen: string; lastSeen: string }[]> = {};
  for (const [cat, map] of Object.entries(counters)) {
    out[cat] = [...map.entries()].map(([clientKey, v]) => ({
      clientKey,
      count: v.count,
      firstSeen: new Date(v.firstSeen).toISOString(),
      lastSeen: new Date(v.lastSeen).toISOString(),
    }));
  }
  return out as Record<UsageCategory, { clientKey: string; count: number; firstSeen: string; lastSeen: string }[]>;
}

/** Convenience wrapper that records a usage event around an async operation.
 *  Captures duration and success automatically. Use in endpoint handlers:
 *    return await withUsage({req, endpoint: "/api/keyword-research", category: "keyword-lookup"},
 *                          () => doTheWork());
 */
export async function withUsage<T>(
  meta: { req: { socket?: { remoteAddress?: string | null }; headers: Record<string, unknown> }; endpoint: string; category: UsageCategory },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const clientKey = deriveClientKey(meta.req);
  let ok = true;
  try {
    const result = await fn();
    return result;
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    const bytes = 0; // response-bytes measurement is up to the caller if they care
    recordUsage({
      ts: new Date().toISOString(),
      clientKey,
      endpoint: meta.endpoint,
      category: meta.category,
      bytes,
      durationMs: Date.now() - started,
      ok,
    });
  }
}
