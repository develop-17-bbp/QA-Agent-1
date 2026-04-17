import { load } from "cheerio";
import type { CheerioAPI } from "cheerio";
import pLimit from "p-limit";
import type { BrokenLinkRecord, CrawlSiteResult, LinkCheckRecord, PageFetchRecord } from "./types.js";
import { siteIdFromUrl } from "./load-urls.js";

/** Many hosts block non-browser UAs; override with QA_AGENT_USER_AGENT if needed. */
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 QA-Agent/0.2";

function userAgent(): string {
  const fromEnv = process.env.QA_AGENT_USER_AGENT?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_UA;
}

const MAX_FETCH_ATTEMPTS = (() => {
  const n = Number.parseInt(process.env.QA_AGENT_FETCH_MAX_ATTEMPTS ?? "2", 10);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 2;
})();

const RETRY_BACKOFF_MS = (() => {
  const n = Number.parseInt(process.env.QA_AGENT_FETCH_RETRY_BACKOFF_MS ?? "80", 10);
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? n : 80;
})();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTimeoutLikeError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("aborted") ||
    (m.includes("abort") && m.includes("signal"))
  );
}

/** Transient network/TLS/socket errors worth retrying (Node/undici wording varies). */
function isTransientError(message: string): boolean {
  if (isTimeoutLikeError(message)) return true;
  const m = message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("enetunreach") ||
    m.includes("ehostunreach") ||
    m.includes("eai_again") ||
    m.includes("socket hang up") ||
    m.includes("premature close") ||
    m.includes("other side closed") ||
    m.includes("und_err_connect") ||
    m.includes("und_err_socket") ||
    m.includes("tls") ||
    m.includes("ssl") ||
    m.includes("certificate") ||
    m.includes("wrong version number")
  );
}

function shouldRetryFetch(attempt: number, message: string): boolean {
  return attempt < MAX_FETCH_ATTEMPTS - 1 && (isTimeoutLikeError(message) || isTransientError(message));
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    // Treat www.example.com and example.com as same origin
    const ha = ua.hostname.replace(/^www\./, "");
    const hb = ub.hostname.replace(/^www\./, "");
    return ha === hb;
  } catch {
    return false;
  }
}

/**
 * Cloudflare wraps mailto in same-origin URLs like `/cdn-cgi/l/email-protection#…`.
 * They are not meant for server-side GET/HEAD and routinely fail automated checks.
 */
function isCloudflareEmailProtectionUrl(u: URL): boolean {
  const p = u.pathname.replace(/\\/g, "/").toLowerCase();
  return p.startsWith("/cdn-cgi/l/email-protection");
}

/**
 * Skip URL patterns that are almost never HTML content pages:
 * - CMS admin panels, login pages, cart/checkout flows
 * - Static asset extensions (images, fonts, scripts, stylesheets, archives)
 * - Feed/API endpoints, sitemaps (covered separately)
 * - Session/token query strings that produce duplicate content
 */
const SKIP_PATH_PATTERNS = [
  // CMS admin & tooling
  /^\/wp-(admin|login|cron|json|includes\/)\b/i,
  /^\/(admin|login|logout|signin|signout|dashboard|backend|cp|panel)\b/i,
  // Static asset file extensions
  /\.(jpe?g|png|gif|svg|webp|ico|bmp|tiff?|avif)(\?.*)?$/i,
  /\.(woff2?|ttf|eot|otf)(\?.*)?$/i,
  /\.(js|css|map|ts)(\?.*)?$/i,
  /\.(zip|gz|tar|rar|7z|pdf|docx?|xlsx?|pptx?)(\?.*)?$/i,
  /\.(mp4|webm|ogg|mp3|wav|flac|avi|mov)(\?.*)?$/i,
  // Feeds, sitemaps, manifests
  /\/(feed|rss|atom)(\/|\.xml)?(\?.*)?$/i,
  /\/sitemap[\w-]*\.xml(\?.*)?$/i,
  /\/manifest\.json(\?.*)?$/i,
  // CDN / cache bust paths
  /^\/cdn-cgi\//i,
];

const SKIP_QUERY_PARAMS = new Set([
  "session_id", "PHPSESSID", "jsessionid", "sid",
  "preview", "preview_id", "preview_nonce",
  "wc-ajax", "action",
]);

function shouldSkipUrl(u: URL): boolean {
  const path = u.pathname;
  for (const re of SKIP_PATH_PATTERNS) {
    if (re.test(path)) return true;
  }
  // Skip if any query param is a known session/preview key
  for (const key of u.searchParams.keys()) {
    if (SKIP_QUERY_PARAMS.has(key)) return true;
  }
  return false;
}

