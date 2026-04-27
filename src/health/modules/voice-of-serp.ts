/**
 * Voice-of-SERP Analyzer — fetch the top-10 organic results for a target
 * keyword, crawl their actual content, and ask a single LLM synthesis
 * pass to extract the dominant narrative pattern Google is rewarding:
 *
 *   - Dominant topics (3-5 themes the top-10 share)
 *   - Format profile (long-form / listicle / video-heavy / Q&A)
 *   - Tone (technical / consumer / promotional / neutral)
 *   - Depth signals (avg word count, schema heuristics, comparison tables)
 *   - Coverage gaps (what's NOT in top-10 that arguably should be — your
 *     opportunity surface)
 *
 * Why it matters: SEMrush shows you who ranks. This shows you WHY they
 * rank — the content recipe Google is currently rewarding for this query.
 *
 * Privacy: only the query + extracted page text leaves this machine to
 * Ollama. No external LLM. Page text is truncated before LLM submission
 * to keep prompts under 4k tokens.
 */

import { load } from "cheerio";
import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { routeLlmJson, checkOllamaAvailable } from "../agentic/llm-router.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 600_000;
const PER_URL_TEXT_CAP = 1200;
const TOP_N_DEFAULT = 10;

export interface VoiceOfSerpInput {
  keyword: string;
  region?: string;
  topN?: number;
}

export interface SerpPageSummary {
  rank: number;
  url: string;
  domain: string;
  title: string;
  wordCount: number;
  /** Detected layout signals from cheap parsing — informs depth heuristic. */
  signals: {
    hasH2List: boolean;
    hasComparisonTable: boolean;
    hasFaqStructured: boolean;
    paragraphCount: number;
  };
  /** First chunk of cleaned article text (capped). Used in LLM prompt. */
  textSample: string;
  fetchOk: boolean;
  fetchError?: string;
}

export interface VoiceOfSerpResult {
  keyword: string;
  region: string;
  fetchedAt: string;
  pages: SerpPageSummary[];
  /** Aggregate from page-level signals — shown in KPI strip. */
  aggregate: {
    avgWordCount: number;
    medianWordCount: number;
    listLayoutPct: number;
    comparisonTablePct: number;
    faqPct: number;
    successfulFetches: number;
  };
  /** LLM synthesis output. Null when Ollama unavailable or synthesis fails. */
  voice: VoiceSynthesis | null;
  voiceError?: string;
}

export interface VoiceSynthesis {
  dominantTopics: string[];
  formatProfile: string;
  tone: string;
  depthSignals: string[];
  coverageGaps: string[];
  whyTheyWin: string;
  model: string;
  durationMs: number;
}

interface LlmOut {
  dominantTopics?: string[];
  formatProfile?: string;
  tone?: string;
  depthSignals?: string[];
  coverageGaps?: string[];
  whyTheyWin?: string;
}

function pickUserAgent(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
}

async function fetchHtml(url: string): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": pickUserAgent(), Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const ct = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(ct)) return { ok: false, error: `non-html ${ct}` };
      const buf = await res.arrayBuffer();
      const bytes = buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf;
      return { ok: true, html: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 80) : "fetch failed" };
  }
}

/** Cheerio-based article extractor — strips nav/footer/script/aside,
 *  prefers <main>/<article>, falls back to longest <div> text cluster.
 *  Returns trimmed plain text + structural signals. */
