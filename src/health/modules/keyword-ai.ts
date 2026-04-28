/**
 * Keyword AI Layer — three on-device enrichment passes that turn the
 * raw keyword harvest into agency-grade intelligence.
 *
 *   1. harvestAdsIdeas(seedKeywords, region)
 *      Google Ads' KeywordPlanIdeaService returns ~30-200 ADDITIONAL
 *      idea keywords beyond the seed. Today the rest of the pipeline
 *      ignores them. This export pulls them out and returns them as
 *      ready-to-use rows. NO LLM — pure first-party Google data.
 *
 *   2. expandWithAi(seed, context)
 *      Ollama (local, on-device) generates ~15 SEMANTIC-CONCEPT
 *      variations Google Suggest / Trends won't surface — the things
 *      nobody has typed yet because the concept is new or aliased.
 *      Closes the "obscure long-tail" gap vs SEMrush. Wrapped in
 *      withLlmTelemetry("keyword-ai-expand").
 *
 *   3. enrichWithAi(rows, context)
 *      Single batched LLM pass — for every row in the table, returns
 *      a refined cluster label + opportunityScore (0-100) + a single
 *      recommendedAction (target-new-page / improve-existing /
 *      consolidate-with / skip) + a one-line reason. Composite signal
 *      that a deterministic heuristic can't compute.
 *
 * Privacy: every LLM call goes through routeLlmJson — Ollama-only,
 * never leaves the host. Hard fallback to a no-op when Ollama is
 * offline so the magic-keyword pipeline never blocks on AI.
 */

import { fetchKeywordVolume, isGoogleAdsConfigured, type KeywordVolumeResult } from "../providers/google-ads.js";
import { routeLlmJson, checkOllamaAvailable } from "../agentic/llm-router.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";
import type { MagicKeywordRow } from "./keyword-analyzer.js";

// ── 1. Google Ads idea harvesting ────────────────────────────────────────

export interface HarvestedAdsIdea {
  keyword: string;
  avgMonthlySearches: number | null;
  competitionIndex: number | null;
  cpcLowUsd: number | null;
  cpcHighUsd: number | null;
}

/** Pulls additional idea keywords Google's KeywordPlanIdeaService returns
 *  beyond the supplied seeds. De-dups against `existingKeywords` (lower-
 *  cased compare) so the magic-keyword pipeline doesn't re-add what
 *  Suggest / Trends already produced. Returns sorted by volume desc. */
export async function harvestAdsIdeas(
  seedKeywords: string[],
  region = "US",
  existingKeywords: string[] = [],
  cap = 60,
): Promise<HarvestedAdsIdea[]> {
  if (!isGoogleAdsConfigured() || seedKeywords.length === 0) return [];
  const seen = new Set<string>(existingKeywords.map((k) => k.toLowerCase().trim()));
  const seedSet = new Set<string>(seedKeywords.map((k) => k.toLowerCase().trim()));
  // Use the strongest seeds (first 5 — Ads expands well from any of them).
  const seeds = seedKeywords.slice(0, 5);
  const out: HarvestedAdsIdea[] = [];
  try {
    const results: KeywordVolumeResult[] = await fetchKeywordVolume(seeds, region);
    for (const r of results) {
      const kw = r.keyword.toLowerCase().trim();
      if (!kw || seedSet.has(kw) || seen.has(kw)) continue;
      seen.add(kw);
      out.push({
        keyword: r.keyword,
        avgMonthlySearches: r.avgMonthlySearches?.value ?? null,
        competitionIndex: r.competitionIndex?.value ?? null,
        cpcLowUsd: r.lowTopOfPageBidMicros?.value ?? null,
        cpcHighUsd: r.highTopOfPageBidMicros?.value ?? null,
      });
    }
  } catch {
    // One Ads error shouldn't kill the whole pipeline — return what we have.
    return out;
  }
  out.sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0));
  return out.slice(0, cap);
}

