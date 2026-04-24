/**
 * DataForSEO provider — BYOK backlink + keyword data for any domain.
 *
 * DataForSEO is the cheapest paid-API alternative to Ahrefs ($500/mo) and
 * Semrush ($200+/mo). Typical spend is $20-50/mo for moderate use. The
 * customer brings their own credentials (login + password stored in
 * runtime-keys or .env); QA-Agent reads those and calls the vendor
 * directly — no proxy, no markup.
 *
 * This provider ships three endpoints, each the minimum needed to close
 * a specific gap vs SEMrush:
 *
 *   - fetchDfsBacklinksSummary(domain) — referring-domain count +
 *     dofollow/nofollow split + DR anchor distribution for ANY domain
 *     (competitor or your own), not just verified sites. Closes the
 *     "backlinks for competitors" gap that free-tier sources have.
 *
 *   - fetchDfsTopAnchors(domain, limit) — most-used anchor texts +
 *     their referring-domain counts. Used by Term Intel to surface
 *     anchor competition for any term × any domain.
 *
 *   - fetchDfsKeywordVolume(keywords, region) — global monthly volume
 *     + CPC + competition from DataForSEO's keyword database. Covers
 *     regions where Google Ads OAuth isn't set up.
 *
 * Auth uses HTTP Basic with DATAFORSEO_LOGIN:DATAFORSEO_PASSWORD.
 * Endpoints are in the /v3/ REST family. All calls wrapped in dp() so
 * the Council framework can treat the values as first-party DataPoints.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";
import { getByokConfig } from "./byok-config.js";

const PROVIDER = "dataforseo";
// DataForSEO allows 2000 requests/minute on standard plans. We cap low
// locally so accidental loops don't burn a customer's budget.
registerLimit(PROVIDER, 60, 60_000);
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — competitor-facing data, slowish to change

const API_BASE = "https://api.dataforseo.com/v3";

export function isDfsConfigured(): boolean {
  return getByokConfig().dataforseo !== undefined;
}

function authHeader(): string {
  const cfg = getByokConfig().dataforseo;
  if (!cfg) throw new ProviderError(PROVIDER, "DataForSEO not configured (set DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD in /integrations)");
  return `Basic ${Buffer.from(`${cfg.login}:${cfg.password}`).toString("base64")}`;
}

async function dfsPost<T>(path: string, body: unknown): Promise<T> {
  if (!tryConsume(PROVIDER)) throw new ProviderError(PROVIDER, "Local rate limit exhausted (60/min cap)");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(PROVIDER, `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { status_code?: number; status_message?: string; tasks?: unknown[] };
  if (json.status_code && json.status_code !== 20000) {
    throw new ProviderError(PROVIDER, `API error ${json.status_code}: ${json.status_message ?? "unknown"}`);
  }
  return json as T;
}

// ── Backlinks summary ──────────────────────────────────────────────────

export interface DfsBacklinksSummary {
  domain: string;
  referringDomains: DataPoint<number>;
  referringPages: DataPoint<number>;
  backlinksTotal: DataPoint<number>;
  dofollow: DataPoint<number>;
  nofollow: DataPoint<number>;
  referringDomainsDrAvg?: DataPoint<number>;
  /** DataForSEO's own domain authority proxy (0-100). */
  domainRank?: DataPoint<number>;
}

interface DfsBacklinksSummaryResponse {
  tasks?: Array<{
    status_code?: number;
    result?: Array<{
      target?: string;
      referring_domains?: number;
      referring_pages?: number;
      backlinks?: number;
      backlinks_spam_score?: number;
      referring_domains_nofollow?: number;
      rank?: number;
    }>;
  }>;
}

export async function fetchDfsBacklinksSummary(domain: string): Promise<DfsBacklinksSummary> {
  if (!isDfsConfigured()) throw new ProviderError(PROVIDER, "DataForSEO not configured");
  const target = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!target) throw new ProviderError(PROVIDER, "Empty domain");

  const cacheKey = `${PROVIDER}:summary:${target}`;
  const cached = cacheGet<DfsBacklinksSummary>(cacheKey);
  if (cached) return cached;

  const resp = await dfsPost<DfsBacklinksSummaryResponse>(
    "/backlinks/summary/live",
    [{ target, internal_list_limit: 10, backlinks_status_type: "live" }],
  );
  const row = resp.tasks?.[0]?.result?.[0];
  if (!row) throw new ProviderError(PROVIDER, "Empty response from DataForSEO");

  const referringDomains = row.referring_domains ?? 0;
  const referringPages = row.referring_pages ?? 0;
  const backlinksTotal = row.backlinks ?? 0;
  const nofollow = row.referring_domains_nofollow ?? 0;
  const dofollow = Math.max(0, referringDomains - nofollow);
  const note = "DataForSEO /v3/backlinks/summary/live";

  const out: DfsBacklinksSummary = {
    domain: target,
    referringDomains: dp(referringDomains, PROVIDER, "high", TTL_MS, note),
    referringPages: dp(referringPages, PROVIDER, "high", TTL_MS, note),
    backlinksTotal: dp(backlinksTotal, PROVIDER, "high", TTL_MS, note),
    dofollow: dp(dofollow, PROVIDER, "high", TTL_MS, note),
    nofollow: dp(nofollow, PROVIDER, "high", TTL_MS, note),
    domainRank: typeof row.rank === "number" ? dp(row.rank, PROVIDER, "high", TTL_MS, `${note} · DataForSEO rank`) : undefined,
  };
  cacheSet(cacheKey, out, TTL_MS);
  return out;
}

