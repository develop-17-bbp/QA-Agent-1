import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";
import { dp, type DataPoint } from "../providers/types.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";

// ── Unit 8 honesty goal ──────────────────────────────────────────────────
//
// The old version was already mostly deterministic — the quality score is
// computed from real crawl fields — but it let the LLM invent a generic list
// of 5–7 "recommendations". Users read those as a semrush-style "fix plan"
// even though the LLM never saw the specific pages. It also exposed raw
// numbers with no provenance so the UI couldn't show which crawl fields
// backed each score.
//
// This rewrite:
//   1. Wraps the per-page qualityScore + summary counts in DataPoint<number>.
//   2. Attaches a DataQuality envelope listing every real crawl field used.
//   3. Computes duplicate-title detection from crawl titles (real).
//   4. Adds an estimated word count from bodyBytes with confidence:"low".
//   5. Restricts the LLM to a single ≤3-sentence "why this matters"
//      commentary keyed off the top three issues — no invented pages,
//      counts, or sites.
//
// ────────────────────────────────────────────────────────────────────────

type DataQuality = {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};

const CONTENT_TTL = 60 * 60 * 1000;

export interface AuditedPage {
  url: string;
  title: string;
  classification: "good" | "needs-improvement" | "poor";
  qualityScore: DataPoint<number>;
  bodyBytes: number;
  /** Rough word count estimated from bodyBytes (≈ bytes/6). Confidence "low". */
  estimatedWordCount: DataPoint<number>;
  loadTimeMs: number;
  issues: string[];
  /** Which crawl fields were used to compute the qualityScore for this page. */
  sourcedFields: string[];
}

export interface ContentAuditResult {
  pages: AuditedPage[];
  summary: {
    totalPages: DataPoint<number>;
    avgScore: DataPoint<number>;
    good: DataPoint<number>;
    needsImprovement: DataPoint<number>;
    poor: DataPoint<number>;
    duplicateTitles: DataPoint<number>;
  };
  issueBreakdown: { issue: string; count: number }[];
  /** LLM commentary restricted to "why top issues matter". Verify before acting. */
  commentary: string;
  dataQuality: DataQuality;
}

interface PageScoreResult {
  qualityScore: number;
  issues: string[];
  sourcedFields: string[];
}

/** Deterministic rule scoring over real crawl fields. */
function scorePage(p: {
  documentTitle?: string;
  metaDescriptionLength?: number;
  h1Count?: number;
  bodyBytes?: number;
  canonicalUrl?: string;
  documentLang?: string;
  durationMs: number;
  status: number;
}): PageScoreResult {
  let qualityScore = 0;
  const issues: string[] = [];
  const sourcedFields: string[] = [];

  // Title
  if (p.documentTitle !== undefined) sourcedFields.push("documentTitle");
  if (p.documentTitle?.trim()) {
    qualityScore += 15;
    if (p.documentTitle.length < 30) { issues.push("Title too short"); qualityScore -= 5; }
    if (p.documentTitle.length > 70) { issues.push("Title too long"); qualityScore -= 3; }
  } else {
    issues.push("Missing title");
  }

  // Meta description
  if (p.metaDescriptionLength !== undefined) sourcedFields.push("metaDescriptionLength");
  if (p.metaDescriptionLength && p.metaDescriptionLength > 0) {
    qualityScore += 15;
    if (p.metaDescriptionLength < 120) { issues.push("Meta description too short"); qualityScore -= 3; }
    if (p.metaDescriptionLength > 160) { issues.push("Meta description too long"); qualityScore -= 3; }
  } else {
    issues.push("Missing meta description");
  }

  // Heading structure
  if (p.h1Count !== undefined) sourcedFields.push("h1Count");
  if (p.h1Count === 1) {
    qualityScore += 15;
  } else if (p.h1Count === 0) {
    issues.push("Missing H1");
  } else {
    issues.push("Multiple H1 tags");
    qualityScore += 5;
  }

  // Content depth (real: bodyBytes)
  if (p.bodyBytes !== undefined) sourcedFields.push("bodyBytes");
  if (p.bodyBytes && p.bodyBytes > 5000) {
    qualityScore += 15;
  } else if (p.bodyBytes && p.bodyBytes > 1000) {
    qualityScore += 8;
    issues.push("Thin content");
  } else {
    issues.push("Very thin content");
  }

  // Technical
  if (p.canonicalUrl) {
    qualityScore += 10;
    sourcedFields.push("canonicalUrl");
  } else {
    issues.push("Missing canonical");
  }
  if (p.documentLang) {
    qualityScore += 5;
    sourcedFields.push("documentLang");
  }

  // Load time
  sourcedFields.push("durationMs");
  if (p.durationMs < 2000) qualityScore += 10;
  else if (p.durationMs < 4000) qualityScore += 5;
  else issues.push("Slow page load");

  // Status
  sourcedFields.push("status");
  if (p.status === 200) qualityScore += 5;

  return {
    qualityScore: Math.max(0, Math.min(100, qualityScore)),
    issues,
    sourcedFields,
  };
}

/** Detect duplicate titles across the whole crawl. */
function findDuplicateTitles(titles: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const t of titles) {
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [title, c] of counts.entries()) {
    if (c > 1) dupes.add(title);
  }
  return dupes;
}