// ── 2. AI semantic expansion ─────────────────────────────────────────────

interface ExpandLlmOut {
  variants?: string[];
}

/** Ollama generates ~15 semantic-concept variants for a seed keyword.
 *  These are the things nobody has typed yet — aliases, emerging
 *  terminology, problem-statement reformulations — that Google Suggest
 *  can't surface because they don't yet exist in Google's query log.
 *  Returns lowercase trimmed unique strings. Empty array on Ollama-down. */
export async function expandWithAi(
  seed: string,
  context: { domain?: string; topQueries?: string[]; region?: string } = {},
): Promise<string[]> {
  const clean = seed.trim();
  if (!clean) return [];
  if (!(await checkOllamaAvailable())) return [];

  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  const ctxLines: string[] = [];
  if (context.domain) ctxLines.push(`Operator's site: ${context.domain}`);
  if (context.region) ctxLines.push(`Region: ${context.region}`);
  if (context.topQueries && context.topQueries.length > 0) {
    ctxLines.push(`Top current GSC queries on the site: ${context.topQueries.slice(0, 8).join(", ")}`);
  }
  const ctxBlock = ctxLines.length > 0 ? `\nCONTEXT:\n${ctxLines.join("\n")}\n` : "";

  const prompt = [
    `You are a senior SEO researcher. Generate semantic-concept variants of the seed keyword "${clean}" — terms users would search for the same intent but phrased differently.`,
    ctxBlock,
    `Focus on:`,
    `- Aliases / synonyms / industry jargon`,
    `- Problem-statement reformulations ("how do I FIX X" instead of "X tool")`,
    `- Emerging or modern terminology`,
    `- Cross-discipline framings`,
    `- Compound long-tails that combine 2 concepts`,
    ``,
    `Avoid: trivial pluralizations, simple typos, brand-name additions, obvious "near me" / "best" suffixes.`,
    ``,
    `Return ONLY this JSON (no fences, no prose):`,
    `{ "variants": ["variant 1", "variant 2", ...] }`,
    `Provide 12-18 variants. Each is 2-7 words, lowercase, no punctuation except hyphens.`,
  ].join("\n");

  try {
    const { data } = await withLlmTelemetry(
      "keyword-ai-expand",
      model,
      prompt,
      () => routeLlmJson<ExpandLlmOut>(prompt, { preferOllama: true }),
    );
    if (!Array.isArray(data?.variants)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of data.variants) {
      if (typeof v !== "string") continue;
      const norm = v.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim();
      if (!norm || norm === clean.toLowerCase() || seen.has(norm)) continue;
      // Reject 1-word variants and >8-word phrases — usually low quality.
      const wc = norm.split(/\s+/).length;
      if (wc < 2 || wc > 8) continue;
      seen.add(norm);
      out.push(norm);
      if (out.length >= 18) break;
    }
    return out;
  } catch {
    return [];
  }
}

// ── 3. Per-keyword AI enrichment (cluster + score + action) ──────────────

interface EnrichLlmOut {
  results?: Array<{
    index?: number;
    cluster?: string;
    opportunityScore?: number;
    recommendedAction?: string;
    reason?: string;
  }>;
}

export interface EnrichmentInput {
  keyword: string;
  /** Bucketed or numeric. We pass through what we have. */
  volume?: string;
  difficulty?: string;
  intent?: string;
}

export interface EnrichmentContext {
  /** Primary domain — used so the LLM knows whose site this is for. */
  domain?: string;
  /** Site authority / rough DR. Helps the score-reasonableness check. */
  domainAuthority?: number;
  /** Existing top-ranking pages on the operator's site (URL → top query). */
  existingPages?: { url: string; topQuery: string; position: number }[];
}

export interface EnrichmentResult {
  index: number;
  cluster?: string;
  opportunityScore?: number;
  recommendedAction?: MagicKeywordRow["recommendedAction"];
  reason?: string;
}

