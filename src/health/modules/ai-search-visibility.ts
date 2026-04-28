/**
 * AI Search Visibility — track how often the operator's domain is
 * cited by AI search engines (ChatGPT, Perplexity, Google AI Overviews,
 * Gemini, Copilot). The 2026 SEO frontier: visibility is no longer
 * just about ranking on a Google SERP; it's about being the cited
 * source in an AI-generated answer.
 *
 * For a configured set of branded + intent-of-purchase queries, runs
 * each query against every connected AI engine, captures cited
 * sources, and computes the five industry-standard metrics:
 *
 *   - Mention Rate     — how often your brand string appears in answers
 *   - Citation Rate    — how often your domain is in the source list
 *   - Share of Voice   — your citations / all competitor citations
 *   - Average Position — when cited, what rank in the source list
 *   - Sentiment Score  — sentiment of the mention (positive/neutral/negative)
 *
 * Engines (each requires its own BYOK key in /integrations):
 *   - chatgpt    — OpenAI API (requires OPENAI_API_KEY)
 *   - perplexity — Perplexity API (requires PERPLEXITY_API_KEY)
 *   - gemini     — Google Gemini API (requires GOOGLE_AI_API_KEY)
 *   - ai-overviews — Google AI Overviews via Playwright SERP scrape
 *                    (no key, just headless browser)
 *
 * Privacy note: this is the only feature in QA-Agent that legitimately
 * NEEDS to call external LLM providers (you can't track "does ChatGPT
 * cite me" without asking ChatGPT). We surface a clear "🌍 sends queries
 * externally" badge in the UI for this feature so operators understand.
 *
 * History persistence: data/ai-citations/<domain>.json — same shape
 * pattern as position-history. Future runs can compute trends.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveKey } from "./runtime-keys.js";

const HISTORY_ROOT = path.join(process.cwd(), "data", "ai-citations");

export type AiEngine = "chatgpt" | "perplexity" | "gemini" | "ai-overviews";
export type Sentiment = "positive" | "neutral" | "negative";

export interface AiCitation {
  /** Index in the source list (1 = first citation). 0 if mentioned in prose only. */
  position: number;
  url: string;
  domain: string;
  /** Title or snippet from the citation. */
  title?: string;
}

export interface AiQueryResult {
  query: string;
  engine: AiEngine;
  /** Full text of the AI answer (truncated). */
  answerText: string;
  /** Every cited source, in the order the engine ranked them. */
  citations: AiCitation[];
  /** True when the answer text mentions the operator's brand/domain by name. */
  brandMentioned: boolean;
  /** True when at least one citation is from the operator's domain. */
  domainCited: boolean;
  /** Position of the FIRST operator citation (0 = not cited). */
  operatorPosition: number;
  /** Heuristic sentiment of the mention (positive when prose lauds the brand). */
  sentiment: Sentiment;
  fetchedAt: string;
  error?: string;
}

export interface AiVisibilityMetrics {
  engine: AiEngine;
  queriesRan: number;
  queriesFailed: number;
  /** % of queries where brand string appears in the answer. */
  mentionRate: number;
  /** % of queries where the operator's domain appears in citations. */
  citationRate: number;
  /** Operator citations / (operator + competitor citations). */
  shareOfVoice: number;
  /** Average position when cited (lower = better). null when never cited. */
  averagePosition: number | null;
  /** % positive vs neutral vs negative sentiment across answers that mention. */
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  /** Top 5 competitor domains that beat us in citations. */
  topCompetitors: { domain: string; citationCount: number }[];
}

export interface AiVisibilityResult {
  domain: string;
  brandName: string;
  competitors: string[];
  queries: string[];
  perEngine: AiVisibilityMetrics[];
  perQuery: AiQueryResult[];
  enginesAttempted: AiEngine[];
  enginesSkipped: { engine: AiEngine; reason: string }[];
  generatedAt: string;
}

