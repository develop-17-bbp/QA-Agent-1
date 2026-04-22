/**
 * Keyword Consensus producer — gathers keyword/term signals from every SEO
 * data source we've integrated (GSC, Bing WMT anchors, Yandex WMT anchors,
 * Ahrefs WMT CSV anchors, RSS brand mentions) and emits a generic
 * CouncilContext the Council Runner can use.
 *
 * See council-types.ts for the data contract. See council-runner.ts for
 * how these contexts become LLM advisor verdicts.
 *
 * Why consensus matters here: GSC only shows queries you already rank for,
 * anchor text skews toward brand terms, news/RSS skews toward trending
 * coverage. A keyword only showing up in one source is a noise candidate.
 * A keyword showing up in 3+ sources is almost certainly an editorial
 * north-star term you should be writing about.
 */

import { queryGscAnalytics, listGscSites, type GscSite } from "../providers/google-search-console.js";
import { getConnectionStatus } from "../providers/google-auth.js";
import { fetchBingBacklinks, isBingWmtConfigured } from "../providers/bing-webmaster.js";
import { fetchYandexSites, fetchYandexInboundLinks, isYandexWebmasterConfigured, isYandexConnected } from "../providers/yandex-webmaster.js";
import { loadAwtBundle } from "../providers/ahrefs-webmaster-csv.js";
import { fetchBrandMentions } from "../providers/rss-aggregator.js";
import type { CouncilContext, CouncilAgendaItem, CouncilAdvisor } from "./council-types.js";

const KEYWORD_ADVISORS: CouncilAdvisor[] = [
  { id: "content", name: "Content Strategist", focus: "Editorial priorities and search intent — what to write next" },
  { id: "technical", name: "Technical SEO", focus: "On-page, crawl, and ranking blockers specific to this term" },
  { id: "analytics", name: "Analytics PM", focus: "What the metric trajectory says about this term's value" },
  { id: "competitive", name: "Competitive Analyst", focus: "Gap vs. competitors — unique opportunities and risks" },
];

// ── Term extraction + normalization ─────────────────────────────────────────

const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","for","of","in","on","at","to","by","with","from","as","is","are","was","were","be","been","being","it","its","this","that","these","those","which","who","whom","whose","what","when","where","why","how","not","no","so","do","does","did","doing","have","has","had","having","i","you","he","she","we","they","them","our","your","their","here","there","can","could","will","would","shall","should","may","might","must","just","only","also","very","more","most","some","any","all","each","every","than","too","own","same","such","nor","into","over","under","up","down","out","off","about","after","before","while","during","because","until","through","across",
  "home","page","read","more","click","here","link","website","site","blog","post","article","download","view","visit","learn","contact","login","sign","register","menu","search","next","prev","previous","back",
]);

function stripDomainTokens(domain: string): string[] {
  const host = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const parts = host.split(".").filter(Boolean);
  const tlds = new Set(["com","org","net","io","co","uk","de","fr","in","jp","cn","ru","kz","by","ua","us","au","ca","info","biz"]);
  return parts.filter((p) => !tlds.has(p) && p.length > 1);
}

function tokenize(text: string, domainTokens: string[]): { unigrams: string[]; bigrams: string[] } {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9À-ɏЀ-ӿ぀-ヿ㐀-鿿\s-]/g, " ");
  const words = cleaned.split(/[\s\-]+/).filter(Boolean);
  const drop = new Set([...STOPWORDS, ...domainTokens]);
  const kept: string[] = [];
  for (const w of words) {
    if (w.length < 3) continue;
    if (drop.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    kept.push(w);
  }
  const bigrams: string[] = [];
  for (let i = 0; i < kept.length - 1; i++) bigrams.push(`${kept[i]} ${kept[i + 1]}`);
  return { unigrams: kept, bigrams };
}

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

// ── Aggregation bucket ──────────────────────────────────────────────────────

type Bucket = {
  sources: Set<string>;
  metrics: {
    gscImpressions?: number;
    gscClicks?: number;
    gscPosition?: number;
    bingAnchorCount?: number;
    yandexAnchorCount?: number;
    awtAnchorCount?: number;
    rssMentions?: number;
  };
  rawVariants: Map<string, number>;
};

