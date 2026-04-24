/**
 * Keyword Difficulty v2 — multi-factor blend.
 *
 * The v1 scorer (in keyword-research.ts) inferred difficulty from a list
 * of authoritative domains (wikipedia, youtube, amazon…) appearing in the
 * top 10 SERP. That heuristic has two problems:
 *
 *   1. It treats any Wikipedia appearance as +8 regardless of position or
 *      the rest of the SERP — niche queries where Wikipedia ranks #7 get
 *      inflated scores.
 *   2. It ignores the actual authority distribution of the NON-whitelisted
 *      domains, which is where the real competition signal lives (a page
 *      ranked #2 by a DR-80 competitor beats one ranked #1 by a DR-30 blog).
 *
 * The v2 scorer blends four independent signals, each capped 0-100:
 *
 *   A. AUTHORITY_OF_TOP_10   — average OpenPageRank authority (0-100) of
 *                              the domains ranking 1..10. Real DR signal,
 *                              position-weighted (rank 1 = 2.0x, rank 10 = 0.2x).
 *
 *   B. ADS_COMPETITION_INDEX — Google Ads Keyword Planner's competition
 *                              metric (0-100), a real first-party signal
 *                              when available (requires Ads OAuth).
 *
 *   C. SERP_SATURATION       — does the SERP look "owned" by giants?
 *                              Counts unique eTLD+1s in top 10; fewer
 *                              unique = more saturation = harder.
 *
 *   D. CONTENT_DEPTH_FLOOR   — rough word-count proxy from the top 3
 *                              result URL slugs (long slugs correlate with
 *                              long pages; pages competing must match or
 *                              exceed). Approximation, flagged "medium"
 *                              confidence.
 *
 * Weights (total 100%):
 *   A 45%   B 30%   C 15%   D 10%
 *
 * Rationale: Authority is the dominant real signal (DR of who's ranking);
 * Ads competition is first-party when present; saturation and content-
 * depth are noise-prone on their own but refine borderline cases. When
 * a signal is missing we renormalize across what's available.
 *
 * Output shape preserves the v1 0-100 scale + label so the UI is
 * unchanged; we add a `breakdown` field so users can see why a score is
 * what it is — a trust feature SEMrush doesn't expose.
 */

import { fetchDomainAuthority, isOpenPageRankConfigured } from "../providers/open-page-rank.js";

export interface DifficultyV2Breakdown {
  authorityOfTop10: { score: number; available: boolean; note?: string };
  adsCompetition: { score: number; available: boolean; note?: string };
  serpSaturation: { score: number; available: boolean; note?: string };
  contentDepth: { score: number; available: boolean; note?: string };
}

export interface DifficultyV2 {
  /** Final 0-100 difficulty score (higher = harder). */
  score: number;
  label: "Easy" | "Possible" | "Difficult" | "Hard" | "Very hard";
  method: "v2-multifactor";
  breakdown: DifficultyV2Breakdown;
  /** Which weights were actually applied after renormalizing over
   *  available signals. Sum = 1. */
  weightsUsed: { A: number; B: number; C: number; D: number };
}

const DEFAULT_WEIGHTS = { A: 0.45, B: 0.30, C: 0.15, D: 0.10 };

function labelFor(score: number): DifficultyV2["label"] {
  if (score >= 85) return "Very hard";
  if (score >= 70) return "Hard";
  if (score >= 50) return "Difficult";
  if (score >= 30) return "Possible";
  return "Easy";
}

