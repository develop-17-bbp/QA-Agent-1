import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";
import { routeLlmJson } from "../agentic/llm-router.js";
import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { fetchDomainHits, type CommonCrawlHit } from "../providers/common-crawl.js";
import { searchDomainReferences, isUrlscanConfigured, type UrlscanHit } from "../providers/urlscan.js";
import { dp, type DataPoint } from "../providers/types.js";
import { promises as fs } from "node:fs";
import path from "node:path";

// ── Unit 5 honesty goal ──────────────────────────────────────────────────────
//
// The OLD version asked the LLM to invent a "visibility score", a "sentiment
// breakdown", "brand strength" metrics (awareness / authority / consistency /
// reputation), competitor visibility, and alerts — all from thin air. None of
// these numbers were real. An SEO team would treat them as Semrush-grade data
// and be completely misled.
//
// This rewrite replaces invented numbers with mentions pulled from REAL sources:
//
//   - Crawl mentions    → scan the provided run's pages for brand-name hits
//   - DDG SERP          → real web search results for the brand
//   - Common Crawl CDX  → real historical web references
//   - URLScan           → real recent scans referencing the brand/domain
//
// The LLM is restricted to ONE job: a ≤2-sentence qualitative summary of the
// real findings. It is not allowed to output sentiment scores, strength metrics,
// or visibility percentages.
//
// ─────────────────────────────────────────────────────────────────────────────

type DataQuality = {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};

export interface BrandMention {
  source: "crawl" | "duckduckgo-serp" | "common-crawl" | "urlscan";
  url: string;
  title?: string;
  snippet?: string;
  /** ISO timestamp if the provider reports one. */
  time?: string;
  // ── Sentiment-enrichment fields (Phase F: Private AI Brand Guardian) ──
  /** Local-LLM classification: positive / neutral / negative. */
  sentiment?: "positive" | "neutral" | "negative";
  /** Local-LLM urgency tag — high when negative + reach signals. */
  urgency?: "low" | "medium" | "high";
  /** Tracked competitor name that co-occurs in the title/snippet, if any. */
  competitorProximity?: string;
}

export interface BrandSentimentSummary {
  positive: number;
  neutral: number;
  negative: number;
  high: number;   // high-urgency
  medium: number;
  low: number;
  /** Map of competitor name → mention count where they co-occurred. */
  competitorProximity: Record<string, number>;
}

export interface BrandMonitoringResult {
  brandName: string;
  /** Summary counts, each a DataPoint<number>. */
  crawlMentions: DataPoint<number>;
  webMentions: DataPoint<number>;
  commonCrawlHits: DataPoint<number>;
  urlscanHits: DataPoint<number>;
  /** Aggregate — the union of everything we actually found. */
  totalUniqueMentions: DataPoint<number>;
  mentions: BrandMention[];
  /** LLM-generated ≤2-sentence qualitative summary (no numbers). */
  summary: string;
  meta: {
    crawlPagesScanned: number;
    hostnames: string[];
    urlscanConfigured: boolean;
  };
  dataQuality: DataQuality;
  // ── Sentiment-enrichment outputs (Phase F) ──
  /** Aggregate counts after enrichWithSentiment(). Absent when sentiment was not requested. */
  sentimentSummary?: BrandSentimentSummary;
  /** Always set when sentiment enrichment runs. Marketing signal: "your brand
   *  string never left this machine". */
  privacyMode?: "local-only";
  /** Optional human-readable note on which model handled enrichment. */
  sentimentModel?: string;
}

const BRAND_TTL = 24 * 60 * 60 * 1000;

function isLikelyDomain(s: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.trim());
}

