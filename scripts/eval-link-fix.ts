/**
 * Applied-AI eval harness for the Link Fix Advisor.
 *
 * Runs 20 golden broken-link examples against whatever OLLAMA_MODEL is
 * configured, measures:
 *   - Category accuracy   — did the model pick "redirect"/"remove"/"fix-typo"?
 *   - Latency             — per-call duration, p50/p95
 *   - Schema adherence    — did the response parse cleanly?
 *   - Anchor utilization  — did the recommendation reference the anchor text?
 *
 * Usage:
 *   OLLAMA_MODEL=llama3.2 tsx scripts/eval-link-fix.ts
 *   OLLAMA_MODEL=mistral  tsx scripts/eval-link-fix.ts
 *
 * Compare the printed summary across models before promoting one to
 * production. This is the guardrail that stops a model swap from silently
 * tanking fix quality.
 */

import { recommendLinkFixes } from "../src/health/modules/link-fix-advisor.js";
import { withLlmTelemetry } from "../src/health/agentic/llm-telemetry.js";

type GoldenCase = {
  foundOn: string;
  target: string;
  status: number;
  error?: string;
  anchorText?: string;
  linkContext?: string;
  /** Expected category label (one of "redirect", "remove", "fix-typo", "contact-owner", "other"). */
  expected: "redirect" | "remove" | "fix-typo" | "contact-owner" | "other";
  /** Human-readable reason for the expected label — useful when an eval fails. */
  rationale: string;
};

const CASES: GoldenCase[] = [
  {
    foundOn: "https://example.com/blog/seo-tips",
    target: "https://example.com/blogs/seo-tips",
    status: 404,
    anchorText: "our SEO guide",
    expected: "fix-typo",
    rationale: "'/blogs/' vs '/blog/' — classic pluralization typo, redirect to the right path.",
  },
  {
    foundOn: "https://example.com/services/legacy-product",
    target: "https://example.com/products/retired-2019",
    status: 410,
    anchorText: "our legacy product",
    expected: "remove",
    rationale: "410 = intentionally gone. Remove the anchor or rewrite the paragraph.",
  },
  {
    foundOn: "https://example.com/about",
    target: "https://external-partner.com/broken-page",
    status: 404,
    anchorText: "read the partner announcement",
    expected: "contact-owner",
    rationale: "External site 404 — we can't fix; contact them or find archive.org mirror.",
  },
  {
    foundOn: "https://example.com/pricing",
    target: "https://example.com/pricin",
    status: 404,
    anchorText: "pricing",
    expected: "fix-typo",
    rationale: "Obvious typo: /pricin → /pricing.",
  },
  {
    foundOn: "https://example.com/docs",
    target: "https://example.com/old-docs/intro",
    status: 301,
    anchorText: "intro",
    expected: "redirect",
    rationale: "Already redirecting — update the href to the final URL to save the hop.",
  },
  {
    foundOn: "https://example.com/guides",
    target: "https://example.com/blog/deep-dive-q3-2019",
    status: 404,
    anchorText: "Q3 2019 deep dive",
    expected: "remove",
    rationale: "Old-dated content, link points to intentionally deleted page — remove.",
  },
  {
    foundOn: "https://example.com/team",
    target: "mailto:hr@exmample.com",
    status: 0,
    error: "ENOTFOUND",
    anchorText: "HR",
    expected: "fix-typo",
    rationale: "Typo in mailto domain: exmample → example.",
  },
  {
    foundOn: "https://example.com/",
    target: "https://twitter.com/handle-changed",
    status: 404,
    anchorText: "follow us on Twitter",
    expected: "redirect",
    rationale: "Platform URL changed — redirect to new handle / x.com.",
  },
  {
    foundOn: "https://example.com/support",
    target: "https://example.com/helpdesk",
    status: 500,
    anchorText: "helpdesk",
    expected: "other",
    rationale: "5xx is a server problem, not a link problem. Investigate backend before re-linking.",
  },
  {
    foundOn: "https://example.com/careers",
    target: "https://example.com/jobs/2020-intern",
    status: 410,
    anchorText: "2020 internship",
    expected: "remove",
    rationale: "Expired dated listing intentionally 410'd.",
  },
  {
    foundOn: "https://example.com/blog/post",
    target: "https://example.com//double-slash",
    status: 404,
    anchorText: "this article",
    expected: "fix-typo",
    rationale: "Double-slash URL artifact from CMS — fix path.",
  },
  {
    foundOn: "https://example.com/resources",
    target: "https://example.com/resources/whitepaper.pdf",
    status: 404,
    anchorText: "download the whitepaper",
    expected: "contact-owner",
    rationale: "PDF missing from CDN — restore asset or remove link.",
  },
  {
    foundOn: "https://example.com/case-studies",
    target: "https://example.com/case/acme-corp",
    status: 404,
    anchorText: "Acme Corp case study",
    expected: "redirect",
    rationale: "Page renamed — set up 301 from /case/ to /case-studies/.",
  },
  {
    foundOn: "https://example.com/api",
    target: "https://api.example.com/v1/deprecated",
    status: 410,
    anchorText: "v1 API reference",
    expected: "redirect",
    rationale: "Point docs to current API version.",
  },
  {
    foundOn: "https://example.com/compare",
    target: "https://competitor.com/page",
    status: 403,
    anchorText: "competitor comparison",
    expected: "other",
    rationale: "403 could mean bot-blocking — try different UA before removing.",
  },
  {
    foundOn: "https://example.com/download",
    target: "https://example.com/download/app-v1.exe",
    status: 404,
    anchorText: "download v1",
    expected: "remove",
    rationale: "Old version no longer distributed — remove link or update to current version.",
  },
  {
    foundOn: "https://example.com/partners",
    target: "https://defunct-partner.com",
    status: 0,
    error: "ENOTFOUND",
    anchorText: "Partner Co.",
    expected: "remove",
    rationale: "Partner domain dead — remove entirely.",
  },
  {
    foundOn: "https://example.com/blog",
    target: "https://example.com/blog/draft-do-not-publish",
    status: 404,
    anchorText: "upcoming piece",
    expected: "remove",
    rationale: "Accidentally published link to a draft — remove immediately.",
  },
  {
    foundOn: "https://example.com/tutorials",
    target: "https://youtube.com/watch?v=deletedVideoId",
    status: 404,
    anchorText: "video tutorial",
    expected: "remove",
    rationale: "YouTube video deleted — remove embed + anchor.",
  },
  {
    foundOn: "https://example.com/sitemap",
    target: "https://example.com/catagory/alt",
    status: 404,
    anchorText: "alternate category",
    expected: "fix-typo",
    rationale: "'catagory' → 'category' typo in path.",
  },
];

