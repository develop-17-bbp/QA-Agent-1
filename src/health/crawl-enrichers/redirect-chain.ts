/**
 * Redirect-chain enricher — for every page the crawler recorded as
 * redirected, replay the redirect path manually with `redirect: "manual"`
 * so we can count hops and detect loops. One-hop redirects are normal and
 * skipped; we only report chains with ≥2 hops.
 *
 * Why this matters: Google treats redirect chains >3 hops as a crawl-budget
 * tax and often stops before reaching the final URL, meaning link equity
 * is lost. Infinite loops (A→B→A) break indexing entirely. Both are
 * invisible in the base crawl because the standard `fetch()` follows the
 * whole chain silently.
 */

import pLimit from "p-limit";
import type { SiteHealthReport, RedirectChainFindings } from "../types.js";

interface Hop {
  url: string;
  status: number;
  location?: string;
}

const MAX_HOPS = 10; // hard guard against runaway chains
const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = "QA-Agent-Enricher/1.0";

async function replay(url: string): Promise<{ hops: Hop[]; loop: boolean }> {
  const hops: Hop[] = [];
  const seen = new Set<string>();
  let current = url;
  for (let i = 0; i < MAX_HOPS; i++) {
    if (seen.has(current)) {
      // Loop — record the final re-visit so the UI can show where it closed
      hops.push({ url: current, status: 0, location: "(loop)" });
      return { hops, loop: true };
    }
    seen.add(current);
    let res: Response | undefined;
    try {
      res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT },
      });
    } catch {
      hops.push({ url: current, status: 0 });
      return { hops, loop: false };
    }
    const location = res.headers.get("location") ?? undefined;
    hops.push({ url: current, status: res.status, location: location ?? undefined });
    if (res.status >= 300 && res.status < 400 && location) {
      let nextUrl: string;
      try {
        nextUrl = new URL(location, current).href;
      } catch {
        return { hops, loop: false };
      }
      current = nextUrl;
      continue;
    }
    return { hops, loop: false };
  }
  return { hops, loop: false };
}

export async function enrichRedirectChains(report: SiteHealthReport): Promise<RedirectChainFindings> {
  const limit = pLimit(4);
  const candidates = report.crawl.pages.filter((p) => p.redirected === true && p.url);
  const results = await Promise.all(
    candidates.map((p) => limit(() => replay(p.url).then((r) => ({ start: p.url, ...r })))),
  );

  const chains: RedirectChainFindings["chains"] = [];
  let longest = 0;
  let loops = 0;
  for (const r of results) {
    // Chain length = number of hops - 1 (final non-redirect response isn't a "hop").
    const hopCount = Math.max(0, r.hops.length - 1);
    if (hopCount >= 2 || r.loop) {
      chains.push({ startUrl: r.start, hops: r.hops, loop: r.loop });
      if (hopCount > longest) longest = hopCount;
      if (r.loop) loops++;
    }
  }

  return {
    chains,
    longestChainHops: longest,
    loopCount: loops,
  };
}
