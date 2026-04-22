/**
 * SERP Consensus producer — for a set of (domain, keyword) pairs, probe
 * multiple SERP sources and grade agreement on the domain's rank.
 *
 * Any single SERP scraper / API has bias — DDG under-represents Google's
 * algorithmic personalization, Startpage is regional and rate-limited,
 * GSC only reports queries you already rank for, Brave has a small
 * query window. When 3+ sources agree the domain ranks in a given range
 * for a keyword, that rank is highly credible. When only 1 source
 * returns a number, it's a weak signal.
 *
 * Sources tapped (per keyword, in parallel with individual timeouts):
 *   - DuckDuckGo — Playwright-backed HTML scrape
 *   - Startpage  — Playwright-backed, Google-proxy (~0.9 correlation)
 *   - GSC        — first-party Google position (only queries you rank for)
 *   - Brave      — API-keyed scraper (only if BRAVE_SEARCH_API_KEY set)
 *
 * Consensus window: two sources "agree" if their ranks are within ±5
 * positions. Agreement count drives tiering:
 *   tierTop    — 3+ sources agree on a rank within ±5
 *   tierMid    — 2 sources agree or rank present in 2 sources but differ
 *   tierBottom — only 1 source returned a number
 *
 * Advisors for this council focus on SERP-specific concerns:
 *   - serpAnalyst — what the consensus rank tells the operator about
 *                    actual visibility
 *   - contentLead — implications for content strategy on this query
 *   - competitive — implications vs competitors tracked in the same space
 *   - technical   — crawl / schema / on-page blockers holding back rank
 */

import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { searchStartpage } from "../providers/startpage-serp.js";
import { getGscKeywordStats, listGscSites, type GscSite } from "../providers/google-search-console.js";
import { getConnectionStatus } from "../providers/google-auth.js";
import { searchBrave, isBraveConfigured } from "../providers/brave-search.js";
import type { CouncilContext, CouncilAgendaItem, CouncilAdvisor } from "./council-types.js";

const SERP_ADVISORS: CouncilAdvisor[] = [
  { id: "serpAnalyst", name: "SERP Analyst", focus: "What the consensus rank means for real visibility on this keyword" },
  { id: "contentLead", name: "Content Lead", focus: "Editorial implication — rewrite, expand, or freeze?" },
  { id: "competitive", name: "Competitive Analyst", focus: "Position vs. competitors on this exact query" },
  { id: "technical", name: "Technical SEO", focus: "Rank blockers: schema, intent match, on-page freshness, internal linking" },
];

const AGREEMENT_WINDOW = 5; // two sources agree if their ranks are within ±5 positions

/** Match a domain against a GSC site list. */
function findGscSite(sites: GscSite[], domain: string): GscSite | null {
  const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  for (const s of sites) {
    const u = s.siteUrl;
    let host = "";
    if (u.startsWith("sc-domain:")) host = u.slice("sc-domain:".length).toLowerCase();
    else { try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; } }
    if (host === clean || clean.endsWith("." + host) || host.endsWith("." + clean)) return s;
  }
  return null;
}

/** Find the position of our domain in a list of SERP results. Subdomain-
 *  tolerant host match — "wikipedia.org" matches "en.wikipedia.org". */
function findRankForDomain(results: { position: number; url: string }[], domain: string): number | null {
  const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
      if (host === clean || clean.endsWith("." + host) || host.endsWith("." + clean)) return r.position;
    } catch { /* skip */ }
  }
  return null;
}

type PerKwProbe = {
  keyword: string;
  ranks: { source: string; position: number | null; error?: string }[];
};

/** Probe one keyword across every available SERP source in parallel. */
async function probeKeyword(
  keyword: string,
  domain: string,
  gscSite: GscSite | null,
): Promise<PerKwProbe> {
  const ranks: PerKwProbe["ranks"] = [];

  await Promise.all([
    (async () => {
      try {
        const resp = await searchSerp(keyword, "us-en");
        const pos = findRankForDomain(resp.results, domain);
        ranks.push({ source: "ddg", position: pos });
      } catch (e) {
        ranks.push({ source: "ddg", position: null, error: e instanceof Error ? e.message.slice(0, 80) : "err" });
      }
    })(),
    (async () => {
      try {
        const dp = await searchStartpage(keyword, "US");
        const pos = findRankForDomain(dp.value.results, domain);
        ranks.push({ source: "startpage", position: pos });
      } catch (e) {
        ranks.push({ source: "startpage", position: null, error: e instanceof Error ? e.message.slice(0, 80) : "err" });
      }
    })(),
    (async () => {
      if (!gscSite) return; // quietly skip — no matching verified site
      try {
        const stats = await getGscKeywordStats(gscSite.siteUrl, keyword, 28);
        const pos = stats?.position?.value;
        ranks.push({ source: "gsc", position: typeof pos === "number" ? Math.round(pos) : null });
      } catch (e) {
        ranks.push({ source: "gsc", position: null, error: e instanceof Error ? e.message.slice(0, 80) : "err" });
      }
    })(),
    (async () => {
      if (!isBraveConfigured()) return;
      try {
        const dp = await searchBrave(keyword, "US");
        const pos = findRankForDomain(dp.value.results, domain);
        ranks.push({ source: "brave", position: pos });
      } catch (e) {
        ranks.push({ source: "brave", position: null, error: e instanceof Error ? e.message.slice(0, 80) : "err" });
      }
    })(),
  ]);

  return { keyword, ranks };
}

