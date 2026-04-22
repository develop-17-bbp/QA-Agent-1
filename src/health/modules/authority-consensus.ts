/**
 * Domain Authority Consensus producer — score a target domain plus any
 * competitors across every authority index we pull, and surface who agrees.
 *
 * Sources tapped:
 *   - OpenPageRank (OPR)  — 0-10 / 0-100 scale, earned-link authority proxy
 *   - Tranco              — top-1M aggregated-traffic rank (lower = more traffic)
 *   - Cloudflare Radar    — aggregated traffic rank in the Cloudflare network
 *
 * Why consensus matters: each source measures a different thing claiming to
 * be "domain authority". OPR approximates link-graph pagerank; Tranco is a
 * consensus of popularity lists; Cloudflare Radar reflects actual DNS query
 * volume through the CF network. A domain rated highly by ALL THREE is
 * almost certainly a legitimate top-tier site. A domain rated highly by
 * only OPR might be "SEO-juiced" but not actually trafficked. A domain in
 * Cloudflare Radar but absent from OPR is popular but may be link-poor.
 *
 * Advisor personas for this council focus on authority interpretation:
 *   - auth-analyst: what the spread across sources actually means
 *   - competitive: positioning vs the other domains in the agenda
 *   - link-builder: whether the authority is earned or artifact
 *   - brand:       brand / reputation signal implied by the ranks
 *
 * Input: target domain + optional competitor list. If no competitors are
 * passed, the council reviews just the target with an emphasis on trend
 * ("OPR says 45/100 but Tranco can't find it — that's a signal").
 */

import { fetchDomainAuthority, isOpenPageRankConfigured } from "../providers/open-page-rank.js";
import { fetchDomainRank as fetchTrancoDomainRank } from "../providers/tranco-rank.js";
import { fetchDomainRank as fetchRadarDomainRank, isCloudflareRadarConfigured } from "../providers/cloudflare-radar.js";
import type { CouncilContext, CouncilAgendaItem, CouncilAdvisor } from "./council-types.js";

const AUTHORITY_ADVISORS: CouncilAdvisor[] = [
  { id: "authAnalyst", name: "Authority Analyst", focus: "What the spread across OPR / Tranco / Cloudflare tells us about the domain's real trust weight" },
  { id: "competitive", name: "Competitive Analyst", focus: "Positioning vs the other domains on this agenda — who leads on what axis" },
  { id: "linkBuilder", name: "Link Builder", focus: "Whether the authority is earned-link sustainable or link-graph artifact" },
  { id: "brand", name: "Brand Lead", focus: "Brand / reputation signal the ranks imply and how to act on it" },
];

type Bucket = {
  sources: Set<string>;
  oprScore?: number;          // 0-100 rescaled authority
  oprGlobalRank?: number;
  trancoRank?: number;
  trancoPercentile?: number;  // 0-100 (higher = more trafficked)
  radarRank?: number;
};

function score(b: Bucket): number {
  // Source count is the headline signal — a domain in 3 indexes is far more
  // trustworthy than one in a single index (which might be a fluke).
  const agreement = Math.min(b.sources.size / 3, 1) * 60;
  // Magnitude signal: take the best available authority-like number.
  let magnitude = 0;
  if (typeof b.oprScore === "number") magnitude = Math.max(magnitude, b.oprScore * 0.4);
  if (typeof b.trancoPercentile === "number") magnitude = Math.max(magnitude, b.trancoPercentile * 0.4);
  return Math.round(agreement + magnitude);
}

function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export interface BuildAuthorityCouncilInput {
  /** Primary target for the review (required). */
  domain: string;
  /** Optional competitor domains to include in the same tiered agenda. */
  competitors?: string[];
}

export async function buildAuthorityCouncilContext(input: BuildAuthorityCouncilInput): Promise<CouncilContext> {
  const target = normalizeDomain(input.domain);
  const competitors = (input.competitors ?? []).map(normalizeDomain).filter((d) => d && d !== target);
  const allDomains = [target, ...competitors].slice(0, 10); // cap to avoid slamming APIs

  const queried = new Set<string>();
  const failed: { source: string; reason: string }[] = [];

  if (!isOpenPageRankConfigured()) failed.push({ source: "opr", reason: "OPR_API_KEY not set" });
  if (!isCloudflareRadarConfigured()) failed.push({ source: "cloudflare-radar", reason: "CLOUDFLARE_API_TOKEN not set" });

  // Probe each domain across each source in parallel.
  const results = await Promise.all(
    allDomains.map(async (d): Promise<[string, Bucket]> => {
      const bucket: Bucket = { sources: new Set() };

      await Promise.all([
        (async () => {
          if (!isOpenPageRankConfigured()) return;
          try {
            const r = await fetchDomainAuthority(d);
            bucket.oprScore = r.authority0to100?.value;
            bucket.oprGlobalRank = r.globalRank?.value;
            if (bucket.oprScore != null) bucket.sources.add("opr");
            queried.add("opr");
          } catch (e) {
            failed.push({ source: `opr:${d}`, reason: e instanceof Error ? e.message.slice(0, 80) : "err" });
          }
        })(),
        (async () => {
          try {
            const r = await fetchTrancoDomainRank(d);
            if (r) {
              bucket.trancoRank = r.currentRank?.value;
              bucket.trancoPercentile = r.percentile?.value;
              bucket.sources.add("tranco");
              queried.add("tranco");
            }
          } catch (e) {
            failed.push({ source: `tranco:${d}`, reason: e instanceof Error ? e.message.slice(0, 80) : "err" });
          }
        })(),
        (async () => {
          if (!isCloudflareRadarConfigured()) return;
          try {
            const r = await fetchRadarDomainRank(d);
            if (r) {
              bucket.radarRank = r.rank?.value;
              bucket.sources.add("cloudflare-radar");
              queried.add("cloudflare-radar");
            }
          } catch (e) {
            failed.push({ source: `cloudflare-radar:${d}`, reason: e instanceof Error ? e.message.slice(0, 80) : "err" });
          }
        })(),
      ]);

      return [d, bucket];
    }),
  );

  const items: CouncilAgendaItem[] = results.map(([d, b]) => ({
    id: d,
    label: d,
    sublabel: b.sources.size === 0 ? "not found in any authority index" : `${b.sources.size}/3 sources indexed`,
    sources: [...b.sources].sort(),
    metrics: {
      oprAuthority: b.oprScore != null ? Math.round(b.oprScore) : undefined,
      oprGlobalRank: b.oprGlobalRank,
      trancoRank: b.trancoRank,
      trancoPercentile: b.trancoPercentile,
      radarRank: b.radarRank,
      isTarget: d === target ? "yes" : undefined,
    },
    score: score(b),
  }));
  items.sort((a, b) => b.score - a.score);

  return {
    feature: "authority",
    featureLabel: "Domain Authority Council",
    featureTagline: "Cross-source agreement on domain authority — OPR (link-graph pagerank), Tranco (popularity-list consensus), Cloudflare Radar (real DNS traffic). Present in 3/3 = top-tier trust.",
    target,
    sourcesQueried: [...queried].sort(),
    sourcesFailed: failed,
    tierTop: items.filter((i) => i.sources.length >= 3),
    tierMid: items.filter((i) => i.sources.length === 2),
    tierBottom: items.filter((i) => i.sources.length <= 1),
    totalItems: items.length,
    collectedAt: new Date().toISOString(),
    advisors: AUTHORITY_ADVISORS,
  };
}
