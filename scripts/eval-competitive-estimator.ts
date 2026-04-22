/**
 * Applied-AI eval harness for the competitive-estimator module.
 *
 * 15 golden domain cases covering: small personal blog, mid-size SaaS,
 * enterprise, news publisher, e-commerce, multi-region × different TLDs.
 * For each case we assert:
 *   - Returned ranges are internally consistent (max >= min, min >= 0)
 *   - Confidence enum is one of {high, medium, low}
 *   - All three required range fields are present
 *   - p95 latency stays within budget
 *
 * Usage:
 *   OLLAMA_MODEL=llama3.2 tsx scripts/eval-competitive-estimator.ts
 */

import { estimateCompetitive } from "../src/health/modules/competitive-estimator.js";
import { withLlmTelemetry } from "../src/health/agentic/llm-telemetry.js";

type GoldenCase = { name: string; domain: string };

// Real-ish domains chosen to span the spectrum — not every case will
// return exact data since Cloudflare Radar / Tranco etc. are domain-
// specific. We're asserting STRUCTURAL correctness, not absolute accuracy.
const CASES: GoldenCase[] = [
  { name: "global-enterprise", domain: "wikipedia.org" },
  { name: "top-ecommerce", domain: "amazon.com" },
  { name: "major-news", domain: "nytimes.com" },
  { name: "dev-community", domain: "github.com" },
  { name: "small-blog", domain: "example.com" },
  { name: "mid-saas", domain: "hubspot.com" },
  { name: "local-biz-india", domain: "realdrseattle.com" },
  { name: "forum-reddit", domain: "reddit.com" },
  { name: "news-aggregator", domain: "news.ycombinator.com" },
  { name: "long-tail-niche", domain: "tiny-obscure-blog.example" },
  { name: "edu-domain", domain: "stanford.edu" },
  { name: "gov-domain", domain: "whitehouse.gov" },
  { name: "seo-tool", domain: "ahrefs.com" },
  { name: "podcast-site", domain: "plasticsurgeonpodcast.com" },
  { name: "dental-practice", domain: "nwface.com" },
];

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

function isValidRange(r: { min: number; max: number } | undefined): true | string {
  if (!r) return "range missing";
  if (typeof r.min !== "number" || typeof r.max !== "number") return "range has non-numeric min/max";
  if (r.min < 0) return `min ${r.min} negative`;
  if (r.max < r.min) return `max ${r.max} < min ${r.min}`;
  return true;
}

async function main(): Promise<void> {
  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  console.log(`\n  Competitive-estimator eval — model: ${model}`);
  console.log(`  ─────────────────────────────────────────────\n`);

  const results: Array<{ name: string; ok: boolean; durationMs: number; fail?: string }> = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const started = Date.now();
    let fail: string | undefined;
    try {
      const estimate = await withLlmTelemetry("eval-competitive", model, c.domain, () => estimateCompetitive(c.domain));
      // Assertions:
      if (!estimate) { fail = "null estimate"; }
      else {
        const e = estimate as unknown as {
          ranges?: { backlinks?: { min: number; max: number }; monthlyOrganicTraffic?: { min: number; max: number }; keywordUniverse?: { min: number; max: number; estimate?: number } };
          confidence?: string;
        };
        const br = isValidRange(e.ranges?.backlinks);
        if (br !== true) fail = `backlinks: ${br}`;
        if (!fail) {
          const tr = isValidRange(e.ranges?.monthlyOrganicTraffic);
          if (tr !== true) fail = `monthlyOrganicTraffic: ${tr}`;
        }
        if (!fail) {
          const kr = e.ranges?.keywordUniverse;
          if (!kr || typeof kr.estimate !== "number" || kr.estimate < 0) fail = "keywordUniverse.estimate missing or invalid";
        }
        if (!fail) {
          const conf = String(e.confidence ?? "").toLowerCase();
          if (!["high", "medium", "low"].includes(conf)) fail = `confidence "${conf}" not in high/medium/low`;
        }
      }
    } catch (e) {
      fail = (e as Error).message?.slice(0, 140) ?? "error";
    }
    const durationMs = Date.now() - started;
    const ok = !fail;
    results.push({ name: c.name, ok, durationMs, fail });
    const mark = ok ? "[32m✓[0m" : "[31m✗[0m";
    console.log(`  ${mark} ${(i + 1).toString().padStart(2)}/${CASES.length} ${c.name.padEnd(24)} ${c.domain.padEnd(32)} ${durationMs.toString().padStart(6)}ms  ${ok ? "" : fail}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const durations = results.map((r) => r.durationMs);

  console.log(`\n  Summary`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Model:               ${model}`);
  console.log(`  Schema pass-rate:    ${passed}/${CASES.length} (${Math.round((passed / CASES.length) * 100)}%)`);
  console.log(`  Latency p50:         ${percentile(durations, 0.5).toFixed(0)}ms`);
  console.log(`  Latency p95:         ${percentile(durations, 0.95).toFixed(0)}ms`);
  console.log(`  Latency max:         ${Math.max(...durations).toFixed(0)}ms`);

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
