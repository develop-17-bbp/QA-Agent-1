/**
 * Local Rank Tracker — Google Map Pack ranking + citation consistency
 * for local businesses (the existing local-seo-analyzer covers on-site
 * NAP/schema; this module covers what's OFF the site).
 *
 * Two capabilities:
 *
 *   1. trackMapPack(query, location)
 *      Playwright-driven Google SERP fetch that captures the local-pack
 *      "3-pack" box. For each business in the pack, returns name +
 *      rating + review count + position + maps URL. Stores history in
 *      data/local-rank-history/<domain>.json so trends can render.
 *
 *   2. auditCitationConsistency(business, directories?)
 *      Fetches top citation directories (Yelp, BBB, Yellow Pages,
 *      Foursquare, Apple Maps, etc.) for the business's name and
 *      checks whether the listed NAP matches the operator's canonical
 *      NAP. NAP mismatches across directories tank local rank.
 *
 * Privacy: queries Google + public directory pages. No external LLM,
 * no third-party SaaS. Playwright already a project dep (form-tests
 * + screenshot + AI Overviews).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const RANK_HISTORY_ROOT = path.join(process.cwd(), "data", "local-rank-history");

// ── Types ───────────────────────────────────────────────────────────────

export interface MapPackEntry {
  position: number;
  name: string;
  /** 1-5 stars; null when missing. */
  rating: number | null;
  reviewCount: number | null;
  /** Category line ("Plastic surgeon · 3.2 mi"). */
  category: string;
  /** Maps URL or place link. */
  url: string | null;
  /** Phone if visible. */
  phone: string | null;
}

export interface MapPackSnapshot {
  query: string;
  location: string;
  fetchedAt: string;
  pack: MapPackEntry[];
  /** Operator's match in the pack if found, else null. */
  operatorMatch: { name: string; position: number } | null;
}

export interface MapPackInput {
  query: string;
  /** Operator's business name to look for in the pack. */
  operatorName: string;
  /** Coordinates ("lat,lng") or place name ("Seattle, WA"). Default location uses Google's IP geo. */
  location?: string;
}

export interface CitationCheckRow {
  directory: string;
  url: string;
  found: boolean;
  /** True when directory's NAP matches operator's canonical NAP. */
  napMatch: boolean | null;
  /** Specific mismatches detected (e.g. "phone"). */
  mismatches: string[];
  fetchedAt: string;
  error?: string;
}

export interface CitationConsistencyResult {
  businessName: string;
  canonicalNap: { name: string; phone?: string; address?: string };
  directories: CitationCheckRow[];
  summary: {
    checked: number;
    listed: number;
    consistent: number;
    inconsistent: number;
    missing: number;
  };
  generatedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s@.-]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

async function appendMapPackHistory(operatorDomain: string, snap: MapPackSnapshot): Promise<void> {
  try {
    await fs.mkdir(RANK_HISTORY_ROOT, { recursive: true });
    const file = path.join(RANK_HISTORY_ROOT, `${operatorDomain.replace(/[^\w.-]/g, "_")}.json`);
    let history: MapPackSnapshot[] = [];
    try {
      const existing = await fs.readFile(file, "utf8");
      history = JSON.parse(existing) as MapPackSnapshot[];
      if (!Array.isArray(history)) history = [];
    } catch { /* first run */ }
    history.push(snap);
    await fs.writeFile(file, JSON.stringify(history.slice(-90), null, 2), { encoding: "utf8", mode: 0o600 });
  } catch { /* non-fatal */ }
}

// ── Map Pack tracker ────────────────────────────────────────────────────

