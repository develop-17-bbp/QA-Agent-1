/**
 * Keyword Impact Predictor — "what if my site targeted this keyword?"
 *
 * Given a target URL and a keyword, pulls:
 *   1. Keyword volume + competition (Google Ads Keyword Planner)
 *   2. 12-month trend (Google Trends)
 *   3. SERP top-10 (DuckDuckGo) — who would you compete against
 *   4. Target URL's current HTML signals (title, H1, meta, body text)
 *   5. Domain authority for target (OpenPageRank)
 *
 * Then asks the local LLM to synthesize:
 *   - A difficulty/opportunity rating
 *   - Key metrics the SEO team should watch
 *   - 3–5 concrete recommendations
 *   - 3-month / 6-month / 12-month projections
 *   - Risks & quick wins
 *
 * The LLM is strictly grounded on the numeric evidence it's given — it must
 * never invent traffic figures. If a data point is unavailable, the output
 * flags it honestly.
 */

import { load } from "cheerio";
import { routeLlmJson, checkOllamaAvailable } from "../agentic/llm-router.js";
import { fetchKeywordVolume, isGoogleAdsConfigured } from "../providers/google-ads.js";
import { fetchKeywordTrend } from "../providers/google-trends.js";
import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { fetchDomainAuthority, isOpenPageRankConfigured } from "../providers/open-page-rank.js";
import { ddgRegionCode } from "../providers/geo-targets.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface KeywordImpactRequest {
  url: string;
  keyword: string;
  region: string;
}

export interface ProjectedPoint {
  period: "3-month" | "6-month" | "12-month";
  rankingEstimate: string;
  trafficDelta: string;
  confidence: "low" | "medium" | "high";
}

export interface KeywordImpactResult {
  request: KeywordImpactRequest;
  /** False when the local LLM couldn't be reached — UI should degrade by
   *  hiding synthesis panels but still showing evidence cards + charts. */
  llmAvailable: boolean;
  /** If llmAvailable is false, a short human-readable explanation. */
  llmError?: string;
  evidence: {
    volume: {
      avgMonthlySearches: number | null;
      competition: string | null;
      competitionIndex: number | null;
      lowBidUsd: number | null;
      highBidUsd: number | null;
    };
    trend: {
      interestLast12m: number | null;
      direction: "up" | "down" | "flat" | "unknown";
      monthly: { month: string; value: number }[];
    };
    serp: {
      topResults: { position: number; title: string; url: string; domain: string }[];
      yourDomainPosition: number | null;
    };
    targetPage: {
      title: string;
      h1: string | null;
      metaDescription: string | null;
      wordCount: number;
      keywordOccurrences: number;
      hreflang: string[];
    };
    domainAuthority: { score: number | null; pageRankDecimal: number | null };
    missingFields: string[];
  };
  analysis: {
    difficultyScore: number;               // 0-100, derived from competition/DA gap/SERP strength
    opportunityScore: number;              // 0-100, derived from volume × trend × fit × gap
    verdict: string;                       // one-paragraph overview
    fitWithCurrentContent: string;         // how well the target URL matches the keyword already
    keyMetricsToWatch: string[];
    recommendations: string[];
    risks: string[];
    quickWins: string[];
    projections: ProjectedPoint[];
  };
}

// ── Target-page fetcher ──────────────────────────────────────────────────────

