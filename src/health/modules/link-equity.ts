/**
 * Internal Link Equity Flow — PageRank-style propagation across the
 * crawled-site link graph. SEMrush calls this "Internal Linking";
 * Screaming Frog has a custom "link-score" metric. QA-Agent computes
 * it locally from a re-fetch of each crawled page.
 *
 * Pipeline:
 *   1. Read the run's pages.
 *   2. Re-fetch each page (bounded concurrency, capped at 200) and
 *      extract internal anchor hrefs via Cheerio.
 *   3. Build adjacency: from-URL → to-URLs (deduped).
 *   4. Run PageRank (damping 0.85, 20 iterations) — well-converged.
 *   5. Surface:
 *        - top-N highest-equity pages (your strongest assets)
 *        - orphans (pages with 0 inbound — Google can find them only
 *          via sitemap, severely under-equity)
 *        - "leaky" pages (high outbound × low inbound — they're
 *          giving away equity without receiving any)
 *        - "hoarders" (high inbound × low outbound — they should
 *          link to more children to spread equity)
 *
 * 100% deterministic. No LLM. Reuses crawl-site's safe fetcher pattern.
 */

import { load } from "cheerio";
import type { SiteHealthReport } from "../types.js";

const FETCH_TIMEOUT_MS = 6_000;
const MAX_PAGES = 200;
const CONCURRENCY = 6;
const PAGERANK_DAMPING = 0.85;
const PAGERANK_ITERATIONS = 20;

export interface LinkEquityNode {
  url: string;
  pageRank: number;
  inboundCount: number;
  outboundCount: number;
  /** Indegree − outdegree. Positive = hoarder, negative = leaky. */
  netEdge: number;
}

export interface LinkEquityResult {
  hostname: string;
  pagesAnalyzed: number;
  pagesSkipped: number;
  totalEdges: number;
  nodes: LinkEquityNode[];
  /** Top 10 PageRank pages — your strongest assets. */
  topAuthority: LinkEquityNode[];
  /** Pages with 0 inbound. Sub-table because they're often dozens. */
  orphans: LinkEquityNode[];
  /** Pages with high outbound × low inbound — gifting equity. */
  leaky: LinkEquityNode[];
  /** Pages with high inbound × very few outbound — should redistribute. */
  hoarders: LinkEquityNode[];
  generatedAt: string;
}

interface PageGraph {
  nodes: Set<string>;
  /** Adjacency: from → Set<to>. Dedupes self-links and duplicates. */
  edges: Map<string, Set<string>>;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; QA-Agent-Equity/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!/text\/html/i.test(ct)) return null;
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  } catch { return null; }
}

function normalizeUrl(href: string, base: string): string | null {
  try {
    const abs = new URL(href, base);
    abs.hash = "";
    // Drop trailing slash for consistency (except root).
    let s = abs.toString();
    if (s.endsWith("/") && s.length > abs.origin.length + 1) s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

function isSameOrigin(url: string, baseHost: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    const b = baseHost.replace(/^www\./, "");
    return h === b;
  } catch { return false; }
}

async function buildGraph(pageUrls: string[], baseHost: string): Promise<{ graph: PageGraph; skipped: number }> {
  const graph: PageGraph = { nodes: new Set(pageUrls), edges: new Map() };
  let cursor = 0;
  let skipped = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pageUrls.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= pageUrls.length) return;
        const from = pageUrls[i]!;
        const html = await fetchHtml(from);
        if (!html) { skipped++; continue; }
        const $ = load(html);
        const outbound = new Set<string>();
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;
          // Skip JS / mailto / tel.
          if (/^(?:javascript:|mailto:|tel:|#)/i.test(href)) return;
          const abs = normalizeUrl(href, from);
          if (!abs) return;
          if (!isSameOrigin(abs, baseHost)) return;
          if (abs === from) return; // skip self-links
          outbound.add(abs);
          graph.nodes.add(abs);
        });
        graph.edges.set(from, outbound);
      }
    }),
  );
  return { graph, skipped };
}

