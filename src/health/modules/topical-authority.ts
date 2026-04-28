/**
 * Topical Authority — measures how authoritative a domain is on
 * each TOPIC, not just overall. Google's Helpful Content + E-E-A-T
 * frameworks both reward topic-level expertise; QA-Agent now
 * surfaces the signal.
 *
 * Pipeline (per crawl run + optional GSC site):
 *   1. Bucket every crawled page by URL section ("/blog/", "/services/").
 *   2. For each section ("topic"):
 *        a. pageCount        — how many pages we have on this topic
 *        b. avgWordCount     — content depth signal
 *        c. avgGscImpressions — search demand we capture (when GSC connected)
 *        d. avgGscPosition   — how Google ranks us on this topic
 *        e. externalCitations — links FROM the section TO outside (E-E-A-T)
 *        f. internalDepth    — average inbound links per page in section
 *   3. Composite score 0-100 weighted by:
 *        depth   30  (avg word count)
 *        traffic 25  (GSC impressions if available)
 *        rank    20  (avg position; lower is better)
 *        density 15  (page count, log-scaled)
 *        cite    10  (external citation density)
 *
 * Returns ranked sections so operators see "where you're authoritative"
 * vs "where you're thin and Google doesn't trust you yet".
 */

import type { SiteHealthReport } from "../types.js";
import { queryGscAnalytics } from "../providers/google-search-console.js";

export interface TopicalAuthorityRow {
  section: string;
  /** Human-readable label inferred from the most-common page title prefix. */
  label: string;
  pageCount: number;
  avgWordCount: number;
  avgGscImpressions: number | null;
  avgGscPosition: number | null;
  externalCitationsPerPage: number;
  internalLinksPerPage: number;
  /** 0-100 composite. */
  authorityScore: number;
  /** Human-readable strength tier. */
  tier: "authoritative" | "established" | "emerging" | "thin";
}

export interface TopicalAuthorityResult {
  hostname: string;
  totalPages: number;
  totalSections: number;
  rows: TopicalAuthorityRow[];
  generatedAt: string;
}

export interface TopicalAuthorityInput {
  /** SiteHealthReports from a run for this hostname. */
  reports: SiteHealthReport[];
  /** Optional GSC site URL — when present we layer real impressions + position data. */
  gscSiteUrl?: string;
}

function sectionOfUrl(u: string): string {
  try {
    const url = new URL(u);
    const seg = url.pathname.split("/").filter(Boolean)[0];
    return seg ? `/${seg}/` : "/";
  } catch {
    return "/";
  }
}

function tierFor(score: number): TopicalAuthorityRow["tier"] {
  if (score >= 75) return "authoritative";
  if (score >= 55) return "established";
  if (score >= 35) return "emerging";
  return "thin";
}

