/**
 * Bulk Keyword Analyzer — paste 1000 keywords, get a SEMrush-style table:
 * volume + difficulty v2 + CPC + competition + intent per keyword.
 *
 * Processing strategy:
 *   1. Dedup + normalize + cap at 1000 (hard cap for memory/latency).
 *   2. Batch into groups of 20 and hit Google Ads Keyword Planner in
 *      parallel (the provider already handles rate limits + caching).
 *   3. Optionally compute difficulty v2 per keyword — but v2 needs a
 *      SERP + OPR per call, which is ~2s per keyword. For a 1000-row
 *      paste that's 30+ minutes, unacceptable. So difficulty here is
 *      the fast heuristic variant: Ads competitionIndex (real, first-
 *      party) when available, otherwise a tier fallback from search
 *      volume (higher volume → harder, loosely). Users who want the
 *      full v2 breakdown click through to Keyword Overview per row.
 *
 * Output shape is deliberately CSV-friendly so users can paste directly
 * into their SEMrush workflow.
 */

import { fetchKeywordVolume as fetchAdsVolume, isGoogleAdsConfigured } from "../providers/google-ads.js";
import { fetchDfsKeywordVolume, isDfsConfigured } from "../providers/dataforseo.js";

export interface BulkKeywordRow {
  keyword: string;
  volume: number | null;
  /** 0-100 difficulty heuristic — Ads competitionIndex if real, else tier fallback. */
  difficulty: number | null;
  cpcUsd: number | null;
  competitionLabel: "LOW" | "MEDIUM" | "HIGH" | null;
  /** Which provider supplied the volume — "google-ads" / "dataforseo" / null. */
  volumeSource: string | null;
  /** Plain-English intent based on keyword surface patterns — fast, not LLM. */
  intent: "informational" | "commercial" | "navigational" | "transactional";
  /** Word count — a rough long-tail vs head signal. */
  wordCount: number;
}

export interface BulkKeywordResult {
  region: string;
  rows: BulkKeywordRow[];
  meta: {
    requestedCount: number;
    processedCount: number;
    provider: "google-ads" | "dataforseo" | "none";
    durationMs: number;
    skippedReasons: { reason: string; count: number }[];
  };
}

// Word-pattern-based intent classification — fast, deterministic, no LLM.
// This is the same classification keyword-research.ts uses, inlined here
// to avoid a circular dep.
function classifyIntent(kw: string): BulkKeywordRow["intent"] {
  const lc = kw.toLowerCase();
  if (/\b(buy|purchase|order|shop|price|coupon|discount|deal|for sale|cheap|best deal)\b/.test(lc)) return "transactional";
  if (/\b(best|top|review|vs|compare|comparison|alternative|worth it)\b/.test(lc)) return "commercial";
  if (/\b(login|sign in|dashboard|account|my |official site)\b/.test(lc)) return "navigational";
  return "informational";
}

function volumeToDifficultyFallback(v: number | null | undefined): number {
  if (v == null || v === 0) return 20;
  if (v < 100) return 20;
  if (v < 1_000) return 30;
  if (v < 10_000) return 50;
  if (v < 100_000) return 70;
  return 85;
}

function competitionIndexToLabel(c: number | null | undefined): BulkKeywordRow["competitionLabel"] {
  if (c == null) return null;
  if (c >= 66) return "HIGH";
  if (c >= 33) return "MEDIUM";
  return "LOW";
}

export async function analyzeBulkKeywords(input: {
  keywords: string[];
  region?: string;
  /** Force a particular provider. Default: auto (Ads first, fall back to DataForSEO). */
  provider?: "google-ads" | "dataforseo" | "auto";
}): Promise<BulkKeywordResult> {
  const started = Date.now();
  const region = input.region?.trim() || "US";
  const normalized = new Map<string, string>(); // lowercase → original
  for (const raw of input.keywords) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!normalized.has(key)) normalized.set(key, trimmed);
    if (normalized.size >= 1000) break;
  }
  const list = [...normalized.values()];
  const skipReasons: Record<string, number> = {};
  const bump = (r: string) => { skipReasons[r] = (skipReasons[r] ?? 0) + 1; };

  // Provider selection
  const want = input.provider ?? "auto";
  let provider: "google-ads" | "dataforseo" | "none" = "none";
  if ((want === "auto" || want === "google-ads") && isGoogleAdsConfigured()) provider = "google-ads";
  else if ((want === "auto" || want === "dataforseo") && isDfsConfigured()) provider = "dataforseo";

  const volumeMap = new Map<string, { volume: number | null; cpc: number | null; competitionIdx: number | null }>();

  if (provider === "google-ads") {
    const batches: string[][] = [];
    for (let i = 0; i < list.length; i += 20) batches.push(list.slice(i, i + 20));
    for (const batch of batches) {
      try {
        const rows = await fetchAdsVolume(batch, region);
        for (const r of rows) {
          const lo = r.lowTopOfPageBidMicros?.value;
          const hi = r.highTopOfPageBidMicros?.value;
          let cpc: number | null = null;
          if (typeof lo === "number" && typeof hi === "number" && hi > 0) {
            cpc = +(((lo + hi) / 2) / 1_000_000).toFixed(2);
          }
          volumeMap.set(r.keyword.toLowerCase().trim(), {
            volume: typeof r.avgMonthlySearches?.value === "number" ? r.avgMonthlySearches.value : null,
            cpc,
            competitionIdx: typeof r.competitionIndex?.value === "number" ? r.competitionIndex.value : null,
          });
        }
      } catch {
        bump("ads-batch-error");
      }
    }
  } else if (provider === "dataforseo") {
    const batches: string[][] = [];
    for (let i = 0; i < list.length; i += 100) batches.push(list.slice(i, i + 100));
    for (const batch of batches) {
      try {
        const regionName = region === "US" ? "United States" : region === "GB" ? "United Kingdom" : region === "IN" ? "India" : region;
        const rows = await fetchDfsKeywordVolume(batch, regionName);
        for (const r of rows) {
          volumeMap.set(r.keyword.toLowerCase().trim(), {
            volume: typeof r.searchVolume?.value === "number" ? r.searchVolume.value : null,
            cpc: typeof r.cpc?.value === "number" ? r.cpc.value : null,
            // DataForSEO returns 0-1 competition; rescale to 0-100.
            competitionIdx: typeof r.competition?.value === "number" ? Math.round(r.competition.value * 100) : null,
          });
        }
      } catch {
        bump("dfs-batch-error");
      }
    }
  } else {
    bump("no-volume-provider-configured");
  }

  const rows: BulkKeywordRow[] = list.map((kw) => {
    const found = volumeMap.get(kw.toLowerCase());
    const volume = found?.volume ?? null;
    const competitionIdx = found?.competitionIdx ?? null;
    const difficulty = typeof competitionIdx === "number"
      ? Math.max(10, Math.min(100, Math.round(competitionIdx)))
      : volumeToDifficultyFallback(volume);
    return {
      keyword: kw,
      volume,
      difficulty,
      cpcUsd: found?.cpc ?? null,
      competitionLabel: competitionIndexToLabel(competitionIdx),
      volumeSource: volume != null ? provider : null,
      intent: classifyIntent(kw),
      wordCount: kw.split(/\s+/).filter(Boolean).length,
    };
  });

  return {
    region,
    rows,
    meta: {
      requestedCount: input.keywords.length,
      processedCount: rows.length,
      provider,
      durationMs: Date.now() - started,
      skippedReasons: Object.entries(skipReasons).map(([reason, count]) => ({ reason, count })),
    },
  };
}
