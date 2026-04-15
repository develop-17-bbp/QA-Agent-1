/**
 * Lightweight time-series store for historical SEO data.
 *
 * We deliberately avoid SQLite (native binary, Windows build friction) and
 * use atomic JSON-file writes. For the volumes this tool handles — at most
 * a few hundred keywords per domain, sampled daily — this is plenty fast.
 *
 * Files live under `./out/history/` by default. Override with
 * `QA_HISTORY_DIR` env var.
 *
 * Layout:
 *   history/
 *   ├── keywords/<domain>/<keyword-hash>.json   — per-keyword position series
 *   ├── backlinks/<domain>.json                 — backlink / DA series
 *   └── traffic/<domain>.json                   — traffic rank series
 */

import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_ROOT = process.env.QA_HISTORY_DIR?.trim() || path.resolve("out", "history");

function hashKey(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 120);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// ── Types ──────────────────────────────────────────────────────────

export interface KeywordPositionSample {
  at: string;               // ISO timestamp
  position: number | null;  // null means not in top-N
  url: string | null;       // our page that ranked, or null
  topUrl: string | null;    // current #1 URL for reference
  provider: string;         // e.g. "duckduckgo"
}

export interface KeywordHistory {
  domain: string;
  keyword: string;
  series: KeywordPositionSample[];
}

export interface BacklinkSample {
  at: string;
  referringDomains: number | null;
  domainAuthority: number | null;
  provider: string;
}

export interface BacklinkHistory {
  domain: string;
  series: BacklinkSample[];
}

export interface TrafficSample {
  at: string;
  trancoRank: number | null;
  cloudflareRadarRank: number | null;
  provider: string;
}

export interface TrafficHistory {
  domain: string;
  series: TrafficSample[];
}

// ── Keyword positions ──────────────────────────────────────────────

function keywordFile(domain: string, keyword: string): string {
  const h = hashKey(keyword.toLowerCase().trim());
  return path.join(DEFAULT_ROOT, "keywords", safeSlug(domain), `${h}.json`);
}

export async function recordKeywordPosition(
  domain: string,
  keyword: string,
  sample: Omit<KeywordPositionSample, "at"> & { at?: string },
): Promise<void> {
  const file = keywordFile(domain, keyword);
  const existing = (await readJson<KeywordHistory>(file)) ?? {
    domain: domain.toLowerCase(),
    keyword: keyword.trim(),
    series: [],
  };
  existing.series.push({
    at: sample.at ?? new Date().toISOString(),
    position: sample.position,
    url: sample.url,
    topUrl: sample.topUrl,
    provider: sample.provider,
  });
  // Cap history at 365 samples (≈1 year daily) to keep files small
  if (existing.series.length > 365) {
    existing.series = existing.series.slice(-365);
  }
  await atomicWrite(file, JSON.stringify(existing, null, 2));
}

export async function getKeywordHistory(domain: string, keyword: string): Promise<KeywordHistory | undefined> {
  return readJson<KeywordHistory>(keywordFile(domain, keyword));
}

export async function listTrackedKeywords(domain: string): Promise<string[]> {
  const dir = path.join(DEFAULT_ROOT, "keywords", safeSlug(domain));
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const keywords: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const hist = await readJson<KeywordHistory>(path.join(dir, f));
    if (hist?.keyword) keywords.push(hist.keyword);
  }
  return keywords.sort();
}

// ── Backlink history ───────────────────────────────────────────────

function backlinkFile(domain: string): string {
  return path.join(DEFAULT_ROOT, "backlinks", `${safeSlug(domain)}.json`);
}

export async function recordBacklinkSnapshot(
  domain: string,
  sample: Omit<BacklinkSample, "at"> & { at?: string },
): Promise<void> {
  const file = backlinkFile(domain);
  const existing = (await readJson<BacklinkHistory>(file)) ?? {
    domain: domain.toLowerCase(),
    series: [],
  };
  existing.series.push({
    at: sample.at ?? new Date().toISOString(),
    referringDomains: sample.referringDomains,
    domainAuthority: sample.domainAuthority,
    provider: sample.provider,
  });
  if (existing.series.length > 365) existing.series = existing.series.slice(-365);
  await atomicWrite(file, JSON.stringify(existing, null, 2));
}

export async function getBacklinkHistory(domain: string): Promise<BacklinkHistory | undefined> {
  return readJson<BacklinkHistory>(backlinkFile(domain));
}

// ── Traffic history ────────────────────────────────────────────────

function trafficFile(domain: string): string {
  return path.join(DEFAULT_ROOT, "traffic", `${safeSlug(domain)}.json`);
}

export async function recordTrafficSnapshot(
  domain: string,
  sample: Omit<TrafficSample, "at"> & { at?: string },
): Promise<void> {
  const file = trafficFile(domain);
  const existing = (await readJson<TrafficHistory>(file)) ?? {
    domain: domain.toLowerCase(),
    series: [],
  };
  existing.series.push({
    at: sample.at ?? new Date().toISOString(),
    trancoRank: sample.trancoRank,
    cloudflareRadarRank: sample.cloudflareRadarRank,
    provider: sample.provider,
  });
  if (existing.series.length > 365) existing.series = existing.series.slice(-365);
  await atomicWrite(file, JSON.stringify(existing, null, 2));
}

export async function getTrafficHistory(domain: string): Promise<TrafficHistory | undefined> {
  return readJson<TrafficHistory>(trafficFile(domain));
}

// ── Summary ────────────────────────────────────────────────────────

export async function getHistoryStats(): Promise<{
  root: string;
  domains: string[];
  keywordCount: number;
  backlinkDomains: number;
  trafficDomains: number;
}> {
  const root = DEFAULT_ROOT;
  const domains = new Set<string>();
  let keywordCount = 0;

  const kwRoot = path.join(root, "keywords");
  if (existsSync(kwRoot)) {
    const dirs = await readdir(kwRoot);
    for (const d of dirs) {
      domains.add(d);
      const files = await readdir(path.join(kwRoot, d)).catch(() => [] as string[]);
      keywordCount += files.filter((f) => f.endsWith(".json")).length;
    }
  }

  let backlinkDomains = 0;
  const blRoot = path.join(root, "backlinks");
  if (existsSync(blRoot)) {
    const files = await readdir(blRoot);
    backlinkDomains = files.filter((f) => f.endsWith(".json")).length;
    for (const f of files) domains.add(f.replace(/\.json$/, ""));
  }

  let trafficDomains = 0;
  const trRoot = path.join(root, "traffic");
  if (existsSync(trRoot)) {
    const files = await readdir(trRoot);
    trafficDomains = files.filter((f) => f.endsWith(".json")).length;
    for (const f of files) domains.add(f.replace(/\.json$/, ""));
  }

  return {
    root,
    domains: Array.from(domains).sort(),
    keywordCount,
    backlinkDomains,
    trafficDomains,
  };
}
