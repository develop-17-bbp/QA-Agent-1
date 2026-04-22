/**
 * Yandex Webmaster Tools — free inbound-link + indexing data for sites
 * verified in Yandex (Russian-language markets, Kazakhstan, Belarus etc.).
 *
 * Yandex has their own crawler with ~300B pages indexed and is the dominant
 * search engine in Russia (60%+ share). If your SEO work includes any
 * .ru / .by / .kz / .ua traffic, this provider gives you first-party data
 * for verified sites, similar to Bing Webmaster Tools for the Microsoft stack.
 *
 * Setup:
 *   1. Sign up at https://webmaster.yandex.com/
 *   2. Verify your site (DNS TXT, HTML file, or meta tag)
 *   3. Create an OAuth app at https://oauth.yandex.com/client/new
 *      - Permissions: "Yandex.Webmaster (use API)"
 *   4. Get a token via the OAuth flow or dev tools
 *   5. Find your numeric Yandex user ID (shown at https://yandex.com/id)
 *   6. Put both in .env:
 *        YANDEX_WEBMASTER_API_KEY=<OAuth token>
 *        YANDEX_WEBMASTER_USER_ID=<numeric user id>
 *
 * Free, no monthly cap published. We self-limit to 60 req/min out of caution.
 *
 * Docs: https://yandex.com/dev/webmaster/doc/dg/concepts/about.html
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "yandex-webmaster";
registerLimit(PROVIDER, 60, 60_000);
const TTL_MS = 6 * 60 * 60 * 1000; // 6h — Yandex index refreshes daily

const API_BASE = "https://api.webmaster.yandex.net/v4";

function resolveToken(): string | undefined {
  return process.env.YANDEX_WEBMASTER_API_KEY?.trim();
}

function resolveUserId(): string | undefined {
  return process.env.YANDEX_WEBMASTER_USER_ID?.trim();
}

export function isYandexWebmasterConfigured(): boolean {
  return !!(resolveToken() && resolveUserId());
}

export interface YandexSite {
  hostId: string;
  siteUrl: string;
  verified: boolean;
}

export interface YandexInboundLink {
  sourceUrl: string;
  targetUrl: string;
  anchorText?: string;
  firstSeen?: string;
}

export interface YandexIndexSnapshot {
  indexedPages: number;
  excludedPages: number;
  searchableUrls?: number;
}

type AuthHeaders = { Authorization: string; Accept: string };

function authHeaders(token: string): AuthHeaders {
  return { Authorization: `OAuth ${token}`, Accept: "application/json" };
}

interface SitesListResponse {
  hosts?: Array<{
    host_id?: string;
    ascii_host_url?: string;
    unicode_host_url?: string;
    verified?: boolean;
  }>;
}

/** List every site verified under the user's Yandex account. Useful for the
 *  Connections hub to show "connected as <user>, N sites verified". */
export async function fetchYandexSites(): Promise<DataPoint<YandexSite[]>> {
  const token = resolveToken();
  const userId = resolveUserId();
  if (!token || !userId) throw new ProviderError(PROVIDER, "YANDEX_WEBMASTER_API_KEY + YANDEX_WEBMASTER_USER_ID not set");

  const cacheKey = `${PROVIDER}:sites:${userId}`;
  const cached = cacheGet<YandexSite[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) throw new ProviderError(PROVIDER, "Rate limit exhausted");

  const url = `${API_BASE}/user/${encodeURIComponent(userId)}/hosts`;
  const res = await httpGet(url, { headers: authHeaders(token), timeoutMs: 20_000 });
  if (!res) throw new ProviderError(PROVIDER, "Network error");
  if (res.status === 401 || res.status === 403) throw new ProviderError(PROVIDER, "401/403: invalid token or insufficient OAuth scope");
  if (!res.ok) throw new ProviderError(PROVIDER, `HTTP ${res.status}`);

  let data: SitesListResponse;
  try { data = (await res.json()) as SitesListResponse; }
  catch { throw new ProviderError(PROVIDER, "Invalid JSON"); }

  const sites: YandexSite[] = (data.hosts ?? [])
    .map((h) => ({
      hostId: String(h.host_id ?? ""),
      siteUrl: String(h.ascii_host_url ?? h.unicode_host_url ?? ""),
      verified: h.verified === true,
    }))
    .filter((s) => s.hostId && s.siteUrl);

  cacheSet(cacheKey, sites, TTL_MS);
  return dp(sites, PROVIDER, "high", TTL_MS, "Yandex Webmaster verified host list");
}