function touchBucket(map: Map<string, Bucket>, term: string, raw: string, source: string): Bucket {
  let b = map.get(term);
  if (!b) { b = { sources: new Set(), metrics: {}, rawVariants: new Map() }; map.set(term, b); }
  b.sources.add(source);
  b.rawVariants.set(raw, (b.rawVariants.get(raw) ?? 0) + 1);
  return b;
}

function scoreBucket(b: Bucket): number {
  const sourceCount = b.sources.size;
  const agreement = Math.min(sourceCount / 4, 1) * 60;
  const m = b.metrics;
  const totalSignal =
    (m.gscImpressions ?? 0) +
    (m.bingAnchorCount ?? 0) * 50 +
    (m.yandexAnchorCount ?? 0) * 50 +
    (m.awtAnchorCount ?? 0) * 25 +
    (m.rssMentions ?? 0) * 100 +
    (m.gscClicks ?? 0) * 5;
  const magnitude = totalSignal > 0 ? Math.min(Math.log10(totalSignal + 1) / 5, 1) * 40 : 0;
  return Math.round(agreement + magnitude);
}

// ── Main entry ──────────────────────────────────────────────────────────────

export async function buildKeywordCouncilContext(domain: string): Promise<CouncilContext> {
  const domainTokens = stripDomainTokens(domain);
  const map = new Map<string, Bucket>();
  const queried = new Set<string>();
  const failed: { source: string; reason: string }[] = [];

  // GSC queries
  await (async () => {
    try {
      const auth = await getConnectionStatus();
      if (!auth.connected) { failed.push({ source: "gsc", reason: "Google not connected" }); return; }
      const sites = await listGscSites();
      const match = findMatchingGscSite(sites, domain);
      if (!match) { failed.push({ source: "gsc", reason: `No verified GSC site matches ${domain}` }); return; }
      const endDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const rows = await queryGscAnalytics({ siteUrl: match.siteUrl, startDate, endDate, dimensions: ["query"], rowLimit: 200 });
      for (const r of rows) {
        const query = r.keys[0];
        if (!query) continue;
        const term = query.trim().toLowerCase();
        if (!term || term.length < 3) continue;
        const b = touchBucket(map, term, query, "gsc");
        b.metrics.gscImpressions = (b.metrics.gscImpressions ?? 0) + (r.impressions?.value ?? 0);
        b.metrics.gscClicks = (b.metrics.gscClicks ?? 0) + (r.clicks?.value ?? 0);
        const pos = r.position?.value;
        if (pos != null) b.metrics.gscPosition = b.metrics.gscPosition != null ? Math.min(b.metrics.gscPosition, pos) : pos;
      }
      queried.add("gsc");
    } catch (e) { failed.push({ source: "gsc", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // Bing anchors
  await (async () => {
    try {
      if (!isBingWmtConfigured()) { failed.push({ source: "bing-anchors", reason: "Bing WMT API key not set" }); return; }
      const siteUrl = domain.startsWith("http") ? domain : `https://${domain.replace(/^www\./, "")}`;
      const dp = await fetchBingBacklinks(siteUrl, 300);
      for (const r of dp.value ?? []) {
        const anchor = (r.anchorText ?? "").trim();
        if (!anchor) continue;
        const { unigrams, bigrams } = tokenize(anchor, domainTokens);
        for (const t of [...unigrams, ...bigrams]) {
          const b = touchBucket(map, t, anchor, "bing-anchors");
          b.metrics.bingAnchorCount = (b.metrics.bingAnchorCount ?? 0) + 1;
        }
      }
      queried.add("bing-anchors");
    } catch (e) { failed.push({ source: "bing-anchors", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // Yandex anchors
  await (async () => {
    try {
      const connected = isYandexWebmasterConfigured() || (await isYandexConnected());
      if (!connected) { failed.push({ source: "yandex-anchors", reason: "Yandex not connected" }); return; }
      const sitesDp = await fetchYandexSites();
      const sites = sitesDp.value ?? [];
      const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const match = sites.find((s) => {
        try {
          const host = new URL(s.siteUrl.startsWith("http") ? s.siteUrl : `https://${s.siteUrl}`).hostname.toLowerCase().replace(/^www\./, "");
          return host === clean || clean.endsWith("." + host) || host.endsWith("." + clean);
        } catch { return s.siteUrl.toLowerCase().includes(clean); }
      });
      if (!match) { failed.push({ source: "yandex-anchors", reason: `No verified Yandex host matches ${domain}` }); return; }
      const linksDp = await fetchYandexInboundLinks(match.hostId, 300);
      for (const l of linksDp.value ?? []) {
        const anchor = (l.anchorText ?? "").trim();
        if (!anchor) continue;
        const { unigrams, bigrams } = tokenize(anchor, domainTokens);
        for (const t of [...unigrams, ...bigrams]) {
          const b = touchBucket(map, t, anchor, "yandex-anchors");
          b.metrics.yandexAnchorCount = (b.metrics.yandexAnchorCount ?? 0) + 1;
        }
      }
      queried.add("yandex-anchors");
    } catch (e) { failed.push({ source: "yandex-anchors", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // AWT CSV anchors
  await (async () => {
    try {
      const bundle = await loadAwtBundle(domain);
      if (!bundle) { failed.push({ source: "awt-anchors", reason: "No AWT CSV imported for this domain" }); return; }
      for (const row of bundle.backlinks) {
        const anchor = (row.anchorText ?? "").trim();
        if (!anchor) continue;
        const { unigrams, bigrams } = tokenize(anchor, domainTokens);
        for (const t of [...unigrams, ...bigrams]) {
          const b = touchBucket(map, t, anchor, "awt-anchors");
          b.metrics.awtAnchorCount = (b.metrics.awtAnchorCount ?? 0) + 1;
        }
      }
      queried.add("awt-anchors");
    } catch (e) { failed.push({ source: "awt-anchors", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // RSS brand mentions
  await (async () => {
    try {
      const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const bundle = await fetchBrandMentions({ query: cleanDomain });
      for (const m of bundle.mentions) {
        const text = `${m.title ?? ""} ${m.snippet ?? ""}`;
        if (!text.trim()) continue;
        const { unigrams, bigrams } = tokenize(text, domainTokens);
        for (const t of [...unigrams, ...bigrams]) {
          const b = touchBucket(map, t, m.title ?? "", "rss-mentions");
          b.metrics.rssMentions = (b.metrics.rssMentions ?? 0) + 1;
        }
      }
      if (bundle.mentions.length > 0) queried.add("rss-mentions");
      else failed.push({ source: "rss-mentions", reason: "No recent mentions found" });
    } catch (e) { failed.push({ source: "rss-mentions", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // Build agenda items
  const all: CouncilAgendaItem[] = [];
  for (const [term, b] of map.entries()) {
    const totalSignal =
      (b.metrics.gscImpressions ?? 0) + (b.metrics.bingAnchorCount ?? 0) + (b.metrics.yandexAnchorCount ?? 0) +
      (b.metrics.awtAnchorCount ?? 0) + (b.metrics.rssMentions ?? 0);
    if (totalSignal < 2 && b.sources.size < 2) continue;
    all.push({
      id: term,
      label: term,
      sublabel: b.sources.size >= 3 ? `${b.sources.size}× sources agree` : undefined,
      sources: [...b.sources].sort(),
      metrics: {
        gscImpressions: b.metrics.gscImpressions,
        gscClicks: b.metrics.gscClicks,
        gscPosition: b.metrics.gscPosition != null ? +b.metrics.gscPosition.toFixed(1) : undefined,
        bingAnchors: b.metrics.bingAnchorCount,
        yandexAnchors: b.metrics.yandexAnchorCount,
        awtAnchors: b.metrics.awtAnchorCount,
        rssMentions: b.metrics.rssMentions,
      },
      score: scoreBucket(b),
      rawVariants: [...b.rawVariants.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([k]) => k),
    });
  }
  all.sort((a, b) => b.score - a.score || b.sources.length - a.sources.length);

  return {
    feature: "keywords",
    featureLabel: "Keyword Council",
    featureTagline: "Which terms appear across GSC, Bing anchors, Yandex anchors, Ahrefs anchors, and news/RSS — cross-source = strong editorial signal.",
    target: domain,
    sourcesQueried: [...queried].sort(),
    sourcesFailed: failed,
    tierTop: all.filter((t) => t.sources.length >= 3).slice(0, 50),
    tierMid: all.filter((t) => t.sources.length === 2).slice(0, 80),
    tierBottom: all.filter((t) => t.sources.length === 1).slice(0, 60),
    totalItems: all.length,
    collectedAt: new Date().toISOString(),
    advisors: KEYWORD_ADVISORS,
  };
}
