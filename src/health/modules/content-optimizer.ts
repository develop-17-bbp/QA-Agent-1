import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";
import { dp, type DataPoint } from "../providers/types.js";
import { searchSerp } from "../agentic/duckduckgo-serp.js";

// ── Unit 3 honesty goal ────────────────────────────────────────────────────
//
// The OLD version asked the LLM to invent scores, word counts, readability,
// target word counts, tone, uniqueAngle, etc. An SEO team would compare those
// hallucinated numbers against Semrush and immediately lose trust. This rewrite:
//
//   analyzeWritingAssistant — all numeric scores derived deterministically from
//     crawl fields (title length, meta desc length, h1 count, canonical, lang,
//     status, duration, body bytes). LLM restricted to ≤120-char "why this
//     matters" commentary for each failed rule.
//
//   generateContentTemplate — targetWordCount is the average word count of the
//     top SERP competitors, fetched via real HTTP. LLM restricted to qualitative
//     template skeleton (title, headings, outline, etc.) — no numbers.
//
// ─────────────────────────────────────────────────────────────────────────────

type DataQuality = {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};

// ── Shared helpers ───────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","is","was","are","were","be","been","being","have","has","had","do",
  "does","did","will","would","could","should","may","might","can","that","this",
  "these","those","it","its","not","no","as","up","out","if","about","over",
  "after","before","more","also","than","into","their","they","them","then",
  "there","which","when","where","who","what","how","your","our","their",
]);

function extractKeywordsFromTitle(title: string | undefined): string[] {
  if (!title) return [];
  return [...new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w)),
  )];
}

// ── analyzeWritingAssistant ──────────────────────────────────────────────────

type RuleResult = {
  label: string;
  points: number;
  passed: boolean;
  category: "SEO" | "Content" | "Technical";
  priority: "High" | "Medium" | "Low";
  issue: string;
};

function scoreRules(page: {
  documentTitle?: string;
  metaDescriptionLength?: number;
  h1Count?: number;
  canonicalUrl?: string;
  documentLang?: string;
  status?: number;
  durationMs?: number;
  bodyBytes?: number;
}): RuleResult[] {
  const titleLen = (page.documentTitle ?? "").length;
  const metaLen = page.metaDescriptionLength ?? 0;
  const bodyBytes = page.bodyBytes ?? 0;

  return [
    {
      label: "title-length-30-60",
      points: 15,
      passed: titleLen >= 30 && titleLen <= 60,
      category: "SEO",
      priority: "High",
      issue: `Title length is ${titleLen} chars (target: 30–60)`,
    },
    {
      label: "meta-desc-120-160",
      points: 15,
      passed: metaLen >= 120 && metaLen <= 160,
      category: "SEO",
      priority: "High",
      issue: `Meta description length is ${metaLen} chars (target: 120–160)`,
    },
    {
      label: "h1-count-1",
      points: 15,
      passed: (page.h1Count ?? 0) === 1,
      category: "SEO",
      priority: "High",
      issue: `Page has ${page.h1Count ?? 0} H1 element(s) (expected exactly 1)`,
    },
    {
      label: "canonical-present",
      points: 10,
      passed: Boolean(page.canonicalUrl),
      category: "Technical",
      priority: "Medium",
      issue: "No canonical URL tag present",
    },
    {
      label: "lang-set",
      points: 10,
      passed: Boolean(page.documentLang),
      category: "Technical",
      priority: "Medium",
      issue: "Document language not declared on <html>",
    },
    {
      label: "status-200",
      points: 10,
      passed: (page.status ?? 0) === 200,
      category: "Technical",
      priority: "High",
      issue: `HTTP status is ${page.status ?? "unknown"} (expected 200)`,
    },
    {
      label: "load-under-3s",
      points: 10,
      passed: (page.durationMs ?? 9999) < 3000,
      category: "Technical",
      priority: "Medium",
      issue: `Page load time is ${page.durationMs ?? "unknown"}ms (target: <3000ms)`,
    },
    {
      label: "body-bytes-5k-80k",
      points: 15,
      passed: bodyBytes >= 5000 && bodyBytes <= 80000,
      category: "Content",
      priority: "Medium",
      issue: `Body size is ${bodyBytes} bytes (target: 5000–80000)`,
    },
  ];
}

