/**
 * Ahrefs Webmaster Tools — CSV importer.
 *
 * Why this matters: Ahrefs Webmaster Tools (AWT) is 100% FREE for verified
 * sites and exposes Ahrefs' full 35-trillion-link backlink database
 * restricted to the domains you've verified. That gives you ~95% of what
 * paying Ahrefs customers see for your own-site analysis at zero cost.
 *
 * Setup:
 *   1. Sign up at https://ahrefs.com/webmaster-tools
 *   2. Verify your site (DNS record, HTML tag, or file upload)
 *   3. Open the site in AWT → Backlink profile → Backlinks tab
 *   4. Click "Export" → download the CSV
 *   5. Upload via the Backlinks page in QA-Agent
 *
 * Ahrefs CSV columns (as of 2026 — may drift slightly over time):
 *   "Referring page URL", "Referring page title", "Referring page HTTP code",
 *   "Domain rating", "URL rating", "Referring domains of referring domain",
 *   "External links of referring page", "Language", "Anchor",
 *   "Type" (text/image/redirect), "Noindex", "Nofollow", "UGC", "Sponsored",
 *   "Alt" (image anchor alt text), "Link URL" (target on your site),
 *   "First seen", "Last check", "Lost"
 *
 * We tolerate column-name variations by matching case-insensitively against
 * known synonyms. A row is only kept if it has both a referring URL and a
 * link URL.
 *
 * Parsed bundles persist per-domain at data/ahrefs-awt/<domain>.json so the
 * backlink views and link-analyzer can enrich without requiring a re-upload
 * on every crawl.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { dp, type DataPoint } from "./types.js";

const PROVIDER = "ahrefs-webmaster-csv";
const DATA_ROOT = path.join(process.cwd(), "data", "ahrefs-awt");
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — AWT exports are ~monthly

export interface AwtBacklinkRow {
  referringUrl: string;
  referringTitle?: string;
  referringDomainRating?: number;
  referringUrlRating?: number;
  anchorText?: string;
  linkType?: string;
  noFollow?: boolean;
  targetUrl: string;
  firstSeen?: string;
  lastCheck?: string;
  lost?: boolean;
}

export interface AwtBundle {
  domain: string;
  importedAt: string;
  backlinks: AwtBacklinkRow[];
  /** Precomputed summary so the UI doesn't have to recompute every render. */
  summary: {
    totalBacklinks: number;
    totalReferringDomains: number;
    dofollow: number;
    nofollow: number;
    avgDr: number;
    topReferringDomains: { domain: string; links: number }[];
    anchorTextFrequency: { anchor: string; count: number }[];
  };
}

// ── Lightweight RFC-4180 CSV parser (zero dependency) ───────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else { field += c; }
    }
  }
  if (field || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.length > 0 && r.some((f) => f.trim()));
}

