/**
 * Bing Webmaster Tools — inbound link list with real anchor text for the
 * user's OWN verified site. The single biggest free-tier win for backlink
 * intelligence: Bing ships its live link graph for sites you've verified.
 *
 * Setup:
 *   1. Sign up at https://www.bing.com/webmasters/
 *   2. Add + verify your site (DNS record, XML file, or meta tag)
 *   3. Settings → API Access → generate an API key
 *   4. Set BING_WEBMASTER_API_KEY in .env
 *
 * Free: no monthly quota published, soft-limit ~10 req/sec per key. 100k links
 * per site per call (we cap the client side at 500 to keep payloads sane).
 *
 * Docs: https://learn.microsoft.com/en-us/bingwebmaster/
 * Endpoints used:
 *   GET https://ssl.bing.com/webmaster/api.svc/json/GetLinkCounts?siteUrl=&apikey=
 *   GET https://ssl.bing.com/webmaster/api.svc/json/GetUrlLinks?siteUrl=&page=0&apikey=
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "bing-webmaster";
registerLimit(PROVIDER, 10, 1_000);
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — Bing refreshes its link graph daily

function resolveKey(): string | undefined {
  return process.env.BING_WEBMASTER_API_KEY?.trim();
}

export function isBingWmtConfigured(): boolean {
  return !!resolveKey();
}

export interface BingLinkRow {
  /** URL of the external page that links to us. */
  sourceUrl: string;
  /** The target page on our site that receives the link. */
  targetUrl: string;
  /** Anchor text of the <a> tag on the source page, when Bing returns it. */
  anchorText?: string;
}

interface GetUrlLinksResponse {
  d?: Array<{
    Url?: string;
    SourceUrl?: string;
    AnchorText?: string;
    [k: string]: unknown;
  }>;
}

interface GetLinkCountsResponse {
  d?: {
    TotalLinks?: number;
    Urls?: Array<{ Url?: string; Count?: number }>;
  };
}

function normalizeSiteUrl(site: string): string {
  const t = site.trim();
  if (!t) return "";
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  return `https://${t}`;
}

/**
 * Get the total inbound-link count + top linked pages for a verified site.
 * Returns undefined if Bing doesn't recognize the site or the key is invalid.
 */
export async function fetchBingLinkCounts(siteUrl: string): Promise<DataPoint<{
  totalLinks: number;
  topLinkedPages: { url: string; count: number }[];
}> | undefined> {
  const site = normalizeSiteUrl(siteUrl);
  if (!site) throw new ProviderError(PROVIDER, "Empty siteUrl");
  const key = resolveKey();
  if (!key) throw new ProviderError(PROVIDER, "BING_WEBMASTER_API_KEY not set");

  const cacheKey = `${PROVIDER}:counts:${site}`;
  const cached = cacheGet<{ totalLinks: number; topLinkedPages: { url: string; count: number }[] } | "miss">(cacheKey);
  if (cached === "miss") return undefined;
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) throw new ProviderError(PROVIDER, "Rate limit exhausted");

  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetLinkCounts?siteUrl=${encodeURIComponent(site)}&apikey=${encodeURIComponent(key)}`;
  const res = await httpGet(url, { timeoutMs: 20_000 });
  if (!res) throw new ProviderError(PROVIDER, "Network error");
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(PROVIDER, "401/403: key invalid or site not verified in Bing Webmaster Tools");
  }
  if (res.status === 404) {
    cacheSet(cacheKey, "miss", TTL_MS);
    return undefined;
  }
  if (!res.ok) throw new ProviderError(PROVIDER, `HTTP ${res.status}`);

  let data: GetLinkCountsResponse;
  try { data = (await res.json()) as GetLinkCountsResponse; } catch { throw new ProviderError(PROVIDER, "Invalid JSON"); }

  const totalLinks = Number(data.d?.TotalLinks ?? 0);
  const topLinkedPages = (data.d?.Urls ?? [])
    .map((u) => ({ url: String(u.Url ?? ""), count: Number(u.Count ?? 0) }))
    .filter((x) => x.url && Number.isFinite(x.count))
    .slice(0, 20);

  const out = { totalLinks, topLinkedPages };
  cacheSet(cacheKey, out, TTL_MS);
  return dp(out, PROVIDER, "high", TTL_MS, "Bing live link graph for verified site");
}

/**
 * Fetch the actual inbound-link list for a verified site, paginated. Returns
 * up to `cap` rows (default 500). Each row has sourceUrl + anchorText when
 * Bing provides them.
 */
export async function fetchBingBacklinks(siteUrl: string, cap = 500): Promise<DataPoint<BingLinkRow[]>> {
  const site = normalizeSiteUrl(siteUrl);
  if (!site) throw new ProviderError(PROVIDER, "Empty siteUrl");
  const key = resolveKey();
  if (!key) throw new ProviderError(PROVIDER, "BING_WEBMASTER_API_KEY not set");

  const cacheKey = `${PROVIDER}:links:${site}:${cap}`;
  const cached = cacheGet<BingLinkRow[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  const out: BingLinkRow[] = [];
  const pageSize = 100;           // Bing returns up to 100 per page
  const maxPages = Math.ceil(cap / pageSize);

  for (let page = 0; page < maxPages; page++) {
    if (!tryConsume(PROVIDER)) break; // be polite; stop paginating if we hit the local limiter
    const url = `https://ssl.bing.com/webmaster/api.svc/json/GetUrlLinks?siteUrl=${encodeURIComponent(site)}&page=${page}&apikey=${encodeURIComponent(key)}`;
    const res = await httpGet(url, { timeoutMs: 20_000 });
    if (!res) break;
    if (res.status === 401 || res.status === 403) throw new ProviderError(PROVIDER, "401/403: key invalid or site not verified");
    if (!res.ok) break;
    let data: GetUrlLinksResponse;
    try { data = (await res.json()) as GetUrlLinksResponse; } catch { break; }
    const rows = data.d ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const sourceUrl = String(r.SourceUrl ?? "");
      const targetUrl = String(r.Url ?? "");
      const anchorText = typeof r.AnchorText === "string" && r.AnchorText.trim() ? r.AnchorText.trim() : undefined;
      if (sourceUrl && targetUrl) {
        out.push({ sourceUrl, targetUrl, anchorText });
      }
    }
    if (rows.length < pageSize) break; // last page
    if (out.length >= cap) break;
  }

  cacheSet(cacheKey, out, TTL_MS);
  return dp(out, PROVIDER, "high", TTL_MS, `${out.length} inbound links (Bing Webmaster Tools, verified site)`);
}
