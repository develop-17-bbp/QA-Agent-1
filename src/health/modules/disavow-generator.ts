/**
 * Disavow File Generator — flags toxic backlinks and emits a Google-
 * format disavow.txt. Accepts input from ANY wired backlink source so
 * the feature works without paying for DataForSEO.
 *
 * Free input sources (default):
 *   - Bing Webmaster Tools API (free with key)
 *   - Ahrefs Webmaster Tools CSV import (free for verified properties)
 *
 * Paid input source (opt-in via fetchDisavowFromDfs):
 *   - DataForSEO live backlinks (BYOK — gives DR signal which improves
 *     toxicity scoring; otherwise we fall back to TLD/anchor heuristics)
 *
 * Toxic patterns (each adds to the "toxicity score"):
 *   - Source domain rank < 10                              (score +30, DFS only)
 *   - Source TLD in known-spam list (.xyz, .top, .cn etc.) (score +20)
 *   - Exact-match anchor used > 50% of links from this dom (score +25)
 *   - Sitewide pattern: same source domain has > 20 links  (score +15)
 *   - Anchor contains gambling/pharma/adult keywords        (score +30)
 *   - All links to single deep page (no contextual diversity)(score +15)
 *
 * domain:example.com syntax recommended over per-URL — Google's docs
 * note that disavowing the entire domain is usually safer.
 */

import type { DfsBacklinkRow, DfsBacklinksLive } from "../providers/dataforseo.js";
import { loadAwtBundle } from "../providers/ahrefs-webmaster-csv.js";
import { fetchBingBacklinks, isBingWmtConfigured } from "../providers/bing-webmaster.js";

/** Generic shape — minimum a backlink row must provide. */
export interface BacklinkRowLike {
  pageFrom: string;
  pageTo: string;
  anchor?: string;
  domainRankFrom?: number | null;
}

const SPAM_TLDS = new Set(["xyz", "top", "cn", "ru", "ml", "tk", "ga", "cf", "click", "loan", "win", "bid"]);
const SPAM_ANCHOR_PATTERNS = /\b(casino|poker|viagra|cialis|porn|escort|loan|crypto airdrop|mlm|bitcoin doubler|essay writing)\b/i;

export interface ToxicLink {
  domain: string;
  exampleSourceUrl: string;
  domainRank: number | null;
  linksFromThisDomain: number;
  topAnchor: string;
  toxicityScore: number;
  reasons: string[];
}

export interface DisavowResult {
  /** Operator's domain. */
  target: string;
  totalLinksScanned: number;
  toxicLinks: ToxicLink[];
  /** Where the input rows came from (for the UI to show a free/paid badge). */
  source: "ahrefs-webmaster-csv" | "bing-webmaster" | "dataforseo" | "merged";
  /** disavow.txt body — paste directly into Google Search Console disavow tool. */
  disavowFileContent: string;
  generatedAt: string;
}

