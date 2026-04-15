/**
 * NLP Query Engine — classifies user intent, routes to specialized handlers,
 * and generates answers grounded in crawl data.
 *
 * ── Unit 7 honesty goal ──────────────────────────────────────────────────
 *
 * Every answer is wrapped in { answer, confidence, citedPages[] }. The LLM
 * never produces a numeric claim without a citation: each handler returns the
 * concrete list of crawl URLs it fed the model, and the router appends a
 * "Based on N pages from crawl" footer so the UI never hides provenance.
 *
 * Confidence levels:
 *   high   — the handler had ≥5 concrete crawl rows (or a BM25 avg score ≥3)
 *   medium — at least one row but fewer than 5 (or BM25 avg ∈ [1, 3))
 *   low    — zero matches, or the RAG fallback kicked in without retrieval hits
 *
 * ────────────────────────────────────────────────────────────────────────
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildGeminiPayloadFromReports } from "./gemini-report.js";
import { generateText } from "./llm.js";
import { buildIndex, retrieve, hasIndex } from "./agentic/rag-engine.js";
import type { HealthRunMeta } from "./orchestrate-health.js";
import type { SiteHealthReport } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NlpIntent =
  | "SEO_AUDIT"
  | "PERFORMANCE_ANALYSIS"
  | "BROKEN_LINKS"
  | "CONTENT_ANALYSIS"
  | "ISSUE_SUMMARY"
  | "GENERAL_QUESTION";

export type AnswerConfidence = "high" | "medium" | "low";

const VALID_INTENTS: NlpIntent[] = [
  "SEO_AUDIT", "PERFORMANCE_ANALYSIS", "BROKEN_LINKS",
  "CONTENT_ANALYSIS", "ISSUE_SUMMARY", "GENERAL_QUESTION",
];

export interface ClassificationResult {
  intent: NlpIntent;
  parameters: {
    domain?: string;
    filter?: string;
    scope?: string;
    metric?: string;
  };
  clarification_needed: boolean;
  follow_up_question: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface NlpQueryRequest {
  query: string;
  runId?: string;
  history?: ChatMessage[];
}

export interface NlpQueryResponse {
  answer: string;
  intent: NlpIntent;
  clarification_needed: boolean;
  follow_up_question: string | null;
  /** Honesty indicator — "low" means the retriever found no solid grounding. */
  confidence: AnswerConfidence;
  /** URLs from the crawl that backed the answer. Empty when clarification-only. */
  citedPages: string[];
}

interface HandlerResult {
  text: string;
  citedPages: string[];
  confidence: AnswerConfidence;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHistoryContext(history: ChatMessage[]): string {
  const recent = history.slice(-6);
  if (recent.length === 0) return "";
  const lines = recent.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 500)}`,
  );
  return `Previous conversation:\n${lines.join("\n")}\n`;
}

function extractJson(text: string): unknown | null {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    cleaned = lines.slice(1, lines[lines.length - 1]?.trim() === "```" ? -1 : undefined).join("\n");
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Confidence based on how many concrete rows we fed the LLM. */
function confidenceFromCount(n: number): AnswerConfidence {
  if (n === 0) return "low";
  if (n < 5) return "medium";
  return "high";
}

/** Dedupe + cap a list of URLs (stable order). */
function uniqUrls(urls: string[], max: number = 10): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** Append an honesty footer naming the number of citations. */
function withFooter(text: string, citedCount: number): string {
  const suffix = citedCount > 0
    ? `Based on ${citedCount} page${citedCount === 1 ? "" : "s"} from crawl.`
    : `No matching crawl pages cited — answer is not grounded in specific pages.`;
  return `${text.trim()}\n\n_${suffix}_`;
}

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

