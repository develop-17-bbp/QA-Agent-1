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
  /** Where this row came from: "seed", "google-suggest",
   *  "google-suggest-question", "google-ads-ideas", or "ai-semantic". */
  source: string;
  /** Gap 7 — AI enrichment fields. Populated when Ollama is reachable AT
   *  research time. All fields are optional so deterministic-only runs
   *  still produce a valid table. */
  aiCluster?: string;
  /** 0-100 — composite opportunity from volume × KD × intent × current
   *  rank (when GSC connected) × site authority. Higher = better target. */
  opportunityScore?: number;
  /** What the operator should do with this keyword. */
  recommendedAction?: "target-new-page" | "improve-existing" | "consolidate-with" | "skip";
  /** One-line LLM rationale for the action. */
  aiReason?: string;
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

  // ── Gap 6 — Harvest Google Ads idea-expansion (new keywords beyond seed) ──
  // KeywordPlanIdeaService returns 30-200 RELATED ideas in addition to the
  // seeds we asked about. Surface them as fresh rows so the table includes
  // first-party Google ideas (the same DB Semrush is trying to estimate).
  if (isGoogleAdsConfigured()) {
    try {
      const { harvestAdsIdeas } = await import("./keyword-ai.js");
      const existing = keywords.map((k) => k.keyword);
      const harvested = await harvestAdsIdeas([clean, ...keywords.slice(1, 4).map((k) => k.keyword)], regionCode, existing, 60);
      for (const idea of harvested) {
        const intent = classifyIntent(idea.keyword);
        const v = idea.avgMonthlySearches ?? 0;
        const compIdx = idea.competitionIndex ?? 0;
        const cpcMid = (typeof idea.cpcLowUsd === "number" && typeof idea.cpcHighUsd === "number" && idea.cpcHighUsd > 0)
          ? (idea.cpcLowUsd + idea.cpcHighUsd) / 2 : null;
        keywords.push({
          keyword: idea.keyword,
          volume: v.toLocaleString(),
          volumeData: dp<number>(v, "google-ads", "high", 24 * 60 * 60 * 1000, "Google Ads idea expansion"),
          difficulty: bucketDifficulty(compIdx),
          difficultyData: dp<number>(compIdx, "google-ads", "high", 24 * 60 * 60 * 1000, "Competition index 0-100"),
          intent,
          intentData: dp<Intent>(intent, "heuristic-regex", "low", 86_400_000),
          cpc: cpcMid != null ? `$${cpcMid.toFixed(2)}` : "",
          trend: "Stable",
          source: "google-ads-ideas",
        });
      }
      if (harvested.length > 0) {
        if (!providersHit.includes("google-ads")) providersHit.push("google-ads");
        realDataFields.push("ideas-expansion");
      }
    } catch { /* harvest failure is non-fatal — keep what we have */ }
  }

  // ── Gap 7 — AI semantic expansion via Ollama (concepts Suggest/Trends miss) ──
  // On-device Ollama call returns 12-18 semantic-concept variants — the
  // aliases / industry-jargon / problem-statement reformulations Google
  // Suggest can't surface because nobody has typed them yet. Skipped
  // silently when Ollama is offline.
  try {
    const { expandWithAi } = await import("./keyword-ai.js");
    const aiVariants = await expandWithAi(clean, { region: regionCode });
    const existing = new Set(keywords.map((k) => k.keyword.toLowerCase()));
    for (const v of aiVariants) {
      if (existing.has(v)) continue;
      existing.add(v);
      const intent = classifyIntent(v);
      keywords.push({
        keyword: v,
        volume: "—",
        volumeData: dp<number>(0, "ollama", "low", 3_600_000, "AI-generated — volume unverified"),
        difficulty: "Medium",
        difficultyData: dp<number>(50, "ollama", "low", 3_600_000, "AI-generated — KD unverified"),
        intent,
        intentData: dp<Intent>(intent, "heuristic-regex", "low", 86_400_000),
        cpc: "",
        trend: "Stable",
        source: "ai-semantic",
      });
    }
    if (aiVariants.length > 0) {
      if (!providersHit.includes("ollama")) providersHit.push("ollama");
      realDataFields.push("ai-semantic-variants");
    }
  } catch { /* Ollama failure is non-fatal */ }

  // ── Gap 7b — AI enrichment pass: cluster + opportunityScore + action ──
  // Single batched LLM call enriches EVERY row with composite signals a
  // deterministic heuristic can't compute. Failures are silent — rows
  // without enrichment still render fine in the UI.
  try {
    const { enrichWithAi } = await import("./keyword-ai.js");
    const enrichInputs = keywords.map((k) => ({
      keyword: k.keyword,
      volume: k.volume,
      difficulty: k.difficulty,
      intent: k.intent,
    }));
    const enrichments = await enrichWithAi(enrichInputs, {
      // No domain/DA context yet at this layer — keyword-magic-tool is seed-only.
      // The /keyword-overview pipeline can pass richer context later.
    });
    for (const e of enrichments) {
      if (typeof e.index !== "number") continue;
      const row = keywords[e.index];
      if (!row) continue;
      if (e.cluster) row.aiCluster = e.cluster;
      if (typeof e.opportunityScore === "number") row.opportunityScore = e.opportunityScore;
      if (e.recommendedAction) row.recommendedAction = e.recommendedAction;
      if (e.reason) row.aiReason = e.reason;
    }
    if (enrichments.length > 0) realDataFields.push("ai-cluster", "ai-opportunity-score", "ai-action");
  } catch { /* enrichment failure is non-fatal */ }

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