export interface AiVisibilityInput {
  domain: string;
  brandName: string;
  /** Competitor domains for share-of-voice computation. */
  competitors?: string[];
  /** Queries to run. Should be branded + intent-of-purchase mix. */
  queries: string[];
  /** Subset of engines to run. Default: all configured. */
  engines?: AiEngine[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function domainOf(url: string): string {
  try { return normalizeDomain(new URL(url).hostname); } catch { return ""; }
}

function detectSentiment(text: string, brand: string): Sentiment {
  const lower = text.toLowerCase();
  const brandLower = brand.toLowerCase();
  if (!lower.includes(brandLower)) return "neutral";
  // Cheap heuristic — substring lexicon. LLM-based sentiment is the future.
  const ctx = lower.slice(Math.max(0, lower.indexOf(brandLower) - 60), lower.indexOf(brandLower) + brand.length + 60);
  const pos = /(best|leading|trusted|recommend|excellent|top|premium|reliable|innovative|favorite)/.test(ctx);
  const neg = /(avoid|complaint|issue|problem|controvers|lawsuit|scam|disappointed|poor|outdated)/.test(ctx);
  if (pos && !neg) return "positive";
  if (neg && !pos) return "negative";
  return "neutral";
}

async function ensureHistoryDir(): Promise<void> {
  await fs.mkdir(HISTORY_ROOT, { recursive: true });
}

async function appendToHistory(domain: string, result: AiVisibilityResult): Promise<void> {
  try {
    await ensureHistoryDir();
    const file = path.join(HISTORY_ROOT, `${normalizeDomain(domain)}.json`);
    let history: AiVisibilityResult[] = [];
    try {
      const existing = await fs.readFile(file, "utf8");
      history = JSON.parse(existing) as AiVisibilityResult[];
      if (!Array.isArray(history)) history = [];
    } catch { /* first run */ }
    history.push(result);
    // Keep last 60 snapshots — about 2 months at daily cadence.
    const trimmed = history.slice(-60);
    await fs.writeFile(file, JSON.stringify(trimmed, null, 2), { encoding: "utf8", mode: 0o600 });
  } catch { /* non-fatal */ }
}

// ── Engine adapters ──────────────────────────────────────────────────────

interface EngineAdapter {
  engine: AiEngine;
  isConfigured: () => boolean;
  run: (query: string) => Promise<{ answerText: string; citations: AiCitation[] }>;
}

function chatGptAdapter(): EngineAdapter {
  return {
    engine: "chatgpt",
    isConfigured: () => !!resolveKey("OPENAI_API_KEY"),
    run: async (query) => {
      const apiKey = resolveKey("OPENAI_API_KEY")!;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a research assistant. When answering, list authoritative sources at the end with their full URLs in a numbered list under a 'Sources:' heading." },
            { role: "user", content: query },
          ],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const answerText = data.choices?.[0]?.message?.content ?? "";
      const citations = parseCitationsFromText(answerText);
      return { answerText: answerText.slice(0, 4_000), citations };
    },
  };
}

function perplexityAdapter(): EngineAdapter {
  return {
    engine: "perplexity",
    isConfigured: () => !!resolveKey("PERPLEXITY_API_KEY"),
    run: async (query) => {
      const apiKey = resolveKey("PERPLEXITY_API_KEY")!;
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: query }],
          return_citations: true,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Perplexity HTTP ${res.status}`);
      const data = await res.json() as {
        choices?: { message?: { content?: string } }[];
        citations?: string[];
      };
      const answerText = (data.choices?.[0]?.message?.content ?? "").slice(0, 4_000);
      // Perplexity returns citations as a parallel array of URLs.
      const citations: AiCitation[] = (data.citations ?? []).map((url, i) => ({
        position: i + 1,
        url,
        domain: domainOf(url),
      }));
      return { answerText, citations };
    },
  };
}

function geminiAdapter(): EngineAdapter {
  return {
    engine: "gemini",
    isConfigured: () => !!resolveKey("GOOGLE_AI_API_KEY"),
    run: async (query) => {
      const apiKey = resolveKey("GOOGLE_AI_API_KEY")!;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${query}\n\nList authoritative sources with full URLs at the end.` }] }],
          tools: [{ googleSearchRetrieval: {} }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = await res.json() as {
        candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
      };
      const cand = data.candidates?.[0];
      const answerText = (cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").slice(0, 4_000);
      const citations: AiCitation[] = [];
      const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
      for (let i = 0; i < chunks.length; i++) {
        const uri = chunks[i]?.web?.uri;
        if (!uri) continue;
        citations.push({ position: i + 1, url: uri, domain: domainOf(uri), title: chunks[i]?.web?.title });
      }
      return { answerText, citations };
    },
  };
}

