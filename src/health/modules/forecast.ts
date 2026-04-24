/**
 * Forecast — per-domain predictive synthesis over the operator's own
 * position-history DB.
 *
 * Why this is unique: every other "SEO forecast" product ships a
 * black-box number sourced from a proprietary index. This module is
 * grounded in the crawls THIS operator ran + the GSC queries THIS
 * operator tracked. Nothing is inferred from strangers' data; the
 * projections are repeatable from disk.
 *
 * Two layers:
 *
 *   1. Deterministic projection — for every (domain, keyword) pair with
 *      ≥7 snapshots, fit a simple linear regression on the last 14 days
 *      of rank. Extrapolate 30 days ahead. Confidence is R² × sample-size
 *      adequacy; low-confidence forecasts are flagged, not hidden.
 *
 *   2. LLM synthesis — a single council call over the aggregate summary
 *      produces a narrative from 4 advisor personas (Content, Technical,
 *      Competitive, Performance) explaining WHY the forecast looks the
 *      way it does and what actions to prioritize. The advisors never
 *      see the LLM inferring numbers — they see numbers from step 1 and
 *      opine on causes + actions only. This keeps the numeric layer
 *      honest.
 */

import { loadTrackedPairs, readHistory, type PositionSnapshot } from "../position-db.js";
import { runCouncil } from "./council-runner.js";
import type { CouncilContext, CouncilAgendaItem, CouncilAdvisor, CouncilResult } from "./council-types.js";

const FORECAST_ADVISORS: CouncilAdvisor[] = [
  { id: "content",     name: "Content Strategist",   focus: "Which at-risk keywords need content refresh to stop the drop" },
  { id: "technical",   name: "Technical SEO",        focus: "Which breakthroughs are being helped by crawl/indexing wins that should be reinforced" },
  { id: "competitive", name: "Competitive Analyst",  focus: "Where competitors are gaining ground against your projected trajectory" },
  { id: "performance", name: "Performance Engineer", focus: "Whether Core Web Vitals / speed trends correlate with projected movement" },
];

export interface KeywordForecast {
  domain: string;
  keyword: string;
  /** Most-recent observed rank. */
  latestRank: number | null;
  /** Linear-fit rank projected 30 days from today. */
  projectedRank: number | null;
  /** Signed projection delta. Negative = moving up (better). Positive = moving down. */
  projectedDelta: number | null;
  /** R² of the fit (0..1); low = noisy, don't overtrust. */
  confidenceR2: number;
  sampleCount: number;
  /** Bucket: how confident should the UI be in this single projection. */
  confidenceBand: "high" | "medium" | "low";
  /** Snapshot window used for the fit — last 14 days preferred. */
  windowDays: number;
  slopePerDay: number | null;
}

export interface ForecastAggregate {
  domain: string;
  windowDays: number;
  pairsTracked: number;
  pairsForecastable: number;
  /** Keywords with `projectedDelta >= riskThreshold` — rank about to get worse. */
  atRiskKeywords: KeywordForecast[];
  /** Keywords with `projectedDelta <= -breakoutThreshold` — rank about to improve. */
  breakthroughKeywords: KeywordForecast[];
  /** Aggregate expected-rank change across all forecastable pairs. */
  avgProjectedDelta: number;
  medianConfidenceR2: number;
  generatedAt: string;
}

export interface ForecastResult {
  aggregate: ForecastAggregate;
  perKeyword: KeywordForecast[];
  council: CouncilResult | null;
  councilError?: string;
}