function extractArticle(html: string): { text: string; signals: SerpPageSummary["signals"]; wordCount: number } {
  const $ = load(html);
  // Strip noise once.
  $("script, style, noscript, nav, footer, aside, header, form, iframe").remove();
  // Prefer the most semantically meaningful container.
  let root = $("article").first();
  if (root.length === 0) root = $("main").first();
  if (root.length === 0) {
    // Fallback: pick the <div> with the most text.
    let bestEl: ReturnType<typeof $> | null = null;
    let bestLen = 0;
    $("div").each((_, el) => {
      const text = $(el).text();
      const len = text.replace(/\s+/g, " ").trim().length;
      if (len > bestLen) { bestEl = $(el); bestLen = len; }
    });
    if (bestEl) root = bestEl;
  }
  const textRaw = (root.length ? root.text() : $("body").text()).replace(/\s+/g, " ").trim();
  const wordCount = textRaw ? textRaw.split(/\s+/).length : 0;
  // Structural signals — cheap detections that influence depth heuristics.
  const hasH2List = root.find("h2").length >= 3;
  const hasComparisonTable = root.find("table").toArray().some((t) => $(t).find("tr").length >= 4 && $(t).find("th").length >= 2);
  const faqLd = $("script[type='application/ld+json']").toArray().some((s) => /"@type"\s*:\s*"FAQPage"/i.test($(s).html() ?? ""));
  const hasFaqStructured = faqLd || $('details').length >= 2;
  const paragraphCount = root.find("p").length;
  return {
    text: textRaw,
    signals: { hasH2List, hasComparisonTable, hasFaqStructured, paragraphCount },
    wordCount,
  };
}

function domainOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function buildPrompt(keyword: string, pages: SerpPageSummary[]): string {
  const pageBlock = pages
    .filter((p) => p.fetchOk && p.textSample)
    .map((p) => [
      `[#${p.rank}] ${p.title} (${p.domain}, ${p.wordCount} words)`,
      `signals: ${p.signals.hasH2List ? "h2-list " : ""}${p.signals.hasComparisonTable ? "compare-table " : ""}${p.signals.hasFaqStructured ? "faq-schema" : ""}`,
      p.textSample,
    ].join("\n"))
    .join("\n\n---\n\n");
  return [
    `You are the Voice-of-SERP analyst. Examine the top organic results below for the query "${keyword}".`,
    `Identify the dominant content recipe Google is rewarding RIGHT NOW: shared topics, format, tone, depth, and what's notably absent.`,
    ``,
    `TOP RESULTS (${pages.filter((p) => p.fetchOk).length} fetched of ${pages.length} ranked):`,
    pageBlock,
    ``,
    `Respond with ONLY this JSON object — no prose, no fences:`,
    `{`,
    `  "dominantTopics": ["3-5 themes that appear in most of the top results"],`,
    `  "formatProfile": "1 short phrase (long-form guide, listicle, comparison, Q&A, video-heavy, etc.)",`,
    `  "tone": "1 short phrase (technical, consumer-friendly, promotional, neutral, etc.)",`,
    `  "depthSignals": ["3-5 specific characteristics — schema, table presence, anchor density, image counts, etc."],`,
    `  "coverageGaps": ["2-4 angles missing from these results that an opportunity-seeker should fill"],`,
    `  "whyTheyWin": "2 sentences naming the single biggest pattern that distinguishes ranking pages from non-ranking ones"`,
    `}`,
    ``,
    `Rules:`,
    `- Reference at least one specific page (e.g. #1 or domain) in dominantTopics or whyTheyWin.`,
    `- Never invent topics not visible in the supplied text.`,
    `- coverageGaps must be opportunities — not generic SEO platitudes.`,
  ].join("\n");
}