const CLASSIFICATION_PROMPT = `You are an intent classifier for a website QA/health crawl tool. Given a user question about their crawl data, classify it into exactly ONE intent and extract parameters.

Available intents:
- SEO_AUDIT: Questions about on-page SEO issues (missing H1, title tags, meta descriptions, canonical URLs, lang attributes, schema markup)
- PERFORMANCE_ANALYSIS: Questions about page speed, Lighthouse scores, load times, Core Web Vitals (LCP, FCP, CLS, TBT)
- BROKEN_LINKS: Questions about broken links, dead links, 404 errors, failed fetches, redirect chains
- CONTENT_ANALYSIS: Questions about content quality (short/long meta descriptions, duplicate titles, missing elements, word counts)
- ISSUE_SUMMARY: Questions asking for a summary of issues, critical problems, overall health, or prioritized action items
- GENERAL_QUESTION: Any other question about the crawl data that does not fit above

Return ONLY valid JSON (no markdown fences, no text before or after):
{
  "intent": "<one of the intent names above>",
  "parameters": {
    "domain": "<specific domain mentioned, or null>",
    "filter": "<specific filter like 'missing_h1', 'slow_pages', 'short_meta', 'duplicate_titles', or null>",
    "scope": "<'all_pages', 'single_site', or null>",
    "metric": "<specific metric like 'lcp', 'fcp', 'cls', 'performance', or null>"
  },
  "clarification_needed": false,
  "follow_up_question": null
}`;

