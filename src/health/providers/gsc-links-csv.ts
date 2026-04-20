/**
 * Google Search Console Links — CSV importer.
 *
 * Why CSV and not the API: Google deprecated the public Search Console Links
 * endpoint. The Links report is now only available in the GSC UI (or via
 * BigQuery export for enterprise tier). Users can still download any of the
 * three Links CSVs from the UI and feed them in here:
 *
 *   1. Top linking sites      → referring domains + link counts
 *   2. Top linked pages       → top pages on your site receiving links
 *   3. Top linking text       → anchor text frequency
 *
 * The parsed rows are persisted per-domain at data/gsc-links/<domain>.json
 * so `link-analyzer.ts` can enrich its ExternalBacklinkReport without
 * requiring a re-upload on every run.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { dp, type DataPoint } from "./types.js";

const PROVIDER = "gsc-links-csv";
const DATA_ROOT = path.join(process.cwd(), "data", "gsc-links");
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — users re-export monthly

export type GscLinksReportType = "top-linking-sites" | "top-linked-pages" | "top-linking-text";

export interface GscLinkingSiteRow { source: string; links: number }
export interface GscLinkedPageRow { target: string; links: number }
export interface GscLinkingTextRow { anchor: string; links: number }

export interface GscLinksBundle {
  domain: string;
  importedAt: string;
  topLinkingSites: GscLinkingSiteRow[];
  topLinkedPages: GscLinkedPageRow[];
  topLinkingText: GscLinkingTextRow[];
}

// ── Lightweight RFC-4180 CSV parser (no dependency) ─────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, ""); // strip BOM
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

function parseNumber(s: string): number {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse one of the three GSC Links CSVs. Auto-detects the report type from
 * the header row (Google uses consistent column titles across locales with
 * small variations). Returns an array of typed rows and the detected type.
 */
export function parseGscLinksCsv(csvText: string): {
  reportType: GscLinksReportType;
  rows: GscLinkingSiteRow[] | GscLinkedPageRow[] | GscLinkingTextRow[];
} {
  const grid = parseCsv(csvText);
  if (grid.length === 0) throw new Error("Empty CSV");
  const header = grid[0]!.map((h) => h.trim().toLowerCase());

  // Detect report type by matching the first column.
  const col0 = header[0] ?? "";
  if (/^(top linking site|top linking sites|linking site|source)/i.test(col0)) {
    const rows: GscLinkingSiteRow[] = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i]!;
      const source = (r[0] ?? "").trim();
      const links = parseNumber(r[1] ?? "0");
      if (source) rows.push({ source, links });
    }
    return { reportType: "top-linking-sites", rows };
  }
  if (/^(top linked page|top linked pages|linked page|target)/i.test(col0)) {
    const rows: GscLinkedPageRow[] = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i]!;
      const target = (r[0] ?? "").trim();
      const links = parseNumber(r[1] ?? "0");
      if (target) rows.push({ target, links });
    }
    return { reportType: "top-linked-pages", rows };
  }
  if (/^(top linking text|anchor|linking text)/i.test(col0)) {
    const rows: GscLinkingTextRow[] = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i]!;
      const anchor = (r[0] ?? "").trim();
      const links = parseNumber(r[1] ?? "0");
      if (anchor) rows.push({ anchor, links });
    }
    return { reportType: "top-linking-text", rows };
  }

  throw new Error(`Unrecognized GSC Links CSV. Expected first column to look like "Top linking sites", "Top linked pages", or "Top linking text". Saw: "${grid[0]![0] ?? ""}"`);
}

// ── Per-domain persistence ──────────────────────────────────────────────────

function safeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "_");
}

function bundlePath(domain: string): string {
  return path.join(DATA_ROOT, `${safeDomain(domain)}.json`);
}

export async function loadBundle(domain: string): Promise<GscLinksBundle | null> {
  try {
    const raw = await readFile(bundlePath(domain), "utf8");
    return JSON.parse(raw) as GscLinksBundle;
  } catch {
    return null;
  }
}

async function saveBundle(bundle: GscLinksBundle): Promise<void> {
  if (!existsSync(DATA_ROOT)) await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(bundlePath(bundle.domain), JSON.stringify(bundle, null, 2), "utf8");
}

/**
 * Merge a freshly parsed CSV into the stored bundle for a domain. Each CSV
 * type replaces the corresponding slice; other slices persist. Returns the
 * updated bundle.
 */
export async function ingestGscLinksCsv(domain: string, csvText: string): Promise<{
  bundle: GscLinksBundle;
  reportType: GscLinksReportType;
  rowCount: number;
}> {
  const cleanDom = safeDomain(domain);
  if (!cleanDom) throw new Error("Empty domain");
  const parsed = parseGscLinksCsv(csvText);
  const existing = (await loadBundle(cleanDom)) ?? {
    domain: cleanDom,
    importedAt: new Date().toISOString(),
    topLinkingSites: [],
    topLinkedPages: [],
    topLinkingText: [],
  };
  const next: GscLinksBundle = { ...existing, importedAt: new Date().toISOString() };
  if (parsed.reportType === "top-linking-sites") next.topLinkingSites = parsed.rows as GscLinkingSiteRow[];
  if (parsed.reportType === "top-linked-pages") next.topLinkedPages = parsed.rows as GscLinkedPageRow[];
  if (parsed.reportType === "top-linking-text") next.topLinkingText = parsed.rows as GscLinkingTextRow[];
  await saveBundle(next);
  return { bundle: next, reportType: parsed.reportType, rowCount: parsed.rows.length };
}

/**
 * Return a DataPoint-wrapped GSC bundle for use by link-analyzer. When no
 * bundle exists, returns undefined so callers can degrade gracefully.
 */
export async function fetchGscLinksBundle(domain: string): Promise<DataPoint<GscLinksBundle> | undefined> {
  const bundle = await loadBundle(domain);
  if (!bundle) return undefined;
  return dp(bundle, PROVIDER, "high", TTL_MS, "imported from GSC Links CSV");
}