function etld1(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  // Very-basic public-suffix heuristic: handle common two-part TLDs.
  const maybeTwoPart = new Set(["co.uk", "co.in", "com.au", "com.br", "co.jp", "co.nz", "com.mx", "co.za"]);
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  return maybeTwoPart.has(lastTwo) ? parts.slice(-3).join(".") : lastThree;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** Signal A: position-weighted average OPR authority of top-10 domains.
 *  Returns 0 (very easy) when OPR isn't configured; we flag it as
 *  unavailable so the caller renormalizes weights. */
async function computeAuthorityOfTop10(
  serp: { position: number; url: string }[],
): Promise<{ score: number; available: boolean; note?: string }> {
  if (!isOpenPageRankConfigured()) {
    return { score: 0, available: false, note: "OpenPageRank not configured — set OPR_API_KEY in /integrations to enable authority-weighted difficulty" };
  }
  const top = serp.filter((r) => r.position >= 1 && r.position <= 10);
  if (top.length === 0) {
    return { score: 40, available: false, note: "empty SERP" };
  }
  // Dedupe by eTLD+1 so multiple pages from the same giant don't overweight.
  const seenHosts = new Set<string>();
  const domains: { url: string; position: number; host: string }[] = [];
  for (const r of top) {
    const host = etld1(hostOf(r.url));
    if (!host || seenHosts.has(host)) continue;
    seenHosts.add(host);
    domains.push({ ...r, host });
  }
  if (domains.length === 0) return { score: 40, available: false, note: "no parseable domains in SERP" };

  // Fetch authority per unique domain (OPR accepts batches; we keep it simple
  // per-domain because the provider has cache + rate-limit already).
  let weightedSum = 0;
  let weightTotal = 0;
  let successes = 0;
  for (const d of domains) {
    const weight = Math.max(0.2, 2.0 - (d.position - 1) * 0.2); // 1→2.0, 10→0.2
    try {
      const auth = await fetchDomainAuthority(d.host);
      const val = auth.authority0to100?.value;
      if (typeof val === "number" && Number.isFinite(val)) {
        weightedSum += val * weight;
        weightTotal += weight;
        successes++;
      }
    } catch { /* OPR rate-limit / missing — skip this domain */ }
  }
  if (successes === 0) return { score: 40, available: false, note: "OPR lookups all failed (rate-limit?)" };
  const score = Math.round(weightedSum / weightTotal);
  return { score: Math.max(0, Math.min(100, score)), available: true, note: `${successes}/${domains.length} domains scored` };
}

/** Signal B: Google Ads competitionIndex (0-100). Available only when
 *  Ads OAuth is connected AND the keyword returned a value (some long-tails
 *  have null competition). */
function computeAdsCompetition(adsCompetitionIndex: number | null | undefined): { score: number; available: boolean; note?: string } {
  if (adsCompetitionIndex == null || !Number.isFinite(adsCompetitionIndex)) {
    return { score: 0, available: false, note: "Google Ads competition unavailable for this keyword" };
  }
  return { score: Math.max(0, Math.min(100, Math.round(adsCompetitionIndex))), available: true, note: "Google Ads competitionIndex (first-party)" };
}

/** Signal C: SERP saturation = how concentrated the top 10 is. Fewer unique
 *  eTLD+1s → more domination by few players → harder to break in. */
function computeSerpSaturation(serp: { url: string; position: number }[]): { score: number; available: boolean; note?: string } {
  const top10 = serp.filter((r) => r.position >= 1 && r.position <= 10);
  if (top10.length < 3) return { score: 40, available: false, note: "SERP too shallow to measure saturation" };
  const uniqueHosts = new Set(top10.map((r) => etld1(hostOf(r.url))).filter(Boolean));
  // 10 unique = 0 saturation (score 10); 1 unique = 100 saturation (score 100).
  const uniqueCount = uniqueHosts.size || 1;
  const score = Math.round(100 - ((uniqueCount - 1) * 10));
  return { score: Math.max(10, Math.min(100, score)), available: true, note: `${uniqueCount} unique eTLD+1 in top ${top10.length}` };
}

/** Signal D: content-depth proxy from top-3 URL slugs. Long slugs (many
 *  hyphenated segments) typically correlate with long-form content; a
 *  keyword competing in that space needs at least that much word-count.
 *  Approximation — flagged as medium confidence. */
function computeContentDepth(serp: { url: string; position: number; title?: string }[]): { score: number; available: boolean; note?: string } {
  const top3 = serp.filter((r) => r.position >= 1 && r.position <= 3);
  if (top3.length === 0) return { score: 40, available: false, note: "no top-3 SERP entries" };
  let totalLen = 0;
  let samples = 0;
  for (const r of top3) {
    try {
      const slug = new URL(r.url).pathname.replace(/^\/|\/$/g, "");
      const segs = slug.split("/").filter(Boolean);
      // Deepest segment hyphen-count as a word-count proxy.
      const deepSeg = segs[segs.length - 1] ?? "";
      const wordish = deepSeg.split("-").filter((s) => s.length > 2).length;
      // Plus title length (chars) / 8 as a length proxy.
      const titleLen = (r.title ?? "").length;
      totalLen += wordish * 4 + titleLen / 4;
      samples++;
    } catch { /* skip */ }
  }
  if (samples === 0) return { score: 40, available: false, note: "couldn't parse any top-3 slugs" };
  const avg = totalLen / samples;
  // Map: 0 → 20 (very shallow, easy), 20+ → 80+ (deep content required).
  const score = Math.round(Math.min(95, 20 + avg * 2.5));
  return { score, available: true, note: `top-3 slug proxy` };
}

/** Main entry. Accepts raw SERP + Ads competitionIndex; returns blended
 *  difficulty with breakdown. Weights renormalize across available signals. */
export async function computeDifficultyV2(input: {
  serp: { position: number; url: string; title?: string }[];
  adsCompetitionIndex?: number | null;
}): Promise<DifficultyV2> {
  const [A, C, D] = [
    await computeAuthorityOfTop10(input.serp),
    computeSerpSaturation(input.serp),
    computeContentDepth(input.serp),
  ];
  const B = computeAdsCompetition(input.adsCompetitionIndex);

  // Renormalize weights across available signals.
  const rawWeights = { A: DEFAULT_WEIGHTS.A, B: DEFAULT_WEIGHTS.B, C: DEFAULT_WEIGHTS.C, D: DEFAULT_WEIGHTS.D };
  const availability = { A: A.available, B: B.available, C: C.available, D: D.available };
  const totalAvailWeight = (["A","B","C","D"] as const).reduce((sum, k) => sum + (availability[k] ? rawWeights[k] : 0), 0);
  const weights = totalAvailWeight > 0
    ? {
        A: availability.A ? rawWeights.A / totalAvailWeight : 0,
        B: availability.B ? rawWeights.B / totalAvailWeight : 0,
        C: availability.C ? rawWeights.C / totalAvailWeight : 0,
        D: availability.D ? rawWeights.D / totalAvailWeight : 0,
      }
    : { A: 0, B: 0, C: 0, D: 0 };

  // If literally no signal is available, fall back to a neutral 40.
  let blended: number;
  if (totalAvailWeight === 0) {
    blended = 40;
  } else {
    blended = A.score * weights.A + B.score * weights.B + C.score * weights.C + D.score * weights.D;
  }

  const score = Math.max(0, Math.min(100, Math.round(blended)));
  return {
    score,
    label: labelFor(score),
    method: "v2-multifactor",
    breakdown: {
      authorityOfTop10: A,
      adsCompetition: B,
      serpSaturation: C,
      contentDepth: D,
    },
    weightsUsed: weights,
  };
}