async function fetchTargetPage(url: string, keyword: string): Promise<KeywordImpactResult["evidence"]["targetPage"] | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QA-Agent/1.0; +https://github.com/allure/qa-agent)" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = load(html);
    $("script, style, noscript").remove();
    const title = $("title").first().text().trim();
    const h1 = $("h1").first().text().trim() || null;
    const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
    const kwLower = keyword.toLowerCase();
    const occurrences = bodyText ? (bodyText.toLowerCase().split(kwLower).length - 1) : 0;
    const hreflang = $('link[rel="alternate"][hreflang]').map((_, el) => $(el).attr("hreflang") ?? "").get().filter(Boolean) as string[];
    return { title, h1, metaDescription, wordCount, keywordOccurrences: occurrences, hreflang };
  } catch {
    return null;
  }
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function predictKeywordImpact(req: KeywordImpactRequest): Promise<KeywordImpactResult> {
  const region = req.region?.trim() || "US";
  const missingFields: string[] = [];

  let targetDomain = "";
  try {
    targetDomain = new URL(req.url.startsWith("http") ? req.url : `https://${req.url}`).hostname.replace(/^www\./, "");
  } catch {
    /* invalid URL — targetDomain stays empty */
  }

  const [volumeRes, trendRes, serpRes, pageRes, daRes] = await Promise.allSettled([
    isGoogleAdsConfigured() ? fetchKeywordVolume([req.keyword], region) : Promise.reject(new Error("ads-not-configured")),
    fetchKeywordTrend(req.keyword, region),
    searchSerp(req.keyword, ddgRegionCode(region)),
    fetchTargetPage(req.url, req.keyword),
    targetDomain && isOpenPageRankConfigured() ? fetchDomainAuthority(targetDomain) : Promise.reject(new Error("opr-not-configured")),
  ]);

  // ── Volume ──
  const volumeEvidence: KeywordImpactResult["evidence"]["volume"] = {
    avgMonthlySearches: null, competition: null, competitionIndex: null, lowBidUsd: null, highBidUsd: null,
  };
  if (volumeRes.status === "fulfilled" && volumeRes.value.length > 0) {
    const v = volumeRes.value[0]!;
    volumeEvidence.avgMonthlySearches = v.avgMonthlySearches.value;
    volumeEvidence.competition = v.competition.value;
    volumeEvidence.competitionIndex = v.competitionIndex.value;
    volumeEvidence.lowBidUsd = v.lowTopOfPageBidMicros.value;
    volumeEvidence.highBidUsd = v.highTopOfPageBidMicros.value;
  } else {
    missingFields.push("avgMonthlySearches");
  }

  // ── Trend ──
  const trendEvidence: KeywordImpactResult["evidence"]["trend"] = { interestLast12m: null, direction: "unknown", monthly: [] };
  if (trendRes.status === "fulfilled") {
    const t = trendRes.value;
    const monthly = (t.trend12mo?.value ?? []).map((p) => ({ month: p.month, value: p.value }));
    trendEvidence.monthly = monthly;
    if (monthly.length >= 3) {
      const latest = monthly[monthly.length - 1]!.value;
      const earliest = monthly[0]!.value;
      trendEvidence.interestLast12m = Math.round(monthly.reduce((a, p) => a + p.value, 0) / monthly.length);
      if (latest > earliest * 1.1) trendEvidence.direction = "up";
      else if (latest < earliest * 0.9) trendEvidence.direction = "down";
      else trendEvidence.direction = "flat";
    }
  } else {
    missingFields.push("trend");
  }

  // ── SERP ──
  const serpEvidence: KeywordImpactResult["evidence"]["serp"] = { topResults: [], yourDomainPosition: null };
  if (serpRes.status === "fulfilled") {
    for (const r of serpRes.value.results.slice(0, 10)) {
      let dom = "";
      try { dom = new URL(r.url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
      serpEvidence.topResults.push({ position: r.position, title: r.title, url: r.url, domain: dom });
      if (targetDomain && dom === targetDomain && serpEvidence.yourDomainPosition === null) {
        serpEvidence.yourDomainPosition = r.position;
      }
    }
  } else {
    missingFields.push("serp");
  }

  // ── Target page ──
  const pageEvidence: KeywordImpactResult["evidence"]["targetPage"] = pageRes.status === "fulfilled" && pageRes.value
    ? pageRes.value
    : { title: "", h1: null, metaDescription: null, wordCount: 0, keywordOccurrences: 0, hreflang: [] };
  if (pageRes.status !== "fulfilled" || !pageRes.value) missingFields.push("targetPage");

  // ── Domain authority ──
  const daEvidence: KeywordImpactResult["evidence"]["domainAuthority"] = { score: null, pageRankDecimal: null };
  if (daRes.status === "fulfilled") {
    daEvidence.score = daRes.value.authority0to100.value;
    daEvidence.pageRankDecimal = daRes.value.pageRankDecimal.value;
  } else {
    missingFields.push("domainAuthority");
  }

  // ── LLM synthesis ──
  const evidenceBlock = JSON.stringify({
    targetUrl: req.url,
    keyword: req.keyword,
    region,
    targetDomain,
    volume: volumeEvidence,
    trend: { direction: trendEvidence.direction, interestLast12m: trendEvidence.interestLast12m, lastMonth: trendEvidence.monthly.at(-1) ?? null },
    serpSnapshot: serpEvidence,
    targetPage: pageEvidence,
    domainAuthority: daEvidence,
    missingFields,
  }, null, 2);

  const prompt = `You are an SEO strategist. The user is considering targeting a keyword on a specific URL. Using ONLY the evidence JSON below, produce a grounded prediction. Never invent numbers. If a field is null or in missingFields, say so honestly.

Return a JSON object with exactly this shape:
{
  "difficultyScore": 0-100 integer,
  "opportunityScore": 0-100 integer,
  "verdict": "One-paragraph plain-English verdict, 2-3 sentences.",
  "fitWithCurrentContent": "Explain how well the target URL's current title/H1/body already serves this keyword. 1-2 sentences.",
  "keyMetricsToWatch": ["metric 1", "metric 2", ...],        // 3-5 items
  "recommendations": ["recommendation 1", ...],               // 3-5 items, actionable
  "risks": ["risk 1", ...],                                   // 2-4 items
  "quickWins": ["quick win 1", ...],                          // 2-4 items
  "projections": [
    { "period": "3-month", "rankingEstimate": "...", "trafficDelta": "...", "confidence": "low|medium|high" },
    { "period": "6-month", "rankingEstimate": "...", "trafficDelta": "...", "confidence": "low|medium|high" },
    { "period": "12-month", "rankingEstimate": "...", "trafficDelta": "...", "confidence": "low|medium|high" }
  ]
}

Scoring guidance (so scores stay consistent):
- difficultyScore: higher = harder. Use competitionIndex, DA gap vs top SERP domains, content length of SERP leaders.
- opportunityScore: higher = better opportunity. Use volume, trend direction, gap between current rank and top-10, current content fit.
- projections: confidence should be 'low' unless volume + SERP data are present.

Evidence:
${evidenceBlock}

Respond with ONLY the JSON object, no prose.`;

  const emptyAnalysis = (): KeywordImpactResult["analysis"] => ({
    difficultyScore: 0, opportunityScore: 0,
    verdict: "", fitWithCurrentContent: "",
    keyMetricsToWatch: [], recommendations: [], risks: [], quickWins: [], projections: [],
  });

  // Probe Ollama up-front so the UI gets a clean llmAvailable=false instead of
  // a hard error when the local model isn't running. The evidence panels still
  // render from the real providers.
  const ollamaOk = await checkOllamaAvailable().catch(() => false);
  if (!ollamaOk) {
    return {
      request: { url: req.url, keyword: req.keyword, region },
      llmAvailable: false,
      llmError: "Local Ollama is not running. Evidence below is live, but the AI synthesis panels are hidden until Ollama is started (ollama serve).",
      evidence: { volume: volumeEvidence, trend: trendEvidence, serp: serpEvidence, targetPage: pageEvidence, domainAuthority: daEvidence, missingFields },
      analysis: emptyAnalysis(),
    };
  }

  let analysis: KeywordImpactResult["analysis"];
  let llmAvailable = true;
  let llmError: string | undefined;
  try {
    const { data } = await routeLlmJson<KeywordImpactResult["analysis"]>(prompt);
    analysis = {
      difficultyScore: clampInt(data.difficultyScore, 0, 100, 50),
      opportunityScore: clampInt(data.opportunityScore, 0, 100, 50),
      verdict: String(data.verdict ?? "Not enough data to produce a verdict."),
      fitWithCurrentContent: String(data.fitWithCurrentContent ?? ""),
      keyMetricsToWatch: arrayOfStrings(data.keyMetricsToWatch, 5),
      recommendations: arrayOfStrings(data.recommendations, 5),
      risks: arrayOfStrings(data.risks, 4),
      quickWins: arrayOfStrings(data.quickWins, 4),
      projections: normalizeProjections(data.projections),
    };
  } catch (e) {
    llmAvailable = false;
    llmError = e instanceof Error ? e.message : String(e);
    analysis = emptyAnalysis();
  }

  return {
    request: { url: req.url, keyword: req.keyword, region },
    llmAvailable,
    llmError,
    evidence: { volume: volumeEvidence, trend: trendEvidence, serp: serpEvidence, targetPage: pageEvidence, domainAuthority: daEvidence, missingFields },
    analysis,
  };
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function arrayOfStrings(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, cap);
}

function normalizeProjections(v: unknown): ProjectedPoint[] {
  const out: ProjectedPoint[] = [];
  if (!Array.isArray(v)) return out;
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    const period = obj.period === "3-month" || obj.period === "6-month" || obj.period === "12-month" ? obj.period : null;
    if (!period) continue;
    const conf = obj.confidence === "low" || obj.confidence === "medium" || obj.confidence === "high" ? obj.confidence : "low";
    out.push({
      period,
      rankingEstimate: typeof obj.rankingEstimate === "string" ? obj.rankingEstimate : "—",
      trafficDelta: typeof obj.trafficDelta === "string" ? obj.trafficDelta : "—",
      confidence: conf,
    });
  }
  return out;
}