export async function analyzeVoiceOfSerp(input: VoiceOfSerpInput): Promise<VoiceOfSerpResult> {
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error("keyword is required");
  const region = input.region?.trim() || "us-en";
  const topN = Math.max(3, Math.min(input.topN ?? TOP_N_DEFAULT, TOP_N_DEFAULT));

  // Step 1 — top-N organic URLs from DDG.
  const serp = await searchSerp(keyword, region);
  const ranked = serp.results.slice(0, topN);

  // Step 2 — fetch + extract article text per URL, in parallel with bounded concurrency.
  const concurrency = 4;
  const summaries: SerpPageSummary[] = new Array(ranked.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ranked.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= ranked.length) return;
        const r = ranked[i]!;
        const fetched = await fetchHtml(r.url);
        if (!fetched.ok) {
          summaries[i] = {
            rank: r.position,
            url: r.url,
            domain: domainOf(r.url),
            title: r.title || r.url,
            wordCount: 0,
            signals: { hasH2List: false, hasComparisonTable: false, hasFaqStructured: false, paragraphCount: 0 },
            textSample: "",
            fetchOk: false,
            fetchError: fetched.error,
          };
          continue;
        }
        try {
          const { text, signals, wordCount } = extractArticle(fetched.html);
          summaries[i] = {
            rank: r.position,
            url: r.url,
            domain: domainOf(r.url),
            title: r.title || r.url,
            wordCount,
            signals,
            textSample: text.slice(0, PER_URL_TEXT_CAP),
            fetchOk: true,
          };
        } catch (e) {
          summaries[i] = {
            rank: r.position,
            url: r.url,
            domain: domainOf(r.url),
            title: r.title || r.url,
            wordCount: 0,
            signals: { hasH2List: false, hasComparisonTable: false, hasFaqStructured: false, paragraphCount: 0 },
            textSample: "",
            fetchOk: false,
            fetchError: e instanceof Error ? e.message.slice(0, 80) : "extract failed",
          };
        }
      }
    }),
  );

  const ok = summaries.filter((s) => s.fetchOk);
  const wordCounts = ok.map((s) => s.wordCount);
  const aggregate = {
    avgWordCount: ok.length > 0 ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / ok.length) : 0,
    medianWordCount: median(wordCounts),
    listLayoutPct: ok.length > 0 ? Math.round((ok.filter((s) => s.signals.hasH2List).length / ok.length) * 100) : 0,
    comparisonTablePct: ok.length > 0 ? Math.round((ok.filter((s) => s.signals.hasComparisonTable).length / ok.length) * 100) : 0,
    faqPct: ok.length > 0 ? Math.round((ok.filter((s) => s.signals.hasFaqStructured).length / ok.length) * 100) : 0,
    successfulFetches: ok.length,
  };

  // Step 3 — LLM synthesis (skipped silently if Ollama is offline).
  let voice: VoiceSynthesis | null = null;
  let voiceError: string | undefined;
  if (ok.length >= 3) {
    const ollamaUp = await checkOllamaAvailable();
    if (ollamaUp) {
      const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
      const prompt = buildPrompt(keyword, summaries);
      const started = Date.now();
      try {
        const { data } = await withLlmTelemetry(
          "voice-of-serp",
          model,
          prompt,
          () => routeLlmJson<LlmOut>(prompt, { preferOllama: true }),
        );
        voice = {
          dominantTopics: Array.isArray(data?.dominantTopics) ? data.dominantTopics.slice(0, 5).map(String) : [],
          formatProfile: data?.formatProfile?.toString().trim() || "unspecified",
          tone: data?.tone?.toString().trim() || "unspecified",
          depthSignals: Array.isArray(data?.depthSignals) ? data.depthSignals.slice(0, 6).map(String) : [],
          coverageGaps: Array.isArray(data?.coverageGaps) ? data.coverageGaps.slice(0, 5).map(String) : [],
          whyTheyWin: data?.whyTheyWin?.toString().trim() || "(synthesis missing)",
          model,
          durationMs: Date.now() - started,
        };
      } catch (e) {
        voiceError = e instanceof Error ? e.message.slice(0, 200) : "voice synthesis failed";
      }
    } else {
      voiceError = "Ollama not reachable — synthesis skipped (deterministic page summary still returned).";
    }
  } else {
    voiceError = `only ${ok.length} of ${summaries.length} pages fetched successfully — need ≥3 for synthesis`;
  }

  return {
    keyword,
    region,
    fetchedAt: new Date().toISOString(),
    pages: summaries,
    aggregate,
    voice,
    voiceError,
  };
}
