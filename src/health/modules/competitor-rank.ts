/**
 * Competitor Rank Tracker — live SERP position for competitor (domain, keyword)
 * pairs using DuckDuckGo + Brave as two independent signals. GSC is not
 * applicable (we don't own the competitor's property), so ranks come from
 * two public SERP sources.
 *
 * Honest framing: DDG and Brave ranks correlate ~0.7 with Google rank.
 * Use them for *trend* and *delta*, not absolute "you rank #X on Google".
 * When DDG and Brave disagree by >10 positions, we flag it so the SEO team
 * can treat the data point as noisy.
 *
 * Storage: the existing position-db (JSON file) with isCompetitor=true.
 */

import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { ddgRegionCode } from "../providers/geo-targets.js";
import { findDomainRankBrave, isBraveConfigured } from "../providers/brave-search.js";
import {
  loadTrackedPairs,
  saveTrackedPairs,
  appendSnapshot,
  readHistory,
  type TrackedPair,
  type PositionSnapshot,
} from "../position-db.js";

function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function addCompetitorPair(domain: string, keyword: string, regionCode = "US"): Promise<void> {
  const d = cleanDomain(domain);
  const k = keyword.trim();
  if (!d || !k) throw new Error("domain and keyword required");
  const pairs = await loadTrackedPairs();
  const exists = pairs.some((p) => p.domain === d && p.keyword === k && p.isCompetitor === true);
  if (exists) return;
  pairs.push({ domain: d, keyword: k, isCompetitor: true, regionCode: regionCode.toUpperCase() });
  await saveTrackedPairs(pairs);
}

export async function removeCompetitorPair(domain: string, keyword: string): Promise<void> {
  const d = cleanDomain(domain);
  const k = keyword.trim();
  const pairs = await loadTrackedPairs();
  const filtered = pairs.filter((p) => !(p.domain === d && p.keyword === k && p.isCompetitor === true));
  await saveTrackedPairs(filtered);
}

export async function listCompetitorPairs(): Promise<TrackedPair[]> {
  const pairs = await loadTrackedPairs();
  return pairs.filter((p) => p.isCompetitor === true);
}

// ── Live rank check ─────────────────────────────────────────────────────────

export interface CompetitorRankResult {
  domain: string;
  keyword: string;
  regionCode: string;
  ddgRank: number | null;
  braveRank: number | null;
  discrepancy: boolean;
  checkedAt: string;
  errors: Partial<Record<"ddg" | "brave", string>>;
}

function findDomainInResults(results: Array<{ url: string; position?: number }>, domain: string): number | null {
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || !r.url) continue;
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
      if (host === domain || host.endsWith(`.${domain}`)) {
        return typeof r.position === "number" ? r.position : i + 1;
      }
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Check a competitor's rank RIGHT NOW (no persistence). Returns DDG and Brave
 * ranks in parallel plus a discrepancy flag. When Brave is not configured,
 * only DDG is returned and braveRank is null.
 */
export async function checkCompetitorRank(
  domain: string,
  keyword: string,
  regionCode = "US",
): Promise<CompetitorRankResult> {
  const d = cleanDomain(domain);
  const k = keyword.trim();
  const region = regionCode.toUpperCase();
  const errors: CompetitorRankResult["errors"] = {};

  const [ddgRes, braveRes] = await Promise.allSettled([
    searchSerp(k, ddgRegionCode(region)),
    isBraveConfigured() ? findDomainRankBrave(k, d, region) : Promise.reject(new Error("brave-not-configured")),
  ]);

  let ddgRank: number | null = null;
  if (ddgRes.status === "fulfilled") {
    ddgRank = findDomainInResults(ddgRes.value.results, d);
  } else {
    errors.ddg = ddgRes.reason instanceof Error ? ddgRes.reason.message : String(ddgRes.reason);
  }

  let braveRank: number | null = null;
  if (braveRes.status === "fulfilled") {
    braveRank = braveRes.value;
  } else if (isBraveConfigured()) {
    errors.brave = braveRes.reason instanceof Error ? braveRes.reason.message : String(braveRes.reason);
  }

  const discrepancy =
    ddgRank !== null && braveRank !== null && Math.abs(ddgRank - braveRank) > 10;

  return {
    domain: d,
    keyword: k,
    regionCode: region,
    ddgRank,
    braveRank,
    discrepancy,
    checkedAt: new Date().toISOString(),
    errors,
  };
}

/**
 * Check rank + append a daily snapshot to the history file. Safe to call
 * multiple times per day — appendSnapshot() deduplicates by date.
 */
export async function checkAndRecord(domain: string, keyword: string, regionCode = "US"): Promise<CompetitorRankResult> {
  const result = await checkCompetitorRank(domain, keyword, regionCode);
  const primary = result.ddgRank ?? result.braveRank; // prefer DDG as the main rank column
  const snapshot: PositionSnapshot = {
    at: todayIso(),
    position: primary,
    clicks: 0,
    impressions: 0,
    ctr: 0,
    ddgRank: result.ddgRank,
    braveRank: result.braveRank,
    discrepancy: result.discrepancy,
    regionCode: result.regionCode,
  };
  await appendSnapshot(result.domain, result.keyword, snapshot);
  return result;
}

// ── Stats + history ─────────────────────────────────────────────────────────

export interface CompetitorStats {
  domain: string;
  keyword: string;
  regionCode: string;
  latest: PositionSnapshot | null;
  delta7d: number | null;
  delta30d: number | null;
  best: number | null;
  worst: number | null;
  snapshotCount: number;
}

function deltaByDays(history: PositionSnapshot[], days: number): number | null {
  if (history.length < 2) return null;
  const latest = history.at(-1);
  if (!latest || latest.position === null) return null;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  // Find the first snapshot older than cutoff with a non-null position
  const older = history
    .filter((s) => s.position !== null && Date.parse(s.at) <= cutoffMs)
    .at(-1);
  if (!older || older.position === null) return null;
  // Positive delta = improved (rank went from 20 to 5, delta = +15)
  return older.position - latest.position;
}

export async function getCompetitorStats(domain: string, keyword: string): Promise<CompetitorStats> {
  const pairs = await listCompetitorPairs();
  const pair = pairs.find((p) => p.domain === domain && p.keyword === keyword);
  const history = await readHistory(domain, keyword);
  const positions = history.map((s) => s.position).filter((p): p is number => p !== null);
  return {
    domain,
    keyword,
    regionCode: pair?.regionCode ?? "US",
    latest: history.at(-1) ?? null,
    delta7d: deltaByDays(history, 7),
    delta30d: deltaByDays(history, 30),
    best: positions.length ? Math.min(...positions) : null,
    worst: positions.length ? Math.max(...positions) : null,
    snapshotCount: history.length,
  };
}

export async function getAllCompetitorStats(): Promise<CompetitorStats[]> {
  const pairs = await listCompetitorPairs();
  return Promise.all(pairs.map((p) => getCompetitorStats(p.domain, p.keyword)));
}

export async function getCompetitorHistory(domain: string, keyword: string): Promise<PositionSnapshot[]> {
  return readHistory(domain, keyword);
}
