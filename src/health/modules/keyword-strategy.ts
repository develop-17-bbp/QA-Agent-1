import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";
import { extractKeywords } from "./keyword-analyzer.js";
import { fetchSuggestions } from "../providers/google-suggest.js";

// ── Unit 2 honesty goal ────────────────────────────────────────────────────
//
// The OLD version asked the LLM to invent priority keywords, content gaps,
// clusters, action plans, and "competitive insights". None of that was real —
// an SEO team would copy a hallucinated keyword into Semrush and find it
// doesn't exist. This rewrite restricts the LLM to ONE task: clustering a
// real keyword list into named themes. Every keyword in the output must come
// from the crawl or Google Suggest — the LLM cannot introduce new keywords,
// volumes, priorities, or commentary on competitors.
//
// ─────────────────────────────────────────────────────────────────────────

type Priority = "High" | "Medium" | "Low";

export interface StrategyKeyword {
  keyword: string;
  /** Where the keyword came from. */
  source: "crawl" | "google-suggest";
  /** Frequency across crawl pages (crawl keywords only). */
  frequency?: number;
  /** Sample page URLs where the keyword appeared (crawl keywords only). */
  urls?: string[];
  /** Deterministic priority bucket based on frequency tier. */
  priority?: Priority;
  /** For google-suggest rows, the seed keyword that produced the suggestion. */
  fromSeed?: string;
}

export interface StrategyCluster {
  name: string;
  /** Keywords in the cluster — must all exist in the real input set. */
  keywords: string[];
}

export interface KeywordStrategyResult {
  priorityKeywords: StrategyKeyword[];
  relatedKeywords: StrategyKeyword[];
  clusters: StrategyCluster[];
  meta: {
    totalPages: number;
    sitesAnalyzed: number;
    hostnames: string[];
  };
  dataQuality: {
    realDataFields: string[];
    estimatedFields: string[];
    missingFields: string[];
    providersHit: string[];
    providersFailed: string[];
  };
}

function priorityFromFrequency(freq: number, maxFreq: number): Priority {
  if (maxFreq <= 0) return "Low";
  const ratio = freq / maxFreq;
  if (ratio >= 0.66) return "High";
  if (ratio >= 0.33) return "Medium";
  return "Low";
}

/**
 * Build a keyword strategy backed by real data.
 *
 *   1. Pull real keywords from the crawl via extractKeywords(reports).
 *   2. Expand the top-5 real keywords via Google Suggest autocomplete.
 *   3. Ask the LLM ONLY to cluster the combined real set into themes.
 *      Any keyword the LLM returns that isn't in our real set is dropped —
 *      the LLM cannot invent keywords, volumes, priorities, or competitor
 *      insights.
 */
export async function buildKeywordStrategy(reports: SiteHealthReport[]): Promise<KeywordStrategyResult> {
  const allPages = reports.flatMap((r) => r.crawl.pages);
  const hostnames = [...new Set(reports.map((r) => r.hostname))];
  const providersHit: string[] = [];
  const providersFailed: string[] = [];

  // ── Step 1: real keywords from crawl titles (no LLM) ──
  const extracted = extractKeywords(reports);
  if (extracted.keywords.length > 0) providersHit.push("crawl");

  const maxFreq = extracted.keywords[0]?.frequency ?? 0;
  const priorityKeywords: StrategyKeyword[] = extracted.keywords.slice(0, 15).map((k) => ({
    keyword: k.keyword,
    source: "crawl",
    frequency: k.frequency,
    urls: k.urls,
    priority: priorityFromFrequency(k.frequency, maxFreq),
  }));

  // ── Step 2: real related keywords via Google Suggest on top 5 crawl seeds ──
  const relatedKeywords: StrategyKeyword[] = [];
  const seedsToExpand = priorityKeywords.slice(0, 5).map((k) => k.keyword);
  let suggestHit = false;
  for (const seed of seedsToExpand) {
    try {
      const dp = await fetchSuggestions(seed);
      suggestHit = true;
      for (const s of dp.value) {
        if (!relatedKeywords.find((rk) => rk.keyword === s)) {
          relatedKeywords.push({ keyword: s, source: "google-suggest", fromSeed: seed });
        }
      }
    } catch {
      // continue — we'll report if none succeeded
    }
  }
  if (suggestHit) providersHit.push("google-suggest");
  else if (seedsToExpand.length > 0) providersFailed.push("google-suggest");

  // ── Step 3: cluster the combined real set via LLM (clustering only) ──
  const realSet = new Set<string>([
    ...priorityKeywords.map((k) => k.keyword.toLowerCase()),
    ...relatedKeywords.map((k) => k.keyword.toLowerCase()),
  ]);
  const clusterInput = [...realSet];

  let clusters: StrategyCluster[] = [];
  if (clusterInput.length >= 3) {
    const prompt = `You are an SEO clustering assistant. Given this list of real keywords from a website crawl and Google Suggest, group them into 3-5 named thematic clusters.

STRICT RULES:
- You may ONLY output keywords from the input list. Do not invent new keywords.
- Do not output any volumes, priorities, difficulty scores, or commentary.
- Every keyword in the output must be an exact match from the input list.

Input keywords:
${clusterInput.map((k) => `- ${k}`).join("\n")}

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "clusters": [
    { "name": "...", "keywords": ["...", "..."] }
  ]
}`;

    try {
      const text = await generateText(prompt);
      const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(clean) as { clusters?: { name?: string; keywords?: string[] }[] };
      if (Array.isArray(parsed.clusters)) {
        // Defend against hallucination: drop any keyword that isn't in our real set.
        clusters = parsed.clusters
          .map((c) => ({
            name: typeof c.name === "string" ? c.name : "Unnamed",
            keywords: (c.keywords ?? []).filter((k): k is string => typeof k === "string" && realSet.has(k.toLowerCase())),
          }))
          .filter((c) => c.keywords.length > 0);
      }
    } catch {
      // LLM failed or returned invalid JSON — fall back to empty clusters.
      // The real keyword lists are still returned; users just lose the theme grouping.
    }
  }

  const realDataFields = ["keyword", "source", "frequency", "urls", "priority"];
  const estimatedFields = ["cluster-name"];
  const missingFields: string[] = [];
  if (clusters.length === 0) missingFields.push("cluster");
  if (allPages.length === 0) missingFields.push("crawl-pages");

  return {
    priorityKeywords,
    relatedKeywords,
    clusters,
    meta: {
      totalPages: allPages.length,
      sitesAnalyzed: hostnames.length,
      hostnames,
    },
    dataQuality: {
      realDataFields,
      estimatedFields,
      missingFields,
      providersHit,
      providersFailed,
    },
  };
}
