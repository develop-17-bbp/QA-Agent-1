import type { SiteHealthReport, PageFetchRecord } from "../types.js";
import { generateText } from "../llm.js";
import { dp, type DataPoint } from "../providers/types.js";

// ── Unit 9 honesty goal ─────────────────────────────────────────────────
//
// Every rule reads directly from the real crawl page record — no network
// calls, no scoring the LLM can corrupt. The deterministic score + status
// + recommendation text is always safe. The LLM is restricted to a single
// batched call that produces one short "fix suggestion" per FAILED or
// WARNING check, rendered in the UI as an "AI suggestion — verify before
// applying" accordion (same pattern as the Local SEO checklist).
//
// Provenance: every numeric field is a DataPoint<number>, and the
// DataQuality envelope lists every crawl field that backed the score.
//
// ────────────────────────────────────────────────────────────────────────

type DataQuality = {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};

const ONPAGE_TTL = 60 * 60 * 1000;

export type CheckStatus = "pass" | "warning" | "fail";

export interface OnPageCheck {
  element: string;
  status: CheckStatus;
  score: DataPoint<number>;
  value: string;
  /** Deterministic plain-text guidance — always safe, never invented. */
  recommendation: string;
  /** Which real crawl field(s) produced this check. */
  sourcedFields: string[];
  /** LLM-generated one-line fix; only set for warning/fail checks. */
  fixSuggestion?: string;
}

export interface OnPageSeoResult {
  url: string;
  overallScore: DataPoint<number>;
  checks: OnPageCheck[];
  dataQuality: DataQuality;
}

function mkCheck(
  element: string,
  status: CheckStatus,
  score: number,
  value: string,
  recommendation: string,
  sourcedFields: string[],
  note?: string,
): OnPageCheck {
  return {
    element,
    status,
    score: dp<number>(score, "crawl-rule", "high", ONPAGE_TTL, note),
    value,
    recommendation,
    sourcedFields,
  };
}