function fitLinear(samples: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = samples.length;
  if (n < 2) return { slope: 0, intercept: samples[0]?.y ?? 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const s of samples) { sumX += s.x; sumY += s.y; sumXY += s.x * s.y; sumXX += s.x * s.x; }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  const slope = denom === 0 ? 0 : (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  // R²
  let ssTot = 0, ssRes = 0;
  for (const s of samples) {
    const pred = slope * s.x + intercept;
    ssRes += (s.y - pred) * (s.y - pred);
    ssTot += (s.y - meanY) * (s.y - meanY);
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

function snapshotDayEpoch(at: string): number {
  return Math.floor(new Date(at).getTime() / (24 * 60 * 60 * 1000));
}

function buildKeywordForecast(domain: string, keyword: string, history: PositionSnapshot[], projectDays: number, windowDays: number): KeywordForecast {
  const withPos = history.filter((h) => typeof h.position === "number") as Array<{ at: string; position: number }>;
  const latest = withPos[withPos.length - 1];
  const latestRank = latest?.position ?? null;

  // Keep only the last `windowDays` days of samples for the fit.
  const nowEpoch = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const recent = withPos
    .map((s) => ({ x: snapshotDayEpoch(s.at), y: s.position }))
    .filter((p) => nowEpoch - p.x <= windowDays);

  if (recent.length < 3) {
    return {
      domain, keyword,
      latestRank,
      projectedRank: latestRank,
      projectedDelta: latestRank == null ? null : 0,
      confidenceR2: 0,
      sampleCount: recent.length,
      confidenceBand: "low",
      windowDays,
      slopePerDay: null,
    };
  }

  const { slope, intercept, r2 } = fitLinear(recent);
  const targetX = nowEpoch + projectDays;
  const projectedRank = Math.max(1, Math.round(slope * targetX + intercept));
  const projectedDelta = latestRank == null ? null : projectedRank - latestRank;

  let confidenceBand: "high" | "medium" | "low" = "low";
  if (r2 >= 0.7 && recent.length >= 10) confidenceBand = "high";
  else if (r2 >= 0.4 && recent.length >= 5) confidenceBand = "medium";

  return {
    domain, keyword,
    latestRank,
    projectedRank,
    projectedDelta,
    confidenceR2: +r2.toFixed(3),
    sampleCount: recent.length,
    confidenceBand,
    windowDays,
    slopePerDay: +slope.toFixed(3),
  };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export interface ForecastInput {
  domain: string;
  windowDays?: number;
  projectDays?: number;
  riskThreshold?: number;
  breakoutThreshold?: number;
  includeLlm?: boolean;
}

export async function buildForecast(input: ForecastInput): Promise<ForecastResult> {
  const targetDomain = normalizeDomain(input.domain);
  const windowDays = Math.max(7, Math.min(input.windowDays ?? 14, 90));
  const projectDays = Math.max(7, Math.min(input.projectDays ?? 30, 90));
  const riskThreshold = input.riskThreshold ?? 5;
  const breakoutThreshold = input.breakoutThreshold ?? 3;

  const allPairs = await loadTrackedPairs();
  const myPairs = allPairs.filter((p) => normalizeDomain(p.domain) === targetDomain);

  const forecasts: KeywordForecast[] = [];
  for (const pair of myPairs) {
    try {
      const history = await readHistory(pair.domain, pair.keyword);
      forecasts.push(buildKeywordForecast(pair.domain, pair.keyword, history, projectDays, windowDays));
    } catch {
      /* skip keyword that can't load */
    }
  }

  const forecastable = forecasts.filter((f) => f.projectedDelta != null && f.confidenceBand !== "low");
  const atRisk = forecasts.filter((f) => typeof f.projectedDelta === "number" && f.projectedDelta >= riskThreshold).sort((a, b) => (b.projectedDelta ?? 0) - (a.projectedDelta ?? 0)).slice(0, 20);
  const breakthrough = forecasts.filter((f) => typeof f.projectedDelta === "number" && f.projectedDelta <= -breakoutThreshold).sort((a, b) => (a.projectedDelta ?? 0) - (b.projectedDelta ?? 0)).slice(0, 20);
  const deltas = forecasts.map((f) => f.projectedDelta).filter((d): d is number => typeof d === "number");
  const avgProjectedDelta = deltas.length > 0 ? +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2) : 0;
  const medianConfidenceR2 = +median(forecastable.map((f) => f.confidenceR2)).toFixed(3);

  const aggregate: ForecastAggregate = {
    domain: targetDomain,
    windowDays,
    pairsTracked: myPairs.length,
    pairsForecastable: forecastable.length,
    atRiskKeywords: atRisk,
    breakthroughKeywords: breakthrough,
    avgProjectedDelta,
    medianConfidenceR2,
    generatedAt: new Date().toISOString(),
  };

  // LLM council synthesis (optional, default on)
  let council: CouncilResult | null = null;
  let councilError: string | undefined;
  if (input.includeLlm !== false && forecastable.length > 0) {
    try {
      const context = buildForecastCouncilContext(aggregate, targetDomain);
      council = await runCouncil(context);
    } catch (e) {
      councilError = e instanceof Error ? e.message.slice(0, 200) : "council failed";
    }
  }

  return { aggregate, perKeyword: forecasts, council, councilError };
}

/** Shape the forecast aggregate as a single-item CouncilContext so the
 *  existing council-runner drives the advisor synthesis. The agenda item
 *  is the domain; the metrics carry the distilled numeric story. */
function buildForecastCouncilContext(agg: ForecastAggregate, domain: string): CouncilContext {
  const item: CouncilAgendaItem = {
    id: domain,
    label: `${domain} · next ${30}-day forecast`,
    sublabel: `${agg.pairsForecastable}/${agg.pairsTracked} keywords forecastable · avg delta ${agg.avgProjectedDelta > 0 ? "+" : ""}${agg.avgProjectedDelta}`,
    sources: ["position-history"],
    metrics: {
      avgProjectedDelta: agg.avgProjectedDelta,
      atRiskCount: agg.atRiskKeywords.length,
      breakthroughCount: agg.breakthroughKeywords.length,
      medianConfidenceR2: agg.medianConfidenceR2,
      pairsForecastable: agg.pairsForecastable,
      topAtRisk: agg.atRiskKeywords.slice(0, 3).map((f) => `"${f.keyword}" ${f.latestRank}→${f.projectedRank}`).join(" · ") || "(none)",
      topBreakthrough: agg.breakthroughKeywords.slice(0, 3).map((f) => `"${f.keyword}" ${f.latestRank}→${f.projectedRank}`).join(" · ") || "(none)",
    },
    score: 100,
    rawVariants: [
      ...agg.atRiskKeywords.slice(0, 3).map((f) => `⚠ ${f.keyword}: ${f.latestRank} → ${f.projectedRank}`),
      ...agg.breakthroughKeywords.slice(0, 3).map((f) => `↑ ${f.keyword}: ${f.latestRank} → ${f.projectedRank}`),
    ],
  };
  return {
    feature: "forecast",
    featureLabel: "Forecast",
    featureTagline: `Next-30-day rank projections for ${domain}, grounded in your own tracked position history. Linear fit per keyword; advisors opine on causes + actions, never on numbers.`,
    target: domain,
    sourcesQueried: ["position-history"],
    sourcesFailed: [],
    tierTop: [item],
    tierMid: [],
    tierBottom: [],
    totalItems: 1,
    collectedAt: agg.generatedAt,
    advisors: FORECAST_ADVISORS,
  };
}
