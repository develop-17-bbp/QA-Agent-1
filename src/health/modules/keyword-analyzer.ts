import type { SiteHealthReport } from "../types.js";
import { researchKeyword } from "./keyword-research.js";
import { dp, type DataPoint } from "../providers/types.js";
import { fetchKeywordVolume, isGoogleAdsConfigured, type KeywordVolumeResult } from "../providers/google-ads.js";

// ── Seed-based crawl keyword extractor (unchanged) ──────────────────────────

export function extractKeywords(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const kwMap = new Map<string, { count: number; urls: string[] }>();

  for (const p of allPages) {
    if (!p.documentTitle) continue;
    const words = p.documentTitle.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(w => w.length > 2);
    const stopwords = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "been", "have", "has", "had", "not", "but", "all", "can", "her", "his", "one", "our", "out", "you"]);
    const meaningful = words.filter(w => !stopwords.has(w));

    for (const w of meaningful) {
      const e = kwMap.get(w) ?? { count: 0, urls: [] };
      e.count++;
      if (e.urls.length < 5) e.urls.push(p.url);
      kwMap.set(w, e);
    }
    for (let i = 0; i < meaningful.length - 1; i++) {
      const bigram = `${meaningful[i]} ${meaningful[i + 1]}`;
      const e = kwMap.get(bigram) ?? { count: 0, urls: [] };
      e.count++;
      if (e.urls.length < 5) e.urls.push(p.url);
      kwMap.set(bigram, e);
    }
  }

  const keywords = [...kwMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 50)
    .map(([kw, data]) => ({
      keyword: kw,
      frequency: data.count,
      density: allPages.length > 0 ? +(data.count / allPages.length * 100).toFixed(1) : 0,
      urls: data.urls,
    }));

  const intentMap = { informational: 0, commercial: 0, transactional: 0, navigational: 0 };
  for (const p of allPages) {
    const u = p.url.toLowerCase();
    if (/blog|article|guide|how|what|why|learn/.test(u)) intentMap.informational++;
    else if (/product|buy|price|shop|store|cart/.test(u)) intentMap.transactional++;
    else if (/review|compare|best|top|vs/.test(u)) intentMap.commercial++;
    else intentMap.navigational++;
  }

  return { keywords, totalPages: allPages.length, uniqueKeywords: kwMap.size, intentDistribution: intentMap, topKeywords: keywords.slice(0, 10) };
}

// ── Magic Keywords (real-data-backed) ───────────────────────────────────────

type Intent = "Informational" | "Commercial" | "Transactional" | "Navigational";
type DifficultyLabel = "Easy" | "Medium" | "Hard" | "Very Hard";
type Trend = "Rising" | "Stable" | "Declining";

export interface MagicKeywordRow {
  keyword: string;
  /** Human-friendly volume bucket ("1K-10K"). The numeric DataPoint drives this label. */
  volume: string;
  volumeData: DataPoint<number>;
  difficulty: DifficultyLabel;
  difficultyData: DataPoint<number>;
  intent: Intent;
  intentData: DataPoint<Intent>;
  /** Always empty string today — we don't have a free CPC provider. */
  cpc: string;
  trend: Trend;
  /** Where this row came from: "seed", "google-suggest", or "google-suggest-question". */
  source: string;
}

export interface MagicKeywordCluster {
  name: string;
  keywords: string[];
}

export interface MagicKeywordsResult {
  seed: string;
  keywords: MagicKeywordRow[];
  clusters: MagicKeywordCluster[];
  /** Provenance summary so the UI can show per-row badges. */
  dataQuality: {
    realDataFields: string[];
    estimatedFields: string[];
    missingFields: string[];
    providersHit: string[];
    providersFailed: string[];
  };
}

// ── Deterministic intent classifier (no LLM, no hallucination) ──────────────

const INTENT_PATTERNS: { intent: Intent; patterns: RegExp[] }[] = [
  {
    intent: "Transactional",
    patterns: [/\b(buy|order|purchase|for sale|cheap|discount|deal|coupon|price|pricing|cost|subscribe|download|free)\b/i],
  },
  {
    intent: "Commercial",
    patterns: [/\b(best|top|review|reviews|compare|vs|versus|alternative|alternatives|rating|rated)\b/i],
  },
  {
    intent: "Informational",
    patterns: [/\b(how|what|why|when|where|who|which|guide|tutorial|tips|learn|meaning|definition|examples?)\b/i, /\?/],
  },
];

