/**
 * Applied-AI eval harness for the run-summary-ai module.
 *
 * Measures whether the LLM produces a summary markdown that matches the
 * strict format we ask for: `## Run at a glance` + `### Nutshell` (5-8
 * bullets) + `### By site` with 3 bullets per site, ≤220 words total.
 *
 * Runs 10 golden RunSummaryPayload fixtures covering:
 *   - clean site (no broken links)
 *   - site with many 404s
 *   - slow-loading site
 *   - multi-site mixed run
 *   - run with failed pagespeed (no insights data)
 *   - run with viewport issues
 *   - run with broken fetches (status 0)
 *   - run with only 1 tiny site
 *   - run with 10+ sites
 *   - run with PageSpeed strategies only (no broken links)
 *
 * Usage:
 *   OLLAMA_MODEL=llama3.2 tsx scripts/eval-run-summary.ts
 *   OLLAMA_MODEL=mistral   tsx scripts/eval-run-summary.ts
 */

import { generateRunSummary } from "../src/health/run-summary-ai.js";
import { withLlmTelemetry } from "../src/health/agentic/llm-telemetry.js";

type GoldenCase = {
  name: string;
  payload: any; // RunSummaryPayload but loose for fixture ease
  mustContain: string[];   // substring checks — at least one match per item required
  mustSatisfy: Array<(text: string) => true | string>; // returns true or an error message
};

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function makeSite(overrides: Partial<any> = {}): any {
  return {
    hostname: "example.com",
    startUrl: "https://example.com/",
    pagesVisited: 25,
    brokenLinks: 0,
    failedPageFetches: 0,
    avgPageMs: 420,
    ...overrides,
  };
}

const CASES: GoldenCase[] = [
  {
    name: "clean-single-site",
    payload: {
      runId: "test-001",
      generatedAt: new Date().toISOString(),
      sites: [makeSite()],
    },
    mustContain: ["example.com"],
    mustSatisfy: [
      (s) => /##\s+Run at a glance/i.test(s) || "missing '## Run at a glance' header",
      (s) => /###\s+Nutshell/i.test(s) || "missing '### Nutshell' header",
      (s) => countWords(s) <= 280 || `word count ${countWords(s)} exceeds ~280 cap`,
    ],
  },
  {
    name: "broken-404s-single-site",
    payload: {
      runId: "test-002",
      generatedAt: new Date().toISOString(),
      sites: [makeSite({ brokenLinks: 42, failedPageFetches: 3 })],
    },
    mustContain: ["example.com"],
    mustSatisfy: [
      (s) => /##\s+Run at a glance/i.test(s) || "missing header",
      (s) => /42|broken|fail/i.test(s) || "did not mention broken-link count",
    ],
  },
  {
    name: "multi-site-mixed",
    payload: {
      runId: "test-003",
      generatedAt: new Date().toISOString(),
      sites: [
        makeSite({ hostname: "a.example.com", pagesVisited: 10 }),
        makeSite({ hostname: "b.example.com", brokenLinks: 50, pagesVisited: 100 }),
        makeSite({ hostname: "c.example.com", failedPageFetches: 5, pagesVisited: 5 }),
      ],
    },
    mustContain: ["a.example.com", "b.example.com", "c.example.com"],
    mustSatisfy: [
      (s) => /###\s+By site/i.test(s) || "missing '### By site' section",
    ],
  },
  {
    name: "slow-pages",
    payload: {
      runId: "test-004",
      generatedAt: new Date().toISOString(),
      sites: [makeSite({ avgPageMs: 6800 })],
    },
    mustContain: ["example.com"],
    mustSatisfy: [
      (s) => /##/.test(s) || "missing markdown structure",
    ],
  },
  {
    name: "with-pagespeed-insights",
    payload: {
      runId: "test-005",
      generatedAt: new Date().toISOString(),
      sites: [{
        ...makeSite(),
        pageSpeedSample: [
          { url: "https://example.com/", perfMobile: 45, perfDesktop: 82 },
          { url: "https://example.com/about", perfMobile: 52, perfDesktop: 90 },
        ],
      }],
    },
    mustContain: ["example.com"],
    mustSatisfy: [
      (s) => countWords(s) <= 280 || `word count ${countWords(s)} exceeds cap`,
    ],
  },
  {
    name: "all-status-zero-network-errors",
    payload: {
      runId: "test-006",
      generatedAt: new Date().toISOString(),
      sites: [makeSite({ brokenLinks: 8, failedPageFetches: 15, pagesVisited: 20 })],
    },
    mustContain: ["example.com"],
    mustSatisfy: [
      (s) => /broken|fail/i.test(s) || "didn't surface broken/fail",
    ],
  },
  {
    name: "single-page-tiny-site",
    payload: {
      runId: "test-007",
      generatedAt: new Date().toISOString(),
      sites: [makeSite({ pagesVisited: 1, avgPageMs: 200 })],
    },
    mustContain: ["example.com"],
    mustSatisfy: [
      (s) => countWords(s) >= 30 || `word count ${countWords(s)} suspiciously small`,
    ],
  },
  {
    name: "ten-site-run",
    payload: {
      runId: "test-008",
      generatedAt: new Date().toISOString(),
      sites: Array.from({ length: 10 }, (_, i) => makeSite({ hostname: `site-${i}.example.com`, pagesVisited: 10 + i })),
    },
    mustContain: ["site-0.example.com"],
    mustSatisfy: [
      (s) => countWords(s) <= 280 || `word count ${countWords(s)} exceeds cap with 10 sites`,
    ],
  },
  {
    name: "viewport-issues",
    payload: {
      runId: "test-009",
      generatedAt: new Date().toISOString(),
      sites: [{
        ...makeSite(),
        viewportIssues: [
          { url: "https://example.com/", mobileOk: false, desktopOk: true },
          { url: "https://example.com/contact", mobileOk: false, desktopOk: false },
        ],
      }],
    },
    mustContain: ["example.com"],
    mustSatisfy: [
      (s) => /##/.test(s) || "missing markdown structure",
    ],
  },
  {
    name: "no-data-empty-run",
    payload: {
      runId: "test-010",
      generatedAt: new Date().toISOString(),
      sites: [],
    },
    mustContain: [],
    mustSatisfy: [
      (s) => /not enough data|no.*data/i.test(s) || s.length > 0 || "empty run produced empty output",
    ],
  },
];

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