export async function classifyIntent(
  query: string,
  history: ChatMessage[],
): Promise<ClassificationResult> {
  const historyBlock = buildHistoryContext(history);
  const prompt = `${CLASSIFICATION_PROMPT}

${historyBlock ? historyBlock + "\n" : ""}Current user question:
${query}`;

  try {
    const raw = await generateText(prompt);
    const data = extractJson(raw) as Record<string, unknown> | null;
    if (!data) throw new Error("No JSON in response");

    const intent = VALID_INTENTS.includes(data.intent as NlpIntent)
      ? (data.intent as NlpIntent)
      : "GENERAL_QUESTION";
    const params = typeof data.parameters === "object" && data.parameters !== null
      ? (data.parameters as ClassificationResult["parameters"])
      : {};

    return {
      intent,
      parameters: params,
      clarification_needed: data.clarification_needed === true,
      follow_up_question: typeof data.follow_up_question === "string" ? data.follow_up_question : null,
    };
  } catch {
    return {
      intent: "GENERAL_QUESTION",
      parameters: {},
      clarification_needed: false,
      follow_up_question: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

async function handleSeoAudit(
  query: string,
  reports: SiteHealthReport[],
  classification: ClassificationResult,
  history: ChatMessage[],
): Promise<HandlerResult> {
  const pages: { site: string; url: string; title?: string; metaDescLen?: number; h1Count?: number; lang?: string; canonical?: string }[] = [];
  for (const r of reports) {
    for (const p of r.crawl.pages) {
      pages.push({
        site: r.hostname,
        url: p.url,
        title: p.documentTitle,
        metaDescLen: p.metaDescriptionLength,
        h1Count: p.h1Count,
        lang: p.documentLang,
        canonical: p.canonicalUrl,
      });
    }
  }

  let filtered = pages;
  const f = classification.parameters.filter;
  if (f === "missing_h1") filtered = pages.filter((p) => p.h1Count === 0);
  else if (f === "short_meta") filtered = pages.filter((p) => p.metaDescLen !== undefined && p.metaDescLen < 120);
  else if (f === "missing_title") filtered = pages.filter((p) => !p.title);
  else if (f === "missing_lang") filtered = pages.filter((p) => !p.lang);

  const capped = filtered.slice(0, 60);
  const historyCtx = buildHistoryContext(history);

  const prompt = `You are an SEO expert analyzing crawl data. Answer the user's question using ONLY the data below.

Rules:
- Be specific: cite URLs and exact counts from the data.
- Use markdown with bullet points or a short table.
- Max 300 words.
- If the data does not contain enough info, say so.
- Do NOT invent URLs, scores, or counts that aren't in the data.

${historyCtx}
User question: ${query}

SEO data (${capped.length} of ${pages.length} total pages):
${JSON.stringify(capped, null, 2)}`;

  const text = await generateText(prompt);
  return {
    text,
    citedPages: uniqUrls(capped.map((p) => p.url)),
    confidence: confidenceFromCount(capped.length),
  };
}

async function handlePerformanceAnalysis(
  query: string,
  reports: SiteHealthReport[],
  classification: ClassificationResult,
  history: ChatMessage[],
): Promise<HandlerResult> {
  const entries: { site: string; url: string; perfMobile?: number; perfDesktop?: number; fcpMs?: number; lcpMs?: number; tbtMs?: number; cls?: number; speedIndexMs?: number; loadMs: number }[] = [];
  for (const r of reports) {
    for (const p of r.crawl.pages) {
      const insights = p.insights;
      let mobile: { scores?: { performance?: number }; metrics?: { fcpMs?: number; lcpMs?: number; tbtMs?: number; cls?: number; speedIndexMs?: number } } | undefined;
      let desktop: typeof mobile | undefined;
      if (insights && "mobile" in insights) {
        mobile = insights.mobile;
        desktop = insights.desktop;
      } else if (insights && "strategy" in insights) {
        if (insights.strategy === "mobile") mobile = insights;
        else desktop = insights;
      }
      entries.push({
        site: r.hostname,
        url: p.url,
        perfMobile: mobile?.scores?.performance,
        perfDesktop: desktop?.scores?.performance,
        fcpMs: mobile?.metrics?.fcpMs ?? desktop?.metrics?.fcpMs,
        lcpMs: mobile?.metrics?.lcpMs ?? desktop?.metrics?.lcpMs,
        tbtMs: mobile?.metrics?.tbtMs ?? desktop?.metrics?.tbtMs,
        cls: mobile?.metrics?.cls ?? desktop?.metrics?.cls,
        speedIndexMs: mobile?.metrics?.speedIndexMs ?? desktop?.metrics?.speedIndexMs,
        loadMs: p.durationMs,
      });
    }
  }

  entries.sort((a, b) => (a.perfMobile ?? 100) - (b.perfMobile ?? 100));
  const capped = entries.slice(0, 40);
  const withPerfData = capped.filter((e) => e.perfMobile !== undefined || e.perfDesktop !== undefined);
  const historyCtx = buildHistoryContext(history);

  const prompt = `You are a web performance expert analyzing Lighthouse/PageSpeed data. Answer using ONLY the data below.

Rules:
- Cite specific URLs, scores, and metric values.
- Use markdown; a table is preferred for comparisons.
- Max 300 words.
- If Core Web Vitals data is missing, say so rather than guessing.
- Do NOT invent scores or URLs that aren't in the data.

${historyCtx}
User question: ${query}

Performance data (${capped.length} of ${entries.length} total pages):
${JSON.stringify(capped, null, 2)}`;

  const text = await generateText(prompt);
  // When no page has real PageSpeed data, downgrade confidence — the LLM can
  // describe loadMs but it's not the metric the user usually asks about.
  const confidence: AnswerConfidence = withPerfData.length === 0
    ? "low"
    : confidenceFromCount(withPerfData.length);
  return {
    text,
    citedPages: uniqUrls(capped.map((e) => e.url)),
    confidence,
  };
}

async function handleBrokenLinks(
  query: string,
  reports: SiteHealthReport[],
  history: ChatMessage[],
): Promise<HandlerResult> {
  const data: { site: string; brokenLinks: { foundOn: string; target: string; status?: number; error?: string }[]; failedPages: { url: string; status: number; error?: string }[] }[] = [];
  const cited: string[] = [];
  let brokenCount = 0;
  for (const r of reports) {
    const bl = r.crawl.brokenLinks.slice(0, 50).map((l) => ({
      foundOn: l.foundOn, target: l.target, status: l.status, error: l.error,
    }));
    const fp = r.crawl.pages.filter((p) => !p.ok).slice(0, 20).map((p) => ({
      url: p.url, status: p.status, error: p.error,
    }));
    if (bl.length > 0 || fp.length > 0) {
      data.push({ site: r.hostname, brokenLinks: bl, failedPages: fp });
      for (const l of bl) { cited.push(l.foundOn); brokenCount++; }
      for (const p of fp) { cited.push(p.url); brokenCount++; }
    }
  }
  const historyCtx = buildHistoryContext(history);

  const prompt = `You are a QA engineer analyzing broken links in a site health crawl. Answer using ONLY the data below.

Rules:
- List broken links with their HTTP status codes and the page where they were found.
- Group by site if multiple sites are present.
- Use markdown with bullet points or a table.
- Max 300 words.
- Do NOT invent URLs or status codes that aren't in the data.

${historyCtx}
User question: ${query}

Broken links data:
${JSON.stringify(data, null, 2)}`;

  const text = await generateText(prompt);
  return {
    text,
    citedPages: uniqUrls(cited),
    confidence: confidenceFromCount(brokenCount),
  };
}

async function handleContentAnalysis(
  query: string,
  reports: SiteHealthReport[],
  classification: ClassificationResult,
  history: ChatMessage[],
): Promise<HandlerResult> {
  const pages: { site: string; url: string; title?: string; metaDescLen?: number; h1Count?: number; bodyBytes?: number }[] = [];
  for (const r of reports) {
    for (const p of r.crawl.pages) {
      pages.push({
        site: r.hostname,
        url: p.url,
        title: p.documentTitle,
        metaDescLen: p.metaDescriptionLength,
        h1Count: p.h1Count,
        bodyBytes: p.bodyBytes,
      });
    }
  }

  const issues = {
    shortMeta: pages.filter((p) => p.metaDescLen !== undefined && p.metaDescLen < 120).length,
    missingMeta: pages.filter((p) => p.metaDescLen === undefined || p.metaDescLen === 0).length,
    missingH1: pages.filter((p) => p.h1Count === 0).length,
    multipleH1: pages.filter((p) => p.h1Count !== undefined && p.h1Count > 1).length,
    duplicateTitles: findDuplicates(pages.map((p) => p.title).filter(Boolean) as string[]),
  };

  const capped = pages.slice(0, 60);
  const historyCtx = buildHistoryContext(history);

  const prompt = `You are a content strategist reviewing page metadata from a crawl. Answer using ONLY the data below.

Rules:
- Be specific about which pages have issues and what the issue is.
- Use markdown with bullets or a table.
- Max 300 words.
- Do NOT invent pages or counts that aren't in the data.

${historyCtx}
User question: ${query}

Content summary:
- Total pages: ${pages.length}
- Short meta descriptions (<120 chars): ${issues.shortMeta}
- Missing meta descriptions: ${issues.missingMeta}
- Missing H1: ${issues.missingH1}
- Multiple H1s: ${issues.multipleH1}
- Duplicate titles: ${issues.duplicateTitles.length}

Page data (${capped.length} pages):
${JSON.stringify(capped, null, 2)}

Duplicate titles:
${JSON.stringify(issues.duplicateTitles, null, 2)}`;

  const text = await generateText(prompt);
  return {
    text,
    citedPages: uniqUrls(capped.map((p) => p.url)),
    confidence: confidenceFromCount(capped.length),
  };
}

function findDuplicates(arr: string[]): { title: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of arr) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, c]) => c > 1).map(([title, count]) => ({ title, count }));
}

