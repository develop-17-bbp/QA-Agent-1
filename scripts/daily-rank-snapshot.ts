/**
 * Daily competitor-rank snapshot cron.
 *
 * Reads tracked (domain, keyword) pairs from data/tracked-pairs.json, runs
 * them through the position-scheduler, and writes a new sample to the
 * history DB. Run on a daily cron:
 *
 *   # crontab entry (Linux)
 *   0 8 * * *  cd /path/to/QA-Agent && node --import tsx scripts/daily-rank-snapshot.ts
 *
 *   # Windows Task Scheduler: equivalent daily trigger, Action =
 *   #   powershell -c "cd 'C:\path\to\QA-Agent'; npx tsx scripts/daily-rank-snapshot.ts"
 *
 * Output: a JSONL line to artifacts/daily-rank-snapshots.jsonl plus the
 * normal history-db append. Non-zero exit if >50% of pairs errored so the
 * cron runner flags the failure.
 *
 * Data file schema (data/tracked-pairs.json):
 *   [
 *     { "domain": "realdrseattle.com",   "keyword": "plastic surgery seattle" },
 *     { "domain": "competitor.com",       "keyword": "plastic surgery seattle", "isCompetitor": true }
 *   ]
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { trackBatch, type TrackPair } from "../src/health/position-scheduler.js";

const PAIRS_FILE = path.resolve("data", "tracked-pairs.json");
const OUT_FILE = path.resolve("artifacts", "daily-rank-snapshots.jsonl");

async function loadPairs(): Promise<TrackPair[]> {
  try {
    const raw = await fs.readFile(PAIRS_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("tracked-pairs.json must be an array");
    return arr
      .filter((x) => x && typeof x.domain === "string" && typeof x.keyword === "string")
      .map((x) => ({
        domain: x.domain,
        keyword: x.keyword,
        strictHost: x.strictHost === true,
      }));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`[daily-rank-snapshot] ${PAIRS_FILE} not found. Create it to opt in.`);
      console.error(`  Example contents: [{ "domain": "realdrseattle.com", "keyword": "plastic surgery seattle" }]`);
      return [];
    }
    throw e;
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  const pairs = await loadPairs();
  if (pairs.length === 0) {
    console.log("[daily-rank-snapshot] No tracked pairs — exiting cleanly.");
    process.exit(0);
  }

  console.log(`[daily-rank-snapshot] Tracking ${pairs.length} pairs…`);
  const results = await trackBatch(pairs, { delayMs: 1800 });

  const failed = results.filter((r) => r.error).length;
  const ranked = results.filter((r) => r.position !== null).length;
  const summary = {
    ts: new Date().toISOString(),
    totalPairs: pairs.length,
    ranked,
    unranked: pairs.length - ranked - failed,
    failed,
    durationMs: Date.now() - started,
    results: results.map((r) => ({
      domain: r.domain,
      keyword: r.keyword,
      position: r.position,
      topUrl: r.topUrl,
      error: r.error,
    })),
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.appendFile(OUT_FILE, JSON.stringify(summary) + "\n", "utf8");

  console.log(
    `[daily-rank-snapshot] Done. ranked=${ranked} unranked=${summary.unranked} failed=${failed} in ${summary.durationMs}ms`,
  );

  if (failed / pairs.length > 0.5) {
    console.error(`[daily-rank-snapshot] >50% failures — exiting with code 1 so cron flags this.`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[daily-rank-snapshot] fatal:", e);
  process.exit(1);
});