function mean(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

function classifyRecommendation(rec: string): GoldenCase["expected"] {
  const r = rec.toLowerCase();
  if (/redirect|301|302|point.*to|set up a.*redirect/.test(r)) return "redirect";
  if (/remove|delete|strip|unlink|take.*down/.test(r)) return "remove";
  if (/typo|misspell|correct.*spelling|fix the.*url|path.*typo/.test(r)) return "fix-typo";
  if (/contact.*owner|reach.*out|email.*them|ask the.*site/.test(r)) return "contact-owner";
  return "other";
}

async function main(): Promise<void> {
  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  const results: Array<{ case: GoldenCase; got: string; gotCategory: GoldenCase["expected"]; correct: boolean; mentionsAnchor: boolean; durationMs: number; schemaOk: boolean }> = [];

  console.log(`\n  Link Fix Advisor eval — model: ${model}`);
  console.log(`  ──────────────────────────────────────────────\n`);

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const started = Date.now();
    let got = "";
    let schemaOk = false;
    try {
      const out = await withLlmTelemetry(
        "eval-link-fix",
        model,
        JSON.stringify(c),
        () => recommendLinkFixes([c]),
      );
      got = out?.[0]?.recommendation ?? "";
      schemaOk = got.length > 0 && got.length <= 300;
    } catch (e) {
      got = `ERROR: ${(e as Error).message}`;
    }
    const durationMs = Date.now() - started;
    const gotCategory = classifyRecommendation(got);
    const correct = gotCategory === c.expected;
    const mentionsAnchor = !!c.anchorText && got.toLowerCase().includes(c.anchorText.toLowerCase().slice(0, 20));
    results.push({ case: c, got, gotCategory, correct, mentionsAnchor, durationMs, schemaOk });
    const mark = correct ? "[32m✓[0m" : "[31m✗[0m";
    console.log(`  ${mark} [${(i + 1).toString().padStart(2)}/${CASES.length}] ${c.expected.padEnd(13)} → ${gotCategory.padEnd(13)} · ${durationMs}ms`);
    console.log(`      got: "${got.slice(0, 110)}${got.length > 110 ? "…" : ""}"`);
  }

  const correctCount = results.filter((r) => r.correct).length;
  const anchorCount = results.filter((r) => r.mentionsAnchor && r.case.anchorText).length;
  const totalWithAnchor = results.filter((r) => r.case.anchorText).length;
  const durations = results.map((r) => r.durationMs);
  const schemaOkCount = results.filter((r) => r.schemaOk).length;

  console.log(`\n  Summary`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`  Model:              ${model}`);
  console.log(`  Category accuracy:  ${correctCount}/${CASES.length} (${((correctCount / CASES.length) * 100).toFixed(0)}%)`);
  console.log(`  Schema OK:          ${schemaOkCount}/${CASES.length}`);
  console.log(`  Anchor utilization: ${anchorCount}/${totalWithAnchor} recs mention the anchor text`);
  console.log(`  Latency mean:       ${mean(durations).toFixed(0)}ms`);
  console.log(`  Latency p50:        ${percentile(durations, 0.5).toFixed(0)}ms`);
  console.log(`  Latency p95:        ${percentile(durations, 0.95).toFixed(0)}ms`);

  const failed = results.filter((r) => !r.correct);
  if (failed.length > 0) {
    console.log(`\n  Failures (expected → got):`);
    for (const f of failed.slice(0, 10)) {
      console.log(`    ${f.case.expected} → ${f.gotCategory}   [${f.case.target}]`);
      console.log(`      Expected rationale: ${f.case.rationale}`);
      console.log(`      Model said: "${f.got.slice(0, 140)}"`);
    }
  }

  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