function normalizeHref(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.toLowerCase().startsWith("javascript:")) {
    return null;
  }
  if (/^(mailto:|tel:)/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed, pageUrl);
    if (isCloudflareEmailProtectionUrl(u)) return null;
    if (shouldSkipUrl(u)) return null;
    // Strip fragment — same page
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function primaryMime(contentTypeHeader: string): string | undefined {
  const t = contentTypeHeader.split(";")[0]?.trim();
  return t || undefined;
}

/** Case-insensitive: treat as document we should read as text for crawling. */
function contentTypeLooksLikeHtml(contentTypeHeader: string): boolean {
  const ct = contentTypeHeader.toLowerCase();
  return (
    ct.includes("text/html") ||
    ct.includes("application/xhtml") ||
    ct.includes("application/xml") ||
    ct.includes("text/xml") ||
    ct.includes("xml")
  );
}

function htmlDocumentFetchHeaders(): Record<string, string> {
  const ua = userAgent();
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
}

async function fetchPage(
  url: string,
  timeoutMs: number,
): Promise<{
  status: number;
  body: string | null;
  durationMs: number;
  error?: string;
  contentType?: string;
  bodyBytes?: number;
  redirected?: boolean;
  finalUrl?: string;
}> {
  const started = Date.now();
  let lastError: string | undefined;
  const htmlHeaders = htmlDocumentFetchHeaders();

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const doFetch = async (headers: Record<string, string>) => {
        return await fetch(url, {
          redirect: "follow",
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      };

      let res = await doFetch(htmlHeaders);
      let ct = res.headers.get("content-type") ?? "";
      let mime = primaryMime(ct);
      let body: string | null = null;
      if (contentTypeLooksLikeHtml(ct)) {
        body = await res.text();
      }

      const statusOk = res.status >= 200 && res.status < 300;
      if (
        body !== null &&
        body.length === 0 &&
        statusOk &&
        contentTypeLooksLikeHtml(ct)
      ) {
        const res2 = await doFetch({
          ...htmlHeaders,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        });
        const ct2 = res2.headers.get("content-type") ?? "";
        if (contentTypeLooksLikeHtml(ct2)) {
          const body2 = await res2.text();
          if (body2.length > 0) {
            res = res2;
            ct = ct2;
            mime = primaryMime(ct2);
            body = body2;
          }
        }
      }

      const bodyBytes = body != null ? Buffer.byteLength(body, "utf8") : undefined;
      return {
        status: res.status,
        body,
        durationMs: Date.now() - started,
        contentType: mime,
        bodyBytes,
        redirected: res.redirected,
        finalUrl: res.url,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg;
      if (shouldRetryFetch(attempt, msg)) {
        await sleep(Math.round(RETRY_BACKOFF_MS * (attempt + 1) * (0.7 + Math.random() * 0.6)));
        continue;
      }
      return { status: 0, body: null, durationMs: Date.now() - started, error: msg };
    }
  }

  return { status: 0, body: null, durationMs: Date.now() - started, error: lastError ?? "Unknown error" };
}

async function headOrGetStatus(
  target: string,
  timeoutMs: number,
): Promise<{ status: number; durationMs: number; method: "HEAD" | "GET_RANGE"; error?: string }> {
  const started = Date.now();
  let lastError: string | undefined;
  const ua = userAgent();
  const headHeaders = {
    "User-Agent": ua,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(target, {
        method: "HEAD",
        redirect: "follow",
        headers: headHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 405 || res.status === 501) {
        const g = await fetch(target, {
          method: "GET",
          redirect: "follow",
          headers: { ...headHeaders, Range: "bytes=0-0" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { status: g.status, durationMs: Date.now() - started, method: "GET_RANGE" };
      }
      return { status: res.status, durationMs: Date.now() - started, method: "HEAD" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg;
      if (shouldRetryFetch(attempt, msg)) {
        await sleep(Math.round(RETRY_BACKOFF_MS * (attempt + 1) * (0.7 + Math.random() * 0.6)));
        continue;
      }
      return { status: 0, durationMs: Date.now() - started, method: "HEAD", error: msg };
    }
  }

  return { status: 0, durationMs: Date.now() - started, method: "HEAD", error: lastError ?? "Unknown error" };
}

function canonicalHref(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

const MAX_STORED_TITLE_LEN = 500;

/**
 * SEO / QA signals from HTML (same pass as link discovery).
 */
function extractHtmlDocumentSignals($: CheerioAPI, pageUrl: string): Pick<
  PageFetchRecord,
  "documentTitle" | "metaDescriptionLength" | "h1Count" | "documentLang" | "canonicalUrl"
> {
  const titleRaw = $("title").first().text().replace(/\s+/g, " ").trim();
  const metaRaw =
    $('meta[name="description"]').attr("content")?.trim() ??
    $('meta[property="og:description"]').attr("content")?.trim() ??
    "";
  const h1Count = $("h1").length;
  const canon = $('link[rel="canonical"]').attr("href")?.trim();
  let canonicalUrl: string | undefined;
  if (canon) {
    const abs = normalizeHref(canon, pageUrl);
    if (abs) canonicalUrl = abs;
  }
  const langRaw = ($("html").attr("lang") ?? "").trim();
  return {
    documentTitle: titleRaw ? titleRaw.slice(0, MAX_STORED_TITLE_LEN) : undefined,
    metaDescriptionLength: metaRaw.length,
    h1Count,
    documentLang: langRaw || undefined,
    canonicalUrl,
  };
}

/** `<= 0` means no limit (use MAX_SAFE_INTEGER internally). */
function capOrUnlimited(n: number): number {
  return n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

/** Fetch sitemap(s) and return all <loc> URLs. Non-fatal — returns [] on error. */
async function fetchSitemapUrls(baseUrl: URL, timeoutMs: number): Promise<string[]> {
  const urls: string[] = [];
  const sitemapQueue: string[] = [];

  // Try sitemap_index.xml first (WordPress default), then sitemap.xml
  for (const path of ["/sitemap_index.xml", "/sitemap.xml"]) {
    try {
      const res = await fetch(new URL(path, baseUrl).href, {
        headers: { "User-Agent": userAgent() },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.includes("<")) continue;

      // Extract nested sitemap URLs (for sitemap index files)
      const sitemapMatches = text.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/gi);
      for (const m of sitemapMatches) sitemapQueue.push(m[1].trim());

      // Extract direct page URLs
      const locMatches = text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/gi);
      for (const m of locMatches) urls.push(m[1].trim());

      if (sitemapQueue.length > 0 || urls.length > 0) break; // found valid sitemap
    } catch { /* non-fatal */ }
  }

  // Fetch nested sitemaps (e.g., post-sitemap.xml, page-sitemap.xml)
  for (const smUrl of sitemapQueue) {
    try {
      const res = await fetch(smUrl, {
        headers: { "User-Agent": userAgent() },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const locMatches = text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/gi);
      for (const m of locMatches) urls.push(m[1].trim());
    } catch { /* non-fatal */ }
  }

  return urls;
}

export async function crawlSite(options: {
  startUrl: string;
  maxPages: number;
  /** Max extra same-origin URLs to verify with HEAD (links found but not visited in BFS). `<= 0` = no limit. */
  maxLinkChecks: number;
  requestTimeoutMs: number;
  /** Parallel HTTP fetches per site (BFS + link checks). Default callers pass >= 1. */
  fetchConcurrency: number;
}): Promise<CrawlSiteResult> {
  const started = Date.now();
  let base = new URL(options.startUrl);

  // Follow redirect to get the canonical base URL (e.g., nwface.com → www.nwface.com)
  try {
    const probe = await fetch(base.href, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": userAgent() },
    });
    if (probe.url) base = new URL(probe.url);
  } catch { /* use original */ }

  const hostname = base.hostname;
  const siteId = siteIdFromUrl(options.startUrl);

  const maxPagesCap = capOrUnlimited(options.maxPages);
  const maxLinkChecksCap = capOrUnlimited(options.maxLinkChecks);
  const fetchConcurrency = Math.max(1, options.fetchConcurrency);
  const limit = pLimit(fetchConcurrency);

  const visited = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [base.href];
  queued.add(base.href);

  // Seed BFS queue from sitemap — discovers pages not reachable through internal links
  try {
    const sitemapUrls = await fetchSitemapUrls(base, options.requestTimeoutMs);
    for (const sUrl of sitemapUrls) {
      if (sameOrigin(sUrl, base.href) && !queued.has(sUrl)) {
        const normalized = normalizeHref(sUrl, base.href);
        if (normalized && !queued.has(normalized)) {
          queue.push(normalized);
          queued.add(normalized);
        }
      }
    }
    if (sitemapUrls.length > 0) {
      console.log(`[crawl] ${hostname}: seeded ${queued.size - 1} URLs from sitemap`);
    }
  } catch { /* sitemap fetch failed — continue with BFS only */ }

  const pages: PageFetchRecord[] = [];
  const brokenLinks: BrokenLinkRecord[] = [];
  const linkChecks: LinkCheckRecord[] = [];
  /** Every unique same-origin URL we discover from <a href> — verify even if not crawled */
  const discoveredInternal = new Set<string>();

  let outstanding = 0;

  async function processPage(pageUrl: string): Promise<void> {
    const { status, body, error, durationMs, contentType, bodyBytes, redirected, finalUrl } = await fetchPage(
      pageUrl,
      options.requestTimeoutMs,
    );
    const ok = status >= 200 && status < 400;
    let $: CheerioAPI | null = null;
    let docSignals: Partial<
      Pick<PageFetchRecord, "documentTitle" | "metaDescriptionLength" | "h1Count" | "documentLang" | "canonicalUrl">
    > = {};
    if (body) {
      $ = load(body);
      docSignals = extractHtmlDocumentSignals($, pageUrl);
    }
    pages.push({
      url: pageUrl,
      status,
      ok,
      durationMs,
      error: error ?? (ok ? undefined : `HTTP ${status}`),
      contentType,
      bodyBytes,
      redirected,
      finalUrl,
      ...docSignals,
    });

    if (!ok && status !== 0) {
      brokenLinks.push({ foundOn: "(crawl)", target: pageUrl, status, error, durationMs });
    }
    if (error && status === 0) {
      brokenLinks.push({ foundOn: "(crawl)", target: pageUrl, error, durationMs });
    }

    if (!$ || !ok) return;

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const abs = normalizeHref(href, pageUrl);
      if (!abs || !sameOrigin(abs, pageUrl)) return;
      discoveredInternal.add(abs);

      if (!visited.has(abs) && !queued.has(abs) && visited.size < maxPagesCap) {
        queue.push(abs);
        queued.add(abs);
      }
    });
  }

  await new Promise<void>((resolve) => {
    function tryFinish() {
      if (outstanding === 0 && queue.length === 0) {
        resolve();
      }
    }

    function scheduleNext(): void {
      while (queue.length > 0 && visited.size < maxPagesCap) {
        const pageUrl = queue.shift()!;
        if (visited.has(pageUrl)) continue;
        if (visited.size >= maxPagesCap) break;
        visited.add(pageUrl);
        outstanding++;
        void limit(async () => {
          try {
            await processPage(pageUrl);
          } finally {
            outstanding--;
            scheduleNext();
            tryFinish();
          }
        });
      }
      tryFinish();
    }

    scheduleNext();
  });

  /** Verify discovered internal links we did not crawl (HEAD/GET), capped */
  const toVerifyAll = [...discoveredInternal].filter((u) => !visited.has(u));
  const toVerify = toVerifyAll.slice(0, maxLinkChecksCap);
  await Promise.all(
    toVerify.map((target) =>
      limit(async () => {
        const { status, error, durationMs, method } = await headOrGetStatus(target, options.requestTimeoutMs);
        const linkOk = status >= 200 && status < 400;
        linkChecks.push({ target, status, ok: linkOk, durationMs, method });
        if (!linkOk) {
          brokenLinks.push({
            foundOn: "(discovered, not crawled)",
            target,
            status: status || undefined,
            error: error ?? (status ? `HTTP ${status}` : undefined),
            durationMs,
          });
        }
      }),
    ),
  );

  /** Ensure the listed URL appears in `pages` (same canonical href as start). */
  const listedCanonical = canonicalHref(options.startUrl);
  const listedSeen = pages.some((p) => canonicalHref(p.url) === listedCanonical);
  if (!listedSeen) {
    const { status, body, error, durationMs, contentType, bodyBytes, redirected, finalUrl } = await fetchPage(
      listedCanonical,
      options.requestTimeoutMs,
    );
    const ok = status >= 200 && status < 400;
    let listedDoc: Partial<
      Pick<PageFetchRecord, "documentTitle" | "metaDescriptionLength" | "h1Count" | "documentLang" | "canonicalUrl">
    > = {};
    if (body) {
      listedDoc = extractHtmlDocumentSignals(load(body), listedCanonical);
    }
    visited.add(listedCanonical);
    pages.unshift({
      url: listedCanonical,
      status,
      ok,
      durationMs,
      error: error ?? (ok ? undefined : `HTTP ${status}`),
      contentType,
      bodyBytes,
      redirected,
      finalUrl,
      ...listedDoc,
    });
    if (!ok && status !== 0) {
      brokenLinks.push({ foundOn: "(listed URL)", target: listedCanonical, status, error, durationMs });
    }
    if (error && status === 0) {
      brokenLinks.push({ foundOn: "(listed URL)", target: listedCanonical, error, durationMs });
    }
  }

  const durationMs = Date.now() - started;
  return {
    startUrl: options.startUrl,
    siteId,
    hostname,
    pagesVisited: visited.size,
    uniqueUrlsChecked: visited.size + toVerify.length,
    pages,
    brokenLinks,
    linkChecks,
    durationMs,
  };
}
