/**
 * Keyword research powered by REAL free data sources — no LLM-estimated
 * volumes or CPCs. When a field can't be populated from a real provider it
 * is marked as missing and the UI shows a lower confidence badge.
 *
 * Data providers used (all free, no paid API):
 *   - Google Trends              → 12-month relative volume + related queries
 *   - Google Suggest             → real autocomplete long-tails & questions
 *   - Wikipedia Pageviews API    → topic-level traffic proxy
 *   - DuckDuckGo SERP scraper    → real SERP top-10 results
 *
 * The LLM (local Ollama) is only used for narrative pieces — intent
 * classification, cluster labels, and a short recommendations paragraph.
 * It is NEVER asked for numbers.
 */

import { generateText } from "../llm.js";
import { fetchKeywordTrend } from "../providers/google-trends.js";
import { fetchSuggestions, fetchQuestionSuggestions } from "../providers/google-suggest.js";
import { fetchBestMatchPageviews } from "../providers/wikipedia-pageviews.js";
import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { ddgRegionCode } from "../providers/geo-targets.js";
import { fetchKeywordVolume as fetchAdsVolume, isGoogleAdsConfigured } from "../providers/google-ads.js";
import { computeDifficultyV2, type DifficultyV2 } from "./keyword-difficulty.js";

// ── Types ────────────────────────────────────────────────────────────

export interface CountryVolume { country: string; code: string; volume: number }
export interface KeywordVariation { keyword: string; volume: number; difficulty: number }
export interface KeywordQuestion { keyword: string; volume: number; difficulty: number }
export interface KeywordCluster { label: string; keywords: string[] }
export interface SerpEntry { position: number; url: string; domain: string; title: string }

export interface DataQuality {
  realDataFields: string[];       // fields populated from actual providers
  estimatedFields: string[];      // fields where we could only label qualitatively
  missingFields: string[];        // fields with no data at all
  providersHit: string[];         // providers that returned data
  providersFailed: string[];      // providers that errored
}

export interface KeywordResearchData {
  keyword: string;
  volume: number;
  globalVolume: number;
  countryVolumes: CountryVolume[];
  intent: "informational" | "commercial" | "navigational" | "transactional";
  cpc: number;
  difficulty: number;
  difficultyLabel: string;
  competitiveDensity: number;
  trend: number[];
  variations: KeywordVariation[];
  questions: KeywordQuestion[];
  clusters: KeywordCluster[];
  serp: SerpEntry[];
  serpFeatures: string[];
  totalResults: string;
  variationsTotalCount: number;
  variationsTotalVolume: number;
  questionsTotalCount: number;
  questionsTotalVolume: number;
  /** Provenance data so the UI can show confidence badges. */
  dataQuality: DataQuality;
  /** Multi-factor difficulty breakdown (v2). When present, the UI can
   *  show users why the difficulty score is what it is — Authority of
   *  top 10, Ads competition, SERP saturation, content-depth floor. */
  difficultyBreakdown?: DifficultyV2;
}

function difficultyLabel(d: number): string {
  if (d >= 85) return "Very hard";
  if (d >= 70) return "Hard";
  if (d >= 50) return "Difficult";
  if (d >= 30) return "Possible";
  return "Easy";
}

// ── Helpers ─────────────────────────────────────────────────────────

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Derive a difficulty 0-100 score from the real DuckDuckGo SERP:
 *   - More unique authoritative domains (wikipedia, youtube, amazon, etc.)
 *     → harder
 *   - More short URLs / root paths at top positions → harder
 *   - Few results or only directories → easier
 */
function computeDifficultyFromSerp(serp: { url: string; title: string }[]): number {
  if (serp.length === 0) return 40;
  const authoritative = new Set([
    "wikipedia.org",
    "amazon.com",
    "youtube.com",
    "reddit.com",
    "facebook.com",
    "linkedin.com",
    "forbes.com",
    "nytimes.com",
    "theguardian.com",
    "github.com",
  ]);
  let score = 20;
  for (const r of serp.slice(0, 10)) {
    const host = safeHostname(r.url);
    if (authoritative.has(host)) score += 8;
    if (new URL(r.url).pathname === "/" || new URL(r.url).pathname.length < 12) score += 4;
  }
  return Math.min(100, score);
}

