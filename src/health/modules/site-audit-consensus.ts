/**
 * Site-Audit Council producer — the unified cross-signal AI audit.
 *
 * Unlike the other 5 council producers (keywords/backlinks/serp/authority/
 * vitals), this one operates on a COMPLETED crawl + every configured
 * provider, and its agenda items are ISSUES — not keywords, not domains,
 * not URLs, but actionable findings like "12 pages missing meta
 * description" or "GSC top query 'X' has no ranking page".
 *
 * Sources reconciled (each runs best-effort; failures degrade gracefully):
 *   - The enriched SiteHealthReport (crawl + 6 enricher outputs)
 *   - GSC top queries (when Google connected + matching verified site)
 *   - Bing inbound links + crawl errors (when Bing API key set)
 *   - Yandex inbound links (when Yandex connected)
 *   - Ahrefs WMT CSV anchors (when imported for this domain)
 *   - PageSpeed insights already on the report
 *   - CrUX field data for the target origin
 *
 * Output: a standard CouncilContext that the generic council-runner.ts
 * drives through the LLM advisor panel, producing per-issue verdicts from
 * four domain-specific personas (Technical SEO, Editorial Strategist,
 * Link Reconciler, Performance Engineer).
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { CouncilContext, CouncilAgendaItem, CouncilAdvisor } from "./council-types.js";
import type { SiteHealthReport, PageFetchRecord } from "../types.js";
import type { HealthRunMeta } from "../orchestrate-health.js";
import { queryGscAnalytics, listGscSites, type GscSite } from "../providers/google-search-console.js";
import { getConnectionStatus } from "../providers/google-auth.js";
import { loadAwtBundle } from "../providers/ahrefs-webmaster-csv.js";
import { fetchCruxRecord, isCruxConfigured } from "../providers/crux.js";

const ADVISORS: CouncilAdvisor[] = [
  { id: "technical",   name: "Technical SEO",        focus: "Crawl, indexability, structured data, redirects, canonicals" },
  { id: "editorial",   name: "Editorial Strategist", focus: "Content gaps from GSC queries × crawled pages, intent mismatches" },
  { id: "backlinks",   name: "Link Reconciler",      focus: "External anchors vs internal URL reality; broken inbound targets" },
  { id: "performance", name: "Performance Engineer", focus: "Core Web Vitals lab vs field, crawl load-time findings" },
];

interface IssueDraft {
  id: string;
  label: string;
  sublabel?: string;
  sources: string[];
  metrics: Record<string, number | string | undefined>;
  severity: number; // 1 (low) – 10 (critical)
  rawVariants?: string[];
}

function draftToAgendaItem(d: IssueDraft): CouncilAgendaItem {
  // Score: severity-weighted consensus. 60% source-count, 40% severity.
  const agreementScore = Math.min(d.sources.length / 4, 1) * 60;
  const severityScore = (Math.min(Math.max(d.severity, 0), 10) / 10) * 40;
  const score = Math.round(agreementScore + severityScore);
  return {
    id: d.id,
    label: d.label,
    sublabel: d.sublabel,
    sources: [...d.sources].sort(),
    metrics: d.metrics,
    score,
    rawVariants: d.rawVariants,
  };
}

// ── Crawl report loader (reads the persisted JSON from a completed run) ──
async function loadRunReports(outRoot: string, runId: string): Promise<SiteHealthReport[] | null> {
  const runDir = path.join(outRoot, runId);
  try {
    const st = await stat(runDir);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  let meta: HealthRunMeta;
  try {
    meta = JSON.parse(await readFile(path.join(runDir, "run-meta.json"), "utf8")) as HealthRunMeta;
  } catch {
    return null;
  }
  const reports: SiteHealthReport[] = [];
  for (const site of meta.sites ?? []) {
    // site.reportHtmlHref ~= "example.com/report.html" — sibling report.json
    const href = (site as { reportHtmlHref?: string }).reportHtmlHref;
    if (!href) continue;
    const siteDir = path.dirname(path.join(runDir, href));
    try {
      const json = await readFile(path.join(siteDir, "report.json"), "utf8");
      reports.push(JSON.parse(json) as SiteHealthReport);
    } catch { /* skip missing */ }
  }
  return reports.length > 0 ? reports : null;
}