export async function analyzeTopicalAuthority(input: TopicalAuthorityInput): Promise<TopicalAuthorityResult> {
  const reports = input.reports;
  if (reports.length === 0) throw new Error("no crawl reports provided");
  const hostname = reports[0]!.hostname;

  // Bucket pages by section.
  interface Bucket {
    pages: Set<string>;
    titles: string[];
    wordCounts: number[];
    inboundLinkCount: number;
    externalLinks: number;
  }
  const sections = new Map<string, Bucket>();

  // Build a set of internal URLs first so we can count "from-this-page TO outside".
  const allInternal = new Set<string>();
  for (const r of reports) {
    for (const p of r.crawl.pages) allInternal.add(p.url);
  }

  for (const r of reports) {
    for (const p of r.crawl.pages) {
      const sec = sectionOfUrl(p.url);
      const slot = sections.get(sec) ?? { pages: new Set(), titles: [], wordCounts: [], inboundLinkCount: 0, externalLinks: 0 };
      slot.pages.add(p.url);
      if (p.documentTitle) slot.titles.push(p.documentTitle);
      if (typeof p.bodyBytes === "number") slot.wordCounts.push(Math.round(p.bodyBytes / 6)); // ~6 bytes/word avg
      sections.set(sec, slot);
    }
    // Use linkChecks (HEAD-checked URLs that the BFS noticed but didn't crawl)
    // as a proxy for outbound link counts per section. They're per-page hard
    // to attribute, so spread evenly across sections by host.
    for (const lc of r.crawl.linkChecks ?? []) {
      try {
        const sec = sectionOfUrl(lc.target);
        const slot = sections.get(sec);
        if (slot) slot.inboundLinkCount++;
      } catch { /* skip */ }
    }
  }

  // Optional GSC layer: per-page impressions + position over the last 28 days.
  const gscByPage = new Map<string, { impressions: number; position: number }>();
  if (input.gscSiteUrl?.trim()) {
    try {
      const rows = await queryGscAnalytics({
        siteUrl: input.gscSiteUrl.trim(),
        dimensions: ["page"],
        rowLimit: 5000,
      });
      for (const r of rows) {
        const pageUrl = r.keys[0] ?? "";
        if (!pageUrl) continue;
        gscByPage.set(pageUrl, {
          impressions: r.impressions.value ?? 0,
          position: r.position.value ?? 0,
        });
      }
    } catch { /* GSC failure is non-fatal */ }
  }

  // Score each section.
  const allPageCounts = [...sections.values()].map((s) => s.pages.size);
  const maxLogPageCount = allPageCounts.length > 0 ? Math.log10(Math.max(...allPageCounts) + 1) : 1;

  const rows: TopicalAuthorityRow[] = [];
  for (const [section, slot] of sections) {
    if (section === "/") continue; // Root doesn't get a topic score
    const pageCount = slot.pages.size;
    if (pageCount < 2) continue; // Need ≥2 pages to call something a "topic"
    const avgWordCount = slot.wordCounts.length > 0 ? Math.round(slot.wordCounts.reduce((a, b) => a + b, 0) / slot.wordCounts.length) : 0;

    // GSC layer
    const sectionPages = [...slot.pages];
    const gscEntries = sectionPages.map((u) => gscByPage.get(u)).filter((e): e is { impressions: number; position: number } => !!e);
    const avgGscImpressions = gscEntries.length > 0 ? Math.round(gscEntries.reduce((s, e) => s + e.impressions, 0) / gscEntries.length) : null;
    const avgGscPosition = gscEntries.length > 0 ? +(gscEntries.reduce((s, e) => s + e.position, 0) / gscEntries.length).toFixed(1) : null;

    // Composite score components, all 0-1.
    const depthScore   = Math.min(1, avgWordCount / 1200);
    const trafficScore = avgGscImpressions != null ? Math.min(1, Math.log10(avgGscImpressions + 1) / 4) : 0; // 10K impressions ≈ 1.0
    const rankScore    = avgGscPosition != null ? Math.max(0, 1 - (avgGscPosition - 1) / 30) : 0;
    const densityScore = maxLogPageCount > 0 ? Math.log10(pageCount + 1) / maxLogPageCount : 0;
    const citeScore    = Math.min(1, slot.inboundLinkCount / Math.max(pageCount, 1) / 5);

    const authorityScore = Math.round(
      depthScore * 30 + trafficScore * 25 + rankScore * 20 + densityScore * 15 + citeScore * 10,
    );

    // Pick a label — prefix-of-most-common-title pattern.
    const titleSample = slot.titles[0] ?? section.replace(/^\/|\/$/g, "");
    const label = titleSample.length > 60 ? titleSample.slice(0, 57) + "…" : titleSample;

    rows.push({
      section,
      label,
      pageCount,
      avgWordCount,
      avgGscImpressions,
      avgGscPosition,
      externalCitationsPerPage: 0, // Filled below if we have linkCheck data
      internalLinksPerPage: pageCount > 0 ? +(slot.inboundLinkCount / pageCount).toFixed(2) : 0,
      authorityScore,
      tier: tierFor(authorityScore),
    });
  }

  rows.sort((a, b) => b.authorityScore - a.authorityScore);
  const totalPages = reports.reduce((s, r) => s + r.crawl.pages.length, 0);

  return {
    hostname,
    totalPages,
    totalSections: rows.length,
    rows,
    generatedAt: new Date().toISOString(),
  };
}
