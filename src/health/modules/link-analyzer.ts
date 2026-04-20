/**
 * Link / backlink analyzer powered by real free data sources.
 *
 * This module has two layers:
 *   1. SELF-CRAWL ANALYSIS — uses the existing crawl results to describe the
 *      site's internal link graph (orphans, internal vs external, broken).
 *   2. EXTERNAL BACKLINK DISCOVERY — queries real free providers to surface
 *      backlinks from the outside web:
 *        - Common Crawl CDX index (approximate referring domains)
 *        - URLScan.io recent scans (recent link activity)
 *        - OpenPageRank (domain authority score)
 *        - Wayback Machine (historical link count)
 *
 * No LLM estimates. Every number carries provenance.
 */

import type { SiteHealthReport } from "../types.js";
import { approximateReferringDomains, fetchDomainHits, fetchWarcRecord, extractAnchorsToTarget, type WarcAnchor } from "../providers/common-crawl.js";
import { searchDomainReferences, isUrlscanConfigured } from "../providers/urlscan.js";
import { fetchDomainAuthority, isOpenPageRankConfigured } from "../providers/open-page-rank.js";
import { fetchSnapshotHistory } from "../providers/wayback-machine.js";
import { fetchBingBacklinks, isBingWmtConfigured, type BingLinkRow } from "../providers/bing-webmaster.js";

function safeHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// ── Self-crawl link analysis (unchanged core, kept for backwards compat) ──

export function analyzeBacklinks(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const linkChecks = reports.flatMap(r => r.crawl.linkChecks ?? []);
  const brokenLinks = reports.flatMap(r => r.crawl.brokenLinks);
  const hostnames = new Set(reports.map(r => r.hostname));

  const inboundCount = new Map<string, number>();
  for (const check of linkChecks) {
    inboundCount.set(check.target, (inboundCount.get(check.target) ?? 0) + 1);
  }

  const topLinked = [...inboundCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([url, count]) => ({ url, inboundLinks: count }));

  const linkedUrls = new Set(inboundCount.keys());
  const orphanPages = allPages.filter(p => p.ok && !linkedUrls.has(p.url)).map(p => ({ url: p.url, title: p.documentTitle ?? "" })).slice(0, 30);

  const internalCount = linkChecks.filter(l => hostnames.has(safeHostname(l.target))).length;
  const externalCount = linkChecks.filter(l => !hostnames.has(safeHostname(l.target))).length;
  const healthy = linkChecks.filter(l => l.ok).length;
  const redirected = linkChecks.filter(l => l.status >= 300 && l.status < 400).length;

  return {
    totalLinks: linkChecks.length + brokenLinks.length,
    internalLinks: internalCount,
    externalLinks: externalCount,
    topLinked,
    orphanPages,
    healthDistribution: { healthy, broken: brokenLinks.length, redirected },
    brokenLinks: brokenLinks.slice(0, 30).map(bl => ({ source: bl.foundOn, target: bl.target, status: bl.status ?? 0, error: bl.error ?? "" })),
    summary: { totalPages: allPages.length, pagesWithInboundLinks: linkedUrls.size, orphanPageCount: orphanPages.length, avgLinksPerPage: allPages.length > 0 ? +(linkChecks.length / allPages.length).toFixed(1) : 0 },
  };
}

export function analyzeReferringDomains(reports: SiteHealthReport[]) {
  const linkChecks = reports.flatMap(r => r.crawl.linkChecks ?? []);
  const hostnames = new Set(reports.map(r => r.hostname));

  const domainMap = new Map<string, { urls: string[]; ok: number; broken: number }>();
  for (const check of linkChecks) {
    const host = safeHostname(check.target);
    if (hostnames.has(host)) continue;
    const entry = domainMap.get(host) ?? { urls: [], ok: 0, broken: 0 };
    if (entry.urls.length < 10) entry.urls.push(check.target);
    if (check.ok) entry.ok++; else entry.broken++;
    domainMap.set(host, entry);
  }

  const sections = [...domainMap.entries()]
    .sort((a, b) => (b[1].ok + b[1].broken) - (a[1].ok + a[1].broken))
    .slice(0, 30)
    .map(([domain, data]) => ({
      domain,
      totalLinks: data.ok + data.broken,
      healthyLinks: data.ok,
      brokenLinks: data.broken,
      trustScore: +(data.ok / Math.max(1, data.ok + data.broken) * 100).toFixed(1),
      sampleUrls: data.urls.slice(0, 5),
    }));

  return {
    sections,
    totalDomains: domainMap.size,
    authorityDistribution: { high: sections.filter(s => s.trustScore >= 80).length, medium: sections.filter(s => s.trustScore >= 50 && s.trustScore < 80).length, low: sections.filter(s => s.trustScore < 50).length },
    summary: { totalExternalDomains: domainMap.size, avgTrustScore: sections.length > 0 ? +(sections.reduce((a, s) => a + s.trustScore, 0) / sections.length).toFixed(1) : 0 },
  };
}