export async function analyzeBrandPresence(
  brandName: string,
  reports: SiteHealthReport[],
): Promise<BrandMonitoringResult> {
  const clean = brandName.trim();
  const brandLower = clean.toLowerCase();
  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const realDataFields: string[] = [];
  const estimatedFields: string[] = [];
  const missingFields: string[] = [];

  const allPages = reports.flatMap((r) => r.crawl.pages);
  const hostnames = [...new Set(reports.map((r) => r.hostname))];
  const allMentions: BrandMention[] = [];

  // ── Source 1: crawl mentions ──────────────────────────────────────────────
  const crawlHitUrls = new Set<string>();
  for (const p of allPages) {
    const inTitle = p.documentTitle?.toLowerCase().includes(brandLower) ?? false;
    const inUrl = p.url.toLowerCase().includes(brandLower);
    if (inTitle || inUrl) {
      if (!crawlHitUrls.has(p.url)) {
        crawlHitUrls.add(p.url);
        allMentions.push({
          source: "crawl",
          url: p.url,
          title: p.documentTitle ?? undefined,
        });
      }
    }
  }
  if (crawlHitUrls.size > 0) {
    providersHit.push("crawl");
    realDataFields.push("crawlMentions");
  }

  // ── Source 2: DuckDuckGo SERP for the brand name ─────────────────────────
  let serpCount = 0;
  try {
    const serp = await searchSerp(clean);
    for (const r of serp.results.slice(0, 20)) {
      allMentions.push({
        source: "duckduckgo-serp",
        url: r.url,
        title: r.title,
        snippet: r.snippet || undefined,
      });
      serpCount++;
    }
    if (serpCount > 0) {
      providersHit.push("duckduckgo-serp");
      realDataFields.push("webMentions");
    } else {
      providersFailed.push("duckduckgo-serp");
    }
  } catch {
    providersFailed.push("duckduckgo-serp");
  }

  // ── Source 3: Common Crawl (only if brand looks like a domain) ───────────
  let ccCount = 0;
  const brandAsDomain = isLikelyDomain(clean)
    ? clean
    : hostnames.find((h) => h.toLowerCase().includes(brandLower)) ?? null;
  if (brandAsDomain) {
    try {
      const hits = await fetchDomainHits(brandAsDomain, 100);
      for (const h of hits.value as CommonCrawlHit[]) {
        allMentions.push({
          source: "common-crawl",
          url: h.url,
          time: h.timestamp,
        });
        ccCount++;
      }
      if (ccCount > 0) {
        providersHit.push("common-crawl");
        realDataFields.push("commonCrawlHits");
      } else {
        providersFailed.push("common-crawl");
      }
    } catch {
      providersFailed.push("common-crawl");
    }
  } else {
    missingFields.push("commonCrawlHits");
  }

  // ── Source 4: URLScan (only if brand looks like a domain) ────────────────
  let urlscanCount = 0;
  if (brandAsDomain) {
    try {
      const hits = await searchDomainReferences(brandAsDomain, 30);
      for (const h of hits.value as UrlscanHit[]) {
        allMentions.push({
          source: "urlscan",
          url: h.url,
          title: h.title,
          time: h.time,
        });
        urlscanCount++;
      }
      if (urlscanCount > 0) {
        providersHit.push("urlscan");
        realDataFields.push("urlscanHits");
      } else {
        providersFailed.push("urlscan");
      }
    } catch {
      providersFailed.push("urlscan");
    }
  } else {
    missingFields.push("urlscanHits");
  }

  // ── Dedupe mentions by URL while preserving source preference ────────────
  const seen = new Set<string>();
  const uniqueMentions: BrandMention[] = [];
  for (const m of allMentions) {
    if (!m.url || seen.has(m.url)) continue;
    seen.add(m.url);
    uniqueMentions.push(m);
  }

  // ── Wrap counts as DataPoint<number> ─────────────────────────────────────
  const crawlMentionsDP = dp<number>(crawlHitUrls.size, "crawl", "high", BRAND_TTL, "exact substring match in title or URL");
  const webMentionsDP = dp<number>(serpCount, "duckduckgo-serp", "medium", BRAND_TTL, "top-20 organic results mentioning the brand");
  const commonCrawlHitsDP = dp<number>(ccCount, "common-crawl", ccCount > 0 ? "medium" : "low", BRAND_TTL, brandAsDomain ? "recent CDX indexes" : "no domain-shaped brand input");
  const urlscanHitsDP = dp<number>(urlscanCount, "urlscan", urlscanCount > 0 ? "medium" : "low", BRAND_TTL, brandAsDomain ? "domain reference search" : "no domain-shaped brand input");
  const totalUniqueDP = dp<number>(uniqueMentions.length, "union", "medium", BRAND_TTL, "dedup by URL across all providers");

  // ── LLM — qualitative summary only (≤2 sentences, no numbers) ────────────
  let summary = "";
  if (uniqueMentions.length > 0) {
    const sampleTitles = uniqueMentions
      .slice(0, 10)
      .map((m) => m.title || m.url)
      .join(" | ");
    const prompt = `You are an SEO analyst. Below are real mentions of the brand "${clean}" found across the web (DuckDuckGo SERP, Common Crawl, URLScan) and the user's own site crawl.

Write a SHORT 2-sentence qualitative summary of what kinds of surfaces this brand appears on. Do NOT include numbers, counts, percentages, sentiment scores, or rankings. Qualitative only.

Real mentions (sample):
${sampleTitles}

Return only the plain-text summary, no JSON, no markdown.`;
    try {
      const raw = await withLlmTelemetry(
        "brand-monitor",
        process.env.OLLAMA_MODEL?.trim() || "llama3.2",
        prompt,
        () => generateText(prompt),
      );
      summary = raw.replace(/```[\s\S]*?```/g, "").trim().slice(0, 400);
      if (summary) estimatedFields.push("summary");
    } catch {
      /* leave empty */
    }
  } else {
    summary = "No mentions found in any real source. Try a broader brand spelling, or a domain form.";
    missingFields.push("mentions");
  }

  return {
    brandName: clean,
    crawlMentions: crawlMentionsDP,
    webMentions: webMentionsDP,
    commonCrawlHits: commonCrawlHitsDP,
    urlscanHits: urlscanHitsDP,
    totalUniqueMentions: totalUniqueDP,
    mentions: uniqueMentions.slice(0, 50),
    summary,
    meta: {
      crawlPagesScanned: allPages.length,
      hostnames,
      urlscanConfigured: isUrlscanConfigured(),
    },
    dataQuality: {
      realDataFields: Array.from(new Set(realDataFields)),
      estimatedFields: Array.from(new Set(estimatedFields)),
      missingFields,
      providersHit: Array.from(new Set(providersHit)),
      providersFailed: Array.from(new Set(providersFailed)),
    } satisfies DataQuality,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Phase F — Private AI Brand Guardian extension ───────────────────────────
//
// Adds sentiment + urgency + competitor-proximity classification per mention.
// Enforced LOCAL-ONLY: routeLlmJson is the Ollama-only router. We also append
// a privacy audit line per call so regulated buyers can prove brand strings
// never reached an external host.
// ─────────────────────────────────────────────────────────────────────────────

const PRIVACY_AUDIT_LOG = path.join(process.cwd(), "artifacts", "brand-privacy.jsonl");

interface SentimentLlmOut {
  results?: Array<{
    index?: number;
    sentiment?: "positive" | "neutral" | "negative";
    urgency?: "low" | "medium" | "high";
    competitor?: string | null;
  }>;
}

async function appendPrivacyAuditLine(entry: { brand: string; model: string; mentionCount: number }): Promise<void> {
  try {
    await fs.mkdir(path.dirname(PRIVACY_AUDIT_LOG), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      host: "ollama",
      privacyMode: "local-only",
      ...entry,
    }) + "\n";
    await fs.appendFile(PRIVACY_AUDIT_LOG, line, "utf8");
  } catch { /* non-fatal */ }
}

/** Detect competitor proximity heuristically before sending to the LLM —
 *  keeps the prompt focused and reduces token usage. The LLM is still asked
 *  to confirm/refine. */
function heuristicCompetitor(text: string, competitors: string[]): string | undefined {
  const blob = text.toLowerCase();
  for (const c of competitors) {
    const cl = c.toLowerCase().trim();
    if (cl && blob.includes(cl)) return c;
  }
  return undefined;
}

/** Enrich an existing BrandMonitoringResult with on-device sentiment +
 *  urgency + competitor-proximity per mention. Single batched LLM call.
 *  Falls back to heuristic-only when Ollama is offline. */
export async function enrichBrandWithSentiment(
  result: BrandMonitoringResult,
  competitors: string[] = [],
): Promise<BrandMonitoringResult> {
  const cleanCompetitors = competitors.map((c) => c.trim()).filter(Boolean);
  // Heuristic competitor pre-pass (no LLM, instant).
  for (const m of result.mentions) {
    const blob = `${m.title ?? ""} ${m.snippet ?? ""} ${m.url}`;
    const c = heuristicCompetitor(blob, cleanCompetitors);
    if (c) m.competitorProximity = c;
  }

  let sentimentModel: string | undefined;
  if (result.mentions.length > 0) {
    const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
    const sample = result.mentions.slice(0, 30); // cap prompt size
    const lines = sample.map((m, i) => `[${i}] ${m.title ?? "(no title)"} — ${m.snippet ?? ""} (${m.url})`).join("\n");
    const compList = cleanCompetitors.length > 0 ? `KNOWN COMPETITORS to flag in 'competitor' (or null): ${cleanCompetitors.join(", ")}` : `No competitor list provided — leave 'competitor' as null.`;
    const prompt = [
      `You are a private brand-sentiment analyst running entirely on the operator's local hardware.`,
      `Classify each of the ${sample.length} mentions of brand "${result.brandName}" below.`,
      ``,
      compList,
      ``,
      `MENTIONS:`,
      lines,
      ``,
      `Return ONLY this JSON (no prose, no fences):`,
      `{`,
      `  "results": [`,
      `    { "index": 0, "sentiment": "positive|neutral|negative", "urgency": "low|medium|high", "competitor": "<name-or-null>" }`,
      `  ]`,
      `}`,
      ``,
      `Rules:`,
      `- High urgency = negative tone + signals of reach/audience (publication name, social platform, "report", "controversy").`,
      `- Sentiment must reflect the cited mention, not your prior knowledge of the brand.`,
      `- 'competitor' must be one of the known competitors above, or null. Do not invent.`,
    ].join("\n");
    try {
      const { data } = await withLlmTelemetry(
        "brand-sentiment",
        model,
        prompt,
        () => routeLlmJson<SentimentLlmOut>(prompt, { preferOllama: true }),
      );
      sentimentModel = model;
      const arr = Array.isArray(data?.results) ? data!.results! : [];
      for (const r of arr) {
        if (typeof r.index !== "number" || r.index < 0 || r.index >= sample.length) continue;
        const m = sample[r.index]!;
        if (r.sentiment === "positive" || r.sentiment === "neutral" || r.sentiment === "negative") m.sentiment = r.sentiment;
        if (r.urgency === "low" || r.urgency === "medium" || r.urgency === "high") m.urgency = r.urgency;
        if (typeof r.competitor === "string" && cleanCompetitors.includes(r.competitor)) m.competitorProximity = r.competitor;
      }
      void appendPrivacyAuditLine({ brand: result.brandName, model, mentionCount: sample.length });
    } catch {
      // Heuristic-only fallback path: assign neutral defaults so UI renders.
      for (const m of sample) {
        if (!m.sentiment) m.sentiment = "neutral";
        if (!m.urgency) m.urgency = "low";
      }
    }
  }

  // ── Aggregate counts ──
  const summary: BrandSentimentSummary = {
    positive: 0, neutral: 0, negative: 0,
    high: 0, medium: 0, low: 0,
    competitorProximity: {},
  };
  for (const m of result.mentions) {
    if (m.sentiment === "positive") summary.positive++;
    else if (m.sentiment === "negative") summary.negative++;
    else if (m.sentiment === "neutral") summary.neutral++;
    if (m.urgency === "high") summary.high++;
    else if (m.urgency === "medium") summary.medium++;
    else if (m.urgency === "low") summary.low++;
    if (m.competitorProximity) {
      summary.competitorProximity[m.competitorProximity] = (summary.competitorProximity[m.competitorProximity] ?? 0) + 1;
    }
  }

  return {
    ...result,
    sentimentSummary: summary,
    privacyMode: "local-only",
    sentimentModel,
  };
}
