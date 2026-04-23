/**
 * Sitemap-diff enricher — compare URLs declared in sitemap(s) against
 * URLs actually crawled.
 *
 * Two failure modes this catches that the base crawler misses:
 *   - "declaredNotCrawled" — a page is in the sitemap but the crawler
 *     didn't visit it. Usually means the page is orphaned from internal
 *     links (crawler never reached it via BFS) or the sitemap contains
 *     stale entries. Either way Googlebot may still index it but rely
 *     on sitemap alone, which is a weak signal.
 *   - "crawledNotDeclared" — a page is reachable via internal links but
 *     not in the sitemap. Often indexable but invisible to bots that
 *     prefer sitemap-first discovery.
 *
 * Robots.txt sitemap declarations take precedence; if none found, we
 * fallback to the common /sitemap.xml and /sitemap_index.xml paths.
 */

import type { SiteHealthReport, SitemapDiffFindings } from "../types.js";
import { httpGetText } from "../providers/http.js";

const CAP = 500;

/** Very small XML sitemap URL extractor — avoids pulling in a full XML
 *  parser. Matches <loc>…</loc> text content. Works for both sitemap
 *  (`urlset`) and sitemap-index (`sitemapindex`) formats. */
function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

async function fetchSitemapRecursive(url: string, seen: Set<string>, urls: Set<string>, maxDepth: number): Promise<void> {
  if (maxDepth < 0) return;
  if (seen.has(url)) return;
  seen.add(url);
  const body = await httpGetText(url, { timeoutMs: 15_000 });
  if (!body) return;
  // If it's a sitemap index (contains <sitemapindex>), recurse into each child.
  if (/<sitemapindex/i.test(body)) {
    const children = extractLocs(body);
    for (const child of children.slice(0, 20)) {
      await fetchSitemapRecursive(child, seen, urls, maxDepth - 1);
    }
    return;
  }
  for (const loc of extractLocs(body)) urls.add(loc);
}

export async function enrichSitemapDiff(
  report: SiteHealthReport,
  declaredSitemapsFromRobots: string[],
): Promise<SitemapDiffFindings> {
  const base = new URL(report.startUrl);
  const origin = `${base.protocol}//${base.host}`;
  const candidates = declaredSitemapsFromRobots.length > 0
    ? [...declaredSitemapsFromRobots]
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  const declared = new Set<string>();
  const seen = new Set<string>();
  const fetchedSuccess: string[] = [];
  const failed: string[] = [];

  for (const sUrl of candidates) {
    const sizeBefore = declared.size;
    const seenBefore = seen.size;
    await fetchSitemapRecursive(sUrl, seen, declared, 2);
    if (declared.size > sizeBefore || seen.size > seenBefore + 1) fetchedSuccess.push(sUrl);
    else failed.push(sUrl);
  }

  const crawled = new Set<string>();
  for (const page of report.crawl.pages) {
    if (page.url) crawled.add(page.url);
    if (page.finalUrl) crawled.add(page.finalUrl);
  }

  const declaredNotCrawled: string[] = [];
  for (const u of declared) {
    if (!crawled.has(u) && declaredNotCrawled.length < CAP) declaredNotCrawled.push(u);
  }

  const declaredSet = declared;
  const crawledNotDeclared: string[] = [];
  for (const u of crawled) {
    if (!declaredSet.has(u) && crawledNotDeclared.length < CAP) crawledNotDeclared.push(u);
  }

  return {
    sitemapsFetched: fetchedSuccess,
    declaredUrlCount: declared.size,
    declaredNotCrawled,
    crawledNotDeclared,
    error: fetchedSuccess.length === 0 ? `Could not fetch any sitemap (tried: ${candidates.join(", ")})` : undefined,
  };
}
