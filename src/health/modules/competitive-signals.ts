/**
 * Shared free-signal fetcher for any competitive estimator (backlinks, traffic,
 * keyword-universe). Hits every free provider in parallel, wraps each value in
 * a DataPoint<T> with source + confidence, and returns a normalized bundle.
 *
 * Every signal is optional — the module guarantees it will NOT throw even if
 * all providers fail. Downstream estimators decide how to degrade confidence
 * when signals are missing.
 */

import { fetchDomainRank as fetchTrancoRank } from "../providers/tranco-rank.js";
import { fetchDomainAuthority, isOpenPageRankConfigured } from "../providers/open-page-rank.js";
import { fetchDomainRank as fetchCloudflareRank, isCloudflareRadarConfigured } from "../providers/cloudflare-radar.js";
import { fetchBestMatchPageviews } from "../providers/wikipedia-pageviews.js";
import { fetchKeywordTrend } from "../providers/google-trends.js";
import { fetchDomainHits, approximateReferringDomains } from "../providers/common-crawl.js";
import { fetchCruxRecord, isCruxConfigured } from "../providers/crux.js";
import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { dp, type DataPoint } from "../providers/types.js";

export interface CompetitiveSignals {
  domain: string;
  fetchedAt: string;
  trancoRank?: DataPoint<number>;
  trancoPercentile?: DataPoint<number>;
  domainAuthority?: DataPoint<number>;       // 0-100
  cloudflareRank?: DataPoint<number>;
  wikipediaMonthlyViews?: DataPoint<number>;
  googleTrendsLatest?: DataPoint<number>;    // 0-100
  cruxPresent?: DataPoint<boolean>;          // domain has enough real-user traffic to be in CrUX origin dataset
  commonCrawlReferringHosts?: DataPoint<number>;
  commonCrawlDomainHits?: DataPoint<number>; // how many URLs Common Crawl has for the domain (indexed-page proxy)
  serpVisibilityCount?: DataPoint<number>;   // count of branded/seed queries the domain ranks top-30 for
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
}

function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

/**
 * Derive a rough "SERP visibility" integer by querying the domain's hostname
 * and a few obvious brand terms. Returns the count of queries (out of ~3)
 * where the domain appears in the DDG top-30. This is cheap enough to call
 * during estimation; expensive enough that we cap queries aggressively.
 */
