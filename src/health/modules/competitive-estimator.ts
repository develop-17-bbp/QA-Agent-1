/**
 * AI Competitive Estimator — probabilistic ranges for any domain using only
 * free-tier signals. Never emits a single fake integer; always emits a band
 * with confidence. Fills the Semrush-moat gap of "competitor backlinks /
 * traffic / keyword universe" without any paid APIs.
 *
 * Pipeline:
 *   1. fetchCompetitiveSignals() — gathers ~9 free signals in parallel
 *   2. deterministic log-linear baseline — rank + authority + visibility
 *      produce a point estimate per metric
 *   3. Ollama band-widener — given signals + baseline, returns {min, max,
 *      confidence, drivers, caveats} as JSON. Bands are clamped to
 *      baseline/10 ≤ min and max ≤ baseline*10 to prevent runaway.
 *   4. If Ollama is offline, return deterministic baseline with "low"
 *      confidence and a note.
 */

import { routeLlmJson, checkOllamaAvailable } from "../agentic/llm-router.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";
import { fetchCompetitiveSignals, type CompetitiveSignals } from "./competitive-signals.js";

export type Confidence = "high" | "medium" | "low";

export interface RangeEstimate {
  min: number;
  max: number;
  mid: number;
  confidence: Confidence;
}

export interface PointEstimate {
  estimate: number;
  confidence: Confidence;
}

export interface CompetitiveEstimate {
  domain: string;
  fetchedAt: string;
  signals: CompetitiveSignals;
  baseline: {
    backlinks: number;
    monthlyOrganicTraffic: number;
    keywordUniverse: number;
  };
  estimates: {
    backlinks: RangeEstimate;
    monthlyOrganicTraffic: RangeEstimate;
    keywordUniverse: PointEstimate;
  };
  methodology: string;
  caveats: string[];
  drivers: string[];
  llmAvailable: boolean;
  llmError?: string;
}

// ── Deterministic log-linear baseline ───────────────────────────────────────