function classifyIntent(keyword: string): Intent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(keyword))) return intent;
  }
  return "Navigational";
}

// ── Volume / difficulty bucket helpers ──────────────────────────────────────

function bucketVolume(n: number): string {
  if (n >= 100_000) return "100K+";
  if (n >= 10_000) return "10K-100K";
  if (n >= 1_000) return "1K-10K";
  if (n >= 100) return "100-1K";
  if (n > 0) return "0-100";
  return "—";
}

function bucketDifficulty(d: number): DifficultyLabel {
  if (d >= 85) return "Very Hard";
  if (d >= 65) return "Hard";
  if (d >= 40) return "Medium";
  return "Easy";
}

/**
 * Derive a trend label from the Google Trends 12-month relative-interest array.
 * Compare last quarter vs first quarter.
 */
function deriveTrend(trend12mo: number[]): Trend {
  if (!trend12mo.length) return "Stable";
  const n = trend12mo.length;
  const firstQ = trend12mo.slice(0, Math.floor(n / 4));
  const lastQ = trend12mo.slice(Math.ceil((n * 3) / 4));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const delta = avg(lastQ) - avg(firstQ);
  if (delta > 5) return "Rising";
  if (delta < -5) return "Declining";
  return "Stable";
}

/**
 * Build a Magic Keywords result backed entirely by real providers
 * (Google Trends + Google Suggest + Wikipedia pageviews + DuckDuckGo SERP).
 *
 * Every numeric field carries a `DataPoint<number>` so the UI can show
 * a provenance badge and confidence level. The LLM is NEVER asked to
 * invent search volumes, difficulty, or CPCs — intent is classified by
 * deterministic regex instead.
 */