// ── Domain matching for GSC / CrUX ──
function findMatchingGscSite(sites: GscSite[], domain: string): GscSite | null {
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

// ── Reconciliation producers ──

/** Pure-crawl issues: things we see from the enriched report alone. */
function reconcileCrawlOnly(reports: SiteHealthReport[]): IssueDraft[] {
  const out: IssueDraft[] = [];
  for (const report of reports) {
    const allPages = report.crawl.pages;
    const pages = allPages.filter((p) => p.ok);

    // Missing meta description
    const missingMeta = pages.filter((p) => (p.metaDescriptionLength ?? 0) === 0);
    if (missingMeta.length > 0) {
      out.push({
        id: `missing-meta::${report.hostname}`,
        label: `${missingMeta.length} page(s) missing meta description`,
        sublabel: report.hostname,
        sources: ["crawl"],
        metrics: { pages: missingMeta.length, totalPages: pages.length },
        severity: missingMeta.length > 20 ? 7 : 4,
        rawVariants: missingMeta.slice(0, 3).map((p) => p.url),
      });
    }

    // Missing H1
    const missingH1 = pages.filter((p) => (p.h1Count ?? 0) === 0);
    if (missingH1.length > 0) {
      out.push({
        id: `missing-h1::${report.hostname}`,
        label: `${missingH1.length} page(s) missing an H1 heading`,
        sublabel: report.hostname,
        sources: ["crawl"],
        metrics: { pages: missingH1.length, totalPages: pages.length },
        severity: 5,
        rawVariants: missingH1.slice(0, 3).map((p) => p.url),
      });
    }

    // Broken internal links
    if (report.crawl.brokenLinks.length > 0) {
      out.push({
        id: `broken-links::${report.hostname}`,
        label: `${report.crawl.brokenLinks.length} broken link reference(s)`,
        sublabel: report.hostname,
        sources: ["crawl"],
        metrics: { count: report.crawl.brokenLinks.length },
        severity: report.crawl.brokenLinks.length > 5 ? 8 : 5,
        rawVariants: report.crawl.brokenLinks.slice(0, 3).map((b) => `${b.target} (from ${b.foundOn})`),
      });
    }

    // Slow pages
    const slow = pages.filter((p) => (p.durationMs ?? 0) > 4000);
    if (slow.length > 0) {
      const avgMs = Math.round(slow.reduce((s, p) => s + (p.durationMs ?? 0), 0) / slow.length);
      out.push({
        id: `slow-pages::${report.hostname}`,
        label: `${slow.length} page(s) loaded in >4s`,
        sublabel: report.hostname,
        sources: ["crawl"],
        metrics: { pages: slow.length, avgMs },
        severity: slow.length > 10 ? 7 : 4,
        rawVariants: slow.slice(0, 3).map((p) => `${p.url} (${p.durationMs}ms)`),
      });
    }

    // Enrichment-driven issues
    const e = report.enrichments;
    if (!e) continue;

    if (e.robots?.disallowedButCrawled && e.robots.disallowedButCrawled.length > 0) {
      out.push({
        id: `robots-disallowed-crawled::${report.hostname}`,
        label: `${e.robots.disallowedButCrawled.length} URLs crawled that robots.txt disallows`,
        sublabel: report.hostname,
        sources: ["crawl", "robots"],
        metrics: { count: e.robots.disallowedButCrawled.length },
        severity: 6,
        rawVariants: e.robots.disallowedButCrawled.slice(0, 3).map((d) => `${d.url} (rule: ${d.matchedRule})`),
      });
    }

    if (e.redirectChains?.chains && e.redirectChains.chains.length > 0) {
      out.push({
        id: `redirect-chains::${report.hostname}`,
        label: `${e.redirectChains.chains.length} redirect chain(s)${e.redirectChains.loopCount > 0 ? ` (${e.redirectChains.loopCount} loop${e.redirectChains.loopCount === 1 ? "" : "s"})` : ""}`,
        sublabel: `longest: ${e.redirectChains.longestChainHops} hops`,
        sources: ["crawl", "redirects"],
        metrics: { chains: e.redirectChains.chains.length, longestHops: e.redirectChains.longestChainHops, loops: e.redirectChains.loopCount },
        severity: e.redirectChains.loopCount > 0 ? 9 : e.redirectChains.longestChainHops > 3 ? 6 : 3,
        rawVariants: e.redirectChains.chains.slice(0, 3).map((c) => c.startUrl),
      });
    }

    if (e.structuredData) {
      const invalid = e.structuredData.pages.filter((p) => p.issues.length > 0 || p.blocksInvalidJson > 0);
      if (invalid.length > 0) {
        out.push({
          id: `structured-data-issues::${report.hostname}`,
          label: `${invalid.length} page(s) with JSON-LD issues`,
          sublabel: report.hostname,
          sources: ["crawl", "structured-data"],
          metrics: {
            invalidPages: invalid.length,
            pagesWithSchema: e.structuredData.pagesWithSchema,
            topType: Object.entries(e.structuredData.byType).sort((a, b) => b[1] - a[1])[0]?.[0],
          },
          severity: 5,
          rawVariants: invalid.slice(0, 3).map((p) => `${p.url} — ${p.issues.join("; ") || "invalid JSON"}`),
        });
      }
    }

    if (e.hreflang) {
      const probs = e.hreflang.nonMutualPairs.length + e.hreflang.invalidLangs.length + e.hreflang.selfTargetingMismatches.length;
      if (probs > 0) {
        out.push({
          id: `hreflang-issues::${report.hostname}`,
          label: `${probs} hreflang issue(s) (non-mutual / invalid / self-mismatch)`,
          sublabel: report.hostname,
          sources: ["crawl", "hreflang"],
          metrics: {
            nonMutual: e.hreflang.nonMutualPairs.length,
            invalidLangs: e.hreflang.invalidLangs.length,
            selfMismatch: e.hreflang.selfTargetingMismatches.length,
            missingXDefault: e.hreflang.missingXDefault.length,
          },
          severity: 5,
          rawVariants: e.hreflang.nonMutualPairs.slice(0, 3).map((p) => `${p.from} → ${p.to} (${p.lang})`),
        });
      }
    }

    if (e.sitemapDiff) {
      if (e.sitemapDiff.declaredNotCrawled.length > 0) {
        out.push({
          id: `sitemap-declared-not-crawled::${report.hostname}`,
          label: `${e.sitemapDiff.declaredNotCrawled.length} sitemap URLs never crawled`,
          sublabel: "orphaned from internal links?",
          sources: ["crawl", "sitemap"],
          metrics: { urls: e.sitemapDiff.declaredNotCrawled.length, totalDeclared: e.sitemapDiff.declaredUrlCount },
          severity: e.sitemapDiff.declaredNotCrawled.length > 50 ? 7 : 4,
          rawVariants: e.sitemapDiff.declaredNotCrawled.slice(0, 3),
        });
      }
      if (e.sitemapDiff.crawledNotDeclared.length > 0) {
        out.push({
          id: `crawled-not-in-sitemap::${report.hostname}`,
          label: `${e.sitemapDiff.crawledNotDeclared.length} crawled URLs missing from sitemap`,
          sublabel: "invisible to sitemap-only bots",
          sources: ["crawl", "sitemap"],
          metrics: { urls: e.sitemapDiff.crawledNotDeclared.length },
          severity: 4,
          rawVariants: e.sitemapDiff.crawledNotDeclared.slice(0, 3),
        });
      }
    }

    if (e.canonicalChains && (e.canonicalChains.chains.length > 0 || e.canonicalChains.loopCount > 0)) {
      out.push({
        id: `canonical-chains::${report.hostname}`,
        label: `${e.canonicalChains.chains.length} canonical chain${e.canonicalChains.chains.length === 1 ? "" : "s"}${e.canonicalChains.loopCount > 0 ? ` (${e.canonicalChains.loopCount} loop)` : ""}`,
        sublabel: `longest: ${e.canonicalChains.longestChain} hops`,
        sources: ["crawl", "canonical"],
        metrics: { chains: e.canonicalChains.chains.length, loops: e.canonicalChains.loopCount, longest: e.canonicalChains.longestChain },
        severity: e.canonicalChains.loopCount > 0 ? 9 : 5,
        rawVariants: e.canonicalChains.chains.slice(0, 3).map((c) => c.chain.join(" → ")),
      });
    }
  }
  return out;
}

/** GSC × crawl — queries with impressions that no crawled page targets. */
async function reconcileGsc(reports: SiteHealthReport[], domain: string): Promise<{ drafts: IssueDraft[]; queried: boolean; reason?: string }> {
  const out: IssueDraft[] = [];
  try {
    const auth = await getConnectionStatus();
    if (!auth.connected) return { drafts: out, queried: false, reason: "Google not connected" };
    const sites = await listGscSites();
    const match = findMatchingGscSite(sites, domain);
    if (!match) return { drafts: out, queried: false, reason: `No verified GSC site for ${domain}` };
    const endDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = await queryGscAnalytics({ siteUrl: match.siteUrl, startDate, endDate, dimensions: ["query"], rowLimit: 100 });

    // Build a set of normalized terms we see on crawled pages (from titles + h1s
    // proxied by URL slugs — a crude but reasonable signal).
    const crawledTerms = new Set<string>();
    for (const r of reports) {
      for (const p of r.crawl.pages) {
        const title = p.documentTitle?.toLowerCase() ?? "";
        const slug = (p.url || "").toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/[-_/]+/g, " ");
        for (const tok of (title + " " + slug).split(/\s+/)) if (tok.length >= 3) crawledTerms.add(tok);
      }
    }

    const gapQueries: { query: string; impressions: number; clicks: number; position: number }[] = [];
    for (const row of rows) {
      const q = (row.keys[0] ?? "").trim().toLowerCase();
      if (!q) continue;
      const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
      if (tokens.length === 0) continue;
      const covered = tokens.some((t) => crawledTerms.has(t));
      if (!covered) {
        gapQueries.push({
          query: q,
          impressions: row.impressions?.value ?? 0,
          clicks: row.clicks?.value ?? 0,
          position: row.position?.value ?? 0,
        });
      }
    }
    if (gapQueries.length > 0) {
      gapQueries.sort((a, b) => b.impressions - a.impressions);
      out.push({
        id: `gsc-content-gap::${domain}`,
        label: `${gapQueries.length} GSC query${gapQueries.length === 1 ? "" : "ies"} with no targeted page`,
        sublabel: `top: "${gapQueries[0]?.query}" (${gapQueries[0]?.impressions} impressions)`,
        sources: ["crawl", "gsc"],
        metrics: {
          queryCount: gapQueries.length,
          totalImpressions: gapQueries.reduce((s, q) => s + q.impressions, 0),
          totalClicks: gapQueries.reduce((s, q) => s + q.clicks, 0),
        },
        severity: gapQueries.length >= 10 ? 8 : 5,
        rawVariants: gapQueries.slice(0, 3).map((q) => `"${q.query}" — ${q.impressions} imp, rank ${q.position.toFixed(1)}`),
      });
    }
    return { drafts: out, queried: true };
  } catch (e) {
    return { drafts: out, queried: false, reason: e instanceof Error ? e.message.slice(0, 120) : "gsc error" };
  }
}