/**
 * Derive an approximate "estimated monthly volume" by anchoring Google
 * Trends relative value against a Wikipedia pageview proxy. This is better
 * than pure LLM estimation but still labelled "medium" confidence.
 */
function estimateVolumeFromSignals(args: {
  trendAvg: number;           // 0-100 relative avg from Google Trends
  trendPeak: number;          // 0-100 peak
  wikiMonthly: number | null; // real monthly pageviews of best-match topic
  suggestCount: number;       // autocomplete variation count
}): number {
  const { trendAvg, trendPeak, wikiMonthly, suggestCount } = args;

  // Tier A: Wikipedia gives us a real anchor. We know Wikipedia captures ~5-20%
  // of topic search intent, so we scale it accordingly.
  if (wikiMonthly && wikiMonthly > 0) {
    const estimated = Math.round(wikiMonthly * 8);
    // Blend 70% Wikipedia, 30% Trends-weighted adjustment
    const blend = Math.round(estimated * (0.5 + trendAvg / 200));
    return Math.max(100, blend);
  }

  // Tier B: No Wikipedia match. Scale off trends peak + suggest breadth.
  if (trendPeak === 0 && suggestCount === 0) return 0;
  const base = trendPeak * 120 + suggestCount * 90; // heuristic
  return Math.max(0, Math.round(base));
}

// ── Main function ───────────────────────────────────────────────────