// ── Top anchors ────────────────────────────────────────────────────────

export interface DfsAnchorRow {
  anchor: string;
  referringDomains: number;
  backlinks: number;
  firstSeen?: string;
}

interface DfsAnchorsResponse {
  tasks?: Array<{
    status_code?: number;
    result?: Array<{
      items?: Array<{
        anchor?: string;
        referring_domains?: number;
        backlinks?: number;
        first_seen?: string;
      }>;
    }>;
  }>;
}

export async function fetchDfsTopAnchors(domain: string, limit = 100): Promise<DataPoint<DfsAnchorRow[]>> {
  if (!isDfsConfigured()) throw new ProviderError(PROVIDER, "DataForSEO not configured");
  const target = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!target) throw new ProviderError(PROVIDER, "Empty domain");

  const cacheKey = `${PROVIDER}:anchors:${target}:${limit}`;
  const cached = cacheGet<DfsAnchorRow[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  const resp = await dfsPost<DfsAnchorsResponse>(
    "/backlinks/anchors/live",
    [{ target, limit: Math.min(Math.max(limit, 10), 1000), order_by: ["referring_domains,desc"] }],
  );
  const items = resp.tasks?.[0]?.result?.[0]?.items ?? [];
  const rows: DfsAnchorRow[] = items
    .filter((i) => typeof i.anchor === "string" && i.anchor.trim())
    .map((i) => ({
      anchor: String(i.anchor).trim(),
      referringDomains: Number(i.referring_domains ?? 0),
      backlinks: Number(i.backlinks ?? 0),
      firstSeen: typeof i.first_seen === "string" ? i.first_seen : undefined,
    }));
  cacheSet(cacheKey, rows, TTL_MS);
  return dp(rows, PROVIDER, "high", TTL_MS, `DataForSEO /v3/backlinks/anchors/live · ${rows.length} anchors`);
}

// ── Keyword volume ─────────────────────────────────────────────────────

export interface DfsKeywordVolume {
  keyword: string;
  searchVolume: DataPoint<number | null>;
  cpc?: DataPoint<number | null>;
  competition?: DataPoint<number | null>;
}

interface DfsKwVolumeResponse {
  tasks?: Array<{
    status_code?: number;
    result?: Array<{
      keyword?: string;
      search_volume?: number;
      cpc?: number;
      competition?: number;
    }>;
  }>;
}

export async function fetchDfsKeywordVolume(keywords: string[], region = "United States"): Promise<DfsKeywordVolume[]> {
  if (!isDfsConfigured()) throw new ProviderError(PROVIDER, "DataForSEO not configured");
  const terms = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 100);
  if (terms.length === 0) return [];
  const cacheKey = `${PROVIDER}:kwvol:${region}:${terms.join("|").slice(0, 200)}`;
  const cached = cacheGet<DfsKeywordVolume[]>(cacheKey);
  if (cached) return cached;
  const resp = await dfsPost<DfsKwVolumeResponse>(
    "/keywords_data/google_ads/search_volume/live",
    [{ keywords: terms, location_name: region }],
  );
  const rows = resp.tasks?.[0]?.result ?? [];
  const note = `DataForSEO /v3/keywords_data/google_ads/search_volume/live · ${region}`;
  const out: DfsKeywordVolume[] = rows.map((r) => ({
    keyword: String(r.keyword ?? ""),
    searchVolume: dp(typeof r.search_volume === "number" ? r.search_volume : null, PROVIDER, "high", TTL_MS, note),
    cpc: typeof r.cpc === "number" ? dp(r.cpc, PROVIDER, "high", TTL_MS, `${note} · CPC USD`) : undefined,
    competition: typeof r.competition === "number" ? dp(r.competition, PROVIDER, "high", TTL_MS, `${note} · 0-1 scale`) : undefined,
  }));
  cacheSet(cacheKey, out, TTL_MS);
  return out;
}