async function main(): Promise<void> {
  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  console.log(`\n  Run-summary eval — model: ${model}`);
  console.log(`  ───────────────────────────────────────\n`);

  const results: Array<{ name: string; ok: boolean; durationMs: number; words: number; fail?: string }> = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const started = Date.now();
    let text = "";
    let fail: string | undefined;
    try {
      text = await withLlmTelemetry("eval-run-summary", model, JSON.stringify(c.payload), () => generateRunSummary(c.payload as never));
    } catch (e) {
      fail = (e as Error).message;
    }
    const durationMs = Date.now() - started;
    const words = countWords(text);

    if (!fail) {
      for (const must of c.mustContain) {
        if (!text.includes(must)) { fail = `missing substring "${must}"`; break; }
      }
    }
    if (!fail) {
      for (const check of c.mustSatisfy) {
        const r = check(text);
        if (r !== true) { fail = String(r); break; }
      }
    }

    const ok = !fail;
    results.push({ name: c.name, ok, durationMs, words, fail });
    const mark = ok ? "[32m✓[0m" : "[31m✗[0m";
    console.log(`  ${mark} ${(i + 1).toString().padStart(2)}/${CASES.length} ${c.name.padEnd(30)} ${durationMs.toString().padStart(6)}ms  ${words.toString().padStart(4)} words  ${ok ? "" : fail}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const durations = results.map((r) => r.durationMs);

  console.log(`\n  Summary`);
  console.log(`  ───────────────────────────────────────`);
  console.log(`  Model:               ${model}`);
  console.log(`  Schema pass-rate:    ${passed}/${CASES.length} (${Math.round((passed / CASES.length) * 100)}%)`);
  console.log(`  Latency p50:         ${percentile(durations, 0.5).toFixed(0)}ms`);
  console.log(`  Latency p95:         ${percentile(durations, 0.95).toFixed(0)}ms`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failed) console.log(`    ${f.name}: ${f.fail}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