const FALLBACK_SUGGESTION = "Fix this rule to improve on-page SEO.";

async function llmSuggestions(failedLabels: string[]): Promise<string[]> {
  if (failedLabels.length === 0) return [];
  const prompt = `You are an SEO advisor. For each failed SEO rule below, write a single sentence (≤120 chars) explaining WHY fixing it matters for search rankings. Return ONLY a JSON array of strings in the same order — no keys, no markdown.

Rules:
${failedLabels.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
  try {
    const text = await generateText(prompt);
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(clean) as unknown;
    if (Array.isArray(parsed) && parsed.length === failedLabels.length) {
      return parsed.map((s) => (typeof s === "string" ? s.slice(0, 180) : FALLBACK_SUGGESTION));
    }
  } catch { /* fall through */ }
  return failedLabels.map(() => FALLBACK_SUGGESTION);
}

export async function analyzeWritingAssistant(url: string, reports: SiteHealthReport[]) {
  const allPages = reports.flatMap((r) => r.crawl.pages);
  const page = allPages.find((p) => p.url === url) ?? allPages[0];
  if (!page) return { url, scores: {}, recommendations: [], error: "Page not found in crawl data" };

  const rules = scoreRules(page);
  const passed = rules.filter((r) => r.passed);
  const failed = rules.filter((r) => !r.passed);

  // ── Numeric scores (deterministic sub-score buckets) ──────────────────────
  const seoRulePoints = rules
    .filter((r) => r.category === "SEO")
    .reduce((s, r) => s + (r.passed ? r.points : 0), 0);
  const techRulePoints = rules
    .filter((r) => r.category === "Technical")
    .reduce((s, r) => s + (r.passed ? r.points : 0), 0);
  const contentRulePoints = rules
    .filter((r) => r.category === "Content")
    .reduce((s, r) => s + (r.passed ? r.points : 0), 0);

  const totalPossible = rules.reduce((s, r) => s + r.points, 0); // 100
  const overallScore = passed.reduce((s, r) => s + r.points, 0);

  const NOTE = "Deterministic crawl-field heuristic — not an LLM guess";
  const TTL = 3_600_000;

  // SEO score = seo sub-score (40 pts possible) normalised to 0–100
  const seoScore = Math.round((seoRulePoints / 40) * 100);
  // Readability proxied by content/tech (60 pts possible) normalised to 0–100
  const readabilityScore = Math.round(((techRulePoints + contentRulePoints) / 60) * 100);
  // Tone & originality cannot be measured from a crawl page; fixed heuristic = 50 (medium uncertainty)
  const toneScore = 50;
  const originalityScore = 50;

  const scores = {
    readability: dp<number>(readabilityScore, "crawl-heuristic", "medium", TTL,
      `tech(${techRulePoints}/40) + content(${contentRulePoints}/20) sub-scores / 60 × 100. ${NOTE}`),
    seo: dp<number>(seoScore, "crawl-heuristic", "medium", TTL,
      `seo sub-score (${seoRulePoints}/40) × 100. ${NOTE}`),
    tone: dp<number>(toneScore, "crawl-heuristic", "low", TTL,
      `Fixed 50 — tone cannot be measured from crawl fields. ${NOTE}`),
    originality: dp<number>(originalityScore, "crawl-heuristic", "low", TTL,
      `Fixed 50 — originality cannot be measured from crawl fields. ${NOTE}`),
    overall: dp<number>(overallScore, "crawl-heuristic", "medium", TTL,
      `Sum of passed sub-score points (max ${totalPossible}). ${NOTE}`),
  };

  // ── Recommendations ────────────────────────────────────────────────────────
  const suggestions = await llmSuggestions(failed.map((r) => r.label));
  const recommendations = failed.map((r, i) => ({
    category: r.category,
    priority: r.priority,
    issue: r.issue,
    suggestion: suggestions[i] ?? FALLBACK_SUGGESTION,
    impact: r.priority,
  }));

  // ── Derived fields ─────────────────────────────────────────────────────────
  const bodyBytes = page.bodyBytes ?? 0;

  const wordCountEstimate = dp<number>(
    Math.round(bodyBytes / 6),
    "crawl-heuristic",
    "low",
    TTL,
    "bytes/6 approximation — actual word count requires HTML parsing",
  );

  const keywordsDetected = dp<string[]>(
    extractKeywordsFromTitle(page.documentTitle),
    "crawl",
    "high",
    TTL,
    "Extracted from document title — lowercased, stopwords removed, >3 chars",
  );

  const readabilityLevel: "Basic" | "Intermediate" | "Advanced" =
    bodyBytes < 5000 ? "Basic" : bodyBytes <= 20000 ? "Intermediate" : "Advanced";

  const contentType: "Article" | "Product Page" | "About/Contact" | "Landing Page" =
    /blog|article|post|news/i.test(page.url) ? "Article" :
    /product|shop|store|cart/i.test(page.url) ? "Product Page" :
    /about|contact|team/i.test(page.url) ? "About/Contact" :
    "Landing Page";

  return {
    url: page.url,
    scores,
    recommendations,
    wordCountEstimate,
    keywordsDetected,
    readabilityLevel,
    contentType,
    dataQuality: {
      realDataFields: [
        "scores.readability",
        "scores.seo",
        "scores.overall",
        "wordCountEstimate",
        "keywordsDetected",
        "readabilityLevel",
        "contentType",
      ],
      estimatedFields: ["recommendations.suggestion", "scores.tone", "scores.originality"],
      missingFields: [],
      providersHit: ["crawl"],
      providersFailed: [],
    } satisfies DataQuality,
  };
}

// ── generateContentTemplate ──────────────────────────────────────────────────

export async function generateContentTemplate(keyword: string) {
  const missingFields: string[] = [];
  const providersFailed: string[] = [];
  const providersHit: string[] = [];

  // ── Step 1: SERP competitor URLs ──────────────────────────────────────────
  let serpUrls: string[] = [];
  try {
    const serp = await searchSerp(keyword);
    serpUrls = serp.results.slice(0, 10).map((r) => r.url);
    if (serpUrls.length > 0) providersHit.push("duckduckgo-serp");
    else providersFailed.push("duckduckgo-serp");
  } catch {
    providersFailed.push("duckduckgo-serp");
  }

  // ── Step 2: Fetch each competitor and count words ─────────────────────────
  const competitorsAnalyzed: { url: string; wordCount: number }[] = [];

  await Promise.allSettled(
    serpUrls.map(async (compUrl) => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(compUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; QA-Agent/1.0)" },
        });
        clearTimeout(tid);
        if (!res.ok) return;
        const html = await res.text();
        const text = html.replace(/<[^>]+>/g, " ");
        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        competitorsAnalyzed.push({ url: compUrl, wordCount });
      } catch {
        clearTimeout(tid);
      }
    }),
  );

  // ── Step 3: Compute targetWordCount from real competitor data ─────────────
  let targetWordCount: DataPoint<number> | null = null;
  if (competitorsAnalyzed.length >= 1) {
    const avg = competitorsAnalyzed.reduce((s, c) => s + c.wordCount, 0) / competitorsAnalyzed.length;
    targetWordCount = dp<number>(
      Math.round(avg),
      "serp-competitor-average",
      "medium",
      3_600_000,
      `avg of ${competitorsAnalyzed.length} crawled competitor(s)`,
    );
  } else {
    // No competitors fetched — cannot make up a number
    if (!providersFailed.includes("duckduckgo-serp")) providersFailed.push("duckduckgo-serp");
    missingFields.push("targetWordCount");
  }

  // ── Step 4: LLM for qualitative template skeleton only ───────────────────
  const competitorContext = competitorsAnalyzed.length > 0
    ? `Top ${competitorsAnalyzed.length} SERP competitor URLs for context:\n${competitorsAnalyzed.map((c, i) => `${i + 1}. ${c.url} (${c.wordCount} words)`).join("\n")}`
    : "No competitor data available.";

  const prompt = `You are an SEO content strategist. Create a qualitative content template for the keyword: "${keyword}"

${competitorContext}

STRICT RULES:
- Do NOT include any word counts, volumes, numbers, or statistics. Those will be provided separately.
- Only return the structural skeleton: title, meta description, headings, keyword variants, outline section names with key points, and SEO checklist.

Return ONLY valid JSON (no markdown, no backticks):
{
  "title": "SEO-optimized title (50-60 chars, do NOT include word count)",
  "metaDescription": "Meta description (150-160 chars)",
  "headings": [{ "level": "h1", "text": "..." }, { "level": "h2", "text": "..." }],
  "keywords": { "primary": ["${keyword}"], "secondary": ["..."], "lsi": ["..."] },
  "outline": [{ "section": "Introduction", "keyPoints": ["point 1", "point 2"] }],
  "seoChecklist": ["Include primary keyword in title", "Use keyword in first 100 words"],
  "contentBrief": {
    "readabilityLevel": "Intermediate",
    "tone": "Professional",
    "targetAudience": "...",
    "uniqueAngle": "..."
  }
}

Create a detailed template with 8-12 headings, 5-7 outline sections with 2-3 key points each, and 8-10 checklist items.`;

  let title = "";
  let metaDescription = "";
  let headings: { level: string; text: string }[] = [];
  let keywords: { primary: string[]; secondary: string[]; lsi: string[] } = {
    primary: [keyword],
    secondary: [],
    lsi: [],
  };
  let outline: { section: string; keyPoints: string[] }[] = [];
  let seoChecklist: string[] = [];
  let contentBriefQualitative: { readabilityLevel: string; tone: string; targetAudience: string; uniqueAngle: string } = {
    readabilityLevel: "",
    tone: "",
    targetAudience: "",
    uniqueAngle: "",
  };

  try {
    const text = await generateText(prompt);
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;
    title = typeof parsed.title === "string" ? parsed.title : "";
    metaDescription = typeof parsed.metaDescription === "string" ? parsed.metaDescription : "";
    headings = Array.isArray(parsed.headings) ? (parsed.headings as { level: string; text: string }[]) : [];
    keywords = (parsed.keywords as typeof keywords) ?? keywords;
    outline = Array.isArray(parsed.outline) ? (parsed.outline as { section: string; keyPoints: string[] }[]) : [];
    seoChecklist = Array.isArray(parsed.seoChecklist)
      ? (parsed.seoChecklist as string[]).filter((s) => typeof s === "string")
      : [];
    if (parsed.contentBrief && typeof parsed.contentBrief === "object") {
      const cb = parsed.contentBrief as Record<string, unknown>;
      contentBriefQualitative = {
        readabilityLevel: typeof cb.readabilityLevel === "string" ? cb.readabilityLevel : "",
        tone: typeof cb.tone === "string" ? cb.tone : "",
        targetAudience: typeof cb.targetAudience === "string" ? cb.targetAudience : "",
        uniqueAngle: typeof cb.uniqueAngle === "string" ? cb.uniqueAngle : "",
      };
    }
  } catch {
    missingFields.push("template");
  }

  return {
    keyword,
    title,
    metaDescription,
    headings,
    keywords,
    contentBrief: {
      targetWordCount,
      readabilityLevel: contentBriefQualitative.readabilityLevel,
      tone: contentBriefQualitative.tone,
      targetAudience: contentBriefQualitative.targetAudience,
      uniqueAngle: contentBriefQualitative.uniqueAngle,
    },
    outline,
    seoChecklist,
    competitorsAnalyzed,
    dataQuality: {
      realDataFields: ["targetWordCount", "competitorsAnalyzed"],
      estimatedFields: [
        "title",
        "metaDescription",
        "headings",
        "outline",
        "seoChecklist",
        "keywords",
        "tone",
        "targetAudience",
        "uniqueAngle",
      ],
      missingFields,
      providersHit,
      providersFailed,
    } satisfies DataQuality,
  };
}