/** Google AI Overviews — scrape the AI-Overview block from a regular SERP
 *  page using Playwright. No API key needed; opt-in with a flag because
 *  Playwright is a heavy dependency. */
function aiOverviewsAdapter(): EngineAdapter {
  return {
    engine: "ai-overviews",
    isConfigured: () => true, // Playwright already required by /form-tests
    run: async (query) => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        });
        const page = await context.newPage();
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`, { waitUntil: "domcontentloaded", timeout: 25_000 });
        // AI Overview block selector — Google rotates these; cover several.
        const aiBlock = page.locator('div[data-attrid="kc:/local:business reviews"], div[role="complementary"]:has-text("AI Overview"), div:has-text("Generative AI")').first();
        let answerText = "";
        const citations: AiCitation[] = [];
        try {
          await aiBlock.waitFor({ timeout: 4_000 });
          answerText = (await aiBlock.innerText()).slice(0, 4_000);
          // Citation links inside the block.
          const links = await aiBlock.locator("a").all();
          for (let i = 0; i < links.length && i < 15; i++) {
            const href = await links[i]!.getAttribute("href");
            const title = (await links[i]!.innerText()).slice(0, 200);
            if (href && /^https?:\/\//.test(href)) {
              citations.push({ position: i + 1, url: href, domain: domainOf(href), title });
            }
          }
        } catch {
          // No AI Overview shown for this query — that's signal too.
        }
        await context.close();
        return { answerText, citations };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}

// ── Citation parser fallback for engines that don't return structured citations ──

function parseCitationsFromText(text: string): AiCitation[] {
  const citations: AiCitation[] = [];
  const seen = new Set<string>();
  // Find the "Sources:" / "References:" section first.
  const sourcesMatch = text.match(/(?:sources|references|citations)\s*:?\s*([\s\S]+?)(?:\n\n|$)/i);
  const block = sourcesMatch?.[1] ?? text;
  const urlRegex = /https?:\/\/[^\s\)\]"]+/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = urlRegex.exec(block)) !== null && citations.length < 15) {
    const url = m[0]!.replace(/[.,;:)\]]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    citations.push({ position: ++i, url, domain: domainOf(url) });
  }
  return citations;
}

// ── Main orchestrator ───────────────────────────────────────────────────

const ALL_ADAPTERS = [chatGptAdapter, perplexityAdapter, geminiAdapter, aiOverviewsAdapter];

function aggregateMetrics(domain: string, brand: string, competitors: string[], results: AiQueryResult[]): AiVisibilityMetrics[] {
  const target = normalizeDomain(domain);
  const competitorSet = new Set(competitors.map(normalizeDomain));
  const out: AiVisibilityMetrics[] = [];
  const byEngine = new Map<AiEngine, AiQueryResult[]>();
  for (const r of results) {
    if (!byEngine.has(r.engine)) byEngine.set(r.engine, []);
    byEngine.get(r.engine)!.push(r);
  }
  for (const [engine, rows] of byEngine) {
    const succeeded = rows.filter((r) => !r.error);
    const mentions = succeeded.filter((r) => r.brandMentioned).length;
    const citations = succeeded.filter((r) => r.domainCited).length;
    const positions = succeeded.filter((r) => r.operatorPosition > 0).map((r) => r.operatorPosition);
    const avgPos = positions.length > 0 ? +(positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(2) : null;

    // Share of voice
    let operatorCites = 0;
    let competitorCites = 0;
    const competitorTally = new Map<string, number>();
    for (const r of succeeded) {
      for (const c of r.citations) {
        if (c.domain === target) operatorCites++;
        else if (competitorSet.has(c.domain)) competitorCites++;
        if (c.domain && c.domain !== target) {
          competitorTally.set(c.domain, (competitorTally.get(c.domain) ?? 0) + 1);
        }
      }
    }
    const totalRelevant = operatorCites + competitorCites;
    const shareOfVoice = totalRelevant > 0 ? +(operatorCites / totalRelevant).toFixed(3) : 0;
    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    for (const r of succeeded.filter((r) => r.brandMentioned)) sentiment[r.sentiment]++;
    const topCompetitors = [...competitorTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([d, n]) => ({ domain: d, citationCount: n }));

    out.push({
      engine,
      queriesRan: succeeded.length,
      queriesFailed: rows.length - succeeded.length,
      mentionRate: succeeded.length > 0 ? +(mentions / succeeded.length).toFixed(3) : 0,
      citationRate: succeeded.length > 0 ? +(citations / succeeded.length).toFixed(3) : 0,
      shareOfVoice,
      averagePosition: avgPos,
      sentimentBreakdown: sentiment,
      topCompetitors,
    });
  }
  return out;
}

export async function trackAiSearchVisibility(input: AiVisibilityInput): Promise<AiVisibilityResult> {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error("domain is required");
  if (!input.brandName?.trim()) throw new Error("brandName is required");
  if (!input.queries || input.queries.length === 0) throw new Error("queries[] is required");

  const wanted = new Set<AiEngine>(input.engines && input.engines.length > 0 ? input.engines : ["chatgpt", "perplexity", "gemini", "ai-overviews"]);
  const enginesAttempted: AiEngine[] = [];
  const enginesSkipped: { engine: AiEngine; reason: string }[] = [];
  const adapters: EngineAdapter[] = [];
  for (const factory of ALL_ADAPTERS) {
    const a = factory();
    if (!wanted.has(a.engine)) continue;
    if (!a.isConfigured()) {
      enginesSkipped.push({ engine: a.engine, reason: `not configured — set ${envForEngine(a.engine)} in /integrations` });
      continue;
    }
    adapters.push(a);
    enginesAttempted.push(a.engine);
  }

  const perQuery: AiQueryResult[] = [];
  // Run engine × query in parallel, but bound concurrency at 4 to be polite to APIs.
  const tasks: Array<() => Promise<void>> = [];
  for (const adapter of adapters) {
    for (const q of input.queries) {
      tasks.push(async () => {
        try {
          const { answerText, citations } = await adapter.run(q);
          const brandMentioned = answerText.toLowerCase().includes(input.brandName.toLowerCase()) ||
            answerText.toLowerCase().includes(domain);
          const operatorCitation = citations.find((c) => c.domain === domain);
          perQuery.push({
            query: q,
            engine: adapter.engine,
            answerText,
            citations,
            brandMentioned,
            domainCited: !!operatorCitation,
            operatorPosition: operatorCitation?.position ?? 0,
            sentiment: detectSentiment(answerText, input.brandName),
            fetchedAt: new Date().toISOString(),
          });
        } catch (e) {
          perQuery.push({
            query: q,
            engine: adapter.engine,
            answerText: "",
            citations: [],
            brandMentioned: false,
            domainCited: false,
            operatorPosition: 0,
            sentiment: "neutral",
            fetchedAt: new Date().toISOString(),
            error: e instanceof Error ? e.message.slice(0, 200) : "engine failed",
          });
        }
      });
    }
  }
  // Bounded parallelism.
  const concurrency = 4;
  for (let i = 0; i < tasks.length; i += concurrency) {
    await Promise.all(tasks.slice(i, i + concurrency).map((fn) => fn()));
  }

  const result: AiVisibilityResult = {
    domain,
    brandName: input.brandName,
    competitors: input.competitors ?? [],
    queries: input.queries,
    perEngine: aggregateMetrics(domain, input.brandName, input.competitors ?? [], perQuery),
    perQuery,
    enginesAttempted,
    enginesSkipped,
    generatedAt: new Date().toISOString(),
  };

  void appendToHistory(domain, result);
  return result;
}

function envForEngine(engine: AiEngine): string {
  switch (engine) {
    case "chatgpt": return "OPENAI_API_KEY";
    case "perplexity": return "PERPLEXITY_API_KEY";
    case "gemini": return "GOOGLE_AI_API_KEY";
    case "ai-overviews": return "(no key needed — uses Playwright)";
  }
}

/** Read history for a domain — used to compute trends over time. */
export async function readAiVisibilityHistory(domain: string): Promise<AiVisibilityResult[]> {
  try {
    const file = path.join(HISTORY_ROOT, `${normalizeDomain(domain)}.json`);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
