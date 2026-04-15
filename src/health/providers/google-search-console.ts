/**
 * Google Search Console provider.
 *
 * GSC is the single biggest honesty upgrade on the board: for the user's
 * own verified properties it returns REAL impressions, clicks, CTR, and
 * average position for every query. No estimates, no LLM, no scraping.
 *
 * Every numeric field comes back wrapped in DataPoint<number> with
 * source "google-search-console" and confidence "high" — it's a
 * first-party measurement from Google's own index of what THEY showed
 * the user.
 *
 * Endpoints used:
 *   GET  https://www.googleapis.com/webmasters/v3/sites
 *   POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query
 *
 * Scope: https://www.googleapis.com/auth/webmasters.readonly
 *
 * All calls go through `googleApiFetch()` which handles token refresh
 * and error propagation.
 */

import { googleApiFetch } from "./google-auth.js";
import { dp, type DataPoint } from "./types.js";
import { cacheGet, cacheSet } from "./rate-limit.js";

const PROVIDER = "google-search-console";
const TTL_MS = 10 * 60 * 1000; // 10 minutes — GSC data is already 2-3 days delayed server-side

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

interface SitesResponse {
  siteEntry?: { siteUrl: string; permissionLevel: string }[];
}

/**
 * List every verified property the authenticated user has access to.
 * Includes both `sc-domain:example.com` (domain properties) and
 * `https://www.example.com/` (URL-prefix properties).
 */
export async function listGscSites(): Promise<GscSite[]> {
  const cacheKey = `${PROVIDER}:sites`;
  const cached = cacheGet<GscSite[]>(cacheKey);
  if (cached) return cached;

  const data = await googleApiFetch<SitesResponse>("https://www.googleapis.com/webmasters/v3/sites");
  const sites = (data.siteEntry ?? [])
    .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
    .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
  cacheSet(cacheKey, sites, TTL_MS);
  return sites;
}

export interface GscQueryRow {
  keys: string[];
  clicks: DataPoint<number>;
  impressions: DataPoint<number>;
  ctr: DataPoint<number>;
  position: DataPoint<number>;
}

export interface GscQueryOptions {
  siteUrl: string;
  /** ISO date YYYY-MM-DD. Defaults to 28 days ago. */
  startDate?: string;
  /** ISO date YYYY-MM-DD. Defaults to today. */
  endDate?: string;
  /** "query" | "page" | "country" | "device" | "searchAppearance". Defaults to ["query"]. */
  dimensions?: ("query" | "page" | "country" | "device" | "searchAppearance")[];
  /** Free-text filter on one of the dimensions. */
  filter?: { dimension: "query" | "page"; operator: "contains" | "equals" | "notContains"; expression: string };
  rowLimit?: number;
  startRow?: number;
}

