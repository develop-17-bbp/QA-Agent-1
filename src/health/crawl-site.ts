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
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
}

/** Read a fetch response body up to maxBytes, then cancel the rest of the
 *  stream so we don't keep the socket open transferring multi-megabyte HTML
 *  we'll never parse. SEO-relevant markup is almost always <500 KB; set a
 *  safety cap of 2 MB by default (overridable via QA_AGENT_MAX_BODY_BYTES). */
const MAX_BODY_BYTES = (() => {
  const n = Number.parseInt(process.env.QA_AGENT_MAX_BODY_BYTES ?? "2097152", 10);
  return Number.isFinite(n) && n >= 16_384 ? n : 2_097_152;
})();

async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      if (total >= maxBytes) {
        // Got enough HTML to extract every meta + title + body text an SEO
        // analyzer needs. Cancel the rest so the connection can be reused.
        try { await reader.cancel(); } catch { /* best effort */ }
        break;
      }
    }
    chunks.push(decoder.decode());
  } finally {
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  return chunks.join("");
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
        body = await readBodyCapped(res, MAX_BODY_BYTES);
      } else {
        // Non-HTML (PDF, image, zip, etc.): we don't need the body — cancel
        // the stream so the server can stop sending and the socket frees for
        // reuse. Without this, the browser-side fetch would keep reading the
        // whole asset into memory even though we discard it.
        try { await res.body?.cancel(); } catch { /* best effort */ }
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
          const body2 = await readBodyCapped(res2, MAX_BODY_BYTES);
          if (body2.length > 0) {
            res = res2;
            ct = ct2;
            mime = primaryMime(ct2);
            body = body2;
          }
        } else {
          try { await res2.body?.cancel(); } catch { /* best effort */ }
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
  /** When true, attach the raw HTML body to each PageFetchRecord under
   *  `retainedBody` so post-crawl enrichers (structured-data, hreflang)
   *  can re-parse it. Orchestrator drops bodies before persisting the
   *  report. Default false to avoid blowing up memory on large sites. */
  retainBodies?: boolean;
  /** Enable the agentic brain — LLM planner reorders the BFS queue and
   *  re-prioritizes mid-crawl. No-op when Ollama unreachable. Controlled
   *  from orchestrate-health, which defaults it to true unless the env
   *  has QA_AGENT_NO_AGENTIC=1. */
  agentic?: boolean;
  /** Re-render pages that come back as empty SPA shells using a real
   *  Chromium browser (Playwright). Closes the "we miss content on
   *  React/Next/Vue/Angular sites" gap. Off by default — opt in per-run
   *  or via env QA_AGENT_HEADLESS_FALLBACK=1. */
  headlessFallback?: boolean;
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

  // Seed BFS queue from sitemap — discovers pages not reachable through internal links.
  // Cap the seed count at maxPagesCap so we don't queue tens of thousands of URLs on
  // large sitemaps; anything over the cap gets dropped here since BFS would ignore it
  // anyway and leaving it in the queue historically caused tryFinish() to stall.
  try {
    const sitemapUrls = await fetchSitemapUrls(base, options.requestTimeoutMs);
    let seeded = 0;
    for (const sUrl of sitemapUrls) {
      if (queued.size >= maxPagesCap) break;
      if (sameOrigin(sUrl, base.href) && !queued.has(sUrl)) {
        const normalized = normalizeHref(sUrl, base.href);
        if (normalized && !queued.has(normalized)) {
          queue.push(normalized);
          queued.add(normalized);
          seeded++;
        }
      }
    }
    if (sitemapUrls.length > 0) {
      const suffix = sitemapUrls.length > seeded ? ` (of ${sitemapUrls.length} sitemap entries; capped at maxPages)` : "";
      console.log(`[crawl] ${hostname}: seeded ${seeded} URLs from sitemap${suffix}`);
    }
  } catch { /* sitemap fetch failed — continue with BFS only */ }

  // ── Agentic plan + queue prioritization (before BFS starts) ────────────
  // When the agentic brain is enabled AND Ollama is reachable, ask the LLM
  // planner to pick a strategy and reorder the queue so the most SEO-valuable
  // URLs crawl first. Falls back to the default BFS order when either
  // condition isn't met — the crawler never BLOCKS on LLM availability.
  let agenticMeta: import("./types.js").CrawlAgenticMeta | undefined;
  if (options.agentic) {
    const plannerStart = Date.now();
    try {
      const { checkOllamaAvailable } = await import("./agentic/llm-router.js");
      if (await checkOllamaAvailable()) {
        const { planCrawl, prioritizeUrls } = await import("./agentic/crawl-planner.js");
        // Self-Improving Crawl Memory — load prior profile to bias the planner.
        const { loadSiteProfile, condenseProfileForPlanner } = await import("./modules/site-memory.js");
        const priorProfile = await loadSiteProfile(hostname);
        const memoryHint = priorProfile ? condenseProfileForPlanner(priorProfile) : undefined;
        const plan = await planCrawl(base.href, queue, [], memoryHint);
        // Apply extra skip patterns from the planner (additive to default SKIP_PATTERNS).
        const extraSkipRegexes = (plan.skipPatterns ?? [])
          .filter((p) => typeof p === "string" && p.trim())
          .map((p) => { try { return new RegExp(p); } catch { return null; } })
          .filter((r): r is RegExp => r !== null);
        if (extraSkipRegexes.length > 0) {
          const filtered = queue.filter((u) => !extraSkipRegexes.some((r) => r.test(u)));
          queue.length = 0;
          queue.push(...filtered);
          // Rebuild queued set to match the filtered queue (drop removed URLs).
          queued.clear();
          for (const u of queue) queued.add(u);
        }
        // Reorder queue by LLM priority when reasonably sized (heuristic path
        // above 30 URLs in crawl-planner.ts handles big queues efficiently).
        let reordered = 0;
        if (queue.length > 1) {
          const priorities = await prioritizeUrls(queue, {
            hostname,
            focusKeywords: plan.focusKeywords,
            prioritySections: plan.prioritySections,
          });
          if (priorities.length > 0) {
            const priorityByUrl = new Map<string, number>();
            for (const p of priorities) priorityByUrl.set(p.url, p.priority);
            const before = queue.slice();
            queue.sort((a, b) => (priorityByUrl.get(b) ?? 50) - (priorityByUrl.get(a) ?? 50));
            for (let i = 0; i < queue.length; i++) if (queue[i] !== before[i]) reordered++;
          }
        }
        agenticMeta = {
          strategy: plan.strategy,
          prioritySections: plan.prioritySections,
          focusKeywords: plan.focusKeywords,
          reasoning: plan.reasoning,
          replanCount: 0,
          plannerMs: Date.now() - plannerStart,
          reorderedCount: reordered,
          extraSkipPatterns: plan.skipPatterns ?? [],
          memoryUsed: !!priorProfile,
          memorySnapshot: priorProfile ? {
            observedRuns: priorProfile.observedRuns,
            cms: priorProfile.cms,
            priorityPatterns: priorProfile.priorityPatterns.slice(0, 6),
            slowSections: priorProfile.slowSections.slice(0, 4),
            topClusters: priorProfile.contentClusters.slice(0, 5).map((c) => ({ path: c.path, label: c.label, pageCount: c.pageCount })),
          } : undefined,
        };
        console.log(`[crawl/agentic] ${hostname}: strategy=${plan.strategy} reordered=${reordered} sections=${plan.prioritySections.join(",") || "(none)"} memoryUsed=${!!priorProfile} in ${agenticMeta.plannerMs}ms`);
      }
    } catch (e) {
      console.log(`[crawl/agentic] ${hostname}: planner failed, falling back to BFS — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const pages: PageFetchRecord[] = [];
  const brokenLinks: BrokenLinkRecord[] = [];
  const linkChecks: LinkCheckRecord[] = [];
  /**
   * Every unique same-origin URL we discover from <a href>, mapped to the list
   * of origin pages where it was found and the anchor/context captured on each
   * origin. We emit one BrokenLinkRecord per (target, origin) pair so SEO teams
   * can see which specific page contains the broken link and the `<a>` tag
   * exactly as it appears in the HTML.
   */
  interface LinkRef {
    originPage: string;
    anchorText?: string;
    linkContext?: string;
    outerHtml?: string;
  }
  const discoveredInternal = new Map<string, LinkRef[]>();

  let outstanding = 0;

  // SPA fallback flag — opt-in via option OR env. Resolved once per run.
  const headlessFallbackEnabled = options.headlessFallback === true || process.env.QA_AGENT_HEADLESS_FALLBACK?.trim() === "1";
  let spaRenderedCount = 0;

  async function processPage(pageUrl: string): Promise<void> {
    const { status, body: staticBody, error, durationMs, contentType, bodyBytes, redirected, finalUrl } = await fetchPage(
      pageUrl,
      options.requestTimeoutMs,
    );
    const ok = status >= 200 && status < 400;
    // SPA fallback: when the static fetch returned an empty hydration shell
    // AND the operator opted in, re-render with Chromium and use that body
    // for downstream parsing. Failure falls back to the static body silently.
    let body = staticBody;
    if (ok && body && headlessFallbackEnabled && /text\/html/i.test(contentType ?? "")) {
      try {
        const { renderIfShell } = await import("./spa-render.js");
        const upgraded = await renderIfShell(pageUrl, body, true);
        if (upgraded.rendered) {
          body = upgraded.html;
          spaRenderedCount++;
        }
      } catch { /* fallback below */ }
    }
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
      ...(options.retainBodies && body ? { retainedBody: body } : {}),
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

      // Capture per-link provenance so broken-link reports can point at the
      // exact <a> tag on the exact origin page, not a category placeholder.
      const anchorText = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
      const outerRaw = $.html(el) ?? "";
      const outerHtml = outerRaw.length > 400 ? outerRaw.slice(0, 400) + "…" : outerRaw;
      // Context = up to ~60 chars of text on either side of the <a> within its parent.
      let linkContext: string | undefined;
      try {
        const parentText = $(el).parent().text().replace(/\s+/g, " ").trim();
        if (parentText) {
          const anchor = anchorText ?? "";
          const idx = anchor ? parentText.indexOf(anchor) : -1;
          if (idx >= 0) {
            const before = parentText.slice(Math.max(0, idx - 60), idx).trim();
            const after = parentText.slice(idx + anchor.length, idx + anchor.length + 60).trim();
            const stitched = `${before} «${anchor}» ${after}`.replace(/\s+/g, " ").trim();
            linkContext = stitched.slice(0, 200);
          } else {
            linkContext = parentText.slice(0, 200);
          }
        }
      } catch { /* context is best-effort */ }

      const refs = discoveredInternal.get(abs);
      const ref: LinkRef = { originPage: pageUrl, anchorText, linkContext, outerHtml };
      if (refs) {
        // Only append a second reference if the origin page is different —
        // multiple <a> tags to the same target on the same page would just
        // create duplicate rows in the advisor.
        if (!refs.some((r) => r.originPage === pageUrl)) refs.push(ref);
      } else {
        discoveredInternal.set(abs, [ref]);
      }

      if (!visited.has(abs) && !queued.has(abs) && visited.size < maxPagesCap) {
        queue.push(abs);
        queued.add(abs);
      }
    });
  }

  await new Promise<void>((resolve) => {
    function tryFinish() {
      // Resolve when every in-flight fetch has returned AND either the queue
      // is empty or we've hit the cap. Previously this only checked queue.length,
      // which meant caps never terminated the BFS on sites whose sitemap had
      // more URLs than maxPages — crawler hung forever.
      if (outstanding === 0 && (queue.length === 0 || visited.size >= maxPagesCap)) {
        resolve();
      }
    }

    // Mid-crawl agentic replan — after 30% of maxPages have been visited,
    // re-prioritize the REMAINING queue using what we've learned from the
    // pages crawled so far (titles, statuses, content-type). Fires at most
    // once per crawl. No-op when agentic is off or Ollama is unavailable.
    let midReplanFired = false;
    const replanThreshold = Math.max(5, Math.floor(maxPagesCap * 0.3));
    async function maybeReplan(): Promise<void> {
      if (midReplanFired) return;
      if (!options.agentic || !agenticMeta) return;
      if (visited.size < replanThreshold) return;
      if (queue.length < 10) return;
      midReplanFired = true;
      try {
        const replanStart = Date.now();
        const { checkOllamaAvailable } = await import("./agentic/llm-router.js");
        if (!(await checkOllamaAvailable())) return;
        const { prioritizeUrls } = await import("./agentic/crawl-planner.js");
        const priorities = await prioritizeUrls(queue.slice(), {
          hostname,
          focusKeywords: agenticMeta.focusKeywords,
          prioritySections: agenticMeta.prioritySections,
        });
        if (priorities.length > 0) {
          const priorityByUrl = new Map<string, number>();
          for (const p of priorities) priorityByUrl.set(p.url, p.priority);
          const before = queue.slice();
          queue.sort((a, b) => (priorityByUrl.get(b) ?? 50) - (priorityByUrl.get(a) ?? 50));
          let moved = 0;
          for (let i = 0; i < queue.length; i++) if (queue[i] !== before[i]) moved++;
          agenticMeta.replanCount++;
          agenticMeta.reorderedCount += moved;
          agenticMeta.plannerMs += Date.now() - replanStart;
          console.log(`[crawl/agentic] ${hostname}: mid-crawl replan after ${visited.size} pages — moved ${moved} URLs`);
        }
      } catch { /* replan is best-effort */ }
    }

    function scheduleNext(): void {
      // Fire the one-shot replan on entry; fire-and-forget so BFS doesn't block.
      if (!midReplanFired && visited.size >= replanThreshold && queue.length >= 10) {
        void maybeReplan();
      }
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
  const toVerifyAll = [...discoveredInternal.keys()].filter((u) => !visited.has(u));
  const toVerify = toVerifyAll.slice(0, maxLinkChecksCap);
  await Promise.all(
    toVerify.map((target) =>
      limit(async () => {
        const { status, error, durationMs, method } = await headOrGetStatus(target, options.requestTimeoutMs);
        const linkOk = status >= 200 && status < 400;
        linkChecks.push({ target, status, ok: linkOk, durationMs, method });
        if (!linkOk) {
          // Emit one BrokenLinkRecord per origin page so the SEO team can see
          // exactly which page(s) contain the broken <a href>. Anchor text +
          // outerHtml are passed through so the Link Fix Advisor can show the
          // exact tag as it appears in the HTML.
          const refs = discoveredInternal.get(target) ?? [];
          if (refs.length === 0) {
            brokenLinks.push({
              foundOn: "(discovered, not crawled)",
              target,
              status: status || undefined,
              error: error ?? (status ? `HTTP ${status}` : undefined),
              durationMs,
            });
          } else {
            for (const ref of refs) {
              brokenLinks.push({
                foundOn: ref.originPage,
                target,
                status: status || undefined,
                error: error ?? (status ? `HTTP ${status}` : undefined),
                durationMs,
                anchorText: ref.anchorText,
                linkContext: ref.linkContext,
                outerHtml: ref.outerHtml,
              });
            }
          }
        }
      }),
    ),
  );

  /**
   * Second pass: for pages that we actually crawled AND that returned a bad
   * status (broken target), also attribute them back to the pages that linked
   * to them. The initial "(crawl)" record at line ~490 stays (it represents
   * the failed fetch itself), but we add per-origin records so the SEO team
   * sees "page X links to broken page Y" for crawled-but-broken targets too.
   */
  for (const p of pages) {
    if (p.ok) continue;
    const refs = discoveredInternal.get(p.url);
    if (!refs || refs.length === 0) continue;
    for (const ref of refs) {
      if (ref.originPage === p.url) continue; // don't self-attribute
      brokenLinks.push({
        foundOn: ref.originPage,
        target: p.url,
        status: p.status || undefined,
        error: p.error ?? (p.status ? `HTTP ${p.status}` : undefined),
        durationMs: p.durationMs,
        anchorText: ref.anchorText,
        linkContext: ref.linkContext,
        outerHtml: ref.outerHtml,
      });
    }
  }

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

  // Dedupe + relabel synthetic "(crawl)" placeholders. The main fetch loop
  // emits a "(crawl)" record the moment a page 404/410s, before we know which
  // other pages link to it. The second pass above then adds one record per
  // origin page. If those origin records exist, the "(crawl)" row is
  // redundant; if they don't, the target is sitemap/seed-only with no
  // internal <a> pointing at it — relabel so SEO teams can tell the two apart.
  const targetsWithBetterLabel = new Set<string>();
  for (const bl of brokenLinks) {
    if (bl.foundOn !== "(crawl)") targetsWithBetterLabel.add(bl.target);
  }
  const cleanedBrokenLinks: BrokenLinkRecord[] = [];
  for (const bl of brokenLinks) {
    if (bl.foundOn !== "(crawl)") {
      cleanedBrokenLinks.push(bl);
    } else if (!targetsWithBetterLabel.has(bl.target)) {
      cleanedBrokenLinks.push({ ...bl, foundOn: "(sitemap/seed — no internal link)" });
    }
  }

  const durationMs = Date.now() - started;
  if (headlessFallbackEnabled && spaRenderedCount > 0) {
    console.log(`[crawl/spa-fallback] ${hostname}: re-rendered ${spaRenderedCount} SPA shell page${spaRenderedCount === 1 ? "" : "s"} via Chromium`);
  }
  return {
    startUrl: options.startUrl,
    siteId,
    hostname,
    pagesVisited: visited.size,
    uniqueUrlsChecked: visited.size + toVerify.length,
    pages,
    brokenLinks: cleanedBrokenLinks,
    linkChecks,
    durationMs,
    agenticMeta,
    spaRenderedCount: headlessFallbackEnabled ? spaRenderedCount : undefined,
  };
}
