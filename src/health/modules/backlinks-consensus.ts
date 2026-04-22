/**
 * Backlinks Consensus producer — which referring DOMAINS are confirmed by
 * multiple backlink data sources, versus which are only reported by one?
 *
 * The backlink-research space is notorious for false positives: any single
 * index (Bing, Yandex, Ahrefs, GSC) has gaps and includes links the other
 * three don't see. Cross-source agreement is the most reliable signal that
 * a given referring domain is actually pointing at you in a way that
 * matters — it's not a stale scrape, not a mirror, and not a flaky one-off.
 *
 * Sources tapped:
 *   - Bing Webmaster Tools inbound links
 *   - Yandex Webmaster inbound links
 *   - Ahrefs Webmaster Tools CSV export
 *   - Google Search Console "top linking sites" CSV export
 *
 * Items are referring domains (not individual URLs — URLs fragment too much
 * across sources). Advisor personas are specific to link strategy:
 *   - link-builder — is this worth outreach / partnership expansion?
 *   - spam-auditor — does the domain look toxic / disavow candidate?
 *   - pr-comms     — is this a brand-press mention worth amplifying?
 *   - technical    — does the link flow / anchor / target page need fixing?
 */

import { fetchBingBacklinks, isBingWmtConfigured } from "../providers/bing-webmaster.js";
import { fetchYandexSites, fetchYandexInboundLinks, isYandexWebmasterConfigured, isYandexConnected } from "../providers/yandex-webmaster.js";
import { loadAwtBundle } from "../providers/ahrefs-webmaster-csv.js";
import { fetchGscLinksBundle } from "../providers/gsc-links-csv.js";
import type { CouncilContext, CouncilAgendaItem, CouncilAdvisor } from "./council-types.js";

const BACKLINK_ADVISORS: CouncilAdvisor[] = [
  { id: "linkBuilder", name: "Link Builder", focus: "Partnership expansion, outreach value, link-earning playbook" },
  { id: "spamAuditor", name: "Spam Auditor", focus: "Toxicity signals, disavow candidacy, penalty risk" },
  { id: "prComms", name: "PR / Comms", focus: "Brand coverage, reputation value, amplification potential" },
  { id: "technical", name: "Technical SEO", focus: "Anchor diversity, target-URL flow, redirect / canonical issues" },
];

/** Normalize any input (URL, host, bare "www.x.com") into a clean host
 *  suitable for cross-source grouping. */