/** Single batched LLM call to enrich every row. Returns a parallel array
 *  with the LLM output keyed by row index — caller merges back into the
 *  source rows. Returns an empty array on Ollama-down or LLM error. */
export async function enrichWithAi(
  rows: EnrichmentInput[],
  context: EnrichmentContext = {},
): Promise<EnrichmentResult[]> {
  if (rows.length === 0) return [];
  if (!(await checkOllamaAvailable())) return [];

  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  // Cap to 60 rows per call so the prompt stays under 4k tokens. Caller
  // can split into multiple calls for larger lists.
  const sample = rows.slice(0, 60);

  const ctxLines: string[] = [];
  if (context.domain) ctxLines.push(`Operator's site: ${context.domain}`);
  if (typeof context.domainAuthority === "number") ctxLines.push(`Domain authority (0-100): ${context.domainAuthority}`);
  if (context.existingPages && context.existingPages.length > 0) {
    ctxLines.push(`Operator's existing top pages (URL · top query · position):`);
    for (const p of context.existingPages.slice(0, 8)) {
      ctxLines.push(`  - ${p.url} · "${p.topQuery}" · #${p.position}`);
    }
  }

  const tableLines = sample.map((r, i) =>
    `[${i}] "${r.keyword}" · vol=${r.volume ?? "?"} · kd=${r.difficulty ?? "?"} · intent=${r.intent ?? "?"}`,
  ).join("\n");

  const prompt = [
    `You are a senior SEO strategist. For each keyword below, classify it for the operator described in CONTEXT.`,
    `${ctxLines.length > 0 ? `CONTEXT:\n${ctxLines.join("\n")}\n` : ""}`,
    `KEYWORDS:`,
    tableLines,
    ``,
    `For every keyword, return JSON with these exact fields. No prose, no fences:`,
    `{`,
    `  "results": [`,
    `    {`,
    `      "index": 0,`,
    `      "cluster": "<2-4 word semantic cluster label>",`,
    `      "opportunityScore": <integer 0-100>,`,
    `      "recommendedAction": "target-new-page" | "improve-existing" | "consolidate-with" | "skip",`,
    `      "reason": "<one short sentence — must reference at least one metric>"`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `Rules:`,
    `- opportunityScore = composite of (volume × intent-fit × winnability given DA × distance from operator's existing pages). High score = the operator should chase.`,
    `- "improve-existing" only when an existing page already targets this — refer to the URL in the reason.`,
    `- "consolidate-with" only when two or more keywords would compete on the same page.`,
    `- "skip" when the keyword is off-intent or unwinnable given DA.`,
    `- "target-new-page" is the default when none of the above applies and the score is >= 50.`,
    `- Reason must cite a number (the volume / KD / position / DA — your pick).`,
  ].join("\n");

  try {
    const { data } = await withLlmTelemetry(
      "keyword-ai-enrich",
      model,
      prompt,
      () => routeLlmJson<EnrichLlmOut>(prompt, { preferOllama: true }),
    );
    if (!Array.isArray(data?.results)) return [];
    return data.results
      .filter((r) => typeof r?.index === "number" && r.index! >= 0 && r.index! < sample.length)
      .map((r) => ({
        index: r.index!,
        cluster: typeof r.cluster === "string" ? r.cluster.trim().slice(0, 60) : undefined,
        opportunityScore: typeof r.opportunityScore === "number" ? Math.max(0, Math.min(100, Math.round(r.opportunityScore))) : undefined,
        recommendedAction: typeof r.recommendedAction === "string" && ["target-new-page", "improve-existing", "consolidate-with", "skip"].includes(r.recommendedAction)
          ? (r.recommendedAction as MagicKeywordRow["recommendedAction"]) : undefined,
        reason: typeof r.reason === "string" ? r.reason.trim().slice(0, 240) : undefined,
      }));
  } catch {
    return [];
  }
}