function computeConsensus(probe: PerKwProbe): {
  agreementCount: number;
  consensusPosition: number | null;
  spread: number | null;
} {
  const withRank = probe.ranks.filter((r) => typeof r.position === "number") as Array<{ source: string; position: number }>;
  if (withRank.length === 0) return { agreementCount: 0, consensusPosition: null, spread: null };
  // Find the largest cluster within the agreement window
  let bestCluster: number[] = [];
  const positions = withRank.map((r) => r.position);
  for (const anchor of positions) {
    const cluster = positions.filter((p) => Math.abs(p - anchor) <= AGREEMENT_WINDOW);
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }
  const consensusPosition = Math.round(bestCluster.reduce((a, b) => a + b, 0) / bestCluster.length);
  const spread = Math.max(...positions) - Math.min(...positions);
  return { agreementCount: bestCluster.length, consensusPosition, spread };
}

function scoreForItem(agreementCount: number, consensus: number | null): number {
  const base = Math.min(agreementCount / 4, 1) * 70;
  // Higher score for closer-to-top ranks (a #3 rank is more valuable than #80)
  const rankBonus = consensus == null ? 0 : Math.max(0, 30 - Math.min(consensus, 30));
  return Math.round(base + rankBonus);
}

export interface BuildSerpCouncilInput {
  domain: string;
  keywords: string[];
}

export async function buildSerpCouncilContext(input: BuildSerpCouncilInput): Promise<CouncilContext> {
  const { domain } = input;
  const keywords = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 10);

  const queried = new Set<string>();
  const failed: { source: string; reason: string }[] = [];

  // Pre-resolve GSC site match (async, needed once).
  let gscSite: GscSite | null = null;
  try {
    const auth = await getConnectionStatus();
    if (auth.connected) {
      const sites = await listGscSites();
      gscSite = findGscSite(sites, domain);
      if (!gscSite) failed.push({ source: "gsc", reason: `No verified GSC site matches ${domain}` });
    } else {
      failed.push({ source: "gsc", reason: "Google not connected" });
    }
  } catch (e) {
    failed.push({ source: "gsc", reason: e instanceof Error ? e.message : String(e) });
  }

  if (!isBraveConfigured()) {
    failed.push({ source: "brave", reason: "BRAVE_SEARCH_API_KEY not set" });
  }

  if (keywords.length === 0) {
    return {
      feature: "serp",
      featureLabel: "SERP Council",
      featureTagline: "Cross-source agreement on the domain's ranking for each keyword — DDG + Startpage + GSC + Brave.",
      target: domain,
      sourcesQueried: [],
      sourcesFailed: [{ source: "input", reason: "No keywords provided to probe" }, ...failed],
      tierTop: [],
      tierMid: [],
      tierBottom: [],
      totalItems: 0,
      collectedAt: new Date().toISOString(),
      advisors: SERP_ADVISORS,
    };
  }

  // Probe each keyword in parallel. Cap concurrency implicitly since each
  // probe already fans out to 4 sources concurrently.
  const probes = await Promise.all(keywords.map((kw) => probeKeyword(kw, domain, gscSite)));

  // Compute agenda items
  const all: CouncilAgendaItem[] = probes.map((probe) => {
    const { agreementCount, consensusPosition, spread } = computeConsensus(probe);
    const sourcesWithRank = probe.ranks.filter((r) => typeof r.position === "number").map((r) => r.source);
    for (const r of probe.ranks) queried.add(r.source); // any source we tried counts as queried
    return {
      id: probe.keyword,
      label: probe.keyword,
      sublabel: consensusPosition != null
        ? `consensus rank #${consensusPosition} (${agreementCount}/${probe.ranks.length} sources agree)`
        : "no source returned a rank",
      sources: sourcesWithRank.sort(),
      metrics: {
        consensusPosition: consensusPosition ?? undefined,
        ddgRank: probe.ranks.find((r) => r.source === "ddg")?.position ?? undefined,
        startpageRank: probe.ranks.find((r) => r.source === "startpage")?.position ?? undefined,
        gscRank: probe.ranks.find((r) => r.source === "gsc")?.position ?? undefined,
        braveRank: probe.ranks.find((r) => r.source === "brave")?.position ?? undefined,
        sourceSpread: spread ?? undefined,
      },
      score: scoreForItem(agreementCount, consensusPosition),
      rawVariants: [],
    };
  });

  all.sort((a, b) => b.score - a.score);

  return {
    feature: "serp",
    featureLabel: "SERP Council",
    featureTagline: "Cross-source agreement on the domain's ranking for each keyword — DDG + Startpage + GSC + Brave.",
    target: domain,
    sourcesQueried: [...queried].sort(),
    sourcesFailed: failed,
    tierTop: all.filter((t) => t.sources.length >= 3),
    tierMid: all.filter((t) => t.sources.length === 2),
    tierBottom: all.filter((t) => t.sources.length === 1 || t.sources.length === 0),
    totalItems: all.length,
    collectedAt: new Date().toISOString(),
    advisors: SERP_ADVISORS,
  };
}