export async function generateMagicKeywords(seed: string, regionCode = "US"): Promise<MagicKeywordsResult> {
  const clean = seed.trim();
  if (!clean) return emptyResult(clean);

  const research = await researchKeyword(clean, regionCode);
  const now = Date.now();

  const { providersHit, providersFailed, realDataFields, estimatedFields, missingFields } = research.dataQuality;

  // ── Seed row (real derived volume + difficulty) ──
  const trendLabel = deriveTrend(research.trend);
  const seedIntent = (research.intent[0]!.toUpperCase() + research.intent.slice(1)) as Intent;
  const volumeSource = providersHit.includes("wikipedia-pageviews") ? "wikipedia-pageviews" : "google-trends";
  const volumeConfidence = providersHit.includes("wikipedia-pageviews") ? "medium" : "low";
  const difficultySource = providersHit.includes("duckduckgo-serp") ? "duckduckgo-serp" : "heuristic";
  const difficultyConfidence = providersHit.includes("duckduckgo-serp") ? "medium" : "low";

  const seedVolumeDp = dp<number>(research.volume, volumeSource, volumeConfidence, 3_600_000, "Derived from real signals");
  const seedDifficultyDp = dp<number>(research.difficulty, difficultySource, difficultyConfidence, 3_600_000, "Derived from real SERP competition");
  const seedIntentDp = dp<Intent>(seedIntent, "heuristic-regex", "low", 86_400_000, "Pattern-matched, not LLM-generated");

  const seedRow: MagicKeywordRow = {
    keyword: clean,
    volume: bucketVolume(research.volume),
    volumeData: seedVolumeDp,
    difficulty: bucketDifficulty(research.difficulty),
    difficultyData: seedDifficultyDp,
    intent: seedIntent,
    intentData: seedIntentDp,
    cpc: "",
    trend: trendLabel,
    source: "seed",
  };

  // ── Variation rows (real from Google Suggest autocomplete) ──
  const variationRows: MagicKeywordRow[] = research.variations.map((v) => {
    const intent = classifyIntent(v.keyword);
    return {
      keyword: v.keyword,
      volume: bucketVolume(v.volume),
      volumeData: dp<number>(v.volume, "google-suggest+trends", "low", 3_600_000, "Proportional split of seed volume"),
      difficulty: bucketDifficulty(v.difficulty),
      difficultyData: dp<number>(v.difficulty, "duckduckgo-serp", "low", 3_600_000, "Relative to seed SERP difficulty"),
      intent,
      intentData: dp<Intent>(intent, "heuristic-regex", "low", 86_400_000),
      cpc: "",
      trend: "Stable",
      source: "google-suggest",
    };
  });

  // ── Question rows (real from Google Suggest question-form) ──
  const questionRows: MagicKeywordRow[] = research.questions.map((q) => {
    const intent = classifyIntent(q.keyword);
    return {
      keyword: q.keyword,
      volume: bucketVolume(q.volume),
      volumeData: dp<number>(q.volume, "google-suggest+trends", "low", 3_600_000, "Proportional split of seed volume"),
      difficulty: bucketDifficulty(q.difficulty),
      difficultyData: dp<number>(q.difficulty, "duckduckgo-serp", "low", 3_600_000, "Relative to seed SERP difficulty"),
      intent,
      intentData: dp<Intent>(intent, "heuristic-regex", "low", 86_400_000),
      cpc: "",
      trend: "Stable",
      source: "google-suggest-question",
    };
  });

  const keywords = [seedRow, ...variationRows, ...questionRows];

  // ── Google Ads override — exact monthly volume + CPC per keyword ──────
  // When an Ads account is configured, replace the bucketed "1K-10K" strings
  // with the real integer Google Ads returns (e.g. "4,400"). Same data source
  // Semrush / Ahrefs use for their own numbers. Batched in groups of 20
  // (Ads API limit). If Ads errors or is unconfigured, bucketed ranges stay
  // as the fallback so the table never comes back empty.
  const adsPopulated: string[] = [];
  if (isGoogleAdsConfigured() && keywords.length > 0) {
    const allKws = keywords.map((k) => k.keyword);
    const batches: string[][] = [];
    for (let i = 0; i < allKws.length; i += 20) batches.push(allKws.slice(i, i + 20));
    const adsMap = new Map<string, KeywordVolumeResult>();
    for (const batch of batches) {
      try {
        const results = await fetchKeywordVolume(batch, regionCode);
        for (const r of results) adsMap.set(r.keyword.toLowerCase().trim(), r);
      } catch {
        // One batch failure shouldn't nuke the page — keep whatever we have.
        break;
      }
    }
    if (adsMap.size > 0) {
      for (const row of keywords) {
        const hit = adsMap.get(row.keyword.toLowerCase().trim());
        if (!hit) continue;
        const v = hit.avgMonthlySearches?.value;
        if (typeof v === "number" && v >= 0) {
          row.volume = v.toLocaleString();
          row.volumeData = dp<number>(v, "google-ads", "high", 24 * 60 * 60 * 1000, "Real monthly searches from Google Ads Keyword Planner");
          adsPopulated.push(row.keyword);
        }
        const cpcLow = hit.lowTopOfPageBidMicros?.value;
        const cpcHigh = hit.highTopOfPageBidMicros?.value;
        if (typeof cpcLow === "number" && typeof cpcHigh === "number" && cpcHigh > 0) {
          const mid = (cpcLow + cpcHigh) / 2;
          row.cpc = `$${mid.toFixed(2)}`;
        }
        // Competition index → difficulty bucket override if present.
        const compIdx = hit.competitionIndex?.value;
        if (typeof compIdx === "number" && compIdx >= 0) {
          row.difficulty = bucketDifficulty(compIdx);
          row.difficultyData = dp<number>(compIdx, "google-ads", "high", 24 * 60 * 60 * 1000, "Competition index (0-100) from Google Ads Keyword Planner");
        }
      }
      providersHit.push("google-ads");
      realDataFields.push("volume", "cpc", "difficulty");
    }
  }

  const clusters: MagicKeywordCluster[] = research.clusters.map((c) => ({
    name: c.label,
    keywords: c.keywords,
  }));

  // Intent classification is deterministic regex — list as real, not estimated.
  const augmentedReal = Array.from(new Set([...realDataFields, "intent-classification"]));
  // CPC is populated when Google Ads is configured; keep "cpc" missing only
  // when no Ads data came back for any keyword.
  const augmentedMissing = adsPopulated.length > 0
    ? Array.from(new Set(missingFields)).filter((f) => f !== "cpc")
    : Array.from(new Set([...missingFields, "cpc"]));

  void now; // keep the timestamp anchor for future expansion
  return {
    seed: clean,
    keywords,
    clusters,
    dataQuality: {
      realDataFields: augmentedReal,
      estimatedFields,
      missingFields: augmentedMissing,
      providersHit: Array.from(new Set(providersHit)),
      providersFailed,
    },
  };
}

function emptyResult(seed: string): MagicKeywordsResult {
  return {
    seed,
    keywords: [],
    clusters: [],
    dataQuality: {
      realDataFields: [],
      estimatedFields: [],
      missingFields: ["keyword"],
      providersHit: [],
      providersFailed: [],
    },
  };
}