export async function checkOnPageSeo(
  url: string,
  reports: SiteHealthReport[],
): Promise<OnPageSeoResult> {
  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const estimatedFields: string[] = [];
  const missingFields: string[] = [];

  // Find the page
  let page: PageFetchRecord | null = null;
  for (const r of reports) {
    const found = r.crawl.pages.find((p) => p.url === url);
    if (found) { page = found; break; }
  }

  if (!page) {
    // If no specific URL, analyze first successful page
    const firstPage = reports[0]?.crawl.pages.find((p) => p.ok);
    if (!firstPage) {
      providersFailed.push("crawl");
      missingFields.push("pages");
      return {
        url,
        overallScore: dp<number>(0, "crawl-rule", "low", ONPAGE_TTL, "no crawl pages available"),
        checks: [],
        dataQuality: {
          realDataFields: [],
          estimatedFields: [],
          missingFields,
          providersHit,
          providersFailed,
        },
      };
    }
    page = firstPage;
  }

  providersHit.push("crawl");

  const checks: OnPageCheck[] = [];
  const realDataFieldsSet = new Set<string>();

  // ── Title ────────────────────────────────────────────────────────────
  const title = page.documentTitle || "";
  realDataFieldsSet.add("documentTitle");
  if (!title) {
    checks.push(mkCheck("Title Tag", "fail", 0, "Missing", "Add a unique, descriptive title tag (30-60 characters)", ["documentTitle"]));
  } else if (title.length < 30) {
    checks.push(mkCheck("Title Tag", "warning", 50, `${title.length} chars: "${title}"`, "Title is too short. Aim for 30-60 characters with primary keyword near the start", ["documentTitle"]));
  } else if (title.length > 60) {
    checks.push(mkCheck("Title Tag", "warning", 60, `${title.length} chars`, "Title may be truncated in SERPs. Keep under 60 characters", ["documentTitle"]));
  } else {
    checks.push(mkCheck("Title Tag", "pass", 90, `${title.length} chars: "${title}"`, "Good title length", ["documentTitle"]));
  }

  // ── Meta description ─────────────────────────────────────────────────
  const metaLen = page.metaDescriptionLength ?? 0;
  realDataFieldsSet.add("metaDescriptionLength");
  if (metaLen === 0) {
    checks.push(mkCheck("Meta Description", "fail", 0, "Missing", "Add a compelling meta description (120-160 characters)", ["metaDescriptionLength"]));
  } else if (metaLen < 120) {
    checks.push(mkCheck("Meta Description", "warning", 50, `${metaLen} chars`, "Meta description is short. Aim for 120-160 characters", ["metaDescriptionLength"]));
  } else if (metaLen > 160) {
    checks.push(mkCheck("Meta Description", "warning", 60, `${metaLen} chars`, "Meta description may be truncated. Keep under 160 characters", ["metaDescriptionLength"]));
  } else {
    checks.push(mkCheck("Meta Description", "pass", 90, `${metaLen} chars`, "Good meta description length", ["metaDescriptionLength"]));
  }

  // ── H1 ───────────────────────────────────────────────────────────────
  const h1Count = page.h1Count ?? 0;
  realDataFieldsSet.add("h1Count");
  if (h1Count === 0) {
    checks.push(mkCheck("H1 Heading", "fail", 0, "Missing", "Add exactly one H1 heading with your primary keyword", ["h1Count"]));
  } else if (h1Count > 1) {
    checks.push(mkCheck("H1 Heading", "warning", 50, `${h1Count} H1s`, "Use only one H1 per page for optimal SEO", ["h1Count"]));
  } else {
    checks.push(mkCheck("H1 Heading", "pass", 100, "1 H1 found", "Good — single H1 tag present", ["h1Count"]));
  }

  // ── Canonical ────────────────────────────────────────────────────────
  realDataFieldsSet.add("canonicalUrl");
  if (!page.canonicalUrl) {
    checks.push(mkCheck("Canonical URL", "warning", 40, "Missing", "Add a canonical URL to prevent duplicate content issues", ["canonicalUrl"]));
  } else {
    checks.push(mkCheck("Canonical URL", "pass", 100, page.canonicalUrl, "Canonical URL is set", ["canonicalUrl"]));
  }

  // ── Language ─────────────────────────────────────────────────────────
  realDataFieldsSet.add("documentLang");
  if (!page.documentLang) {
    checks.push(mkCheck("Language Attribute", "warning", 50, "Missing", "Add a lang attribute to the HTML element", ["documentLang"]));
  } else {
    checks.push(mkCheck("Language Attribute", "pass", 100, page.documentLang, "Language attribute present", ["documentLang"]));
  }

  // ── Page speed (load time from crawl) ────────────────────────────────
  const loadMs = page.durationMs ?? 0;
  realDataFieldsSet.add("durationMs");
  if (loadMs > 8000) {
    checks.push(mkCheck("Page Speed", "fail", 10, `${(loadMs / 1000).toFixed(1)}s`, "Page is extremely slow. Optimize images, minimize JS/CSS, use CDN", ["durationMs"]));
  } else if (loadMs > 4000) {
    checks.push(mkCheck("Page Speed", "warning", 40, `${(loadMs / 1000).toFixed(1)}s`, "Page is slow. Aim for under 3 seconds load time", ["durationMs"]));
  } else if (loadMs > 2000) {
    checks.push(mkCheck("Page Speed", "warning", 65, `${(loadMs / 1000).toFixed(1)}s`, "Acceptable speed, but could be faster", ["durationMs"]));
  } else {
    checks.push(mkCheck("Page Speed", "pass", 90, `${(loadMs / 1000).toFixed(1)}s`, "Good page speed", ["durationMs"]));
  }

  // ── Content depth — estimated word count from bodyBytes ──────────────
  const bytes = page.bodyBytes ?? 0;
  realDataFieldsSet.add("bodyBytes");
  estimatedFields.push("contentDepthWordCount");
  const estWords = Math.round(bytes / 5);
  const depthNote = "estimated ~bytes/5 — coarse proxy";
  if (bytes < 1000) {
    checks.push(mkCheck("Content Depth", "fail", 10, `~${estWords} words`, "Very thin content. Add substantial, valuable content (aim for 300+ words)", ["bodyBytes"], depthNote));
  } else if (bytes < 3000) {
    checks.push(mkCheck("Content Depth", "warning", 50, `~${estWords} words`, "Light content. Consider expanding with more detail", ["bodyBytes"], depthNote));
  } else {
    checks.push(mkCheck("Content Depth", "pass", 85, `~${estWords} words`, "Good content depth", ["bodyBytes"], depthNote));
  }

  // ── HTTP status ──────────────────────────────────────────────────────
  realDataFieldsSet.add("status");
  if (page.status === 200) {
    checks.push(mkCheck("HTTP Status", "pass", 100, "200 OK", "Page returns correct status", ["status"]));
  } else {
    checks.push(mkCheck("HTTP Status", "fail", 0, `${page.status}`, `Page returns ${page.status}. Ensure pages return 200 status code`, ["status"]));
  }

  const overallScoreValue = Math.round(
    checks.reduce((a, c) => a + c.score.value, 0) / checks.length,
  );

  // ── LLM fix suggestions — one per flagged check, batched ─────────────
  const flagged = checks.filter((c) => c.status !== "pass");
  if (flagged.length > 0) {
    const prompt = `You are an SEO engineer. For each FAILED or WARNING on-page check below, write ONE short plain-text fix suggestion (≤120 chars) telling the developer exactly what to change in the HTML or page template. Be specific to the element. Do NOT invent numbers, URLs, or metrics beyond what's shown.

Return ONLY a JSON array of strings in the same order — no keys, no markdown.

Flagged checks for ${page.url}:
${flagged.map((c, i) => `${i + 1}. [${c.status.toUpperCase()}] ${c.element} — ${c.value}`).join("\n")}`;

    try {
      const raw = await generateText(prompt);
      const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(clean) as unknown;
      if (Array.isArray(parsed) && parsed.length === flagged.length) {
        for (let i = 0; i < flagged.length; i++) {
          const s = parsed[i];
          flagged[i].fixSuggestion = typeof s === "string" ? s.slice(0, 180) : undefined;
        }
        estimatedFields.push("fixSuggestion");
      }
    } catch {
      /* silent — deterministic recommendation remains the user's fallback */
    }
  }

  return {
    url: page.url,
    overallScore: dp<number>(
      overallScoreValue,
      "crawl-rule",
      "high",
      ONPAGE_TTL,
      `mean of ${checks.length} deterministic rule scores`,
    ),
    checks,
    dataQuality: {
      realDataFields: Array.from(realDataFieldsSet),
      estimatedFields: Array.from(new Set(estimatedFields)),
      missingFields,
      providersHit,
      providersFailed,
    } satisfies DataQuality,
  };
}
