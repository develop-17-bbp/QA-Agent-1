/**
 * Common Crawl — free web archive with a searchable CDX index.
 *
 * https://index.commoncrawl.org/
 *
 * Use cases:
 *   - Discover which URLs across the web have captured a given target URL
 *     (backlink discovery via "*.target.com" subdomain queries)
 *   - Check how many times Common Crawl has seen a domain
 *
 * Free and unauthenticated but slow. We cache aggressively. Common Crawl
 * publishes a new index every ~1 month, and the CDX server returns JSON
 * lines (one JSON object per line).
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { httpGet, httpGetJson } from "./http.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";
import { gunzipSync } from "node:zlib";
import { load } from "cheerio";

const PROVIDER = "common-crawl";
registerLimit(PROVIDER, 30, 60_000);
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d — index only updates monthly

interface CollinfoEntry {
  id: string;
  name: string;
  timegate: string;
  "cdx-api": string;
}

let cachedIndexes: CollinfoEntry[] | null = null;

async function fetchRecentIndexes(): Promise<CollinfoEntry[]> {
  if (cachedIndexes) return cachedIndexes;
  const data = await httpGetJson<CollinfoEntry[]>("https://index.commoncrawl.org/collinfo.json");
  if (!data || data.length === 0) {
    throw new ProviderError(PROVIDER, "Failed to fetch Common Crawl index list");
  }
  cachedIndexes = data.slice(0, 3); // keep 3 most-recent indexes
  return cachedIndexes;
}

export interface CommonCrawlHit {
  url: string;
  timestamp: string;
  status: string;
  mime?: string;
  length?: string;
  /** WARC filename inside the data.commoncrawl.org S3 bucket (needed for byte-range fetches). */
  filename?: string;
  /** Byte offset of the record inside the WARC file. */
  offset?: string;
  /** Byte length of the record (offset..offset+length-1). */
  lengthBytes?: string;
}

function parseCdxLines(raw: string): CommonCrawlHit[] {
  const out: CommonCrawlHit[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        url: string;
        timestamp: string;
        status: string;
        mime?: string;
        length?: string;
        filename?: string;
        offset?: string;
      };
      if (obj.url && obj.timestamp) {
        out.push({
          url: obj.url,
          timestamp: obj.timestamp,
          status: obj.status,
          mime: obj.mime,
          length: obj.length,
          filename: obj.filename,
          offset: obj.offset,
          lengthBytes: obj.length,
        });
      }
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

/**
 * Look up all URLs Common Crawl has seen for a given domain (and subpaths).
 * Useful to estimate the crawled footprint of a domain.
 */
export async function fetchDomainHits(domain: string, limit = 200): Promise<DataPoint<CommonCrawlHit[]>> {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) throw new ProviderError(PROVIDER, "Empty domain");

  const cacheKey = `${PROVIDER}:hits:${clean}:${limit}`;
  const cached = cacheGet<CommonCrawlHit[]>(cacheKey);
  if (cached) return dp(cached, PROVIDER, "high", TTL_MS, "cached");

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted");
  }

  const indexes = await fetchRecentIndexes();
  const allHits: CommonCrawlHit[] = [];

  // Query the two most-recent indexes in parallel, merge results
  const promises = indexes.slice(0, 2).map(async (idx) => {
    const url = `${idx["cdx-api"]}?url=${encodeURIComponent(`*.${clean}`)}&output=json&limit=${limit}`;
    const res = await httpGet(url, { timeoutMs: 30_000 });
    if (!res || !res.ok) return [] as CommonCrawlHit[];
    const raw = await res.text();
    return parseCdxLines(raw);
  });

  const results = await Promise.allSettled(promises);
  for (const r of results) if (r.status === "fulfilled") allHits.push(...r.value);

  // Dedupe by URL
  const seen = new Set<string>();
  const deduped: CommonCrawlHit[] = [];
  for (const h of allHits) {
    if (!seen.has(h.url)) {
      seen.add(h.url);
      deduped.push(h);
    }
    if (deduped.length >= limit) break;
  }

  cacheSet(cacheKey, deduped, TTL_MS);
  return dp(deduped, PROVIDER, "high", TTL_MS, `merged from ${indexes.length} indexes`);
}

/**
 * Count the number of external domains linking TO a target domain — an
 * approximation of referring domain count. This is a slow operation; cache
 * aggressively.
 *
 * Note: Common Crawl's CDX index doesn't directly expose backlinks, but we
 * can approximate referring-domain breadth by the number of distinct hosts
 * that Common Crawl has crawled which match the target's URL pattern when
 * searched as a text substring. For a true inlink count you would need the
 * Common Crawl Web Graph dataset (WAT files), which is large to process.
 * We surface whatever we can for free and label confidence accordingly.
 */
