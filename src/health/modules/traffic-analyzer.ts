/**
 * Traffic analyzer — real traffic data from free providers, no LLM estimates.
 *
 * Uses:
 *   - Tranco top-1M list           → real rank + 30d history + percentile
 *   - Cloudflare Radar             → real aggregated rank (if token set)
 *   - OpenPageRank                 → domain authority as traffic proxy
 *   - Local crawl data             → on-site page metrics
 *
 * If a real rank is found, the returned `monthlyTrafficEstimate` is a bucket
 * string like `">5M visits/mo"` derived from the rank. If no provider has
 * data, we return `"Unknown"` rather than a fake number — the UI surfaces
 * this as a "no data" badge.
 */

import type { SiteHealthReport } from "../types.js";
import { fetchDomainRank as fetchTrancoRank } from "../providers/tranco-rank.js";
import { fetchDomainRank as fetchRadarRank, isCloudflareRadarConfigured } from "../providers/cloudflare-radar.js";
import { fetchDomainAuthority, isOpenPageRankConfigured } from "../providers/open-page-rank.js";

// ── Helpers ────────────────────────────────────────────────────────

function bucketFromRank(rank: number): string {
  if (rank <= 100) return ">500M visits/mo";
  if (rank <= 1000) return "50M-500M visits/mo";
  if (rank <= 10_000) return "5M-50M visits/mo";
  if (rank <= 100_000) return "500K-5M visits/mo";
  if (rank <= 1_000_000) return "50K-500K visits/mo";
  return "<50K visits/mo";
}

function bucketFromAuthority(authority: number): string {
  // OPR 0-100 scale → rough traffic bucket
  if (authority >= 80) return ">5M visits/mo";
  if (authority >= 60) return "500K-5M visits/mo";
  if (authority >= 40) return "50K-500K visits/mo";
  if (authority >= 20) return "5K-50K visits/mo";
  return "<5K visits/mo";
}

export interface TrafficDataQuality {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
}

export interface TrafficAnalysis {
  monthlyTrafficEstimate: string;
  trafficTrend: { month: string; estimated: number }[];
  trafficSources: { organic: number; direct: number; referral: number; social: number; paid: number };
  topLandingPages: { url: string; title: string; organicPotential: number; loadTimeMs: number }[];
  geoDistribution: { country: string; share: number }[];
  deviceBreakdown: { desktop: number; mobile: number; tablet: number };
  insights: string[];
  recommendations: string[];
  crawlStats: { totalPages: number; okPages: number; avgLoadTime: number };
  realTraffic?: {
    trancoRank?: number;
    trancoPercentile?: number;
    cloudflareRadarRank?: number;
    domainAuthority?: number;
    history30d?: { date: string; rank: number }[];
  };
  dataQuality: TrafficDataQuality;
}