function runPageRank(graph: PageGraph): Map<string, number> {
  const N = graph.nodes.size;
  if (N === 0) return new Map();
  const init = 1 / N;
  let scores = new Map<string, number>();
  for (const n of graph.nodes) scores.set(n, init);

  // Build inbound adjacency for fast iteration.
  const inbound = new Map<string, string[]>();
  for (const n of graph.nodes) inbound.set(n, []);
  for (const [from, tos] of graph.edges) {
    for (const to of tos) {
      if (inbound.has(to)) inbound.get(to)!.push(from);
    }
  }
  // Outdegree per node.
  const outdeg = new Map<string, number>();
  for (const n of graph.nodes) outdeg.set(n, graph.edges.get(n)?.size ?? 0);

  for (let i = 0; i < PAGERANK_ITERATIONS; i++) {
    const next = new Map<string, number>();
    let danglingMass = 0;
    for (const n of graph.nodes) {
      if ((outdeg.get(n) ?? 0) === 0) danglingMass += scores.get(n) ?? 0;
    }
    const danglingShare = danglingMass / N;
    for (const n of graph.nodes) {
      let inboundSum = 0;
      for (const src of inbound.get(n) ?? []) {
        const od = outdeg.get(src) ?? 0;
        if (od > 0) inboundSum += (scores.get(src) ?? 0) / od;
      }
      const pr = (1 - PAGERANK_DAMPING) / N + PAGERANK_DAMPING * (inboundSum + danglingShare);
      next.set(n, pr);
    }
    scores = next;
  }
  return scores;
}

export async function analyzeLinkEquity(reports: SiteHealthReport[]): Promise<LinkEquityResult> {
  if (reports.length === 0) throw new Error("no crawl reports provided");
  const hostname = reports[0]!.hostname;
  const baseHost = hostname.replace(/^www\./, "");

  // Aggregate page URLs across reports for this run, cap to MAX_PAGES.
  const allUrls = new Set<string>();
  for (const r of reports) for (const p of r.crawl.pages) allUrls.add(p.url);
  const pageUrls = [...allUrls].slice(0, MAX_PAGES);

  const { graph, skipped } = await buildGraph(pageUrls, baseHost);
  const scores = runPageRank(graph);

  // Inbound count per node.
  const inboundCount = new Map<string, number>();
  for (const n of graph.nodes) inboundCount.set(n, 0);
  for (const [, tos] of graph.edges) {
    for (const to of tos) {
      if (inboundCount.has(to)) inboundCount.set(to, (inboundCount.get(to) ?? 0) + 1);
    }
  }
  let totalEdges = 0;
  for (const [, tos] of graph.edges) totalEdges += tos.size;

  const nodes: LinkEquityNode[] = [...graph.nodes].map((url) => {
    const inb = inboundCount.get(url) ?? 0;
    const out = graph.edges.get(url)?.size ?? 0;
    return {
      url,
      pageRank: +(scores.get(url) ?? 0).toFixed(6),
      inboundCount: inb,
      outboundCount: out,
      netEdge: inb - out,
    };
  });

  nodes.sort((a, b) => b.pageRank - a.pageRank);
  const topAuthority = nodes.slice(0, 10);
  const orphans = nodes.filter((n) => n.inboundCount === 0).slice(0, 30);

  // Leaky: outbound ≥ 5 + inbound ≤ 1 + below-median PR.
  const medianPr = nodes[Math.floor(nodes.length / 2)]?.pageRank ?? 0;
  const leaky = nodes
    .filter((n) => n.outboundCount >= 5 && n.inboundCount <= 1 && n.pageRank < medianPr)
    .sort((a, b) => b.outboundCount - a.outboundCount)
    .slice(0, 15);

  // Hoarders: inbound ≥ 5 + outbound ≤ 2.
  const hoarders = nodes
    .filter((n) => n.inboundCount >= 5 && n.outboundCount <= 2)
    .sort((a, b) => b.inboundCount - a.inboundCount)
    .slice(0, 15);

  return {
    hostname,
    pagesAnalyzed: pageUrls.length - skipped,
    pagesSkipped: skipped,
    totalEdges,
    nodes,
    topAuthority,
    orphans,
    leaky,
    hoarders,
    generatedAt: new Date().toISOString(),
  };
}
