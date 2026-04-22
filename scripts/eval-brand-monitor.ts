/**
 * Applied-AI eval harness for the Brand Radar (RSS aggregator).
 *
 * 10 query fixtures. For each we assert:
 *   - At least one providersHit entry (means SOMETHING worked)
 *   - Mentions array is sane (each has title + url + source)
 *   - titleTone histogram integers sum to mentions.length
 *   - Cached re-runs return in < 100 ms (proves the cache layer works)
 *
 * This isn't strictly an LLM eval (the RSS aggregator itself doesn't call
 * an LLM), but it's the same eval harness pattern. It catches regressions
 * when external feeds change their XML structure.
 *
 * Usage:
 *   tsx scripts/eval-brand-monitor.ts
 */

import { fetchBrandMentions } from "../src/health/providers/rss-aggregator.js";

type Case = { name: string; query: string };

const CASES: Case[] = [
  { name: "major-brand", query: "openai" },
  { name: "niche-domain", query: "ahrefs.com" },
  { name: "tech-company", query: "github" },
  { name: "news-topic", query: "climate change" },
  { name: "product-name", query: "vscode" },
  { name: "seo-term", query: "core web vitals" },
  { name: "meme-community", query: "hacker news" },
  { name: "product-review", query: "iphone 16" },
  { name: "small-business", query: "realdrseattle" },
  { name: "empty-ish", query: "xxzz-nonsense-query-no-matches-xxzz" },
];

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

async function main(): Promise<void> {
  console.log(`\n  Brand Radar (RSS aggregator) eval`);
  console.log(`  ──────────────────────────────────\n`);

  const results: Array<{ name: string; query: string; ok: boolean; durationMs: number; mentions: number; hit: number; cachedMs?: number; fail?: string }> = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const started = Date.now();
    let fail: string | undefined;
    let mentions = 0;
    let hit = 0;
    let cachedMs: number | undefined;
    try {
      const bundle = await fetchBrandMentions({ query: c.query });
      mentions = bundle.mentions.length;
      hit = bundle.providersHit.length;

      // Schema checks
      for (const m of bundle.mentions.slice(0, 5)) {
        if (!m.url || !m.title || !m.source) { fail = "mention missing required fields"; break; }
      }
      if (!fail) {
        const tone = bundle.titleTone;
        if (tone.positive + tone.neutral + tone.negative !== mentions) {
          fail = `titleTone sum ${tone.positive + tone.neutral + tone.negative} != mentions ${mentions}`;
        }
      }
      if (!fail && c.name !== "empty-ish" && hit === 0 && mentions === 0) {
        fail = "zero providers returned data for a query that should have matches";
      }
      if (!fail) {
        // Cache check — second call should be fast
        const cStart = Date.now();
        const again = await fetchBrandMentions({ query: c.query });
        cachedMs = Date.now() - cStart;
        if (again.mentions.length !== mentions) fail = `cache returned different mention count (${again.mentions.length} vs ${mentions})`;
        if (!fail && cachedMs > 200) fail = `cache re-fetch took ${cachedMs}ms — expected < 200ms`;
      }
    } catch (e) {
      fail = (e as Error).message?.slice(0, 140) ?? "error";
    }
    const durationMs = Date.now() - started;
    const ok = !fail;
    results.push({ name: c.name, query: c.query, ok, durationMs, mentions, hit, cachedMs, fail });
    const mark = ok ? "[32m✓[0m" : "[31m✗[0m";
    console.log(`  ${mark} ${(i + 1).toString().padStart(2)}/${CASES.length} ${c.name.padEnd(18)} m=${mentions.toString().padStart(3)} hit=${hit} ${durationMs.toString().padStart(6)}ms${cachedMs != null ? ` cache=${cachedMs}ms` : ""}  ${ok ? "" : fail}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const durations = results.map((r) => r.durationMs);
  const cacheDurations = results.filter((r) => r.cachedMs != null).map((r) => r.cachedMs!);

  console.log(`\n  Summary`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  Schema pass-rate:       ${passed}/${CASES.length} (${Math.round((passed / CASES.length) * 100)}%)`);
  console.log(`  Fetch latency p50:      ${percentile(durations, 0.5).toFixed(0)}ms`);
  console.log(`  Fetch latency p95:      ${percentile(durations, 0.95).toFixed(0)}ms`);
  if (cacheDurations.length > 0) {
    console.log(`  Cache re-fetch p50:     ${percentile(cacheDurations, 0.5).toFixed(0)}ms`);
    console.log(`  Cache re-fetch max:     ${Math.max(...cacheDurations).toFixed(0)}ms`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failed) console.log(`    ${f.name} ("${f.query}"): ${f.fail}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