function toNumber(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/[,\s%]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function toBool(s: string | undefined): boolean | undefined {
  if (!s) return undefined;
  const t = s.trim().toLowerCase();
  if (t === "true" || t === "yes" || t === "1") return true;
  if (t === "false" || t === "no" || t === "0" || t === "") return false;
  return undefined;
}

/** Map header row to canonical column indices. Matches common variants. */
interface ColIdx {
  referringUrl: number;
  referringTitle: number;
  dr: number;
  ur: number;
  anchor: number;
  type: number;
  nofollow: number;
  target: number;
  firstSeen: number;
  lastCheck: number;
  lost: number;
}

function locateColumns(header: string[]): ColIdx {
  const h = header.map((c) => c.trim().toLowerCase());
  const idx = (candidates: (string | RegExp)[]): number => {
    for (let i = 0; i < h.length; i++) {
      const cell = h[i]!;
      for (const c of candidates) {
        if (typeof c === "string") {
          if (cell === c || cell.includes(c)) return i;
        } else if (c.test(cell)) return i;
      }
    }
    return -1;
  };
  return {
    referringUrl: idx(["referring page url", "source url", "from url", /^referring.*url/]),
    referringTitle: idx(["referring page title", "source title", "page title"]),
    dr: idx(["domain rating", /^dr$/]),
    ur: idx(["url rating", /^ur$/]),
    anchor: idx(["anchor", "anchor text"]),
    type: idx(["type", "link type"]),
    nofollow: idx(["nofollow"]),
    target: idx(["link url", "target url", "to url", /^target/]),
    firstSeen: idx(["first seen"]),
    lastCheck: idx(["last check", "last seen"]),
    lost: idx(["lost"]),
  };
}

export function parseAwtBacklinksCsv(csvText: string): AwtBacklinkRow[] {
  const grid = parseCsv(csvText);
  if (grid.length < 2) throw new Error("Empty AWT backlinks CSV");
  const header = grid[0]!;
  const cols = locateColumns(header);
  if (cols.referringUrl < 0 || cols.target < 0) {
    throw new Error(
      `CSV header does not look like an Ahrefs Webmaster Tools backlinks export — missing "Referring page URL" and/or "Link URL" columns. Got: ${header.join(", ")}`,
    );
  }
  const out: AwtBacklinkRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]!;
    const referringUrl = (r[cols.referringUrl] ?? "").trim();
    const targetUrl = (r[cols.target] ?? "").trim();
    if (!referringUrl || !targetUrl) continue;
    out.push({
      referringUrl,
      targetUrl,
      referringTitle: cols.referringTitle >= 0 ? (r[cols.referringTitle] ?? "").trim() || undefined : undefined,
      referringDomainRating: cols.dr >= 0 ? toNumber(r[cols.dr]) : undefined,
      referringUrlRating: cols.ur >= 0 ? toNumber(r[cols.ur]) : undefined,
      anchorText: cols.anchor >= 0 ? (r[cols.anchor] ?? "").trim() || undefined : undefined,
      linkType: cols.type >= 0 ? (r[cols.type] ?? "").trim() || undefined : undefined,
      noFollow: cols.nofollow >= 0 ? toBool(r[cols.nofollow]) : undefined,
      firstSeen: cols.firstSeen >= 0 ? (r[cols.firstSeen] ?? "").trim() || undefined : undefined,
      lastCheck: cols.lastCheck >= 0 ? (r[cols.lastCheck] ?? "").trim() || undefined : undefined,
      lost: cols.lost >= 0 ? toBool(r[cols.lost]) : undefined,
    });
  }
  return out;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function computeSummary(backlinks: AwtBacklinkRow[]): AwtBundle["summary"] {
  const domainCounts = new Map<string, number>();
  const anchorCounts = new Map<string, number>();
  let drSum = 0;
  let drCount = 0;
  let dofollow = 0;
  let nofollow = 0;
  for (const b of backlinks) {
    const host = hostOf(b.referringUrl);
    if (host) domainCounts.set(host, (domainCounts.get(host) ?? 0) + 1);
    if (b.anchorText) {
      const a = b.anchorText.toLowerCase().trim().slice(0, 80);
      if (a) anchorCounts.set(a, (anchorCounts.get(a) ?? 0) + 1);
    }
    if (typeof b.referringDomainRating === "number") {
      drSum += b.referringDomainRating;
      drCount++;
    }
    if (b.noFollow === true) nofollow++;
    else if (b.noFollow === false) dofollow++;
  }
  const topReferringDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([domain, links]) => ({ domain, links }));
  const anchorTextFrequency = [...anchorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([anchor, count]) => ({ anchor, count }));
  return {
    totalBacklinks: backlinks.length,
    totalReferringDomains: domainCounts.size,
    dofollow,
    nofollow,
    avgDr: drCount > 0 ? Math.round((drSum / drCount) * 10) / 10 : 0,
    topReferringDomains,
    anchorTextFrequency,
  };
}

// ── Per-domain persistence ──────────────────────────────────────────────────

function safeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "_");
}

function bundlePath(domain: string): string {
  return path.join(DATA_ROOT, `${safeDomain(domain)}.json`);
}

export async function loadAwtBundle(domain: string): Promise<AwtBundle | null> {
  try {
    const raw = await readFile(bundlePath(domain), "utf8");
    return JSON.parse(raw) as AwtBundle;
  } catch {
    return null;
  }
}

async function saveAwtBundle(bundle: AwtBundle): Promise<void> {
  if (!existsSync(DATA_ROOT)) await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(bundlePath(bundle.domain), JSON.stringify(bundle, null, 2), "utf8");
}

export async function ingestAwtBacklinksCsv(domain: string, csvText: string): Promise<{
  bundle: AwtBundle;
  rowCount: number;
}> {
  const cleanDom = safeDomain(domain);
  if (!cleanDom) throw new Error("Empty domain");
  const backlinks = parseAwtBacklinksCsv(csvText);
  const bundle: AwtBundle = {
    domain: cleanDom,
    importedAt: new Date().toISOString(),
    backlinks,
    summary: computeSummary(backlinks),
  };
  await saveAwtBundle(bundle);
  return { bundle, rowCount: backlinks.length };
}

export async function fetchAwtBundle(domain: string): Promise<DataPoint<AwtBundle> | undefined> {
  const bundle = await loadAwtBundle(domain);
  if (!bundle) return undefined;
  return dp(bundle, PROVIDER, "high", TTL_MS, "imported from Ahrefs Webmaster Tools CSV");
}
