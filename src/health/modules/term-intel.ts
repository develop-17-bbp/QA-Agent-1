/**
 * Term Intel — universal cross-source lookup for ANY term.
 *
 * Input: a free-text term (keyword, topic, entity — e.g. "surgery", "nwface.com",
 * "core web vitals"). Output: every configured data source's perspective on
 * that term, presented as a list of SourcePerspective cards with a headline
 * metric + an expandable detail payload for the UI to render in accordions.
 *
 * This is the "give me all context you have about X" shape the product was
 * missing. Individual features (Keyword Overview, Brand Monitor, SERP
 * Analyzer) each touch 1-3 sources; Term Intel touches every source we have
 * credentials for, in parallel, with per-source try/catch so missing
 * integrations degrade gracefully.
 *
 * Consumed by POST /api/term-intel. The endpoint wraps this output in a
 * single-item CouncilContext (one agenda item = the term itself; its
 * sources[] = every source that returned data) so the generic council-
 * runner can deliver 4-advisor AI verdicts on top of the raw data.
 */

import { fetchKeywordTrend } from "../providers/google-trends.js";
import { fetchSuggestions, fetchQuestionSuggestions } from "../providers/google-suggest.js";
import { fetchBestMatchPageviews } from "../providers/wikipedia-pageviews.js";
import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { ddgRegionCode } from "../providers/geo-targets.js";
import { fetchKeywordVolume as fetchAdsVolume, isGoogleAdsConfigured } from "../providers/google-ads.js";
import { queryGscAnalytics, listGscSites, type GscSite } from "../providers/google-search-console.js";
import { getConnectionStatus } from "../providers/google-auth.js";
import { fetchBingBacklinks, isBingWmtConfigured } from "../providers/bing-webmaster.js";
import { fetchYandexSites, fetchYandexInboundLinks, isYandexWebmasterConfigured, isYandexConnected } from "../providers/yandex-webmaster.js";
import { loadAwtBundle } from "../providers/ahrefs-webmaster-csv.js";
import { fetchBrandMentions } from "../providers/rss-aggregator.js";
import { searchStartpage } from "../providers/startpage-serp.js";
import { fetchDfsBacklinksSummary, fetchDfsTopAnchors, fetchDfsKeywordVolume, isDfsConfigured } from "../providers/dataforseo.js";

export type SourceStatus = "ok" | "no-data" | "not-configured" | "error";

export interface SourcePerspective {
  /** Stable id — used as a React key and a chip label. */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Category grouping for the UI. */
  category: "volume" | "editorial" | "anchor" | "serp" | "topic";
  status: SourceStatus;
  /** One-sentence headline with a number the user cares about. */
  headline: string;
  /** Small top-right metric shown in the card header (e.g. "5,400/mo"). */
  metric?: string;
  /** Structured detail payload rendered in the accordion body. Each variant
   *  is a render hint for the UI. */
  detail?:
    | { kind: "table"; columns: string[]; rows: (string | number)[][] }
    | { kind: "list"; items: string[] }
    | { kind: "serp"; results: { position: number; url: string; title: string }[] }
    | { kind: "trend"; monthly: number[] }
    | { kind: "text"; text: string };
  /** Reason surfaced for "not-configured" / "error" / "no-data" states. */
  reason?: string;
}

export interface TermIntelResult {
  term: string;
  region: string;
  fetchedAt: string;
  perSource: SourcePerspective[];
  /** Source ids that returned data (useful for council scoring). */
  sourcesHit: string[];
  /** Source ids that errored or weren't configured. */
  sourcesMissed: string[];
}

export interface TermIntelInput {
  term: string;
  region?: string;
  /** Optional domain — when provided, anchor sources and GSC lookups filter to it. */
  domain?: string;
}

// ── Helper ───────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
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

// ── Per-source probes ────────────────────────────────────────────────────