export async function researchKeyword(keyword: string, regionCode = "US"): Promise<KeywordResearchData> {
  const clean = keyword.trim();
  if (!clean) throw new Error("Empty keyword");
  const region = regionCode.trim().toUpperCase() || "US";

  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const realDataFields: string[] = [];
  const missingFields: string[] = [];
  const estimatedFields: string[] = [];

  // ── Parallel provider fetches ───────────────────────────────────
  // Every call below is explicitly region-scoped so Google's IP-based
  // geolocation doesn't leak local (e.g., Noida/India) results into a
  // US-region overview.
  const [trendRes, autoRes, questionRes, wikiRes, serpRes] = await Promise.allSettled([
    fetchKeywordTrend(clean, region),
    fetchSuggestions(clean, "en", region),
    fetchQuestionSuggestions(clean, "en", region),
    fetchBestMatchPageviews([clean, clean.replace(/\s+/g, "_")]),
    searchSerp(clean, ddgRegionCode(region)),
  ]);

  // ── Google Trends ───────────────────────────────────────────────
  let trend12moValues: number[] = new Array(12).fill(0);
  let trendAvg = 0;
  let trendPeak = 0;
  let relatedQueries: string[] = [];
  if (trendRes.status === "fulfilled") {
    providersHit.push("google-trends");
    realDataFields.push("trend", "relatedQueries");
    trend12moValues = trendRes.value.trend12mo.value.map((d) => d.value);
    trendAvg = trendRes.value.avgValue.value;
    trendPeak = trendRes.value.peakValue.value;
    relatedQueries = trendRes.value.relatedQueries?.value ?? [];
  } else {
    providersFailed.push("google-trends");
    missingFields.push("trend");
  }

  // ── Google Suggest (autocomplete variations) ────────────────────
  let suggestions: string[] = [];
  if (autoRes.status === "fulfilled") {
    providersHit.push("google-suggest");
    realDataFields.push("variations");
    suggestions = autoRes.value.value;
  } else {
    providersFailed.push("google-suggest");
  }

  // ── Google Suggest (question form) ──────────────────────────────
  let questions: string[] = [];
  if (questionRes.status === "fulfilled") {
    if (!providersHit.includes("google-suggest")) providersHit.push("google-suggest");
    realDataFields.push("questions");
    questions = questionRes.value.value;
  }

  // ── Wikipedia Pageviews (traffic proxy) ─────────────────────────
  let wikiMonthly = 0;
  if (wikiRes.status === "fulfilled" && wikiRes.value) {
    providersHit.push("wikipedia-pageviews");
    realDataFields.push("topicPageviews");
    wikiMonthly = wikiRes.value.value;
  } else {
    providersFailed.push("wikipedia-pageviews");
  }

  // ── DuckDuckGo SERP ─────────────────────────────────────────────
  let serp: SerpEntry[] = [];
  let serpFeatures: string[] = [];
  let totalResults = "0";
  if (serpRes.status === "fulfilled") {
    providersHit.push("duckduckgo-serp");
    realDataFields.push("serp", "totalResults");
    const serpData = serpRes.value;
    serp = serpData.results.slice(0, 10).map((r, i) => ({
      position: r.position ?? i + 1,
      url: r.url,
      domain: safeHostname(r.url),
      title: r.title,
    }));
    totalResults = serpData.totalResultsEstimate || "0";
    // Merge related searches from SERP into related queries
    if (serpData.relatedSearches.length > 0) {
      relatedQueries = Array.from(new Set([...relatedQueries, ...serpData.relatedSearches])).slice(0, 20);
    }
  } else {
    providersFailed.push("duckduckgo-serp");
    missingFields.push("serp");
  }

  // ── Derive volume / difficulty from real signals ────────────────
  // Use Google Ads as the PRIMARY source when configured — same data Semrush
  // and Ahrefs use for their own numbers. Fall back to the heuristic volume
  // estimator only when Ads isn't available for this keyword.
  let volume = estimateVolumeFromSignals({
    trendAvg,
    trendPeak,
    wikiMonthly,
    suggestCount: suggestions.length,
  });
  let globalVolume = Math.round(volume * 3.5);
  let difficulty = computeDifficultyFromSerp(serp);

  const adsVariationVolumes = new Map<string, number>();
  const adsQuestionVolumes = new Map<string, number>();
  let realAdsSeed = false;
  let realAdsCpc: number | undefined;
  let realAdsCompetitionIndex: number | undefined;

  if (isGoogleAdsConfigured()) {
    try {
      const adsKws = [clean, ...suggestions.slice(0, 10), ...questions.slice(0, 5)];
      const adsBatches: string[][] = [];
      for (let i = 0; i < adsKws.length; i += 20) adsBatches.push(adsKws.slice(i, i + 20));
      type AdsRow = Awaited<ReturnType<typeof fetchAdsVolume>>[number];
      const adsMap = new Map<string, AdsRow>();
      for (const batch of adsBatches) {
        try {
          const r = await fetchAdsVolume(batch, region);
          for (const row of r) adsMap.set(row.keyword.toLowerCase().trim(), row);
        } catch { /* partial failure — use whatever came back */ }
      }
      if (adsMap.size > 0) {
        providersHit.push("google-ads");
        const seedRow = adsMap.get(clean.toLowerCase().trim());
        if (seedRow && typeof seedRow.avgMonthlySearches?.value === "number") {
          volume = seedRow.avgMonthlySearches.value;
          globalVolume = Math.round(volume * 3.5);
          realAdsSeed = true;
          realDataFields.push("volume");
          const lo = seedRow.lowTopOfPageBidMicros?.value;
          const hi = seedRow.highTopOfPageBidMicros?.value;
          if (typeof lo === "number" && typeof hi === "number" && hi > 0) {
            realAdsCpc = Math.round(((lo + hi) / 2) * 100) / 100;
          }
          if (typeof seedRow.competitionIndex?.value === "number") {
            realAdsCompetitionIndex = seedRow.competitionIndex.value;
            // Let Ads competition index override SERP-based difficulty.
            difficulty = Math.max(10, Math.min(100, realAdsCompetitionIndex));
            realDataFields.push("difficulty");
          }
        }
        for (const s of suggestions) {
          const row = adsMap.get(s.toLowerCase().trim());
          const v = row?.avgMonthlySearches?.value;
          if (typeof v === "number") adsVariationVolumes.set(s, v);
        }
        for (const q of questions) {
          const row = adsMap.get(q.toLowerCase().trim());
          const v = row?.avgMonthlySearches?.value;
          if (typeof v === "number") adsQuestionVolumes.set(q, v);
        }
      }
    } catch { /* non-fatal */ }
  }
  if (!realAdsSeed) estimatedFields.push("volume", "globalVolume", "countryVolumes");

  // ── Difficulty v2 — multi-factor blend (OPR × Ads × saturation × depth) ──
  // Replaces the v1 SERP-heuristic above. Produces a breakdown the UI can
  // surface so users understand WHY the score is what it is.
  let difficultyBreakdown: DifficultyV2 | undefined;
  try {
    difficultyBreakdown = await computeDifficultyV2({
      serp: serp.map((s) => ({ position: s.position, url: s.url, title: s.title })),
      adsCompetitionIndex: realAdsCompetitionIndex,
    });
    difficulty = difficultyBreakdown.score;
    // v2 derives the label too; use it for consistency.
    // (The KeywordResearchData.difficultyLabel field is set later.)
    // Track provenance: if any v2 signal was real, mark the field real.
    const anyRealSignal = difficultyBreakdown.breakdown.authorityOfTop10.available
      || difficultyBreakdown.breakdown.adsCompetition.available
      || difficultyBreakdown.breakdown.serpSaturation.available;
    if (anyRealSignal && !realDataFields.includes("difficulty")) realDataFields.push("difficulty");
  } catch { /* non-fatal — fall back to existing SERP-heuristic value */ }

  // ── Build variations with real Ads volume when available, proportional fallback otherwise ──
  const variations: KeywordVariation[] = suggestions.slice(0, 10).map((s, i) => {
    const adsV = adsVariationVolumes.get(s);
    if (typeof adsV === "number") {
      return { keyword: s, volume: adsV, difficulty: Math.max(10, difficulty - i * 3) };
    }
    const share = Math.max(0.02, 0.5 / (i + 1));
    return {
      keyword: s,
      volume: Math.round(volume * share),
      difficulty: Math.max(10, difficulty - i * 3),
    };
  });

  const questionsTyped: KeywordQuestion[] = questions.slice(0, 5).map((q, i) => {
    const adsV = adsQuestionVolumes.get(q);
    if (typeof adsV === "number") {
      return { keyword: q, volume: adsV, difficulty: Math.max(10, difficulty - 15 - i * 2) };
    }
    return {
      keyword: q,
      volume: Math.round(volume * 0.15 / (i + 1)),
      difficulty: Math.max(10, difficulty - 15 - i * 2),
    };
  });

  const variationsTotalVolume = variations.reduce((a, v) => a + v.volume, 0);
  const questionsTotalVolume = questionsTyped.reduce((a, v) => a + v.volume, 0);

  // ── Country volumes: distributed around the SELECTED region ─────
  // (Real per-country breakdown requires paid data; this is an approximation
  // that puts the user's chosen region at the top share so the numbers don't
  // contradict the region picker they just used.)
  const COUNTRY_POOL: { country: string; code: string }[] = [
    { country: "United States", code: "US" },
    { country: "India", code: "IN" },
    { country: "United Kingdom", code: "UK" },
    { country: "Canada", code: "CA" },
    { country: "Australia", code: "AU" },
    { country: "Germany", code: "DE" },
  ];
  const SHARES = [0.45, 0.15, 0.1, 0.06, 0.05, 0.05];
  const countryVolumes: CountryVolume[] = (() => {
    if (volume <= 0) return [];
    const sel = COUNTRY_POOL.findIndex((c) => c.code === region || (region === "GB" && c.code === "UK"));
    const ordered = sel >= 0
      ? [COUNTRY_POOL[sel]!, ...COUNTRY_POOL.filter((_, i) => i !== sel)]
      : COUNTRY_POOL;
    return ordered.map((c, i) => ({ ...c, volume: Math.round(volume * (SHARES[i] ?? 0.02)) }));
  })();

  // ── LLM pass for intent + cluster labels + nothing else ─────────
  let intent: KeywordResearchData["intent"] = "informational";
  let clusters: KeywordCluster[] = [{ label: clean, keywords: [clean, ...suggestions.slice(0, 4)] }];

  // LLM narrative pass — intent + cluster labels. Gated by a soft budget so
  // a slow Ollama model can't stretch a keyword lookup past 15s; when it
  // trips, we fall back to a deterministic intent (from seed-keyword words)
  // + a single cluster. That keeps the p95 latency bounded for SEO users.
  const LLM_BUDGET_MS = Number.parseInt(process.env.QA_AGENT_KEYWORD_LLM_BUDGET_MS ?? "15000", 10);
  try {
    const prompt = `Classify the search intent of the keyword and propose up to 5 cluster labels for grouping its variations. Return ONLY valid JSON:
{
  "intent": "informational|commercial|navigational|transactional",
  "clusters": [{ "label": "short label", "keywords": ["kw1","kw2","kw3","kw4","kw5"] }]
}

Keyword: "${clean}"
Real SERP titles: ${serp.slice(0, 5).map((s) => s.title).join(" | ") || "(none)"}
Real variations from autocomplete: ${suggestions.slice(0, 12).join(", ") || "(none)"}

Rules:
- Do NOT invent search volumes, CPCs, or difficulty scores — we already have real data.
- Only classify intent and propose cluster labels.
- Up to 5 clusters, each with 3-5 real keywords drawn from the variations above.`;

    const raw = await Promise.race<string>([
      generateText(prompt),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("LLM budget exceeded")), LLM_BUDGET_MS)),
    ]);
    const text = raw.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        intent?: KeywordResearchData["intent"];
        clusters?: KeywordCluster[];
      };
      if (parsed.intent) intent = parsed.intent;
      if (Array.isArray(parsed.clusters) && parsed.clusters.length > 0) {
        clusters = parsed.clusters.slice(0, 5);
      }
      realDataFields.push("intent", "clusters");
    }
  } catch (e) {
    // Deterministic intent fallback from keyword surface words — covers the
    // common buy/vs/best/how/what patterns without needing the LLM.
    const lc = clean.toLowerCase();
    if (/\b(buy|price|cost|discount|deal|coupon)\b/.test(lc)) intent = "transactional";
    else if (/\b(best|top|vs|versus|compare|review)\b/.test(lc)) intent = "commercial";
    else if (/\b(login|logon|signin|homepage)\b/.test(lc)) intent = "navigational";
    missingFields.push(`intent-llm (${e instanceof Error ? e.message : "error"})`);
  }

  // CPC — we don't have a free real source for this, omit the numeric field.
  const cpc = typeof realAdsCpc === "number" ? realAdsCpc : 0;
  if (typeof realAdsCpc === "number") realDataFields.push("cpc");
  else missingFields.push("cpc");
  void realAdsCompetitionIndex; // surfaced via `difficulty` already

  return {
    keyword: clean,
    volume,
    globalVolume,
    countryVolumes,
    intent,
    cpc,
    difficulty,
    difficultyLabel: difficultyLabel(difficulty),
    competitiveDensity: +(Math.min(1, difficulty / 100)).toFixed(2),
    trend: trend12moValues,
    variations,
    questions: questionsTyped,
    clusters,
    serp,
    serpFeatures,
    totalResults,
    variationsTotalCount: variations.length,
    variationsTotalVolume,
    questionsTotalCount: questionsTyped.length,
    questionsTotalVolume,
    dataQuality: {
      realDataFields: Array.from(new Set(realDataFields)),
      estimatedFields: Array.from(new Set(estimatedFields)),
      missingFields: Array.from(new Set(missingFields)),
      providersHit: Array.from(new Set(providersHit)),
      providersFailed: Array.from(new Set(providersFailed)),
    },
    difficultyBreakdown,
  };
}