export async function auditContent(reports: SiteHealthReport[]): Promise<ContentAuditResult> {
  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const estimatedFields: string[] = [];
  const missingFields: string[] = [];
  const realDataFieldsSet = new Set<string>();

  const allPages = reports.flatMap((r) => r.crawl.pages);
  const okPages = allPages.filter((p) => p.ok);

  if (okPages.length > 0) {
    providersHit.push("crawl");
  } else {
    providersFailed.push("crawl");
    missingFields.push("pages");
  }

  // Duplicate-title detection (deterministic, over the whole crawl)
  const duplicateTitles = findDuplicateTitles(
    okPages.map((p) => p.documentTitle ?? "").filter((t) => t.length > 0),
  );

  const pages: AuditedPage[] = okPages.map((p) => {
    const { qualityScore, issues, sourcedFields } = scorePage(p);
    if (p.documentTitle && duplicateTitles.has(p.documentTitle)) {
      issues.push("Duplicate title across the crawl");
    }
    for (const f of sourcedFields) realDataFieldsSet.add(f);

    const classification: AuditedPage["classification"] =
      qualityScore >= 70 ? "good" : qualityScore >= 50 ? "needs-improvement" : "poor";

    // Approximate word count from body bytes (HTML markup included, so this
    // is coarse). Flagged confidence "low" so the UI can show it's estimated.
    const estimatedWordCountValue = Math.max(0, Math.round((p.bodyBytes ?? 0) / 6));

    return {
      url: p.url,
      title: p.documentTitle ?? "",
      classification,
      qualityScore: dp<number>(
        qualityScore,
        "crawl-rule-score",
        "high",
        CONTENT_TTL,
        `deterministic rules over ${sourcedFields.length} real crawl fields`,
      ),
      bodyBytes: p.bodyBytes ?? 0,
      estimatedWordCount: dp<number>(
        estimatedWordCountValue,
        "bodyBytes-heuristic",
        "low",
        CONTENT_TTL,
        "bodyBytes / 6 — coarse proxy; HTML markup inflates vs. real copy",
      ),
      loadTimeMs: p.durationMs,
      issues,
      sourcedFields,
    };
  });

  if (pages.some((p) => p.estimatedWordCount.value > 0)) {
    estimatedFields.push("estimatedWordCount");
  }

  pages.sort((a, b) => a.qualityScore.value - b.qualityScore.value);

  const good = pages.filter((p) => p.classification === "good").length;
  const needsWork = pages.filter((p) => p.classification === "needs-improvement").length;
  const poor = pages.filter((p) => p.classification === "poor").length;
  const avgScoreValue = pages.length > 0
    ? Math.round(pages.reduce((a, p) => a + p.qualityScore.value, 0) / pages.length)
    : 0;

  // Aggregate issues
  const issueCounts = pages
    .flatMap((p) => p.issues)
    .reduce((acc, issue) => {
      acc.set(issue, (acc.get(issue) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());
  const issueBreakdown = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([issue, count]) => ({ issue, count }));

  // ── LLM commentary — ≤3 sentences, no invented pages or numbers ────────
  let commentary = "";
  if (pages.length > 0 && issueBreakdown.length > 0) {
    const topIssues = issueBreakdown.slice(0, 3);
    const prompt = `You are a senior content strategist. Given these REAL top issues from a crawl audit, write a 2-3 sentence qualitative explanation of WHY they matter for SEO and UX. Do NOT invent page URLs, counts, sites, or add more issues. Do NOT output a numbered list.

Top issues:
${topIssues.map((i) => `- ${i.issue} (${i.count} pages)`).join("\n")}

Return plain text only, no JSON, no markdown headers.`;
    try {
      const raw = await withLlmTelemetry(
        "content-audit",
        process.env.OLLAMA_MODEL?.trim() || "llama3.2",
        prompt,
        () => generateText(prompt),
      );
      commentary = raw.replace(/```[\s\S]*?```/g, "").trim().slice(0, 600);
      if (commentary) estimatedFields.push("commentary");
    } catch {
      commentary = "";
    }
  }

  const totalPages = pages.length;

  return {
    pages: pages.slice(0, 50),
    summary: {
      totalPages: dp<number>(totalPages, "crawl", "high", CONTENT_TTL, "count of successfully fetched pages"),
      avgScore: dp<number>(
        avgScoreValue,
        "crawl-rule-score",
        "high",
        CONTENT_TTL,
        `mean of deterministic per-page scores (${totalPages} pages)`,
      ),
      good: dp<number>(good, "crawl-rule-score", "high", CONTENT_TTL, "qualityScore ≥ 70"),
      needsImprovement: dp<number>(needsWork, "crawl-rule-score", "high", CONTENT_TTL, "50 ≤ qualityScore < 70"),
      poor: dp<number>(poor, "crawl-rule-score", "high", CONTENT_TTL, "qualityScore < 50"),
      duplicateTitles: dp<number>(duplicateTitles.size, "crawl", "high", CONTENT_TTL, "distinct titles appearing on more than one crawl page"),
    },
    issueBreakdown,
    commentary,
    dataQuality: {
      realDataFields: Array.from(realDataFieldsSet),
      estimatedFields: Array.from(new Set(estimatedFields)),
      missingFields,
      providersHit: Array.from(new Set(providersHit)),
      providersFailed: Array.from(new Set(providersFailed)),
    } satisfies DataQuality,
  };
}