function normalizeHost(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return "";
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

type Bucket = {
  sources: Set<string>;
  links: number; // total link count across all sources (weighted equally)
  anchors: Map<string, number>;
  targetPages: Map<string, number>;
  firstSeen?: string;
  lastSeen?: string;
};

function touch(map: Map<string, Bucket>, host: string, source: string): Bucket {
  let b = map.get(host);
  if (!b) { b = { sources: new Set(), links: 0, anchors: new Map(), targetPages: new Map() }; map.set(host, b); }
  b.sources.add(source);
  return b;
}

function incAnchor(b: Bucket, anchor: string): void {
  const a = (anchor ?? "").trim();
  if (!a) return;
  b.anchors.set(a, (b.anchors.get(a) ?? 0) + 1);
}

function incTarget(b: Bucket, target: string): void {
  const t = (target ?? "").trim();
  if (!t) return;
  b.targetPages.set(t, (b.targetPages.get(t) ?? 0) + 1);
}

function scoreBucket(b: Bucket): number {
  // Backlink consensus: source count is the dominant signal. A domain in 3
  // sources with 1 link each is more credible than one in 1 source with 50
  // links. Magnitude is a tie-breaker.
  const agreement = Math.min(b.sources.size / 4, 1) * 70;
  const magnitude = b.links > 0 ? Math.min(Math.log10(b.links + 1) / 4, 1) * 30 : 0;
  return Math.round(agreement + magnitude);
}

export async function buildBacklinksCouncilContext(domain: string): Promise<CouncilContext> {
  const map = new Map<string, Bucket>();
  const queried = new Set<string>();
  const failed: { source: string; reason: string }[] = [];

  // Bing WMT
  await (async () => {
    try {
      if (!isBingWmtConfigured()) { failed.push({ source: "bing-wmt", reason: "Bing WMT API key not set" }); return; }
      const siteUrl = domain.startsWith("http") ? domain : `https://${domain.replace(/^www\./, "")}`;
      const dp = await fetchBingBacklinks(siteUrl, 500);
      for (const r of dp.value ?? []) {
        const host = normalizeHost(r.sourceUrl);
        if (!host) continue;
        const b = touch(map, host, "bing-wmt");
        b.links++;
        incAnchor(b, r.anchorText ?? "");
        incTarget(b, r.targetUrl);
      }
      queried.add("bing-wmt");
    } catch (e) { failed.push({ source: "bing-wmt", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // Yandex
  await (async () => {
    try {
      const connected = isYandexWebmasterConfigured() || (await isYandexConnected());
      if (!connected) { failed.push({ source: "yandex-wmt", reason: "Yandex not connected" }); return; }
      const sitesDp = await fetchYandexSites();
      const clean = normalizeHost(domain);
      const site = (sitesDp.value ?? []).find((s) => {
        const h = normalizeHost(s.siteUrl);
        return h === clean || clean.endsWith("." + h) || h.endsWith("." + clean);
      });
      if (!site) { failed.push({ source: "yandex-wmt", reason: `No verified Yandex host matches ${domain}` }); return; }
      const linksDp = await fetchYandexInboundLinks(site.hostId, 500);
      for (const l of linksDp.value ?? []) {
        const host = normalizeHost(l.sourceUrl);
        if (!host) continue;
        const b = touch(map, host, "yandex-wmt");
        b.links++;
        incAnchor(b, l.anchorText ?? "");
        incTarget(b, l.targetUrl);
        if (l.firstSeen) {
          if (!b.firstSeen || l.firstSeen < b.firstSeen) b.firstSeen = l.firstSeen;
        }
      }
      queried.add("yandex-wmt");
    } catch (e) { failed.push({ source: "yandex-wmt", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // Ahrefs WMT CSV
  await (async () => {
    try {
      const bundle = await loadAwtBundle(domain);
      if (!bundle) { failed.push({ source: "ahrefs-wmt", reason: "No AWT CSV imported for this domain" }); return; }
      for (const row of bundle.backlinks) {
        const host = normalizeHost(row.referringUrl);
        if (!host) continue;
        const b = touch(map, host, "ahrefs-wmt");
        b.links++;
        incAnchor(b, row.anchorText ?? "");
        incTarget(b, row.targetUrl);
        if (row.firstSeen) {
          if (!b.firstSeen || row.firstSeen < b.firstSeen) b.firstSeen = row.firstSeen;
        }
        if (row.lastCheck) {
          if (!b.lastSeen || row.lastCheck > b.lastSeen) b.lastSeen = row.lastCheck;
        }
      }
      queried.add("ahrefs-wmt");
    } catch (e) { failed.push({ source: "ahrefs-wmt", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // GSC Links CSV — "top linking sites" exported from the GSC UI
  await (async () => {
    try {
      const dp = await fetchGscLinksBundle(domain);
      if (!dp) { failed.push({ source: "gsc-links", reason: "No GSC Links CSV imported for this domain" }); return; }
      const bundle = dp.value;
      if (!bundle || !bundle.topLinkingSites?.length) { failed.push({ source: "gsc-links", reason: "GSC Links bundle empty" }); return; }
      for (const row of bundle.topLinkingSites) {
        const host = normalizeHost(row.source);
        if (!host) continue;
        const b = touch(map, host, "gsc-links");
        b.links += row.links || 1;
      }
      queried.add("gsc-links");
    } catch (e) { failed.push({ source: "gsc-links", reason: e instanceof Error ? e.message : String(e) }); }
  })();

  // Build agenda
  const all: CouncilAgendaItem[] = [];
  for (const [host, b] of map.entries()) {
    const topAnchors = [...b.anchors.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([a]) => a);
    const topTargets = [...b.targetPages.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 2).map(([t]) => t);
    all.push({
      id: host,
      label: host,
      sublabel: `${b.links} link${b.links === 1 ? "" : "s"} · ${b.sources.size}/4 sources`,
      sources: [...b.sources].sort(),
      metrics: {
        linkCount: b.links,
        anchorDiversity: b.anchors.size,
        topTargetPage: topTargets[0],
        firstSeen: b.firstSeen,
        lastSeen: b.lastSeen,
      },
      score: scoreBucket(b),
      rawVariants: topAnchors,
    });
  }
  all.sort((a, b) => b.score - a.score || b.sources.length - a.sources.length);

  return {
    feature: "backlinks",
    featureLabel: "Backlinks Council",
    featureTagline: "Which referring domains are confirmed by multiple backlink indexes — a domain in 3+ sources is far more credible than one seen by a single crawler.",
    target: domain,
    sourcesQueried: [...queried].sort(),
    sourcesFailed: failed,
    tierTop: all.filter((t) => t.sources.length >= 3).slice(0, 60),
    tierMid: all.filter((t) => t.sources.length === 2).slice(0, 80),
    tierBottom: all.filter((t) => t.sources.length === 1).slice(0, 80),
    totalItems: all.length,
    collectedAt: new Date().toISOString(),
    advisors: BACKLINK_ADVISORS,
  };
}