export function auditBacklinks(reports: SiteHealthReport[]) {
  const linkChecks = reports.flatMap(r => r.crawl.linkChecks ?? []);
  const brokenLinks = reports.flatMap(r => r.crawl.brokenLinks);

  const healthy = linkChecks.filter(l => l.ok).length;
  const broken = brokenLinks.length;
  const redirected = linkChecks.filter(l => l.status >= 300 && l.status < 400).length;
  const serverErrors = linkChecks.filter(l => l.status >= 500).length;
  const clientErrors = linkChecks.filter(l => l.status >= 400 && l.status < 500).length;
  const totalChecked = linkChecks.length + brokenLinks.length;
  const toxicPercent = totalChecked > 0 ? +((broken + serverErrors) / totalChecked * 100).toFixed(1) : 0;

  const links = [
    ...brokenLinks.map(bl => ({ url: bl.target, source: bl.foundOn, status: bl.status ?? 0, health: "broken" as const, reason: bl.error ?? `HTTP ${bl.status}` })),
    ...linkChecks.filter(l => !l.ok || l.status >= 300).slice(0, 50).map(l => ({ url: l.target, source: "", status: l.status, health: (l.status >= 500 ? "server-error" : l.status >= 400 ? "client-error" : "redirect") as string, reason: `HTTP ${l.status}` })),
  ].slice(0, 50);

  return {
    healthy, broken, redirected, serverErrors, clientErrors, links, toxicPercent,
    overallScore: totalChecked > 0 ? Math.max(0, Math.round(100 - toxicPercent * 2)) : 100,
    statusDistribution: { "2xx": linkChecks.filter(l => l.status >= 200 && l.status < 300).length, "3xx": redirected, "4xx": clientErrors, "5xx": serverErrors },
    summary: { totalChecked, healthyPercent: totalChecked > 0 ? +((healthy / totalChecked) * 100).toFixed(1) : 100, actionRequired: broken + serverErrors },
  };
}

// ── NEW: external backlink discovery from real free providers ───────────

export interface ExternalBacklinkReport {
  domain: string;
  domainAuthority: { value: number; source: string; confidence: string } | null;
  referringDomainsApprox: { value: number; source: string; confidence: string; note?: string } | null;
  recentMentions: { url: string; domain: string; title?: string; time: string }[];
  historicalSnapshots: { timestamp: string; url: string }[];
  sampleCrawledPages: { url: string; timestamp: string }[];
  /** Real inbound links from Bing Webmaster Tools (verified-site only). */
  bingBacklinks: BingLinkRow[];
  bingTotalLinks: number;
  /** Anchor-text samples extracted from Common Crawl WARC records — real link anchors from the open web. */
  anchorSamples: WarcAnchor[];
  providersHit: string[];
  providersFailed: string[];
  dataQuality: {
    realDataFields: string[];
    missingFields: string[];
  };
}

/**
 * Query real free providers to build an external backlink profile for a
 * domain we may not own. All provider calls run in parallel; failures are
 * swallowed and surfaced via `providersFailed` so the UI can show an
 * honest confidence signal.
 */