async function probeAds(term: string, region: string): Promise<SourcePerspective> {
  if (!isGoogleAdsConfigured()) {
    return { id: "google-ads", name: "Google Ads volume", category: "volume", status: "not-configured", headline: "Google Ads Keyword Planner not connected", reason: "Connect Google via /integrations to unlock exact monthly search volumes." };
  }
  try {
    const results = await fetchAdsVolume([term], region);
    const r = results[0];
    if (!r || r.avgMonthlySearches.value == null) {
      return { id: "google-ads", name: "Google Ads volume", category: "volume", status: "no-data", headline: "Google has no search-volume data for this term", reason: "Ads API returned no volume (could be too-long-tail or non-searchable)." };
    }
    const vol = r.avgMonthlySearches.value;
    const monthlyRows = (r.monthlyBreakdown?.value ?? []).slice(-12).map((m) => [`${m.year}-${String(m.month).padStart(2, "0")}`, m.searches] as [string, number]);
    return {
      id: "google-ads",
      name: "Google Ads volume",
      category: "volume",
      status: "ok",
      metric: `${fmt(vol)}/mo`,
      headline: `${vol.toLocaleString()} average monthly searches in ${region}`,
      detail: monthlyRows.length > 0
        ? { kind: "table", columns: ["Month", "Searches"], rows: monthlyRows }
        : { kind: "text", text: `Competition: ${r.competition.value ?? "unknown"} (index ${r.competitionIndex.value ?? "—"})` },
    };
  } catch (e) {
    return { id: "google-ads", name: "Google Ads volume", category: "volume", status: "error", headline: "Google Ads query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "unknown error" };
  }
}

async function probeTrends(term: string, region: string): Promise<SourcePerspective> {
  try {
    const t = await fetchKeywordTrend(term, region === "US" ? "" : region);
    const series = (t?.trend12mo?.value ?? []).map((p) => p.value);
    if (series.length === 0) {
      return { id: "google-trends", name: "Google Trends", category: "topic", status: "no-data", headline: "Google Trends has no data for this term" };
    }
    const recent = series.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, series.slice(-3).length);
    const priorWindow = series.slice(-12, -3);
    const prior = priorWindow.reduce((a, b) => a + b, 0) / Math.max(1, priorWindow.length);
    const delta = prior > 0 ? ((recent - prior) / prior) * 100 : 0;
    const direction = delta > 10 ? "rising" : delta < -10 ? "falling" : "stable";
    return {
      id: "google-trends",
      name: "Google Trends",
      category: "topic",
      status: "ok",
      metric: direction === "rising" ? "↑" : direction === "falling" ? "↓" : "→",
      headline: `Interest over last 12 months is ${direction}${delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta.toFixed(0)}% recent vs prior)` : ""}`,
      detail: { kind: "trend", monthly: series },
    };
  } catch (e) {
    return { id: "google-trends", name: "Google Trends", category: "topic", status: "error", headline: "Google Trends throttled or errored", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeSuggest(term: string): Promise<SourcePerspective> {
  try {
    const [s, q] = await Promise.all([
      fetchSuggestions(term).catch(() => null),
      fetchQuestionSuggestions(term).catch(() => null),
    ]);
    const suggestions = s?.value ?? [];
    const questions = q?.value ?? [];
    const total = suggestions.length + questions.length;
    if (total === 0) {
      return { id: "google-suggest", name: "Google Suggest", category: "editorial", status: "no-data", headline: "Autocomplete has no completions for this term" };
    }
    return {
      id: "google-suggest",
      name: "Google Suggest",
      category: "editorial",
      status: "ok",
      metric: `${total} results`,
      headline: `${suggestions.length} autocomplete suggestion(s) and ${questions.length} question(s) from Google`,
      detail: { kind: "list", items: [...suggestions.slice(0, 20), ...questions.slice(0, 20).map((x) => `❓ ${x}`)] },
    };
  } catch (e) {
    return { id: "google-suggest", name: "Google Suggest", category: "editorial", status: "error", headline: "Autocomplete query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeWikipedia(term: string): Promise<SourcePerspective> {
  try {
    const r = await fetchBestMatchPageviews([term]);
    if (!r || !r.value || r.value === 0) {
      return { id: "wikipedia", name: "Wikipedia pageviews", category: "topic", status: "no-data", headline: "No Wikipedia article matched this term" };
    }
    return {
      id: "wikipedia",
      name: "Wikipedia pageviews",
      category: "topic",
      status: "ok",
      metric: `${fmt(r.value)} views`,
      headline: `${r.value.toLocaleString()} views on the best-matching Wikipedia article (last 60d)`,
      detail: { kind: "text", text: r.note ?? "Pageviews from Wikipedia's pageviews API — a proxy for topic-level interest." },
    };
  } catch (e) {
    return { id: "wikipedia", name: "Wikipedia pageviews", category: "topic", status: "error", headline: "Wikipedia pageviews query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeGsc(term: string, domain: string | undefined): Promise<SourcePerspective> {
  try {
    const auth = await getConnectionStatus();
    if (!auth.connected) return { id: "gsc", name: "Google Search Console", category: "editorial", status: "not-configured", headline: "Google not connected", reason: "Connect Google in /integrations to see your own site's clicks/impressions for this query." };
    const sites = await listGscSites();
    if (!sites || sites.length === 0) return { id: "gsc", name: "Google Search Console", category: "editorial", status: "no-data", headline: "No verified GSC properties on this Google account" };
    // Pick the site matching the domain if provided, else query the first site.
    const site = domain ? findMatchingGscSite(sites, domain) : sites[0];
    if (!site) return { id: "gsc", name: "Google Search Console", category: "editorial", status: "no-data", headline: `No verified GSC site matches "${domain}"` };
    const endDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = await queryGscAnalytics({
      siteUrl: site.siteUrl, startDate, endDate, dimensions: ["query"], rowLimit: 500,
      filter: { dimension: "query", operator: "contains", expression: term },
    });
    if (rows.length === 0) return { id: "gsc", name: "Google Search Console", category: "editorial", status: "no-data", headline: `No GSC queries containing "${term}" in the last 28 days` };
    const totalImp = rows.reduce((s, r) => s + (r.impressions.value ?? 0), 0);
    const totalClicks = rows.reduce((s, r) => s + (r.clicks.value ?? 0), 0);
    return {
      id: "gsc",
      name: "Google Search Console",
      category: "editorial",
      status: "ok",
      metric: `${fmt(totalImp)} imp`,
      headline: `${rows.length} queries on ${site.siteUrl} contain this term — ${totalImp.toLocaleString()} impressions, ${totalClicks.toLocaleString()} clicks`,
      detail: {
        kind: "table",
        columns: ["Query", "Impressions", "Clicks", "Avg position"],
        rows: rows.slice(0, 25).map((r) => [r.keys[0] ?? "", r.impressions.value ?? 0, r.clicks.value ?? 0, (r.position.value ?? 0).toFixed(1)]),
      },
    };
  } catch (e) {
    return { id: "gsc", name: "Google Search Console", category: "editorial", status: "error", headline: "GSC query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeBingAnchors(term: string, domain: string | undefined): Promise<SourcePerspective> {
  if (!isBingWmtConfigured()) return { id: "bing-anchors", name: "Bing WMT anchors", category: "anchor", status: "not-configured", headline: "Bing Webmaster Tools not configured", reason: "Add BING_WEBMASTER_API_KEY in /integrations." };
  if (!domain) return { id: "bing-anchors", name: "Bing WMT anchors", category: "anchor", status: "no-data", headline: "Provide a domain to filter anchor text matches", reason: "Anchor search is scoped to a site." };
  try {
    const siteUrl = domain.startsWith("http") ? domain : `https://${domain.replace(/^www\./, "")}`;
    const dp = await fetchBingBacklinks(siteUrl, 500);
    const needle = normalize(term);
    const matches = (dp.value ?? []).filter((r) => r.anchorText && normalize(r.anchorText).includes(needle));
    if (matches.length === 0) return { id: "bing-anchors", name: "Bing WMT anchors", category: "anchor", status: "no-data", headline: `Bing shows 0 inbound anchors containing "${term}" for ${domain}` };
    return {
      id: "bing-anchors",
      name: "Bing WMT anchors",
      category: "anchor",
      status: "ok",
      metric: `${matches.length} anchors`,
      headline: `${matches.length} inbound link${matches.length === 1 ? "" : "s"} to ${domain} anchored with this term (Bing)`,
      detail: {
        kind: "table",
        columns: ["Anchor text", "Source URL", "Target URL"],
        rows: matches.slice(0, 25).map((m) => [m.anchorText ?? "", m.sourceUrl, m.targetUrl]),
      },
    };
  } catch (e) {
    return { id: "bing-anchors", name: "Bing WMT anchors", category: "anchor", status: "error", headline: "Bing WMT query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeYandexAnchors(term: string, domain: string | undefined): Promise<SourcePerspective> {
  const configured = isYandexWebmasterConfigured() || (await isYandexConnected());
  if (!configured) return { id: "yandex-anchors", name: "Yandex WMT anchors", category: "anchor", status: "not-configured", headline: "Yandex Webmaster not configured", reason: "Connect Yandex via /integrations." };
  if (!domain) return { id: "yandex-anchors", name: "Yandex WMT anchors", category: "anchor", status: "no-data", headline: "Provide a domain to filter anchor text matches" };
  try {
    const sitesDp = await fetchYandexSites();
    const clean = normalize(domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
    const site = (sitesDp.value ?? []).find((s) => {
      try {
        const h = new URL(s.siteUrl.startsWith("http") ? s.siteUrl : `https://${s.siteUrl}`).hostname.toLowerCase().replace(/^www\./, "");
        return h === clean || clean.endsWith("." + h) || h.endsWith("." + clean);
      } catch { return s.siteUrl.toLowerCase().includes(clean); }
    });
    if (!site) return { id: "yandex-anchors", name: "Yandex WMT anchors", category: "anchor", status: "no-data", headline: `No verified Yandex host matches "${domain}"` };
    const linksDp = await fetchYandexInboundLinks(site.hostId, 500);
    const needle = normalize(term);
    const matches = (linksDp.value ?? []).filter((l) => l.anchorText && normalize(l.anchorText).includes(needle));
    if (matches.length === 0) return { id: "yandex-anchors", name: "Yandex WMT anchors", category: "anchor", status: "no-data", headline: `Yandex shows 0 inbound anchors containing "${term}" for ${domain}` };
    return {
      id: "yandex-anchors",
      name: "Yandex WMT anchors",
      category: "anchor",
      status: "ok",
      metric: `${matches.length} anchors`,
      headline: `${matches.length} inbound Yandex anchor${matches.length === 1 ? "" : "s"} to ${domain} mentioning this term`,
      detail: {
        kind: "table",
        columns: ["Anchor text", "Source URL", "Target URL"],
        rows: matches.slice(0, 25).map((m) => [m.anchorText ?? "", m.sourceUrl, m.targetUrl]),
      },
    };
  } catch (e) {
    return { id: "yandex-anchors", name: "Yandex WMT anchors", category: "anchor", status: "error", headline: "Yandex WMT query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeAhrefsCsv(term: string, domain: string | undefined): Promise<SourcePerspective> {
  if (!domain) return { id: "ahrefs-anchors", name: "Ahrefs WMT CSV anchors", category: "anchor", status: "no-data", headline: "Provide a domain to scan its Ahrefs CSV" };
  try {
    const bundle = await loadAwtBundle(domain);
    if (!bundle) return { id: "ahrefs-anchors", name: "Ahrefs WMT CSV anchors", category: "anchor", status: "not-configured", headline: `No Ahrefs CSV imported for ${domain}`, reason: "Upload Ahrefs Webmaster Tools backlinks CSV at /backlinks." };
    const needle = normalize(term);
    const matches = bundle.backlinks.filter((b) => b.anchorText && normalize(b.anchorText).includes(needle));
    if (matches.length === 0) return { id: "ahrefs-anchors", name: "Ahrefs WMT CSV anchors", category: "anchor", status: "no-data", headline: `Ahrefs CSV has 0 anchors containing "${term}"` };
    return {
      id: "ahrefs-anchors",
      name: "Ahrefs WMT CSV anchors",
      category: "anchor",
      status: "ok",
      metric: `${matches.length} anchors`,
      headline: `${matches.length} Ahrefs-reported backlink${matches.length === 1 ? "" : "s"} to ${domain} anchored with this term`,
      detail: {
        kind: "table",
        columns: ["Anchor text", "Referring URL", "DR", "Target"],
        rows: matches.slice(0, 25).map((m) => [m.anchorText ?? "", m.referringUrl, m.referringDomainRating ?? "", m.targetUrl]),
      },
    };
  } catch (e) {
    return { id: "ahrefs-anchors", name: "Ahrefs WMT CSV anchors", category: "anchor", status: "error", headline: "Ahrefs CSV scan failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeRss(term: string): Promise<SourcePerspective> {
  try {
    const bundle = await fetchBrandMentions({ query: term });
    if (!bundle || bundle.mentions.length === 0) {
      return { id: "rss-mentions", name: "News + RSS mentions", category: "editorial", status: "no-data", headline: "No recent articles/posts mentioning this term", reason: bundle ? `Queried: ${bundle.providersHit.join(", ") || "none"}` : undefined };
    }
    return {
      id: "rss-mentions",
      name: "News + RSS mentions",
      category: "editorial",
      status: "ok",
      metric: `${bundle.mentions.length} posts`,
      headline: `${bundle.mentions.length} recent mention${bundle.mentions.length === 1 ? "" : "s"} across ${bundle.providersHit.length} source${bundle.providersHit.length === 1 ? "" : "s"} (Google News + Reddit + HN + GDELT…)`,
      detail: {
        kind: "table",
        columns: ["Source", "Title", "Published", "URL"],
        rows: bundle.mentions.slice(0, 30).map((m) => [m.source, m.title, m.publishedAt ?? "", m.url]),
      },
    };
  } catch (e) {
    return { id: "rss-mentions", name: "News + RSS mentions", category: "editorial", status: "error", headline: "RSS aggregator failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeDdgSerp(term: string, region: string): Promise<SourcePerspective> {
  try {
    const resp = await searchSerp(term, ddgRegionCode(region));
    if (!resp.results || resp.results.length === 0) {
      return { id: "ddg-serp", name: "DuckDuckGo SERP", category: "serp", status: "no-data", headline: "DDG returned no results (rare — usually rate-limit or CAPTCHA)" };
    }
    return {
      id: "ddg-serp",
      name: "DuckDuckGo SERP",
      category: "serp",
      status: "ok",
      metric: `top ${resp.results.length}`,
      headline: `Top ${resp.results.length} editorial competitors ranking for this term`,
      detail: { kind: "serp", results: resp.results.slice(0, 10).map((r) => ({ position: r.position, url: r.url, title: r.title })) },
    };
  } catch (e) {
    return { id: "ddg-serp", name: "DuckDuckGo SERP", category: "serp", status: "error", headline: "DDG SERP query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function probeStartpage(term: string, region: string): Promise<SourcePerspective> {
  try {
    const dp = await searchStartpage(term, region === "US" ? "US" : region);
    const v = dp.value;
    if (!v || !v.results || v.results.length === 0) {
      return { id: "startpage-serp", name: "Startpage (Google proxy)", category: "serp", status: "no-data", headline: "Startpage returned no results" };
    }
    return {
      id: "startpage-serp",
      name: "Startpage (Google proxy)",
      category: "serp",
      status: "ok",
      metric: `top ${v.results.length}`,
      headline: `Top ${v.results.length} Google-proxy results (Startpage, ~0.9 correlation with real Google)`,
      detail: { kind: "serp", results: v.results.slice(0, 10).map((r) => ({ position: r.position, url: r.url, title: r.title })) },
    };
  } catch (e) {
    return { id: "startpage-serp", name: "Startpage (Google proxy)", category: "serp", status: "error", headline: "Startpage SERP failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

/** DataForSEO volume probe — global keyword volume for any region. This
 *  complements Google Ads: works without the operator connecting Google
 *  OAuth, and gives coverage in regions where Ads isn't set up. Requires
 *  BYOK DataForSEO credentials. */
async function probeDfsKeywordVolume(term: string, region: string): Promise<SourcePerspective> {
  if (!isDfsConfigured()) {
    return { id: "dataforseo-volume", name: "DataForSEO volume", category: "volume", status: "not-configured", headline: "DataForSEO not configured (paid BYOK)", reason: "Paste DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD in /integrations — typical spend $20-50/mo." };
  }
  try {
    const regionName = region === "US" ? "United States" : region === "GB" ? "United Kingdom" : region === "IN" ? "India" : region;
    const rows = await fetchDfsKeywordVolume([term], regionName);
    const r = rows[0];
    const v = r?.searchVolume?.value;
    if (!r || v == null) {
      return { id: "dataforseo-volume", name: "DataForSEO volume", category: "volume", status: "no-data", headline: "DataForSEO has no volume data for this term" };
    }
    return {
      id: "dataforseo-volume",
      name: "DataForSEO volume",
      category: "volume",
      status: "ok",
      metric: `${fmt(v)}/mo`,
      headline: `${v.toLocaleString()} monthly searches (DataForSEO, ${regionName})`,
      detail: { kind: "text", text: `CPC: ${typeof r.cpc?.value === "number" ? `$${r.cpc.value.toFixed(2)}` : "—"} · Competition: ${typeof r.competition?.value === "number" ? r.competition.value.toFixed(2) : "—"}` },
    };
  } catch (e) {
    return { id: "dataforseo-volume", name: "DataForSEO volume", category: "volume", status: "error", headline: "DataForSEO volume query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

/** DataForSEO backlinks probe — competitor-grade backlink index for any
 *  domain. Fires when the term looks like a domain (contains a dot) OR
 *  when a domain is explicitly provided. */
async function probeDfsBacklinks(term: string, domain: string | undefined): Promise<SourcePerspective> {
  if (!isDfsConfigured()) {
    return { id: "dataforseo-backlinks", name: "DataForSEO backlinks", category: "anchor", status: "not-configured", headline: "DataForSEO not configured (paid BYOK)", reason: "Closes the competitor-backlinks gap that free-tier sources have. Connect in /integrations." };
  }
  const targetDomain = domain || (term.includes(".") && !term.includes(" ") ? term : undefined);
  if (!targetDomain) {
    return { id: "dataforseo-backlinks", name: "DataForSEO backlinks", category: "anchor", status: "no-data", headline: "Enter a domain (or term is not a domain)", reason: "Backlinks probe requires a domain target." };
  }
  try {
    const [summary, anchors] = await Promise.all([
      fetchDfsBacklinksSummary(targetDomain),
      // For anchor table, only fetch when the term looks like a keyword (so we
      // can filter for term-matched anchors); otherwise skip to save calls.
      term.includes(".") ? Promise.resolve(null) : fetchDfsTopAnchors(targetDomain, 100).catch(() => null),
    ]);
    const referring = summary.referringDomains.value;
    const dofollow = summary.dofollow.value;
    const nofollow = summary.nofollow.value;
    const needle = term.toLowerCase().trim();
    const matched = anchors?.value ? anchors.value.filter((a) => a.anchor.toLowerCase().includes(needle)) : [];
    const metricLine = matched.length > 0
      ? `${matched.length} anchor${matched.length === 1 ? "" : "s"} match "${term}"`
      : `${referring.toLocaleString()} referring domains total`;
    const headline = term.includes(".")
      ? `${referring.toLocaleString()} referring domains to ${targetDomain} (${dofollow.toLocaleString()} dofollow / ${nofollow.toLocaleString()} nofollow)`
      : matched.length > 0
        ? `${matched.length} backlink anchor${matched.length === 1 ? "" : "s"} on ${targetDomain} contain "${term}"`
        : `0 anchors on ${targetDomain} mention "${term}" (scanned ${anchors?.value?.length ?? 0} top anchors)`;
    const detail = matched.length > 0
      ? { kind: "table" as const, columns: ["Anchor", "Referring domains", "Backlinks"], rows: matched.slice(0, 25).map((a) => [a.anchor, a.referringDomains, a.backlinks] as (string | number)[]) }
      : { kind: "text" as const, text: `DataForSEO live index: ${summary.backlinksTotal.value.toLocaleString()} total backlinks across ${referring.toLocaleString()} referring domains. ${typeof summary.domainRank?.value === "number" ? `DR rank ${summary.domainRank.value}.` : ""}` };
    return {
      id: "dataforseo-backlinks",
      name: "DataForSEO backlinks",
      category: "anchor",
      status: "ok",
      metric: metricLine.split(" ").slice(0, 3).join(" "),
      headline,
      detail,
    };
  } catch (e) {
    return { id: "dataforseo-backlinks", name: "DataForSEO backlinks", category: "anchor", status: "error", headline: "DataForSEO query failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

// ── Main entry ────────────────────────────────────────────────────────

/** Build a 1-item CouncilContext around a completed TermIntel result so
 *  the generic council-runner.ts can produce 4-advisor verdicts on the
 *  cross-source picture. Single agenda item = the term; its sources[] are
 *  every source that returned data, so tiering reflects real breadth. */
export function buildTermIntelCouncilContext(r: TermIntelResult, domain?: string) {
  const okSources = r.perSource.filter((p) => p.status === "ok");
  const metricsMap: Record<string, number | string | undefined> = {};
  for (const s of okSources) {
    if (s.metric) metricsMap[s.id] = s.metric;
  }
  const advisors = [
    { id: "content",     name: "Content Strategist",   focus: "Editorial opportunity, intent match, angle that competitors miss" },
    { id: "technical",   name: "Technical SEO",        focus: "Target-URL design, internal linking, structured-data implications" },
    { id: "competitive", name: "Competitive Analyst",  focus: "Who ranks today, anchor-text concentration, brand vs generic mix" },
    { id: "trend",       name: "Trend Analyst",        focus: "Is this rising/falling/stable; seasonality; long-term bet vs quick win" },
  ];
  const agendaItem = {
    id: r.term,
    label: r.term,
    sublabel: `${okSources.length}/${r.perSource.length} sources returned data`,
    sources: okSources.map((s) => s.id).sort(),
    metrics: metricsMap,
    score: Math.min(100, 10 * okSources.length),
    rawVariants: okSources.slice(0, 3).map((s) => s.headline),
  };
  const tierTop = okSources.length >= 3 ? [agendaItem] : [];
  const tierMid = okSources.length === 2 ? [agendaItem] : [];
  const tierBottom = okSources.length <= 1 ? [agendaItem] : [];
  return {
    feature: "term-intel",
    featureLabel: "Term Intel Council",
    featureTagline: `Cross-source intelligence for "${r.term}" across every configured data source${domain ? ` (scoped to ${domain})` : ""}. The four advisors weigh in on whether and how to act on it.`,
    target: r.term,
    sourcesQueried: r.sourcesHit,
    sourcesFailed: r.sourcesMissed.map((id) => {
      const src = r.perSource.find((p) => p.id === id);
      return { source: id, reason: src?.reason ?? src?.headline ?? "no data" };
    }),
    tierTop,
    tierMid,
    tierBottom,
    totalItems: 1,
    collectedAt: r.fetchedAt,
    advisors,
  };
}

export async function gatherTermIntel(input: TermIntelInput): Promise<TermIntelResult> {
  const term = input.term.trim();
  const region = (input.region ?? "US").trim().toUpperCase();
  const domain = input.domain?.trim() || undefined;

  // Probe every source in parallel; each returns a SourcePerspective regardless
  // of status (not-configured / no-data / error still appear in the UI).
  const results = await Promise.all([
    probeAds(term, region),
    probeDfsKeywordVolume(term, region),
    probeTrends(term, region),
    probeSuggest(term),
    probeWikipedia(term),
    probeGsc(term, domain),
    probeBingAnchors(term, domain),
    probeYandexAnchors(term, domain),
    probeAhrefsCsv(term, domain),
    probeDfsBacklinks(term, domain),
    probeRss(term),
    probeDdgSerp(term, region),
    probeStartpage(term, region),
  ]);

  const sourcesHit = results.filter((p) => p.status === "ok").map((p) => p.id);
  const sourcesMissed = results.filter((p) => p.status !== "ok").map((p) => p.id);

  return {
    term,
    region,
    fetchedAt: new Date().toISOString(),
    perSource: results,
    sourcesHit,
    sourcesMissed,
  };
}
