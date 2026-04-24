/**
 * GSC Auto-Track — register every GSC query with meaningful impressions
 * into the position-tracking history DB without user intervention.
 *
 * The gap this closes: today users have to manually add each keyword
 * they care about to /position-tracking before we start building rank
 * history. Most operators only add what they already know about; their
 * long tail of "queries we ALREADY rank for but aren't tracking" silently
 * disappears when GSC's 16-month window rolls over.
 *
 * This module solves that by sweeping every verified GSC property on the
 * user's account, pulling the last 28 days of queries, and adding every
 * query with >= impressionsFloor impressions as a tracked pair.
 *
 * Safety:
 *   - Hard cap on how many new pairs get added in one sweep (default 500).
 *   - Skips pairs already tracked (loadTrackedPairs dedup).
 *   - Floor defaults to 10 impressions so we don't pollute the tracker
 *     with single-impression noise.
 *   - Operator must explicitly invoke (no automatic background fire on
 *     server boot).
 */

import { queryGscAnalytics, listGscSites } from "../providers/google-search-console.js";
import { getConnectionStatus } from "../providers/google-auth.js";
import { addTrackedPair, loadTrackedPairs } from "../position-db.js";

export interface GscAutoTrackOptions {
  /** Minimum impressions a query must have accumulated over the window to
   *  be auto-tracked. Default 10 — tuned to exclude noise. */
  impressionsFloor?: number;
  /** Maximum number of new pairs added in a single sweep. Default 500. */
  maxNewPairs?: number;
  /** Lookback window in days (GSC max 16 months). Default 28. */
  daysBack?: number;
  /** When true, only inspect sites whose hostname matches one of these
   *  (comma-separated or array). When not set, scan every verified site. */
  filterHosts?: string[];
}

export interface GscAutoTrackResult {
  scanned: { siteUrl: string; queriesFound: number; addedCount: number; skipped: number }[];
  totalAdded: number;
  totalScanned: number;
  totalSkipped: number;
  reason?: string;
}

function hostOfGscSite(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length).toLowerCase();
  try { return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export async function autoTrackGscQueries(options: GscAutoTrackOptions = {}): Promise<GscAutoTrackResult> {
  const impressionsFloor = options.impressionsFloor ?? 10;
  const maxNewPairs = options.maxNewPairs ?? 500;
  const daysBack = Math.max(7, Math.min(options.daysBack ?? 28, 90));

  const auth = await getConnectionStatus();
  if (!auth.connected) {
    return { scanned: [], totalAdded: 0, totalScanned: 0, totalSkipped: 0, reason: "Google not connected — connect in /integrations" };
  }
  const sites = await listGscSites();
  if (!sites || sites.length === 0) {
    return { scanned: [], totalAdded: 0, totalScanned: 0, totalSkipped: 0, reason: "No verified GSC properties on this Google account" };
  }

  const filter = options.filterHosts?.map((h) => h.toLowerCase().replace(/^www\./, ""));
  const targetSites = filter && filter.length > 0
    ? sites.filter((s) => {
        const h = hostOfGscSite(s.siteUrl);
        return filter.some((f) => h === f || h.endsWith("." + f) || f.endsWith("." + h));
      })
    : sites;

  if (targetSites.length === 0) {
    return { scanned: [], totalAdded: 0, totalScanned: 0, totalSkipped: 0, reason: "filterHosts matched no verified properties" };
  }

  const existing = await loadTrackedPairs();
  const existingKey = new Set(existing.map((p) => `${p.domain.toLowerCase()}::${p.keyword.toLowerCase()}`));

  const endDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - (daysBack + 3) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const perSite: GscAutoTrackResult["scanned"] = [];
  let totalAdded = 0;

  for (const site of targetSites) {
    if (totalAdded >= maxNewPairs) break;
    const domainForTracker = hostOfGscSite(site.siteUrl);
    if (!domainForTracker) continue;
    let queriesFound = 0;
    let addedCount = 0;
    let skipped = 0;
    try {
      const rows = await queryGscAnalytics({
        siteUrl: site.siteUrl,
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: 2000,
      });
      queriesFound = rows.length;
      for (const r of rows) {
        if (totalAdded >= maxNewPairs) break;
        const q = (r.keys[0] ?? "").trim();
        const imp = r.impressions?.value ?? 0;
        if (!q || imp < impressionsFloor) { skipped++; continue; }
        const key = `${domainForTracker}::${q.toLowerCase()}`;
        if (existingKey.has(key)) { skipped++; continue; }
        try {
          await addTrackedPair(domainForTracker, q);
          existingKey.add(key);
          addedCount++;
          totalAdded++;
        } catch {
          skipped++;
        }
      }
    } catch {
      /* site-level error — record 0 adds and continue to next site */
    }
    perSite.push({ siteUrl: site.siteUrl, queriesFound, addedCount, skipped });
  }

  return {
    scanned: perSite,
    totalAdded,
    totalScanned: perSite.reduce((s, r) => s + r.queriesFound, 0),
    totalSkipped: perSite.reduce((s, r) => s + r.skipped, 0),
  };
}