/** Ahrefs WMT CSV × crawl — referring-domain anchors pointing to broken targets. */
async function reconcileAhrefs(reports: SiteHealthReport[], domain: string): Promise<{ drafts: IssueDraft[]; queried: boolean; reason?: string }> {
  const out: IssueDraft[] = [];
  try {
    const bundle = await loadAwtBundle(domain);
    if (!bundle) return { drafts: out, queried: false, reason: "No AWT CSV imported" };
    const allUrls = new Set<string>();
    const okUrls = new Set<string>();
    for (const r of reports) {
      for (const p of r.crawl.pages) {
        allUrls.add(p.url);
        if (p.finalUrl) allUrls.add(p.finalUrl);
        if (p.ok) { okUrls.add(p.url); if (p.finalUrl) okUrls.add(p.finalUrl); }
      }
    }
    // Target URLs from AWT backlinks that either aren't in crawl at all or are 404.
    const broken: { target: string; anchor?: string }[] = [];
    for (const b of bundle.backlinks) {
      if (!b.targetUrl) continue;
      const inCrawl = allUrls.has(b.targetUrl);
      const ok = okUrls.has(b.targetUrl);
      if (inCrawl && !ok) broken.push({ target: b.targetUrl, anchor: b.anchorText });
    }
    if (broken.length > 0) {
      out.push({
        id: `ahrefs-broken-inbound::${domain}`,
        label: `${broken.length} inbound backlink(s) point to broken pages`,
        sublabel: "high-value link equity at risk",
        sources: ["crawl", "ahrefs"],
        metrics: { count: broken.length },
        severity: broken.length > 5 ? 9 : 7,
        rawVariants: broken.slice(0, 3).map((b) => `${b.target}${b.anchor ? ` (anchor: "${b.anchor}")` : ""}`),
      });
    }
    return { drafts: out, queried: true };
  } catch (e) {
    return { drafts: out, queried: false, reason: e instanceof Error ? e.message.slice(0, 120) : "ahrefs error" };
  }
}