interface ExternalLinksResponse {
  links?: Array<{
    source_url?: string;
    target_url?: string;
    anchor?: string;
    first_tracked?: string;
  }>;
  count?: number;
}

/** Fetch inbound backlinks for a verified site. Returns up to `limit` rows
 *  (Yandex default 100, we cap at 1000). */
export async function fetchYandexInboundLinks(hostId: string, limit = 500): Promise<DataPoint<YandexInboundLink[]>> {
  const token = resolveToken();
  const userId = resolveUserId();
  if (!token || !userId) throw new ProviderError(PROVIDER, "YANDEX_WEBMASTER_API_KEY + YANDEX_WEBMASTER_USER_ID not set");
  if (!hostId) throw new ProviderError(PROVIDER, "hostId required — call fetchYandexSites() first");

  const cacheKey = `${PROVIDER}:links:${userId}:${hostId}:${limit}`;
  const cached = cacheGet<YandexInboundLink[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) throw new ProviderError(PROVIDER, "Rate limit exhausted");

  const cap = Math.min(Math.max(limit, 1), 1000);
  const url = `${API_BASE}/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/links/external?limit=${cap}`;
  const res = await httpGet(url, { headers: authHeaders(token), timeoutMs: 30_000 });
  if (!res) throw new ProviderError(PROVIDER, "Network error");
  if (res.status === 401 || res.status === 403) throw new ProviderError(PROVIDER, "401/403: token invalid or host not verified under this account");
  if (res.status === 404) throw new ProviderError(PROVIDER, `Host ${hostId} not found under this Yandex account`);
  if (!res.ok) throw new ProviderError(PROVIDER, `HTTP ${res.status}`);

  let data: ExternalLinksResponse;
  try { data = (await res.json()) as ExternalLinksResponse; }
  catch { throw new ProviderError(PROVIDER, "Invalid JSON"); }

  const links: YandexInboundLink[] = (data.links ?? [])
    .map((l) => ({
      sourceUrl: String(l.source_url ?? ""),
      targetUrl: String(l.target_url ?? ""),
      anchorText: typeof l.anchor === "string" && l.anchor.trim() ? l.anchor.trim() : undefined,
      firstSeen: typeof l.first_tracked === "string" ? l.first_tracked : undefined,
    }))
    .filter((l) => l.sourceUrl && l.targetUrl);

  cacheSet(cacheKey, links, TTL_MS);
  return dp(links, PROVIDER, "high", TTL_MS, `${links.length} inbound links from Yandex index`);
}

interface IndexStatsResponse {
  indexing?: {
    index_count?: number;
    excluded_count?: number;
    searchable_count?: number;
  };
}

/** Indexing snapshot — how many of your pages Yandex currently has. */
export async function fetchYandexIndexSnapshot(hostId: string): Promise<DataPoint<YandexIndexSnapshot>> {
  const token = resolveToken();
  const userId = resolveUserId();
  if (!token || !userId) throw new ProviderError(PROVIDER, "YANDEX_WEBMASTER_API_KEY + YANDEX_WEBMASTER_USER_ID not set");

  const cacheKey = `${PROVIDER}:index:${userId}:${hostId}`;
  const cached = cacheGet<YandexIndexSnapshot>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) throw new ProviderError(PROVIDER, "Rate limit exhausted");

  const url = `${API_BASE}/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/summary`;
  const res = await httpGet(url, { headers: authHeaders(token), timeoutMs: 20_000 });
  if (!res) throw new ProviderError(PROVIDER, "Network error");
  if (!res.ok) throw new ProviderError(PROVIDER, `HTTP ${res.status}`);

  let data: IndexStatsResponse;
  try { data = (await res.json()) as IndexStatsResponse; }
  catch { throw new ProviderError(PROVIDER, "Invalid JSON"); }

  const snap: YandexIndexSnapshot = {
    indexedPages: Number(data.indexing?.index_count ?? 0),
    excludedPages: Number(data.indexing?.excluded_count ?? 0),
    searchableUrls: data.indexing?.searchable_count != null ? Number(data.indexing.searchable_count) : undefined,
  };
  cacheSet(cacheKey, snap, TTL_MS);
  return dp(snap, PROVIDER, "high", TTL_MS, "Yandex index snapshot for verified site");
}
