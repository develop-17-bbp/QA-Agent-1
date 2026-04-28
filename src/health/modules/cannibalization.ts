/**
 * Keyword Cannibalization Detector — finds queries where multiple
 * pages on YOUR site compete for the same SERP slot. SEMrush flags
 * this as "Internal competition"; QA-Agent does it from your own
 * Google Search Console data — every number is real and your-site-
 * specific (no third-party estimates).
 *
 * Mechanism:
 *   1. Pull (query, page) rows from GSC for the last 28 days.
 *   2. Group by query; flag any query with ≥ N distinct pages each
 *      receiving >= clicksFloor or >= impressionsFloor.
 *   3. For each conflict, identify the WINNER (best avg position
 *      with most impressions) and the LOSERS that should consolidate
 *      / canonicalize / 301 to the winner.
 *
 * Returned shape includes raw signals so the caller can write the
 * disavow / canonical / merge plan deterministically — no LLM
 * required for the detection layer.
 */

import { queryGscAnalytics, type GscQueryRow } from "../providers/google-search-console.js";

export interface CannibalizationCandidate {
  query: string;
  pages: Array<{
    url: string;
    clicks: number;
    impressions: number;
    avgPosition: number;
    ctr: number;
  }>;
  /** Page with the best blended position+impressions score. */
  winner: string;
  /** Pages that should consolidate / 301 / canonical to the winner. */
  losers: string[];
  /** Total impressions across all conflicting pages — bigger = more urgent. */
  combinedImpressions: number;
  /** Combined clicks lost to position dilution (heuristic). */
  combinedClicks: number;
  /** Severity label for the UI. */
  severity: "low" | "medium" | "high";
}

export interface CannibalizationResult {
  siteUrl: string;
  startDate: string;
  endDate: string;
  totalQueries: number;
  totalConflicts: number;
  candidates: CannibalizationCandidate[];
  /** Aggregate impressions across all conflicts — at-a-glance KPI. */
  totalImpressionsAtRisk: number;
  generatedAt: string;
}

export interface CannibalizationInput {
  siteUrl: string;
  /** Look-back days. Default 28 (matches GSC default + cron schedule). */
  windowDays?: number;
  /** Minimum number of distinct pages on the same query before flagging. Default 2. */
  minPages?: number;
  /** Each conflicting page must have at least this many impressions. Default 50. */
  impressionsFloor?: number;
  /** Or this many clicks. Default 1. */
  clicksFloor?: number;
  /** Cap rows returned. Default 50 highest-impression conflicts. */
  limit?: number;
}

function blendedScore(p: { avgPosition: number; impressions: number }): number {
  // Lower position is better. Blend with log-impressions so huge-volume
  // wins beat tiny-volume top-3s. Returns higher-is-better.
  const positional = Math.max(0, 100 - (p.avgPosition - 1) * 8);
  const volume = Math.log10(p.impressions + 1) * 10;
  return positional + volume;
}

function severityFor(c: { combinedImpressions: number; pages: { length: number } }): "low" | "medium" | "high" {
  if (c.combinedImpressions >= 5_000 || c.pages.length >= 4) return "high";
  if (c.combinedImpressions >= 500 || c.pages.length >= 3) return "medium";
  return "low";
}

export async function detectCannibalization(input: CannibalizationInput): Promise<CannibalizationResult> {
  const siteUrl = input.siteUrl.trim();
  if (!siteUrl) throw new Error("siteUrl is required");
  const windowDays = Math.max(7, Math.min(input.windowDays ?? 28, 90));
  const minPages = Math.max(2, input.minPages ?? 2);
  const impressionsFloor = Math.max(1, input.impressionsFloor ?? 50);
  const clicksFloor = Math.max(0, input.clicksFloor ?? 1);
  const limit = Math.max(5, Math.min(input.limit ?? 50, 200));

  const endDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows: GscQueryRow[] = await queryGscAnalytics({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["query", "page"],
    rowLimit: 25_000,
  });

  // Group by query → list of (page, metrics).
  const byQuery = new Map<string, Array<{ url: string; clicks: number; impressions: number; avgPosition: number; ctr: number }>>();
  for (const r of rows) {
    const query = r.keys[0] ?? "";
    const url = r.keys[1] ?? "";
    if (!query || !url) continue;
    const clicks = r.clicks.value ?? 0;
    const impressions = r.impressions.value ?? 0;
    const avgPosition = r.position.value ?? 0;
    const ctr = r.ctr.value ?? 0;
    if (impressions < impressionsFloor && clicks < clicksFloor) continue;
    const list = byQuery.get(query) ?? [];
    list.push({ url, clicks, impressions, avgPosition, ctr });
    byQuery.set(query, list);
  }

  const candidates: CannibalizationCandidate[] = [];
  for (const [query, pages] of byQuery) {
    if (pages.length < minPages) continue;
    // Choose the winner — highest blended score.
    let winner = pages[0]!;
    for (const p of pages) {
      if (blendedScore(p) > blendedScore(winner)) winner = p;
    }
    const losers = pages.filter((p) => p.url !== winner.url).map((p) => p.url);
    const combinedImpressions = pages.reduce((s, p) => s + p.impressions, 0);
    const combinedClicks = pages.reduce((s, p) => s + p.clicks, 0);
    const cand: CannibalizationCandidate = {
      query,
      pages: pages.sort((a, b) => blendedScore(b) - blendedScore(a)),
      winner: winner.url,
      losers,
      combinedImpressions,
      combinedClicks,
      severity: severityFor({ combinedImpressions, pages }),
    };
    candidates.push(cand);
  }

  // Sort by impressions-at-risk desc; cap to limit.
  candidates.sort((a, b) => b.combinedImpressions - a.combinedImpressions);
  const top = candidates.slice(0, limit);
  const totalImpressionsAtRisk = candidates.reduce((s, c) => s + c.combinedImpressions, 0);

  return {
    siteUrl,
    startDate,
    endDate,
    totalQueries: byQuery.size,
    totalConflicts: candidates.length,
    candidates: top,
    totalImpressionsAtRisk,
    generatedAt: new Date().toISOString(),
  };
}