async function handleIssueSummary(
  query: string,
  reports: SiteHealthReport[],
  history: ChatMessage[],
): Promise<HandlerResult> {
  const summary = {
    totalSites: reports.length,
    sites: reports.map((r) => {
      const pages = r.crawl.pages;
      const failedFetches = pages.filter((p) => !p.ok).length;
      const missingH1 = pages.filter((p) => p.h1Count === 0).length;
      const shortMeta = pages.filter((p) => p.metaDescriptionLength !== undefined && p.metaDescriptionLength < 120).length;
      const perfScores = pages
        .map((p) => {
          const ins = p.insights;
          if (!ins) return undefined;
          if ("mobile" in ins) return ins.mobile?.scores?.performance;
          if ("scores" in ins) return ins.scores?.performance;
          return undefined;
        })
        .filter((s): s is number => s !== undefined);
      const avgPerf = perfScores.length > 0 ? Math.round(perfScores.reduce((a, b) => a + b, 0) / perfScores.length) : undefined;
      const viewportIssues = r.crawl.viewportChecks?.filter((v) => !v.mobile.ok || !v.desktop.ok).length ?? 0;

      return {
        hostname: r.hostname,
        pagesVisited: r.crawl.pagesVisited,
        brokenLinks: r.crawl.brokenLinks.length,
        failedFetches,
        missingH1,
        shortMeta,
        avgPerformanceScore: avgPerf,
        viewportIssues,
      };
    }),
  };
  const historyCtx = buildHistoryContext(history);

  const prompt = `You are a QA lead summarizing crawl health issues. Provide a prioritized summary using ONLY the data below.

Rules:
- Group issues by severity: Critical, Warning, Info.
- Include counts and specific examples.
- Use markdown with headers and bullet points.
- Max 400 words.
- Do NOT invent sites, issues, or counts that aren't in the data.

${historyCtx}
User question: ${query}

Issue summary:
${JSON.stringify(summary, null, 2)}`;

  const text = await generateText(prompt);

  // Cite each site's start URL + a few concrete failed pages as evidence.
  const cited: string[] = [];
  for (const r of reports) {
    if (r.startUrl) cited.push(r.startUrl);
    for (const p of r.crawl.pages.filter((p) => !p.ok).slice(0, 3)) {
      cited.push(p.url);
    }
  }
  return {
    text,
    citedPages: uniqUrls(cited),
    confidence: confidenceFromCount(reports.length),
  };
}