/** Core scorer — accepts any list of backlink rows. */
export function generateDisavowFromRows(operatorDomain: string, rows: BacklinkRowLike[], source: DisavowResult["source"], threshold = 50): DisavowResult {
  // Group links by source domain.
  const byDomain = new Map<string, BacklinkRowLike[]>();
  for (const row of rows) {
    if (!row.pageFrom) continue;
    let host = "";
    try { host = new URL(row.pageFrom).hostname.replace(/^www\./, "").toLowerCase(); } catch { continue; }
    if (!host) continue;
    const arr = byDomain.get(host) ?? [];
    arr.push(row);
    byDomain.set(host, arr);
  }

  const toxic: ToxicLink[] = [];
  for (const [domain, rows] of byDomain) {
    let score = 0;
    const reasons: string[] = [];
    const dr = rows[0]?.domainRankFrom ?? null;
    if (typeof dr === "number" && dr < 10) {
      score += 30;
      reasons.push(`source DR ${dr} < 10`);
    }
    const tld = domain.split(".").pop() ?? "";
    if (SPAM_TLDS.has(tld)) {
      score += 20;
      reasons.push(`spam-pattern TLD .${tld}`);
    }
    // Exact-match anchor concentration.
    const anchorCounts = new Map<string, number>();
    for (const r of rows) {
      const a = (r.anchor ?? "").trim().toLowerCase();
      if (!a) continue;
      anchorCounts.set(a, (anchorCounts.get(a) ?? 0) + 1);
    }
    const topAnchor = [...anchorCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topAnchorCount = topAnchor?.[1] ?? 0;
    if (rows.length >= 4 && topAnchor && topAnchorCount / rows.length > 0.5) {
      score += 25;
      reasons.push(`anchor "${topAnchor[0]}" used ${Math.round((topAnchorCount / rows.length) * 100)}% of times`);
    }
    if (topAnchor && SPAM_ANCHOR_PATTERNS.test(topAnchor[0])) {
      score += 30;
      reasons.push(`anchor contains spam keyword`);
    }
    if (rows.length > 20) {
      score += 15;
      reasons.push(`sitewide pattern: ${rows.length} links from same domain`);
    }
    // All links to single deep page = no contextual diversity.
    const targets = new Set(rows.map((r) => r.pageTo));
    if (rows.length >= 5 && targets.size === 1) {
      score += 15;
      reasons.push(`all ${rows.length} links target a single page`);
    }

    if (score >= threshold) {
      toxic.push({
        domain,
        exampleSourceUrl: rows[0]?.pageFrom ?? "",
        domainRank: dr,
        linksFromThisDomain: rows.length,
        topAnchor: topAnchor?.[0] ?? "",
        toxicityScore: score,
        reasons,
      });
    }
  }
  toxic.sort((a, b) => b.toxicityScore - a.toxicityScore);

  // Compose disavow.txt — Google-format header + one `domain:` line per entry.
  const header = [
    `# Generated by QA-Agent on ${new Date().toISOString()}`,
    `# Target: ${operatorDomain}`,
    `# Toxicity threshold: ${threshold}`,
    `# Review carefully before submitting to Google Search Console — disavow is irreversible.`,
    `# Docs: https://support.google.com/webmasters/answer/2648487`,
    "",
  ].join("\n");
  const body = toxic.map((t) => {
    const reasonComment = t.reasons.length > 0 ? `# score=${t.toxicityScore} · ${t.reasons.join(" · ")}` : `# score=${t.toxicityScore}`;
    return `${reasonComment}\ndomain:${t.domain}`;
  }).join("\n\n");

  return {
    target: operatorDomain,
    totalLinksScanned: rows.length,
    toxicLinks: toxic,
    source,
    disavowFileContent: header + body + (body ? "\n" : ""),
    generatedAt: new Date().toISOString(),
  };
}

/** Backwards-compat: original DFS-only entry point. */
export function generateDisavow(operatorDomain: string, live: DfsBacklinksLive, threshold = 50): DisavowResult {
  return generateDisavowFromRows(operatorDomain, live.rows, "dataforseo", threshold);
}

/** Free aggregator: pulls live backlink rows from AHREFS Webmaster
 *  Tools CSV (when imported) and Bing Webmaster Tools API (when keyed).
 *  Returns a normalized BacklinkRowLike[] suitable for generateDisavowFromRows. */
export async function aggregateFreeBacklinks(operatorDomain: string): Promise<{ rows: BacklinkRowLike[]; sources: string[] }> {
  const sources: string[] = [];
  const rows: BacklinkRowLike[] = [];

  // 1. AHREFS Webmaster Tools CSV (free for verified properties).
  try {
    const awt = await loadAwtBundle(operatorDomain);
    if (awt && awt.backlinks.length > 0) {
      sources.push("ahrefs-webmaster-csv");
      for (const b of awt.backlinks) {
        rows.push({
          pageFrom: b.referringUrl,
          pageTo: b.targetUrl,
          anchor: b.anchorText,
          domainRankFrom: typeof b.referringDomainRating === "number" ? b.referringDomainRating : null,
        });
      }
    }
  } catch { /* skip */ }

  // 2. Bing Webmaster Tools API (free with key — site verification required).
  if (isBingWmtConfigured()) {
    try {
      const bingDp = await fetchBingBacklinks(`https://${operatorDomain}/`, 500);
      const bingRows = bingDp?.value ?? [];
      if (bingRows.length > 0) {
        sources.push("bing-webmaster");
        for (const b of bingRows) {
          rows.push({
            pageFrom: b.sourceUrl,
            pageTo: b.targetUrl,
            anchor: b.anchorText,
            domainRankFrom: null, // Bing WMT doesn't expose DR
          });
        }
      }
    } catch { /* skip */ }
  }

  return { rows, sources };
}

/** End-to-end free-tier disavow: aggregate + score in one call. */
export async function generateDisavowFree(operatorDomain: string, threshold = 50): Promise<DisavowResult> {
  const { rows, sources } = await aggregateFreeBacklinks(operatorDomain);
  if (rows.length === 0) {
    throw new Error(
      "No free backlink data available for this domain. Either import an AHREFS Webmaster Tools CSV (Backlinks page → import) or configure Bing Webmaster Tools in /integrations.",
    );
  }
  const sourceLabel: DisavowResult["source"] = sources.length > 1 ? "merged" : (sources[0] as DisavowResult["source"]);
  return generateDisavowFromRows(operatorDomain, rows, sourceLabel, threshold);
}