export async function discoverExternalBacklinks(domain: string): Promise<ExternalBacklinkReport> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const realDataFields: string[] = [];
  const missingFields: string[] = [];

  const [authRes, refRes, urlscanRes, waybackRes, ccPagesRes, bingRes] = await Promise.allSettled([
    isOpenPageRankConfigured()
      ? fetchDomainAuthority(clean)
      : Promise.reject(new Error("OPR_API_KEY not set")),
    approximateReferringDomains(clean),
    isUrlscanConfigured()
      ? searchDomainReferences(clean, 30)
      : searchDomainReferences(clean, 30), // anonymous call still works, lower confidence
    fetchSnapshotHistory(`https://${clean}/`, 12),
    fetchDomainHits(clean, 50),
    isBingWmtConfigured()
      ? fetchBingBacklinks(`https://${clean}/`, 500)
      : Promise.reject(new Error("BING_WEBMASTER_API_KEY not set")),
  ]);

  // Domain authority (OpenPageRank)
  let domainAuthority: ExternalBacklinkReport["domainAuthority"] = null;
  if (authRes.status === "fulfilled") {
    providersHit.push("open-page-rank");
    realDataFields.push("domainAuthority");
    const pr = authRes.value;
    domainAuthority = {
      value: pr.authority0to100.value,
      source: pr.authority0to100.source,
      confidence: pr.authority0to100.confidence,
    };
  } else {
    providersFailed.push("open-page-rank");
    missingFields.push("domainAuthority");
  }

  // Referring domains (Common Crawl)
  let referringDomainsApprox: ExternalBacklinkReport["referringDomainsApprox"] = null;
  if (refRes.status === "fulfilled") {
    providersHit.push("common-crawl");
    realDataFields.push("referringDomainsApprox");
    referringDomainsApprox = {
      value: refRes.value.value,
      source: refRes.value.source,
      confidence: refRes.value.confidence,
      note: refRes.value.note,
    };
  } else {
    providersFailed.push("common-crawl");
    missingFields.push("referringDomainsApprox");
  }

  // Recent mentions (URLScan)
  let recentMentions: ExternalBacklinkReport["recentMentions"] = [];
  if (urlscanRes.status === "fulfilled") {
    providersHit.push("urlscan");
    realDataFields.push("recentMentions");
    recentMentions = urlscanRes.value.value.map((h) => ({
      url: h.url,
      domain: h.domain,
      title: h.title,
      time: h.time,
    }));
  } else {
    providersFailed.push("urlscan");
  }

  // Historical snapshots (Wayback)
  let historicalSnapshots: ExternalBacklinkReport["historicalSnapshots"] = [];
  if (waybackRes.status === "fulfilled") {
    providersHit.push("wayback-machine");
    realDataFields.push("historicalSnapshots");
    historicalSnapshots = waybackRes.value.value.map((s) => ({
      timestamp: s.timestamp,
      url: s.url,
    }));
  } else {
    providersFailed.push("wayback-machine");
  }

  // Sample crawled pages (Common Crawl)
  let sampleCrawledPages: ExternalBacklinkReport["sampleCrawledPages"] = [];
  if (ccPagesRes.status === "fulfilled") {
    if (!providersHit.includes("common-crawl")) providersHit.push("common-crawl");
    realDataFields.push("sampleCrawledPages");
    sampleCrawledPages = ccPagesRes.value.value.slice(0, 30).map((h) => ({
      url: h.url,
      timestamp: h.timestamp,
    }));
  }

  // Bing Webmaster Tools inbound links (verified site only)
  let bingBacklinks: BingLinkRow[] = [];
  let bingTotalLinks = 0;
  if (bingRes.status === "fulfilled") {
    providersHit.push("bing-webmaster");
    realDataFields.push("bingBacklinks");
    bingBacklinks = bingRes.value.value.slice(0, 500);
    bingTotalLinks = bingRes.value.value.length;
  } else {
    providersFailed.push("bing-webmaster");
  }

  // Anchor-text samples via Common Crawl WARC byte-range fetch — real anchors
  // from the open web pointing at our target. We sample the first 15 CDX hits
  // to keep the per-estimate cost bounded.
  const anchorSamples: WarcAnchor[] = [];
  if (ccPagesRes.status === "fulfilled" && ccPagesRes.value.value.length > 0) {
    const sampleHits = ccPagesRes.value.value.slice(0, 15);
    const extractions = await Promise.allSettled(
      sampleHits.map(async (h) => {
        if (!h.filename || !h.offset || !h.lengthBytes) return [];
        const off = Number.parseInt(h.offset, 10);
        const len = Number.parseInt(h.lengthBytes, 10);
        if (!Number.isFinite(off) || !Number.isFinite(len)) return [];
        const html = await fetchWarcRecord(h.filename, off, len);
        if (!html) return [];
        return extractAnchorsToTarget(html, clean, h.url);
      }),
    );
    for (const e of extractions) {
      if (e.status === "fulfilled") anchorSamples.push(...e.value);
    }
    if (anchorSamples.length > 0) {
      realDataFields.push("anchorSamples");
      if (!providersHit.includes("common-crawl-warc")) providersHit.push("common-crawl-warc");
    }
  }

  return {
    domain: clean,
    domainAuthority,
    referringDomainsApprox,
    recentMentions,
    historicalSnapshots,
    sampleCrawledPages,
    bingBacklinks,
    bingTotalLinks,
    anchorSamples: anchorSamples.slice(0, 100),
    providersHit: Array.from(new Set(providersHit)),
    providersFailed: Array.from(new Set(providersFailed)),
    dataQuality: {
      realDataFields: Array.from(new Set(realDataFields)),
      missingFields: Array.from(new Set(missingFields)),
    },
  };
}