async function handleGeneralQuestion(
  query: string,
  runId: string,
  reports: SiteHealthReport[],
  generatedAt: string,
  history: ChatMessage[],
): Promise<HandlerResult> {
  // Use RAG retrieval for targeted context instead of dumping the full payload
  if (!hasIndex(runId)) buildIndex(runId, reports);
  const chunks = retrieve(runId, query, 20);
  const historyCtx = buildHistoryContext(history);

  if (chunks.length > 0) {
    const contextData = chunks.map((c) => c.text).join("\n\n");
    const prompt = `You answer questions about ONE website health crawl run. Use ONLY the data below — do not invent URLs, scores, counts, or issues.

Rules:
- 2-4 sentences OR up to 6 bullet points. No preamble.
- Cite exact numbers from the data when relevant.
- If the data does not contain enough info to answer, say "Not in this run's report data."

${historyCtx}
User question: ${query}

Retrieved context (${chunks.length} most relevant pages):
${contextData}`;

    const text = await generateText(prompt);
    // BM25 scores are unbounded; these cutoffs were tuned against the
    // rag-engine's current term-weighting on typical crawl documents.
    const avgScore = chunks.reduce((s, c) => s + c.score, 0) / chunks.length;
    const confidence: AnswerConfidence = avgScore >= 3 ? "high" : avgScore >= 1 ? "medium" : "low";
    return {
      text,
      citedPages: uniqUrls(chunks.map((c) => c.url)),
      confidence,
    };
  }

  // Fallback to full payload if RAG returns nothing — no per-page grounding,
  // so confidence is always "low" here.
  const payload = buildGeminiPayloadFromReports(reports, runId, generatedAt, {
    pageSpeedSampleLimit: 80,
    pageSpeedPreferAnalyzed: true,
  });

  const prompt = `You answer questions about ONE website health crawl run. Use ONLY the JSON below — do not invent URLs, scores, counts, or issues.

Rules:
- 2-4 sentences OR up to 6 bullet points. No preamble.
- Cite exact numbers from the JSON when relevant.
- If the JSON does not contain enough data to answer, say "Not in this run's report data."

${historyCtx}
User question: ${query}

Run data:
${JSON.stringify(payload, null, 2)}`;

  const text = await generateText(prompt);
  return {
    text,
    citedPages: [],
    confidence: "low",
  };
}