export async function trackMapPack(input: MapPackInput, operatorDomain?: string): Promise<MapPackSnapshot> {
  const query = input.query.trim();
  if (!query) throw new Error("query is required");
  const location = (input.location ?? "United States").trim();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    // Use Google's `uule` parameter via the place-name → search query.
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + " near " + location)}&hl=en&gl=us`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });

    const pack: MapPackEntry[] = await page.evaluate(`(() => {
      const pack = [];
      // Local pack containers — Google shuffles selectors. Try multiple.
      const candidates = document.querySelectorAll(
        'div[role="article"], div[jscontroller][data-hveid][data-ved] div[role="article"], div.VkpGBb'
      );
      let position = 0;
      for (const el of candidates) {
        if (position >= 3) break;
        const text = (el).innerText || "";
        if (!text || text.length < 5) continue;
        const lines = text.split(/\\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length < 1) continue;
        const name = lines[0] || "";
        if (!name) continue;
        // Rating: "4.7" inside text. Review count in parens "(123)".
        const ratingMatch = text.match(/(?:^|\\s)(\\d\\.\\d)(?:\\s|\\(|·)/);
        const reviewMatch = text.match(/\\((\\d[\\d,]*)\\)/);
        const phoneMatch = text.match(/(?:\\(\\d{3}\\)\\s?|\\b\\d{3}[-.\\s])\\d{3}[-.\\s]?\\d{4}/);
        const linkEl = (el).querySelector('a[href*="/maps/place/"], a[href*="/maps/"]');
        const url = linkEl ? (linkEl).href : null;
        // Category line is usually 2nd line after name; fall back to first non-numeric line.
        const category = lines.find((l, i) => i > 0 && !/^\\d/.test(l)) || "";
        position++;
        pack.push({
          position,
          name,
          rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
          reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ""), 10) : null,
          category: category.slice(0, 120),
          url,
          phone: phoneMatch ? phoneMatch[0] : null,
        });
      }
      return pack;
    })()`) as MapPackEntry[];

    await context.close();
    const operatorMatch = pack.find((e) => normalize(e.name).includes(normalize(input.operatorName)) || normalize(input.operatorName).includes(normalize(e.name)));
    const snap: MapPackSnapshot = {
      query,
      location,
      fetchedAt: new Date().toISOString(),
      pack,
      operatorMatch: operatorMatch ? { name: operatorMatch.name, position: operatorMatch.position } : null,
    };
    if (operatorDomain) void appendMapPackHistory(operatorDomain, snap);
    return snap;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Citation consistency auditor ────────────────────────────────────────

const DEFAULT_DIRECTORIES = [
  { name: "Yelp", url: (q: string) => `https://www.yelp.com/search?find_desc=${encodeURIComponent(q)}` },
  { name: "BBB", url: (q: string) => `https://www.bbb.org/search?find_text=${encodeURIComponent(q)}` },
  { name: "Yellow Pages", url: (q: string) => `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(q)}` },
  { name: "Manta", url: (q: string) => `https://www.manta.com/search?search=${encodeURIComponent(q)}` },
  { name: "Foursquare", url: (q: string) => `https://foursquare.com/explore?q=${encodeURIComponent(q)}` },
  { name: "MapQuest", url: (q: string) => `https://www.mapquest.com/search/${encodeURIComponent(q)}` },
];

export interface CitationInput {
  businessName: string;
  canonicalNap: { name: string; phone?: string; address?: string };
  /** Override the default directory list. */
  directories?: { name: string; url: (q: string) => string }[];
}

export async function auditCitationConsistency(input: CitationInput): Promise<CitationConsistencyResult> {
  const dirs = input.directories ?? DEFAULT_DIRECTORIES;
  const rows: CitationCheckRow[] = [];
  const canonicalPhone = input.canonicalNap.phone ? normalizePhone(input.canonicalNap.phone) : null;
  const canonicalNameNorm = normalize(input.canonicalNap.name);

  await Promise.all(dirs.map(async (d) => {
    const url = d.url(input.businessName);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; QA-Agent-Citation/1.0)" },
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      const html = await res.text();
      const found = normalize(html).includes(canonicalNameNorm);
      const mismatches: string[] = [];
      let napMatch: boolean | null = null;
      if (found) {
        // Phone mismatch detection — find any phone-shaped strings.
        if (canonicalPhone) {
          const phones = (html.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? []).map(normalizePhone);
          const inDoc = phones.includes(canonicalPhone);
          if (!inDoc && phones.length > 0) mismatches.push("phone");
          napMatch = inDoc;
        } else {
          napMatch = true; // listed but no canonical phone to verify against
        }
      }
      rows.push({
        directory: d.name,
        url,
        found,
        napMatch,
        mismatches,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      rows.push({
        directory: d.name,
        url,
        found: false,
        napMatch: null,
        mismatches: [],
        fetchedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message.slice(0, 100) : "fetch failed",
      });
    }
  }));

  rows.sort((a, b) => a.directory.localeCompare(b.directory));
  const summary = {
    checked: rows.length,
    listed: rows.filter((r) => r.found).length,
    consistent: rows.filter((r) => r.found && r.napMatch === true).length,
    inconsistent: rows.filter((r) => r.found && r.napMatch === false).length,
    missing: rows.filter((r) => !r.found && !r.error).length,
  };

  return {
    businessName: input.businessName,
    canonicalNap: input.canonicalNap,
    directories: rows,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

export async function readMapPackHistory(operatorDomain: string): Promise<MapPackSnapshot[]> {
  try {
    const file = path.join(RANK_HISTORY_ROOT, `${operatorDomain.replace(/[^\w.-]/g, "_")}.json`);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
