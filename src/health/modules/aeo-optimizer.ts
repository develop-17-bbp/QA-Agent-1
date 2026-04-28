/**
 * AEO Content Optimizer — Answer Engine Optimization scoring.
 *
 * Companion to AI Search Visibility: visibility tells you WHETHER
 * AI engines cite you; AEO tells you HOW TO FIX a page so they will.
 *
 * Pipeline (per page URL):
 *   1. Fetch HTML; extract main article via the same Cheerio
 *      extractor used by Voice-of-SERP.
 *   2. Score 8 deterministic AEO signals:
 *        a. Has a clear lead paragraph (≤150 chars, factual)
 *        b. Has structured Q&A (FAQ schema OR <h2>-formatted questions)
 *        c. Has comparison table or list with ≥3 rows
 *        d. Cites external sources (anchor count to non-self domains)
 *        e. Has author byline + publish date
 *        f. Has hierarchical headings (H1 → H2 → H3 not skipped)
 *        g. Has schema.org Article / HowTo / FAQ JSON-LD
 *        h. Has factual stats (numbers in body — preferred citation hooks)
 *   3. Compose a 0-100 AEO readiness score.
 *   4. (Optional) Ollama call generates 3-5 specific fixes for the
 *      missing signals.
 *
 * Returns structured findings the UI can render as a checklist.
 */

import { load } from "cheerio";
import { extractArticle } from "./voice-of-serp.js";
import { routeLlmJson, checkOllamaAvailable } from "../agentic/llm-router.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";

const FETCH_TIMEOUT_MS = 10_000;

export type AeoSignalKey =
  | "clear-lead"
  | "structured-qa"
  | "comparison-table"
  | "external-citations"
  | "author-and-date"
  | "heading-hierarchy"
  | "structured-data"
  | "factual-stats";

export interface AeoSignal {
  key: AeoSignalKey;
  label: string;
  passed: boolean;
  weight: number;
  /** Short evidence line — what we found or didn't find. */
  evidence: string;
}

export interface AeoFix {
  /** Which signal this fix addresses. */
  signal: AeoSignalKey;
  /** One-sentence change to apply. */
  recommendation: string;
  /** "easy" | "medium" | "hard" — operator-facing effort hint. */
  effort: "easy" | "medium" | "hard";
}

export interface AeoResult {
  url: string;
  fetchedAt: string;
  /** 0-100 weighted score. */
  score: number;
  signals: AeoSignal[];
  /** LLM-generated fixes for the failed signals. Empty when Ollama is offline. */
  fixes: AeoFix[];
  fixesError?: string;
  /** Word count of the extracted article body. */
  wordCount: number;
  /** Quoted lead sentence (first 200 chars of body). */
  lead: string;
}

interface FixesLlmOut {
  fixes?: Array<{ signal?: string; recommendation?: string; effort?: string }>;
}

const SIGNAL_WEIGHTS: Record<AeoSignalKey, number> = {
  "clear-lead": 14,
  "structured-qa": 14,
  "comparison-table": 10,
  "external-citations": 14,
  "author-and-date": 10,
  "heading-hierarchy": 12,
  "structured-data": 14,
  "factual-stats": 12,
};

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; QA-Agent-AEO/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function detectSignals(html: string, url: string): { signals: AeoSignal[]; wordCount: number; lead: string } {
  const $ = load(html);
  const { text, wordCount } = extractArticle(html);
  const lead = text.slice(0, 200).trim();
  const targetHost = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();

  // 1. Clear lead — first paragraph 30-180 chars, factual.
  const firstP = $("article p, main p, p").first().text().trim();
  const leadOk = firstP.length >= 30 && firstP.length <= 240 && !/^(welcome|hello|introducing)/i.test(firstP);

  // 2. Structured Q&A — FAQPage schema or h2 lines ending with "?"
  const ldJsonBlocks = $('script[type="application/ld+json"]').toArray()
    .map((el) => $(el).html() ?? "")
    .filter(Boolean);
  const hasFaqSchema = ldJsonBlocks.some((b) => /"@type"\s*:\s*"FAQPage"/i.test(b));
  const h2s = $("h2").toArray().map((el) => $(el).text().trim());
  const questionH2s = h2s.filter((h) => /\?$/.test(h)).length;
  const qaOk = hasFaqSchema || questionH2s >= 3;

  // 3. Comparison table or 3+ row list
  const hasCompareTable = $("table tr").length >= 4 && $("table th").length >= 2;
  const hasLongList = $("ul, ol").toArray().some((el) => $(el).find("li").length >= 5);
  const compareOk = hasCompareTable || hasLongList;

  // 4. External citations — count non-self anchors with href starting http*.
  let externalLinks = 0;
  $("a[href^='http']").each((_, el) => {
    try {
      const h = new URL($(el).attr("href") ?? "").hostname.replace(/^www\./, "");
      if (h && targetHost && h !== targetHost && !h.endsWith("." + targetHost)) externalLinks++;
    } catch { /* skip */ }
  });
  const citationsOk = externalLinks >= 3;

  // 5. Author + date — meta tags or visible byline.
  const author = $('meta[name="author"]').attr("content")?.trim()
    || $('[itemprop="author"]').first().text().trim()
    || $('[rel="author"]').first().text().trim()
    || "";
  const pubDate = $('meta[property="article:published_time"]').attr("content")
    || $('time[datetime]').attr("datetime")
    || "";
  const authorDateOk = !!(author && pubDate);

  // 6. Heading hierarchy — H1 exists, H2s follow, no skipped levels.
  const headings = $("h1, h2, h3, h4").toArray().map((el) => parseInt(el.tagName.slice(1)));
  const hasH1 = headings.includes(1);
  let levelOk = hasH1;
  for (let i = 1; i < headings.length; i++) {
    const cur = headings[i]!, prev = headings[i - 1]!;
    if (cur > prev + 1) { levelOk = false; break; }
  }
  const hierarchyOk = levelOk && headings.length >= 3;

  // 7. Structured data — any JSON-LD block.
  const structuredOk = ldJsonBlocks.length > 0;

  // 8. Factual stats — numeric values inside body (≥5).
  const numbers = (text.match(/\b\d{2,}(?:[,.]\d+)?(?:%|x|×|years?|days?|hours?|users?|dollars?|\$)?/gi) ?? []).length;
  const statsOk = numbers >= 5;

  const signals: AeoSignal[] = [
    { key: "clear-lead",        label: "Clear factual lead paragraph", passed: leadOk,        weight: SIGNAL_WEIGHTS["clear-lead"],        evidence: leadOk ? `${firstP.length}-char lead` : firstP ? `lead is ${firstP.length} chars (target 30-240)` : "no lead paragraph found" },
    { key: "structured-qa",     label: "Structured Q&A (FAQ schema or h2 questions)", passed: qaOk, weight: SIGNAL_WEIGHTS["structured-qa"], evidence: hasFaqSchema ? "FAQPage schema present" : `${questionH2s} question-style h2s` },
    { key: "comparison-table",  label: "Comparison table or substantial list", passed: compareOk, weight: SIGNAL_WEIGHTS["comparison-table"], evidence: hasCompareTable ? "comparison table found" : hasLongList ? "long list found" : "no comparison structures" },
    { key: "external-citations", label: "Cites authoritative external sources", passed: citationsOk, weight: SIGNAL_WEIGHTS["external-citations"], evidence: `${externalLinks} external links` },
    { key: "author-and-date",   label: "Author byline + publish date", passed: authorDateOk, weight: SIGNAL_WEIGHTS["author-and-date"], evidence: authorDateOk ? `author: ${author.slice(0, 40)}` : `author=${author ? "ok" : "missing"}, date=${pubDate ? "ok" : "missing"}` },
    { key: "heading-hierarchy", label: "Hierarchical headings (no skipped levels)", passed: hierarchyOk, weight: SIGNAL_WEIGHTS["heading-hierarchy"], evidence: `${headings.length} headings; h1=${hasH1 ? "yes" : "missing"}` },
    { key: "structured-data",   label: "Schema.org JSON-LD present", passed: structuredOk, weight: SIGNAL_WEIGHTS["structured-data"], evidence: `${ldJsonBlocks.length} JSON-LD blocks` },
    { key: "factual-stats",     label: "Factual stats / numbers in body", passed: statsOk, weight: SIGNAL_WEIGHTS["factual-stats"], evidence: `${numbers} numeric values` },
  ];
  return { signals, wordCount, lead };
}