async function probeSerpVisibility(domain: string): Promise<number> {
  const brandRoot = domain.split(".")[0] ?? domain;
  const queries = [brandRoot, `${brandRoot} review`, `${brandRoot} vs`];
  let hits = 0;
  for (const q of queries) {
    try {
      const serp = await searchSerp(q, "us-en");
      for (const r of serp.results.slice(0, 30)) {
        try {
          const host = new URL(r.url).hostname.replace(/^www\./, "");
          if (host === domain || host.endsWith(`.${domain}`)) { hits++; break; }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return hits;
}

export async function fetchCompetitiveSignals(domainInput: string): Promise<CompetitiveSignals> {
  const domain = cleanDomain(domainInput);
  if (!domain) throw new Error("Empty domain");

  const missingFields: string[] = [];
  const providersHit: string[] = [];
  const providersFailed: string[] = [];

  // Fire all independent signals in parallel. Every `.catch()` folds into an undefined so one failure doesn't kill the bundle.
  const [
    trancoR, oprR, cfR, wikiR, trendsR, cruxR, ccHitsR, ccRefR, serpR,
  ] = await Promise.allSettled([
    fetchTrancoRank(domain),
    isOpenPageRankConfigured() ? fetchDomainAuthority(domain) : Promise.reject(new Error("opr-not-configured")),
    isCloudflareRadarConfigured() ? fetchCloudflareRank(domain) : Promise.reject(new Error("cf-not-configured")),
    // Wikipedia article lookup — try both the domain brand root and the full domain
    (async () => {
      const brandRoot = domain.split(".")[0] ?? "";
      const candidates = [brandRoot, domain, brandRoot.charAt(0).toUpperCase() + brandRoot.slice(1)].filter(Boolean);
      return fetchBestMatchPageviews(candidates);
    })(),
    (async () => fetchKeywordTrend(domain.split(".")[0] ?? domain, "US"))(),
    isCruxConfigured()
      ? fetchCruxRecord(`https://${domain}/`, "ALL_FORM_FACTORS").then((r) => !!r).catch(() => false)
      : Promise.reject(new Error("crux-not-configured")),
    fetchDomainHits(domain, 300),
    approximateReferringDomains(domain),
    probeSerpVisibility(domain),
  ]);

  const out: CompetitiveSignals = {
    domain,
    fetchedAt: new Date().toISOString(),
    missingFields,
    providersHit,
    providersFailed,
  };

  // A provider that FULFILLED with an undefined value did its job — the
  // domain just isn't in that dataset (e.g. small site not in Cloudflare's
  // top-1M or Tranco's top-list). Treat that as "hit but no data for this
  // domain" so the UI's data-source chip stays green; only flag the
  // missing field. Reserve providersFailed for actual rejections.
  if (trancoR.status === "fulfilled") {
    providersHit.push("tranco");
    if (trancoR.value) {
      out.trancoRank = trancoR.value.currentRank;
      out.trancoPercentile = trancoR.value.percentile;
    } else {
      missingFields.push("trancoRank (domain not in Tranco top list)");
    }
  } else { missingFields.push("trancoRank"); providersFailed.push("tranco"); }

  if (oprR.status === "fulfilled") {
    out.domainAuthority = oprR.value.authority0to100;
    providersHit.push("open-page-rank");
  } else { missingFields.push("domainAuthority"); providersFailed.push("open-page-rank"); }

  if (cfR.status === "fulfilled") {
    providersHit.push("cloudflare-radar");
    if (cfR.value) {
      out.cloudflareRank = cfR.value.rank;
    } else {
      missingFields.push("cloudflareRank (domain not in Cloudflare Radar top-domains set)");
    }
  } else { missingFields.push("cloudflareRank"); providersFailed.push("cloudflare-radar"); }

  if (wikiR.status === "fulfilled") {
    providersHit.push("wikipedia-pageviews");
    if (wikiR.value) {
      out.wikipediaMonthlyViews = wikiR.value;
    } else {
      missingFields.push("wikipediaMonthlyViews (no matching Wikipedia article)");
    }
  } else { missingFields.push("wikipediaMonthlyViews"); providersFailed.push("wikipedia-pageviews"); }

  if (trendsR.status === "fulfilled") {
    const t12 = trendsR.value.trend12mo?.value ?? [];
    const latest = t12[t12.length - 1]?.value;
    if (Number.isFinite(latest)) {
      out.googleTrendsLatest = dp(latest!, "google-trends", "medium", 24 * 60 * 60 * 1000, "0-100 relative for brand-root query");
      providersHit.push("google-trends");
    } else { missingFields.push("googleTrendsLatest"); providersFailed.push("google-trends"); }
  } else { missingFields.push("googleTrendsLatest"); providersFailed.push("google-trends"); }

  if (cruxR.status === "fulfilled") {
    out.cruxPresent = dp(cruxR.value, "crux", "high", 24 * 60 * 60 * 1000,
      cruxR.value ? "domain has enough real users for CrUX dataset" : "no CrUX origin data");
    providersHit.push("crux");
  } else { missingFields.push("cruxPresent"); providersFailed.push("crux"); }

  if (ccHitsR.status === "fulfilled") {
    out.commonCrawlDomainHits = dp(ccHitsR.value.value.length, "common-crawl", "high", 7 * 24 * 60 * 60 * 1000, "URLs indexed by Common Crawl — indexed-page proxy");
    providersHit.push("common-crawl-hits");
  } else { missingFields.push("commonCrawlDomainHits"); providersFailed.push("common-crawl-hits"); }

  if (ccRefR.status === "fulfilled") {
    out.commonCrawlReferringHosts = ccRefR.value;
    providersHit.push("common-crawl-referring");
  } else { missingFields.push("commonCrawlReferringHosts"); providersFailed.push("common-crawl-referring"); }

  if (serpR.status === "fulfilled") {
    out.serpVisibilityCount = dp(serpR.value, "duckduckgo", "medium", 60 * 60 * 1000, "brand-root queries (of 3) where domain appears top-30");
    providersHit.push("duckduckgo");
  } else { missingFields.push("serpVisibilityCount"); providersFailed.push("duckduckgo"); }

  return out;
}
