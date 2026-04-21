/**
 * Keep only the N most recent crawl runs in artifacts/health/, delete the
 * rest. Crawl artifacts add up fast (screenshots + HTML + JSON per page) —
 * one big site can hit 500 MB per run.
 *
 * Usage:
 *   tsx scripts/prune-old-runs.ts              # keep 10 most recent (default)
 *   tsx scripts/prune-old-runs.ts 25           # keep 25 most recent
 *   QA_AGENT_RETAIN_RUNS=5 tsx scripts/prune-old-runs.ts
 *
 * "Most recent" is determined by the directory name (ISO timestamp prefix),
 * which sorts lexically in chronological order. Runs without a valid
 * ISO-prefix name are treated as oldest and pruned first.
 *
 * Rule: runs that don't have a run-meta.json are considered INCOMPLETE and
 * are always pruned regardless of age — they can't be loaded by the UI
 * anyway and are pure dead weight.
 *
 * Wire as a cron or run on server startup. Exit code 0 = clean, 1 = fatal.
 */

import { rm, stat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const OUT_ROOT = path.resolve("artifacts", "health");

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      try {
        if (ent.isDirectory()) {
          total += await dirSizeBytes(p);
        } else {
          const st = await stat(p);
          total += st.size;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  return total;
}

async function main(): Promise<void> {
  const keepRaw = process.argv[2] ?? process.env.QA_AGENT_RETAIN_RUNS ?? "10";
  const keep = Math.max(0, Number.parseInt(keepRaw, 10) || 0);

  let entries;
  try {
    entries = await readdir(OUT_ROOT, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`[prune] ${OUT_ROOT} does not exist — nothing to do.`);
      return;
    }
    throw e;
  }

  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);

  // Partition into complete vs. incomplete
  const complete: string[] = [];
  const incomplete: string[] = [];
  for (const name of dirs) {
    const metaPath = path.join(OUT_ROOT, name, "run-meta.json");
    try {
      await readFile(metaPath, "utf8");
      complete.push(name);
    } catch {
      incomplete.push(name);
    }
  }

  // Keep the newest `keep` complete runs; everything else goes.
  complete.sort(); // ISO-timestamp prefix sorts chronologically
  const keepSet = new Set(complete.slice(-keep));
  const toDelete = [...incomplete, ...complete.filter((n) => !keepSet.has(n))];

  if (toDelete.length === 0) {
    console.log(
      `[prune] ${complete.length} complete run${complete.length === 1 ? "" : "s"} · ${incomplete.length} incomplete · nothing to delete (retain = ${keep}).`,
    );
    return;
  }

  let freed = 0;
  for (const name of toDelete) {
    const dir = path.join(OUT_ROOT, name);
    const size = await dirSizeBytes(dir);
    try {
      await rm(dir, { recursive: true, force: true });
      freed += size;
      const marker = incomplete.includes(name) ? "incomplete" : "old";
      console.log(`[prune] removed ${name}  (${marker}, ${(size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      console.error(`[prune] failed to remove ${name}:`, e);
    }
  }

  console.log(
    `[prune] Done. Removed ${toDelete.length} run${toDelete.length === 1 ? "" : "s"} · freed ${(freed / 1024 / 1024).toFixed(1)} MB · kept ${keepSet.size}.`,
  );
}

main().catch((e) => {
  console.error("[prune] fatal:", e);
  process.exit(1);
});