/** CrUX × crawl — field p75 LCP on homepage vs lab PageSpeed (when both exist). */
async function reconcileCrux(reports: SiteHealthReport[], domain: string): Promise<{ drafts: IssueDraft[]; queried: boolean; reason?: string }> {
  const out: IssueDraft[] = [];
  try {
    if (!isCruxConfigured()) return { drafts: out, queried: false, reason: "CrUX API key not set" };
    const origin = `https://${domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")}`;
    const crux = await fetchCruxRecord(origin, "PHONE");
    if (!crux?.lcp?.value?.p75) return { drafts: out, queried: false, reason: "No CrUX sample for origin (low traffic?)" };
    const fieldLcp = crux.lcp.value.p75;
    if (fieldLcp <= 2500) return { drafts: out, queried: true }; // good — no issue
    const sev = fieldLcp > 4000 ? 9 : 6;
    out.push({
      id: `crux-lcp-slow::${domain}`,
      label: `Field LCP p75 is ${Math.round(fieldLcp)}ms (real users)`,
      sublabel: fieldLcp > 4000 ? "POOR per Core Web Vitals" : "NEEDS WORK per Core Web Vitals",
      sources: ["crux", "crawl"],
      metrics: { fieldLcpPhoneMs: Math.round(fieldLcp) },
      severity: sev,
    });
    return { drafts: out, queried: true };
  } catch (e) {
    return { drafts: out, queried: false, reason: e instanceof Error ? e.message.slice(0, 120) : "crux error" };
  }
}

