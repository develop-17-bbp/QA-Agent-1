import { load } from "cheerio";
import type { BrokenLinkRecord, CrawlSiteResult, PageFetchRecord } from "./types.js";
import { siteIdFromUrl } from "./load-urls.js";

const UA = "QA-Agent/0.2 (+https://github.com) site-health-crawl";

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function normalizeHref(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.toLowerCase().startsWith("javascript:")) {
    return null;
  }
  if (/^(mailto:|tel:)/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, pageUrl).href;
  } catch {
    return null;
  }
}

async function fetchPage(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: string | null; error?: string }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = res.headers.get("content-type") ?? "";
    const body =
      ct.includes("text/html") || ct.includes("application/xhtml") || ct.includes("xml")
        ? await res.text()
        : null;
    return { status: res.status, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, body: null, error: msg };
  }
}

async function headOrGetStatus(target: string, timeoutMs: number): Promise<{ status: number; error?: string }> {
  try {
    const res = await fetch(target, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 405 || res.status === 501) {
      const g = await fetch(target, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": UA, Range: "bytes=0-0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: g.status };
    }
    return { status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, error: msg };
  }
}

export async function crawlSite(options: {
  startUrl: string;
  maxPages: number;
  /** Max extra same-origin URLs to verify with HEAD (links found but not visited in BFS) */
  maxLinkChecks: number;
  requestTimeoutMs: number;
}): Promise<CrawlSiteResult> {
  const started = Date.now();
  const base = new URL(options.startUrl);
  const hostname = base.hostname;
  const siteId = siteIdFromUrl(options.startUrl);

  const visited = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [base.href];
  queued.add(base.href);

  const pages: PageFetchRecord[] = [];
  const brokenLinks: BrokenLinkRecord[] = [];
  /** Every unique same-origin URL we discover from <a href> — verify even if not crawled */
  const discoveredInternal = new Set<string>();

  while (queue.length > 0 && visited.size < options.maxPages) {
    const pageUrl = queue.shift()!;
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    const { status, body, error } = await fetchPage(pageUrl, options.requestTimeoutMs);
    const ok = status >= 200 && status < 400;
    pages.push({ url: pageUrl, status, ok, error: error ?? (ok ? undefined : `HTTP ${status}`) });

    if (!ok && status !== 0) {
      brokenLinks.push({ foundOn: "(crawl)", target: pageUrl, status, error });
    }
    if (error && status === 0) {
      brokenLinks.push({ foundOn: "(crawl)", target: pageUrl, error });
    }

    if (!body || !ok) continue;

    const $ = load(body);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const abs = normalizeHref(href, pageUrl);
      if (!abs || !sameOrigin(abs, pageUrl)) return;
      discoveredInternal.add(abs);

      if (!visited.has(abs) && !queued.has(abs) && visited.size < options.maxPages) {
        queue.push(abs);
        queued.add(abs);
      }
    });
  }

  /** Verify discovered internal links we did not crawl (HEAD/GET), capped */
  const toVerifyAll = [...discoveredInternal].filter((u) => !visited.has(u));
  const toVerify = toVerifyAll.slice(0, options.maxLinkChecks);
  for (const target of toVerify) {
    const { status, error } = await headOrGetStatus(target, options.requestTimeoutMs);
    const linkOk = status >= 200 && status < 400;
    if (!linkOk) {
      brokenLinks.push({
        foundOn: "(discovered, not crawled)",
        target,
        status: status || undefined,
        error: error ?? (status ? `HTTP ${status}` : undefined),
      });
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
    durationMs,
  };
}