async function generateFixes(url: string, signals: AeoSignal[], lead: string): Promise<{ fixes: AeoFix[]; error?: string }> {
  const failed = signals.filter((s) => !s.passed);
  if (failed.length === 0) return { fixes: [] };
  if (!(await checkOllamaAvailable())) return { fixes: [], error: "Ollama not reachable — fixes skipped" };

  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  const failBlock = failed.map((s) => `- ${s.key}: ${s.label} — currently: ${s.evidence}`).join("\n");
  const prompt = [
    `You are an Answer Engine Optimization specialist. Generate one specific fix for each failed signal below for the page at ${url}.`,
    `Lead paragraph (for context): "${lead}"`,
    ``,
    `FAILED SIGNALS:`,
    failBlock,
    ``,
    `Return ONLY this JSON (no fences, no prose):`,
    `{`,
    `  "fixes": [`,
    `    { "signal": "<one of the failed signal keys above>", "recommendation": "<one sentence — concrete change to apply>", "effort": "easy|medium|hard" }`,
    `  ]`,
    `}`,
    ``,
    `Rules:`,
    `- Recommendation must be a specific change ("Add a 3-row 'Pricing tiers' comparison table after the Features H2"), not generic ("improve content").`,
    `- Effort: easy = ≤30 min copy/HTML edit; medium = ≤2h with new content; hard = needs schema rework or content rewrite.`,
    `- One fix per failed signal.`,
  ].join("\n");

  try {
    const { data } = await withLlmTelemetry(
      "aeo-fixes",
      model,
      prompt,
      () => routeLlmJson<FixesLlmOut>(prompt, { preferOllama: true }),
    );
    const fixes: AeoFix[] = [];
    for (const f of data?.fixes ?? []) {
      if (typeof f?.signal !== "string" || typeof f?.recommendation !== "string") continue;
      const sig = f.signal as AeoSignalKey;
      if (!Object.keys(SIGNAL_WEIGHTS).includes(sig)) continue;
      const effort = f.effort === "easy" || f.effort === "medium" || f.effort === "hard" ? f.effort : "medium";
      fixes.push({ signal: sig, recommendation: f.recommendation.trim().slice(0, 280), effort });
    }
    return { fixes };
  } catch (e) {
    return { fixes: [], error: e instanceof Error ? e.message.slice(0, 200) : "fix generation failed" };
  }
}

export async function analyzeAeo(url: string): Promise<AeoResult> {
  const html = await fetchHtml(url);
  const { signals, wordCount, lead } = detectSignals(html, url);
  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
  const earned = signals.filter((s) => s.passed).reduce((s, x) => s + x.weight, 0);
  const score = Math.round((earned / totalWeight) * 100);
  const { fixes, error } = await generateFixes(url, signals, lead);
  return {
    url,
    fetchedAt: new Date().toISOString(),
    score,
    signals,
    fixes,
    fixesError: error,
    wordCount,
    lead,
  };
}
