/**
 * Regenerate every past run's Combined Report HTML so it picks up the
 * per-site anchors and jump chips added in commit 215291d.
 *
 * The crawl data is already persisted in each run's
 * `MASTER-all-sites-<timestamp>.json`. We just re-render it through the
 * current `buildMasterHealthHtml` / `writeMasterHealthReports` and overwrite
 * the matching `.html`. No crawl is re-run, so this is fast (~1 run/s) and
 * safe to repeat.
 *
 * Usage:  npx tsx scripts/rebuild-combined-reports.ts
 *          npx tsx scripts/rebuild-combined-reports.ts <runId>   (single run)
 */
import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeMasterHealthReports } from "../src/health/report-site.js";
import type { SiteHealthReport } from "../src/health/types.js";

interface MasterJson {
  runId?: string;
  urlsFile?: string;
  generatedAt?: string;
  sites?: SiteHealthReport[];
}

const ARTIFACTS_ROOT = path.join(process.cwd(), "artifacts", "health");

async function main() {
  const runFilter = process.argv[2];
  let entries;
  try {
    entries = await readdir(ARTIFACTS_ROOT, { withFileTypes: true });
  } catch {
    console.log(`  (no artifacts at ${ARTIFACTS_ROOT} — nothing to rebuild)`);
    return;
  }
  const runDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const targets = runFilter ? runDirs.filter((d) => d === runFilter) : runDirs;
  if (runFilter && targets.length === 0) {
    console.error(`  run "${runFilter}" not found under artifacts/health`);
    process.exit(1);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const runId of targets) {
    const runDir = path.join(ARTIFACTS_ROOT, runId);
    let masterJsonName: string | null = null;
    try {
      const files = await readdir(runDir);
      const masters = files.filter((f) => f.startsWith("MASTER-all-sites-") && f.endsWith(".json"));
      if (masters.length === 0) { skipped++; continue; }
      masters.sort(); // pick newest timestamp
      masterJsonName = masters[masters.length - 1]!;
    } catch {
      skipped++; continue;
    }

    const jsonPath = path.join(runDir, masterJsonName);
    try {
      const raw = await readFile(jsonPath, "utf8");
      const data = JSON.parse(raw) as MasterJson;
      if (!data.sites || data.sites.length === 0) { skipped++; continue; }
      const fileBaseName = masterJsonName.replace(/\.json$/, "");
      await writeMasterHealthReports({
        reports: data.sites,
        runDir,
        fileBaseName,
        meta: {
          runId: data.runId ?? runId,
          urlsFile: data.urlsFile ?? "(unknown)",
          generatedAt: data.generatedAt ?? (await stat(jsonPath)).mtime.toISOString(),
        },
      });
      ok++;
      console.log(`  ✓ ${runId}  (${data.sites.length} site${data.sites.length === 1 ? "" : "s"})`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${runId}  ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nRebuilt ${ok} · skipped ${skipped} · failed ${failed} · total ${targets.length}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