interface RawQueryResponse {
  rows?: {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
  responseAggregationType?: string;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Run a `searchAnalytics.query` against a verified property and return
 * every row with its numeric fields wrapped in DataPoint.
 *
 * GSC data is always 2-3 days delayed on Google's side. We note this in
 * the DataPoint.note so the UI can disclose it.
 */
export async function queryGscAnalytics(opts: GscQueryOptions): Promise<GscQueryRow[]> {
  const startDate = opts.startDate ?? daysAgo(28);
  const endDate = opts.endDate ?? daysAgo(3);
  const dimensions = opts.dimensions ?? ["query"];
  const rowLimit = Math.min(opts.rowLimit ?? 100, 25000);

  const cacheKey = `${PROVIDER}:q:${opts.siteUrl}:${startDate}:${endDate}:${dimensions.join(",")}:${opts.filter?.expression ?? ""}:${rowLimit}:${opts.startRow ?? 0}`;
  const cached = cacheGet<GscQueryRow[]>(cacheKey);
  if (cached) return cached;

  const body: Record<string, unknown> = {
    startDate,
    endDate,
    dimensions,
    rowLimit,
    startRow: opts.startRow ?? 0,
    dataState: "final",
  };
  if (opts.filter) {
    body.dimensionFilterGroups = [
      {
        filters: [
          {
            dimension: opts.filter.dimension,
            operator: opts.filter.operator,
            expression: opts.filter.expression,
          },
        ],
      },
    ];
  }

  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(opts.siteUrl)}/searchAnalytics/query`;
  const data = await googleApiFetch<RawQueryResponse>(url, { method: "POST", body });

  const note = `GSC · ${startDate} → ${endDate} · first-party, ~2-day delay`;
  const rows: GscQueryRow[] = (data.rows ?? []).map((r) => ({
    keys: r.keys ?? [],
    clicks: dp<number>(r.clicks ?? 0, PROVIDER, "high", TTL_MS, note),
    impressions: dp<number>(r.impressions ?? 0, PROVIDER, "high", TTL_MS, note),
    ctr: dp<number>(+(r.ctr * 100).toFixed(2), PROVIDER, "high", TTL_MS, `${note} · percent`),
    position: dp<number>(+r.position.toFixed(1), PROVIDER, "high", TTL_MS, `${note} · average SERP position`),
  }));
  cacheSet(cacheKey, rows, TTL_MS);
  return rows;
}

export interface GscKeywordStats {
  siteUrl: string;
  keyword: string;
  clicks: DataPoint<number>;
  impressions: DataPoint<number>;
  ctr: DataPoint<number>;
  /** Average SERP position across the query window. First-party from Google. */
  position: DataPoint<number>;
  /** Date window end. */
  asOf: string;
}

/**
 * Look up real GSC stats for a specific keyword on a specific site.
 * Returns null if the site has no impressions for that exact query in
 * the window — caller should fall back to DDG scrape position or mark
 * the field missing rather than inventing a number.
 */
export async function getGscKeywordStats(
  siteUrl: string,
  keyword: string,
  daysBack = 28,
): Promise<GscKeywordStats | null> {
  const clean = keyword.trim();
  if (!clean) return null;
  const endDate = daysAgo(3);
  const startDate = daysAgo(3 + daysBack);

  const rows = await queryGscAnalytics({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["query"],
    filter: { dimension: "query", operator: "equals", expression: clean.toLowerCase() },
    rowLimit: 1,
  });
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    siteUrl,
    keyword: r.keys[0] ?? clean,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
    asOf: endDate,
  };
}

export interface GscPageStats {
  siteUrl: string;
  page: string;
  clicks: DataPoint<number>;
  impressions: DataPoint<number>;
  ctr: DataPoint<number>;
  position: DataPoint<number>;
  asOf: string;
}

/**
 * Look up real GSC stats for a specific URL (page-level totals). Used by
 * Content Audit to overlay real search traffic on top of the deterministic
 * quality score.
 */
export async function getGscPageStats(
  siteUrl: string,
  pageUrl: string,
  daysBack = 28,
): Promise<GscPageStats | null> {
  const clean = pageUrl.trim();
  if (!clean) return null;
  const endDate = daysAgo(3);
  const startDate = daysAgo(3 + daysBack);

  const rows = await queryGscAnalytics({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["page"],
    filter: { dimension: "page", operator: "equals", expression: clean },
    rowLimit: 1,
  });
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    siteUrl,
    page: r.keys[0] ?? clean,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
    asOf: endDate,
  };
}

/**
 * Batch version — run one `page` dimension query and return a map keyed
 * by page URL. Used by Content Audit to avoid N round trips.
 */
export async function getGscPageStatsBatch(
  siteUrl: string,
  daysBack = 28,
  rowLimit = 500,
): Promise<Map<string, GscPageStats>> {
  const endDate = daysAgo(3);
  const startDate = daysAgo(3 + daysBack);
  const rows = await queryGscAnalytics({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["page"],
    rowLimit,
  });
  const map = new Map<string, GscPageStats>();
  for (const r of rows) {
    const page = r.keys[0];
    if (!page) continue;
    map.set(page, {
      siteUrl,
      page,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      asOf: endDate,
    });
  }
  return map;
}