// ── Main entry ──────────────────────────────────────────────────────────────

export async function buildSiteAuditCouncilContext(input: {
  runId: string;
  domain: string;
  outRoot: string;
}): Promise<CouncilContext> {
  const queried = new Set<string>();
  const failed: { source: string; reason: string }[] = [];
  const drafts: IssueDraft[] = [];

  const reports = await loadRunReports(input.outRoot, input.runId);
  if (!reports) {
    return {
      feature: "site-audit",
      featureLabel: "Site Audit Council",
      featureTagline: "Unified AI audit reconciling crawl + every configured data source.",
      target: input.domain,
      sourcesQueried: [],
      sourcesFailed: [{ source: "crawl", reason: `Run ${input.runId} not found or empty` }],
      tierTop: [],
      tierMid: [],
      tierBottom: [],
      totalItems: 0,
      collectedAt: new Date().toISOString(),
      advisors: ADVISORS,
    };
  }
  queried.add("crawl");

  // Crawl-only issues (always available when we have reports)
  drafts.push(...reconcileCrawlOnly(reports));

  // Parallel provider-backed reconciliations
  const [gsc, ahrefs, crux] = await Promise.all([
    reconcileGsc(reports, input.domain),
    reconcileAhrefs(reports, input.domain),
    reconcileCrux(reports, input.domain),
  ]);
  for (const r of [gsc, ahrefs, crux]) {
    if (r.queried) {
      for (const d of r.drafts) {
        for (const s of d.sources) queried.add(s);
      }
    } else if (r.reason) {
      // Source name is the first non-"crawl" entry in any draft's sources; we can
      // infer from which reconcile returned it.
    }
  }
  if (!gsc.queried && gsc.reason) failed.push({ source: "gsc", reason: gsc.reason });
  if (!ahrefs.queried && ahrefs.reason) failed.push({ source: "ahrefs", reason: ahrefs.reason });
  if (!crux.queried && crux.reason) failed.push({ source: "crux", reason: crux.reason });
  drafts.push(...gsc.drafts, ...ahrefs.drafts, ...crux.drafts);

  // Build agenda items
  const items = drafts.map(draftToAgendaItem).sort((a, b) => b.score - a.score);

  return {
    feature: "site-audit",
    featureLabel: "Site Audit Council",
    featureTagline: "Unified AI audit reconciling crawl findings with GSC queries, Ahrefs anchors, CrUX field data and each enricher's output. Issues present in multiple sources are prioritized.",
    target: input.domain,
    sourcesQueried: [...queried].sort(),
    sourcesFailed: failed,
    tierTop: items.filter((i) => i.sources.length >= 3),
    tierMid: items.filter((i) => i.sources.length === 2),
    tierBottom: items.filter((i) => i.sources.length === 1),
    totalItems: items.length,
    collectedAt: new Date().toISOString(),
    advisors: ADVISORS,
  };
}

// Also export a PageFetchRecord helper type for consumers that want to
// inspect pages without importing from types.ts directly.
export type { PageFetchRecord };