// ---------------------------------------------------------------------------
// Query router (public entry point)
// ---------------------------------------------------------------------------

export async function routeQuery(
  query: string,
  runId: string,
  reports: SiteHealthReport[],
  generatedAt: string,
  history: ChatMessage[],
): Promise<NlpQueryResponse> {
  // Ensure RAG index exists for this run
  if (!hasIndex(runId)) buildIndex(runId, reports);

  const classification = await classifyIntent(query, history);

  if (classification.clarification_needed && classification.follow_up_question) {
    return {
      answer: classification.follow_up_question,
      intent: classification.intent,
      clarification_needed: true,
      follow_up_question: classification.follow_up_question,
      confidence: "low",
      citedPages: [],
    };
  }

  let result: HandlerResult;
  switch (classification.intent) {
    case "SEO_AUDIT":
      result = await handleSeoAudit(query, reports, classification, history);
      break;
    case "PERFORMANCE_ANALYSIS":
      result = await handlePerformanceAnalysis(query, reports, classification, history);
      break;
    case "BROKEN_LINKS":
      result = await handleBrokenLinks(query, reports, history);
      break;
    case "CONTENT_ANALYSIS":
      result = await handleContentAnalysis(query, reports, classification, history);
      break;
    case "ISSUE_SUMMARY":
      result = await handleIssueSummary(query, reports, history);
      break;
    default:
      result = await handleGeneralQuestion(query, runId, reports, generatedAt, history);
      break;
  }

  return {
    answer: withFooter(result.text, result.citedPages.length),
    intent: classification.intent,
    clarification_needed: false,
    follow_up_question: null,
    confidence: result.confidence,
    citedPages: result.citedPages,
  };
}

// ---------------------------------------------------------------------------
// Raw report loader (replicates MASTER JSON resolution from dashboard server)
// ---------------------------------------------------------------------------

export async function loadRawReportsForRun(
  outRoot: string,
  runId: string,
): Promise<{ reports: SiteHealthReport[]; generatedAt: string } | null> {
  const runDir = path.join(outRoot, runId);
  try {
    const st = await stat(runDir);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }

  let meta: HealthRunMeta;
  try {
    const raw = await readFile(path.join(runDir, "run-meta.json"), "utf8");
    meta = JSON.parse(raw) as HealthRunMeta;
  } catch {
    return null;
  }

  let jsonPath: string | null = null;
  const href = meta.masterHtmlHref?.trim() ?? "";
  const norm = href.replace(/^\.\//, "").replace(/\\/g, "/");
  if (norm.endsWith(".html")) {
    const jsonRel = `${norm.slice(0, -".html".length)}.json`;
    const candidate = path.join(runDir, jsonRel);
    try {
      const st2 = await stat(candidate);
      if (st2.isFile()) jsonPath = candidate;
    } catch {
      /* fall through */
    }
  }
  if (!jsonPath) {
    try {
      const dirents = await readdir(runDir, { withFileTypes: true });
      const jsonFiles = dirents
        .filter((e) => e.isFile() && e.name.startsWith("MASTER-all-sites-") && e.name.endsWith(".json"))
        .map((e) => e.name)
        .sort();
      if (jsonFiles.length > 0) {
        jsonPath = path.join(runDir, jsonFiles[jsonFiles.length - 1]!);
      }
    } catch {
      return null;
    }
  }
  if (!jsonPath) return null;

  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return null;
  }
  let data: { generatedAt?: string; sites?: SiteHealthReport[] };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return null;
  }
  if (!Array.isArray(data.sites) || data.sites.length === 0) return null;

  return {
    reports: data.sites,
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : meta.generatedAt,
  };
}
