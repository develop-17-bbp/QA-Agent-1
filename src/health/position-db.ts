/**
 * Position History DB — JSON-file storage for tracked keyword positions.
 *
 * Stores daily GSC position snapshots per (domain, keyword) pair.
 * Files live at: data/position-history/<domain>/<encoded-keyword>.json
 *
 * Each file is an array of PositionSnapshot, oldest-first.
 * Max 365 snapshots per pair (1 year of daily data).
 */

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface PositionSnapshot {
  /** ISO 8601 date string (YYYY-MM-DD) of the snapshot. */
  at: string;
  /** Average search position (1 = top). null if not in GSC / SERP. */
  position: number | null;
  clicks: number;
  impressions: number;
  ctr: number;
  /** For competitor tracking: DuckDuckGo rank. `position` above is GSC or the preferred source. */
  ddgRank?: number | null;
  /** For competitor tracking: Brave Search rank. */
  braveRank?: number | null;
  /** True when ddgRank and braveRank differ by >10 positions (noise signal). */
  discrepancy?: boolean;
  /** ISO 2-letter country code used at snapshot time. */
  regionCode?: string;
}

export interface TrackedPair {
  domain: string;
  keyword: string;
  /** When true, this is a competitor pair (rank checked via DDG/Brave, not GSC). */
  isCompetitor?: boolean;
  /** ISO 2-letter country code (defaults to "US" when unset). */
  regionCode?: string;
}

const DATA_ROOT = path.join(process.cwd(), "data", "position-history");
const TRACKED_FILE = path.join(process.cwd(), "data", "tracked-pairs.json");
const MAX_SNAPSHOTS = 365;

function encodeName(s: string): string {
  return encodeURIComponent(s.toLowerCase().trim()).replace(/%20/g, "_").slice(0, 120);
}

function domainDir(domain: string): string {
  return path.join(DATA_ROOT, encodeName(domain));
}

function keywordFile(domain: string, keyword: string): string {
  return path.join(domainDir(domain), `${encodeName(keyword)}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

// ── Tracked pairs ──────────────────────────────────────────────────────────

export async function loadTrackedPairs(): Promise<TrackedPair[]> {
  try {
    const raw = await readFile(TRACKED_FILE, "utf8");
    return JSON.parse(raw) as TrackedPair[];
  } catch {
    return [];
  }
}

export async function saveTrackedPairs(pairs: TrackedPair[]): Promise<void> {
  await ensureDir(path.dirname(TRACKED_FILE));
  // Deduplicate
  const seen = new Set<string>();
  const unique = pairs.filter(p => {
    const key = `${p.domain.toLowerCase()}::${p.keyword.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await writeFile(TRACKED_FILE, JSON.stringify(unique, null, 2), "utf8");
}

export async function addTrackedPair(domain: string, keyword: string, opts?: { isCompetitor?: boolean; regionCode?: string }): Promise<void> {
  const pairs = await loadTrackedPairs();
  pairs.push({
    domain: domain.trim(),
    keyword: keyword.trim(),
    isCompetitor: opts?.isCompetitor || undefined,
    regionCode: opts?.regionCode || undefined,
  });
  await saveTrackedPairs(pairs);
}

export async function removeTrackedPair(domain: string, keyword: string): Promise<void> {
  const pairs = await loadTrackedPairs();
  const filtered = pairs.filter(p => !(p.domain === domain && p.keyword === keyword));
  await saveTrackedPairs(filtered);
}

export async function listCompetitorPairs(): Promise<TrackedPair[]> {
  const pairs = await loadTrackedPairs();
  return pairs.filter((p) => p.isCompetitor === true);
}

// ── Snapshot I/O ───────────────────────────────────────────────────────────

export async function readHistory(domain: string, keyword: string): Promise<PositionSnapshot[]> {
  try {
    const raw = await readFile(keywordFile(domain, keyword), "utf8");
    return JSON.parse(raw) as PositionSnapshot[];
  } catch {
    return [];
  }
}

export async function appendSnapshot(
  domain: string,
  keyword: string,
  snapshot: PositionSnapshot,
): Promise<void> {
  await ensureDir(domainDir(domain));
  const history = await readHistory(domain, keyword);

  // Don't double-write the same date
  const today = snapshot.at.slice(0, 10);
  const alreadyHasToday = history.some(s => s.at.slice(0, 10) === today);
  if (alreadyHasToday) return;

  history.push(snapshot);
  // Trim to max
  if (history.length > MAX_SNAPSHOTS) history.splice(0, history.length - MAX_SNAPSHOTS);
  await writeFile(keywordFile(domain, keyword), JSON.stringify(history, null, 2), "utf8");
}

// ── Stats ─────────────────────────────────────────────────────────────────

export interface PositionStats {
  domain: string;
  keyword: string;
  latest: PositionSnapshot | null;
  best: number | null;
  worst: number | null;
  trend: "rising" | "falling" | "stable" | "new";
  snapshotCount: number;
}

export async function getStats(domain: string, keyword: string): Promise<PositionStats> {
  const history = await readHistory(domain, keyword);
  const latest = history.at(-1) ?? null;
  const positions = history.map(s => s.position).filter((p): p is number => p !== null);
  const best = positions.length ? Math.min(...positions) : null;
  const worst = positions.length ? Math.max(...positions) : null;

  let trend: PositionStats["trend"] = "new";
  if (history.length >= 3) {
    const recent = history.slice(-3).map(s => s.position).filter((p): p is number => p !== null);
    if (recent.length >= 2) {
      const delta = (recent.at(-1) ?? 0) - (recent[0] ?? 0);
      trend = delta < -2 ? "rising" : delta > 2 ? "falling" : "stable";
    }
  } else if (history.length > 0) {
    trend = "stable";
  }

  return { domain, keyword, latest, best, worst, trend, snapshotCount: history.length };
}

export async function getAllStats(): Promise<PositionStats[]> {
  const pairs = await loadTrackedPairs();
  return Promise.all(pairs.map(p => getStats(p.domain, p.keyword)));
}

// ── Bulk history for charting ─────────────────────────────────────────────

export interface HistorySeries {
  key: string;
  label: string;
  domain: string;
  keyword: string;
  points: { at: string; position: number | null; clicks: number; impressions: number }[];
}

export async function getHistoryForDomain(domain: string): Promise<HistorySeries[]> {
  const pairs = (await loadTrackedPairs()).filter(p => p.domain === domain);
  return Promise.all(
    pairs.map(async p => {
      const history = await readHistory(p.domain, p.keyword);
      return {
        key: `${p.domain}::${p.keyword}`,
        label: p.keyword,
        domain: p.domain,
        keyword: p.keyword,
        points: history.map(s => ({ at: s.at, position: s.position, clicks: s.clicks, impressions: s.impressions })),
      };
    }),
  );
}

export async function getHistoryForKeyword(domain: string, keyword: string): Promise<HistorySeries> {
  const history = await readHistory(domain, keyword);
  return {
    key: `${domain}::${keyword}`,
    label: keyword,
    domain,
    keyword,
    points: history.map(s => ({ at: s.at, position: s.position, clicks: s.clicks, impressions: s.impressions })),
  };
}
