/**
 * Canonical-chain enricher — walk rel=canonical declarations across every
 * crawled page and detect (a) chains >1 hop, (b) canonical loops, and
 * (c) canonical targets that we never crawled (danglers).
 *
 * Why this matters: Google picks one URL as canonical per content cluster;
 * a chain A → B → C is allowed but costs a crawl hop per link, and any
 * loop causes Google to fall back to its own heuristics (usually ignoring
 * both pages). Danglers — canonical pointing to a URL we never saw —
 * usually indicate a broken redirect or a CMS misconfiguration.
 *
 * Uses only data the base crawler already collected (PageFetchRecord.
 * canonicalUrl), so no new network calls.
 */

import type { SiteHealthReport, CanonicalChainFindings, PageFetchRecord } from "../types.js";

const MAX_WALK = 8; // hard cap against runaway chains

function normalize(u: string): string {
  try { return new URL(u).href; } catch { return u; }
}

export async function enrichCanonicalChains(report: SiteHealthReport): Promise<CanonicalChainFindings> {
  const byUrl = new Map<string, PageFetchRecord>();
  for (const p of report.crawl.pages) {
    if (p.url) byUrl.set(normalize(p.url), p);
  }

  const chains: CanonicalChainFindings["chains"] = [];
  const danglingTargets: CanonicalChainFindings["danglingTargets"] = [];
  let nonSelfCanonicalCount = 0;
  let longest = 0;
  let loopCount = 0;

  for (const [url, page] of byUrl) {
    const canon = page.canonicalUrl ? normalize(page.canonicalUrl) : undefined;
    if (!canon || canon === url) continue;
    nonSelfCanonicalCount++;

    // Walk the chain: follow canonical.canonical.canonical…
    const chain: string[] = [url];
    const visited = new Set<string>([url]);
    let cursor = canon;
    let hadLoop = false;
    for (let i = 0; i < MAX_WALK; i++) {
      if (visited.has(cursor)) {
        chain.push(cursor);
        hadLoop = true;
        loopCount++;
        break;
      }
      chain.push(cursor);
      visited.add(cursor);
      const next = byUrl.get(cursor);
      if (!next) {
        // Canonical target was never crawled (dangler).
        danglingTargets.push({
          from: url,
          to: cursor,
          reason: "canonical target not in crawled set (orphan or broken redirect?)",
        });
        break;
      }
      const nextCanon = next.canonicalUrl ? normalize(next.canonicalUrl) : undefined;
      if (!nextCanon || nextCanon === cursor) {
        // Self-canonical terminates the chain cleanly.
        break;
      }
      cursor = nextCanon;
    }

    // chain.length > 2 means at least A → B → C (a real chain, not just
    // a single redirect to a canonical target).
    if (chain.length > 2 || hadLoop) {
      chains.push({ startUrl: url, chain, loop: hadLoop });
      if (chain.length - 1 > longest) longest = chain.length - 1;
    }
  }

  // Cap output.
  chains.length = Math.min(chains.length, 200);
  danglingTargets.length = Math.min(danglingTargets.length, 200);

  return {
    nonSelfCanonicalCount,
    chains,
    danglingTargets,
    longestChain: longest,
    loopCount,
  };
}