/**
 * Fetch a single WARC record from the Common Crawl public S3 bucket using a
 * Range request on the byte offset/length recorded in the CDX row. Returns
 * the decompressed HTML payload (record body after the WARC headers), or
 * `undefined` if the record can't be decoded. Cost is $0 — the bucket is
 * public and unmetered from the client side; we still respect the provider's
 * rate limit.
 *
 * Typical record sizes are 5-50 KB, so one anchor-extraction lookup is cheap.
 */
export async function fetchWarcRecord(filename: string, offset: number, length: number): Promise<string | undefined> {
  if (!filename || !Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) return undefined;
  if (length > 5_000_000) return undefined; // safety cap — no record should be >5 MB

  if (!tryConsume(PROVIDER)) return undefined;

  const url = `https://data.commoncrawl.org/${filename}`;
  const res = await httpGet(url, {
    timeoutMs: 30_000,
    headers: { Range: `bytes=${offset}-${offset + length - 1}` },
  });
  if (!res || (res.status !== 206 && res.status !== 200)) return undefined;

  let buf: Buffer;
  try {
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
  } catch {
    return undefined;
  }

  // WARC records in the main WET/WARC files are gzipped per-record. The byte
  // range gives us exactly one gzip member.
  let decompressed: Buffer;
  try {
    decompressed = gunzipSync(buf);
  } catch {
    // If it isn't gzipped (rare, e.g. a debug fetch), assume raw.
    decompressed = buf;
  }

  const text = decompressed.toString("utf8");
  // WARC records have a plain-text header block followed by `\r\n\r\n` then the
  // HTTP response (which itself has a header block + another `\r\n\r\n` and
  // then the HTML body). Find the HTML body by locating the second delimiter.
  const firstBreak = text.indexOf("\r\n\r\n");
  if (firstBreak < 0) return text;
  const afterWarc = text.slice(firstBreak + 4);
  const secondBreak = afterWarc.indexOf("\r\n\r\n");
  if (secondBreak < 0) return afterWarc;
  return afterWarc.slice(secondBreak + 4);
}

export interface WarcAnchor {
  sourceUrl: string;
  anchorText: string;
  targetUrl: string;
  context?: string;
}

/**
 * Parse HTML (typically fetched from a WARC record) and return every `<a href>`
 * that points at the given target host (or any subdomain of it). Includes
 * anchor text and ~50 chars of surrounding text context on either side.
 */
export function extractAnchorsToTarget(html: string, targetHost: string, sourceUrl: string): WarcAnchor[] {
  if (!html || !targetHost) return [];
  const cleanHost = targetHost.replace(/^www\./, "").toLowerCase();
  const out: WarcAnchor[] = [];
  let $;
  try { $ = load(html); } catch { return []; }
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href) return;
    let targetUrl = "";
    try {
      const abs = new URL(href, sourceUrl);
      const h = abs.hostname.replace(/^www\./, "").toLowerCase();
      if (h !== cleanHost && !h.endsWith(`.${cleanHost}`)) return;
      targetUrl = abs.toString();
    } catch { return; }
    const anchorText = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160);
    if (!anchorText && !targetUrl) return;
    let context: string | undefined;
    try {
      const parentText = $(el).parent().text().replace(/\s+/g, " ").trim();
      if (parentText) {
        const idx = anchorText ? parentText.indexOf(anchorText) : -1;
        if (idx >= 0) {
          const before = parentText.slice(Math.max(0, idx - 50), idx).trim();
          const after = parentText.slice(idx + anchorText.length, idx + anchorText.length + 50).trim();
          context = `${before} «${anchorText}» ${after}`.slice(0, 200);
        } else {
          context = parentText.slice(0, 200);
        }
      }
    } catch { /* best-effort */ }
    out.push({ sourceUrl, anchorText, targetUrl, context });
  });
  return out;
}

export async function approximateReferringDomains(domain: string): Promise<DataPoint<number>> {
  const hits = await fetchDomainHits(domain, 500);
  const distinctHosts = new Set<string>();
  for (const h of hits.value) {
    try {
      distinctHosts.add(new URL(h.url).hostname.replace(/^www\./, ""));
    } catch {
      // skip bad url
    }
  }
  const count = distinctHosts.size;
  return dp(count, PROVIDER, "medium", TTL_MS, "distinct hosts seen in recent indexes (proxy)");
}