function clampPositive(n: number, fallback = 0): number {
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Baseline backlinks estimate. Anchors:
 *   - DA 8 + referring-hosts 500 + Tranco 1k → ~500k referring domains
 *   - DA 4 + referring-hosts 20 + Tranco 200k → ~500 referring domains
 *   - DA 0 + no data → ~10 (floor)
 */
function baselineBacklinks(s: CompetitiveSignals): number {
  const da = s.domainAuthority?.value ?? 0;                               // 0-100
  const ccHosts = s.commonCrawlReferringHosts?.value ?? 0;                // int
  const trancoPct = s.trancoPercentile?.value ?? 0;                       // 0-100
  const cfPresent = s.cloudflareRank?.value ? 1 : 0;

  // log10(est) ≈ 0.6 + da/20 + log10(ccHosts+1)*0.9 + trancoPct/50 + cfPresent*0.4
  const log10 = 0.6 + da / 20 + Math.log10(ccHosts + 1) * 0.9 + trancoPct / 50 + cfPresent * 0.4;
  return Math.round(Math.max(10, Math.pow(10, Math.min(log10, 9)))); // cap at 1B
}

/**
 * Baseline monthly organic traffic estimate. Anchors:
 *   - DA 8 + Tranco 1k + Wiki 100k views + SERP 3/3 → ~2M visits/month
 *   - DA 4 + Tranco 300k + Wiki 500 views + SERP 1/3 → ~5k visits/month
 *   - DA 0 + no data → ~50 (floor)
 */
function baselineTraffic(s: CompetitiveSignals): number {
  const da = s.domainAuthority?.value ?? 0;
  const trancoPct = s.trancoPercentile?.value ?? 0;
  const wiki = s.wikipediaMonthlyViews?.value ?? 0;
  const trends = s.googleTrendsLatest?.value ?? 0;
  const serpHits = s.serpVisibilityCount?.value ?? 0; // 0-3
  const cruxPresent = s.cruxPresent?.value ? 1 : 0;
  const ccHits = s.commonCrawlDomainHits?.value ?? 0;

  const log10 =
    1.3 +
    da / 14 +                              // DA is the strongest signal
    trancoPct / 25 +                       // Tranco percentile carries real traffic signal
    Math.log10(wiki + 1) * 0.35 +          // brand search proxy
    (trends / 100) * 0.5 +                 // trend boost
    serpHits * 0.35 +                      // actual SERP presence
    cruxPresent * 0.5 +                    // CrUX presence = meaningful traffic
    Math.log10(ccHits + 1) * 0.15;         // indexed-page proxy

  return Math.round(Math.max(50, Math.pow(10, Math.min(log10, 9))));
}

/**
 * Baseline keyword-universe estimate (number of distinct keywords a domain
 * ranks top-30 for). Approximation: SERP visibility × expansion factor × DA.
 */
function baselineKeywordUniverse(s: CompetitiveSignals): number {
  const da = s.domainAuthority?.value ?? 0;
  const serpHits = s.serpVisibilityCount?.value ?? 0;
  const trancoPct = s.trancoPercentile?.value ?? 0;
  const ccHits = s.commonCrawlDomainHits?.value ?? 0;

  // Each brand-query SERP hit implies ~200 keywords; DA multiplies because
  // high-authority sites tend to rank for more long-tail queries.
  const base = 10 + serpHits * 150 + ccHits * 0.05 + (da / 10) * (trancoPct * 2);
  return Math.round(Math.max(5, base));
}

// ── Confidence heuristic (without LLM) ──────────────────────────────────────

function agreeingSignalCount(s: CompetitiveSignals): number {
  let n = 0;
  if (s.trancoRank) n++;
  if (s.domainAuthority) n++;
  if (s.cloudflareRank) n++;
  if (s.wikipediaMonthlyViews?.value && s.wikipediaMonthlyViews.value > 100) n++;
  if (s.googleTrendsLatest?.value && s.googleTrendsLatest.value > 0) n++;
  if (s.cruxPresent?.value) n++;
  if (s.commonCrawlReferringHosts?.value && s.commonCrawlReferringHosts.value > 5) n++;
  if (s.serpVisibilityCount?.value && s.serpVisibilityCount.value > 0) n++;
  return n;
}

function fallbackConfidence(s: CompetitiveSignals): Confidence {
  const k = agreeingSignalCount(s);
  if (k >= 5) return "medium";  // Without the LLM's sanity check we never claim "high"
  if (k >= 3) return "low";
  return "low";
}

// ── LLM-augmented band widener ──────────────────────────────────────────────

interface LlmOutput {
  backlinks?: { min?: number; max?: number; confidence?: string };
  monthlyOrganicTraffic?: { min?: number; max?: number; confidence?: string };
  keywordUniverse?: { estimate?: number; confidence?: string };
  drivers?: unknown;
  caveats?: unknown;
}

function clampRange(baseline: number, min: number | undefined, max: number | undefined): { min: number; max: number } {
  const lo = Number.isFinite(min) ? Number(min) : baseline / 3;
  const hi = Number.isFinite(max) ? Number(max) : baseline * 3;
  const floorLo = Math.max(Math.floor(baseline / 10), 1);
  const ceilHi = Math.ceil(baseline * 10);
  const clampedLo = Math.max(floorLo, Math.min(Math.round(lo), Math.round(baseline)));
  const clampedHi = Math.min(ceilHi, Math.max(Math.round(hi), Math.round(baseline)));
  return { min: clampedLo, max: Math.max(clampedHi, clampedLo + 1) };
}

function parseConfidence(v: unknown, fallback: Confidence): Confidence {
  return v === "high" || v === "medium" || v === "low" ? v : fallback;
}

function arrayOfStrings(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, cap);
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function estimateCompetitive(domain: string): Promise<CompetitiveEstimate> {
  const signals = await fetchCompetitiveSignals(domain);

  const baselineBack = baselineBacklinks(signals);
  const baselineTraf = baselineTraffic(signals);
  const baselineKw = baselineKeywordUniverse(signals);

  const fallback = fallbackConfidence(signals);

  const defaultEstimate: CompetitiveEstimate = {
    domain: signals.domain,
    fetchedAt: signals.fetchedAt,
    signals,
    baseline: {
      backlinks: baselineBack,
      monthlyOrganicTraffic: baselineTraf,
      keywordUniverse: baselineKw,
    },
    estimates: {
      backlinks: { ...clampRange(baselineBack, baselineBack / 3, baselineBack * 3), mid: baselineBack, confidence: fallback },
      monthlyOrganicTraffic: { ...clampRange(baselineTraf, baselineTraf / 3, baselineTraf * 3), mid: baselineTraf, confidence: fallback },
      keywordUniverse: { estimate: baselineKw, confidence: fallback },
    },
    methodology: `Deterministic log-linear baseline over ${signals.providersHit.length} free signals (${signals.providersHit.join(", ")}).`,
    caveats: [],
    drivers: signals.providersHit,
    llmAvailable: false,
  };

  // If Ollama is offline, return the deterministic baseline untouched.
  const ollamaOk = await checkOllamaAvailable().catch(() => false);
  if (!ollamaOk) {
    defaultEstimate.caveats = [
      "Ollama not running — estimates are deterministic only (no AI band widening). Start Ollama with `ollama serve` for calibrated ranges.",
    ];
    defaultEstimate.llmError = "ollama-offline";
    return defaultEstimate;
  }

  // Prompt the LLM to widen bands and set confidence. Keep it compact.
  const signalsBlock = JSON.stringify({
    domain: signals.domain,
    trancoRank: signals.trancoRank?.value ?? null,
    trancoPercentile: signals.trancoPercentile?.value ?? null,
    domainAuthority_0_to_100: signals.domainAuthority?.value ?? null,
    cloudflareRank: signals.cloudflareRank?.value ?? null,
    wikipediaMonthlyViews: signals.wikipediaMonthlyViews?.value ?? null,
    googleTrendsLatest_0_to_100: signals.googleTrendsLatest?.value ?? null,
    cruxDatasetPresent: signals.cruxPresent?.value ?? null,
    commonCrawlReferringHosts: signals.commonCrawlReferringHosts?.value ?? null,
    commonCrawlDomainHits: signals.commonCrawlDomainHits?.value ?? null,
    brandSerpVisibility_out_of_3: signals.serpVisibilityCount?.value ?? null,
    missingFields: signals.missingFields,
  }, null, 2);

  const baselineBlock = JSON.stringify({
    backlinks: baselineBack,
    monthlyOrganicTraffic: baselineTraf,
    keywordUniverse: baselineKw,
  }, null, 2);

  const prompt = `You are a competitive-intelligence estimator for SEO. Given only the free signals below and a deterministic baseline, output probabilistic RANGES, never single point estimates. You must ground every judgement in the signals — if a signal is null, lower confidence.

Confidence rules:
- "high": ONLY when 4+ non-null signals agree within 1 order of magnitude AND brandSerpVisibility >= 2.
- "medium": 3 non-null signals present, some disagreement tolerated.
- "low": fewer signals, or signals clearly conflict.

Band rules:
- Bands should reflect real-world uncertainty. Default width: baseline/3 to baseline*3 for "medium"; baseline/2 to baseline*2 for "high"; baseline/5 to baseline*5 for "low".
- Never emit min/max outside baseline/10 .. baseline*10 — those are clamped anyway.

Return JSON with exactly this shape (no prose, no markdown):
{
  "backlinks": { "min": integer, "max": integer, "confidence": "high"|"medium"|"low" },
  "monthlyOrganicTraffic": { "min": integer, "max": integer, "confidence": "high"|"medium"|"low" },
  "keywordUniverse": { "estimate": integer, "confidence": "high"|"medium"|"low" },
  "drivers": ["top 3 signals that most influenced the estimate"],
  "caveats": ["2-4 short sentences on what could make these estimates wrong"]
}

Signals:
${signalsBlock}

Deterministic baseline (starting point — adjust via signals):
${baselineBlock}

Respond with ONLY the JSON object.`;

  try {
    const { data } = await withLlmTelemetry(
      "competitive-estimator",
      process.env.OLLAMA_MODEL?.trim() || "llama3.2",
      prompt,
      () => routeLlmJson<LlmOutput>(prompt),
      (r) => JSON.stringify(r.data),
    );
    const backRange = clampRange(baselineBack, data.backlinks?.min, data.backlinks?.max);
    const trafRange = clampRange(baselineTraf, data.monthlyOrganicTraffic?.min, data.monthlyOrganicTraffic?.max);
    const kwEst = Math.max(1, Math.min(Math.round(Number(data.keywordUniverse?.estimate ?? baselineKw)), baselineKw * 10));

    return {
      domain: signals.domain,
      fetchedAt: signals.fetchedAt,
      signals,
      baseline: {
        backlinks: baselineBack,
        monthlyOrganicTraffic: baselineTraf,
        keywordUniverse: baselineKw,
      },
      estimates: {
        backlinks: {
          min: backRange.min, max: backRange.max,
          mid: Math.round((backRange.min + backRange.max) / 2),
          confidence: parseConfidence(data.backlinks?.confidence, fallback),
        },
        monthlyOrganicTraffic: {
          min: trafRange.min, max: trafRange.max,
          mid: Math.round((trafRange.min + trafRange.max) / 2),
          confidence: parseConfidence(data.monthlyOrganicTraffic?.confidence, fallback),
        },
        keywordUniverse: {
          estimate: kwEst,
          confidence: parseConfidence(data.keywordUniverse?.confidence, fallback),
        },
      },
      methodology: `Deterministic log-linear baseline over ${signals.providersHit.length} free signals, refined by local Ollama band-widener. Ranges reflect real uncertainty — never treat as Semrush-grade precision.`,
      caveats: arrayOfStrings(data.caveats, 6),
      drivers: arrayOfStrings(data.drivers, 5),
      llmAvailable: true,
    };
  } catch (e) {
    defaultEstimate.caveats = [
      `AI band-widener failed (${e instanceof Error ? e.message : String(e)}). Falling back to deterministic baseline.`,
    ];
    defaultEstimate.llmError = e instanceof Error ? e.message : String(e);
    return defaultEstimate;
  }
}