export async function analyzeTraffic(reports: SiteHealthReport[]): Promise<TrafficAnalysis> {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const okPages = allPages.filter(p => p.ok);
  const firstHost = reports[0]?.hostname ?? "";

  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const realDataFields: string[] = [];
  const estimatedFields: string[] = [];
  const missingFields: string[] = [];

  const pageMetrics = okPages.map(p => {
    const potential = (p.documentTitle ? 25 : 0) + ((p.metaDescriptionLength ?? 0) > 50 ? 20 : 0) + (p.h1Count === 1 ? 20 : 0) + (p.durationMs < 2000 ? 20 : 0) + (p.canonicalUrl ? 15 : 0);
    return { url: p.url, title: p.documentTitle ?? "", potential, loadTimeMs: p.durationMs };
  }).sort((a, b) => b.potential - a.potential);

  // ── Fetch real data in parallel ─────────────────────────────────
  const [trancoRes, radarRes, oprRes] = await Promise.allSettled([
    firstHost ? fetchTrancoRank(firstHost) : Promise.resolve(undefined),
    firstHost && isCloudflareRadarConfigured()
      ? fetchRadarRank(firstHost)
      : Promise.resolve(undefined),
    firstHost && isOpenPageRankConfigured()
      ? fetchDomainAuthority(firstHost)
      : Promise.resolve(undefined),
  ]);

  let trancoRank: number | undefined;
  let trancoPercentile: number | undefined;
  let history30d: { date: string; rank: number }[] | undefined;
  if (trancoRes.status === "fulfilled" && trancoRes.value) {
    providersHit.push("tranco");
    realDataFields.push("trancoRank", "trancoPercentile");
    trancoRank = trancoRes.value.currentRank.value;
    trancoPercentile = trancoRes.value.percentile.value;
    history30d = trancoRes.value.history30d?.value;
  } else {
    providersFailed.push("tranco");
  }

  let cloudflareRadarRank: number | undefined;
  if (radarRes.status === "fulfilled" && radarRes.value) {
    providersHit.push("cloudflare-radar");
    realDataFields.push("cloudflareRadarRank");
    cloudflareRadarRank = radarRes.value.rank.value;
  } else if (isCloudflareRadarConfigured()) {
    providersFailed.push("cloudflare-radar");
  }

  let domainAuthority: number | undefined;
  if (oprRes.status === "fulfilled" && oprRes.value) {
    providersHit.push("open-page-rank");
    realDataFields.push("domainAuthority");
    domainAuthority = oprRes.value.authority0to100.value;
  } else if (isOpenPageRankConfigured()) {
    providersFailed.push("open-page-rank");
  }

  // ── Derive monthly bucket ──────────────────────────────────────
  let monthlyTrafficEstimate = "Unknown";
  if (trancoRank != null) {
    monthlyTrafficEstimate = bucketFromRank(trancoRank);
    realDataFields.push("monthlyTrafficEstimate");
  } else if (cloudflareRadarRank != null) {
    monthlyTrafficEstimate = bucketFromRank(cloudflareRadarRank);
    realDataFields.push("monthlyTrafficEstimate");
  } else if (domainAuthority != null) {
    monthlyTrafficEstimate = bucketFromAuthority(domainAuthority);
    estimatedFields.push("monthlyTrafficEstimate");
  } else {
    missingFields.push("monthlyTrafficEstimate");
  }

  // ── Traffic trend: built from real Tranco 30d history if present ──
  let trafficTrend: { month: string; estimated: number }[] = [];
  if (history30d && history30d.length > 0) {
    // Convert rank → approximate visits by inverting the bucket
    trafficTrend = history30d.slice(-12).map((h) => ({
      month: h.date.slice(0, 7),
      estimated: Math.max(1000, Math.round(5_000_000 / Math.max(1, h.rank))),
    }));
    realDataFields.push("trafficTrend");
  } else {
    missingFields.push("trafficTrend");
  }

  // ── Fields we can't populate from free sources ─────────────────
  //   - trafficSources (organic vs direct vs referral split)
  //   - geoDistribution (top countries by traffic)
  //   - deviceBreakdown (desktop / mobile / tablet)
  // These require paid providers or first-party analytics access. We
  // return empty arrays and flag as missing so the UI can show "no data"
  // instead of a fabricated chart.
  missingFields.push("trafficSources", "geoDistribution", "deviceBreakdown");

  const insights: string[] = [];
  const recommendations: string[] = [];

  if (trancoRank != null) {
    insights.push(`Tranco global rank: #${trancoRank.toLocaleString()} (top ${(100 - (trancoPercentile ?? 0)).toFixed(2)}% of indexed domains)`);
  }
  if (cloudflareRadarRank != null) {
    insights.push(`Cloudflare Radar rank: #${cloudflareRadarRank.toLocaleString()}`);
  }
  if (domainAuthority != null) {
    insights.push(`Domain authority (OpenPageRank): ${domainAuthority}/100`);
  }
  if (monthlyTrafficEstimate === "Unknown") {
    insights.push(`No real traffic data available for ${firstHost} from free providers. Configure OPR_API_KEY or CLOUDFLARE_API_TOKEN for richer data.`);
  }

  if (okPages.length > 0) {
    const avgLoad = Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length);
    if (avgLoad > 3000) recommendations.push(`Reduce average page load (${avgLoad}ms → target <2000ms) to improve organic session quality`);
    const missingTitles = okPages.filter(p => !p.documentTitle).length;
    if (missingTitles > 0) recommendations.push(`${missingTitles} page(s) are missing <title> — fill them in to improve SERP CTR`);
  }

  return {
    monthlyTrafficEstimate,
    trafficTrend,
    trafficSources: { organic: 0, direct: 0, referral: 0, social: 0, paid: 0 },
    topLandingPages: pageMetrics.slice(0, 10).map(pm => ({ url: pm.url, title: pm.title, organicPotential: pm.potential, loadTimeMs: pm.loadTimeMs })),
    geoDistribution: [],
    deviceBreakdown: { desktop: 0, mobile: 0, tablet: 0 },
    insights,
    recommendations,
    crawlStats: {
      totalPages: allPages.length,
      okPages: okPages.length,
      avgLoadTime: okPages.length > 0 ? Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length) : 0,
    },
    realTraffic: {
      trancoRank,
      trancoPercentile,
      cloudflareRadarRank,
      domainAuthority,
      history30d,
    },
    dataQuality: {
      realDataFields: Array.from(new Set(realDataFields)),
      estimatedFields: Array.from(new Set(estimatedFields)),
      missingFields: Array.from(new Set(missingFields)),
      providersHit: Array.from(new Set(providersHit)),
      providersFailed: Array.from(new Set(providersFailed)),
    },
  };
}
