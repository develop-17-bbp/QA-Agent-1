import Firecrawl from "@mendable/firecrawl-js";
import { load } from "cheerio";
import type { CrawlSiteResult, PageFetchRecord, BrokenLinkRecord, LinkCheckRecord } from "./types.js";
import { siteIdFromUrl } from "./load-urls.js";

/**
 * Resolve the Firecrawl API key from environment.
 * Returns `undefined` when not configured (caller falls back to fetch-based crawler).
 */
export function resolveFirecrawlApiKey(): string | undefined {
  return process.env.FIRECRAWL_API_KEY?.trim() || undefined;
}

/**
 * Crawl a site using Firecrawl's JS-rendered distributed crawler.
 * Returns the same `CrawlSiteResult` shape as the fetch-based `crawlSite()`,
 * so downstream code (reports, PageSpeed, viewport checks) works unchanged.
 */
export async function crawlWithFirecrawl(
  startUrl: string,
  options: { maxPages: number },
): Promise<CrawlSiteResult> {
  const apiKey = resolveFirecrawlApiKey();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

  const client = new Firecrawl({ apiKey });
  const started = Date.now();
  const base = new URL(startUrl);
  const hostname = base.hostname;
  const siteId = siteIdFromUrl(startUrl);

  // Request HTML so we can extract SEO signals (h1, canonical, etc.)
  const job = await client.crawl(startUrl, {
    limit: options.maxPages > 0 ? options.maxPages : 100,
    scrapeOptions: {
      formats: ["html"],
    },
  });

  if (job.status === "failed" || job.status === "cancelled") {
    throw new Error(`Firecrawl crawl ${job.status} (id: ${job.id})`);
  }

  const pages: PageFetchRecord[] = [];
  const brokenLinks: BrokenLinkRecord[] = [];
  const linkChecks: LinkCheckRecord[] = [];

  for (const doc of job.data ?? []) {
    const url = doc.metadata?.sourceURL ?? doc.metadata?.url ?? startUrl;
    const status = doc.metadata?.statusCode ?? 200;
    const ok = status >= 200 && status < 400;
    const contentType = doc.metadata?.contentType as string | undefined;

    // Extract SEO signals from HTML when available
    let documentTitle: string | undefined;
    let metaDescriptionLength = 0;
    let h1Count = 0;
    let documentLang: string | undefined;
    let canonicalUrl: string | undefined;
    let bodyBytes: number | undefined;

    if (doc.html) {
      const $ = load(doc.html);
      const titleRaw = $("title").first().text().replace(/\s+/g, " ").trim();
      documentTitle = titleRaw || undefined;

      const metaDesc =
        $('meta[name="description"]').attr("content")?.trim() ??
        $('meta[property="og:description"]').attr("content")?.trim() ??
        "";
      metaDescriptionLength = metaDesc.length;
      h1Count = $("h1").length;

      const langRaw = ($("html").attr("lang") ?? "").trim();
      documentLang = langRaw || undefined;

      const canon = $('link[rel="canonical"]').attr("href")?.trim();
      if (canon) {
        try {
          canonicalUrl = new URL(canon, url).href;
        } catch {
          // ignore malformed canonical
        }
      }

      bodyBytes = Buffer.byteLength(doc.html, "utf8");
    } else {
      // Fallback: use Firecrawl metadata when HTML wasn't returned
      documentTitle = doc.metadata?.title;
      const desc = doc.metadata?.description ?? doc.metadata?.ogDescription ?? "";
      metaDescriptionLength = desc.length;
      documentLang = doc.metadata?.language;
    }

    pages.push({
      url,
      status,
      ok,
      durationMs: 0, // Firecrawl doesn't expose per-page timing
      contentType,
      bodyBytes,
      documentTitle: documentTitle?.slice(0, 500),
      metaDescriptionLength,
      h1Count,
      documentLang,
      canonicalUrl,
    });

    if (!ok) {
      brokenLinks.push({
        foundOn: "(firecrawl)",
        target: url,
        status,
        error: doc.metadata?.error,
      });
    }
  }

  // Ensure the start URL appears in pages
  const startCanonical = base.href;
  if (!pages.some((p) => p.url === startCanonical)) {
    // Firecrawl may have followed a redirect; add a synthetic entry
    const firstPage = pages[0];
    if (firstPage) {
      pages.unshift({
        ...firstPage,
        url: startCanonical,
        redirected: true,
        finalUrl: firstPage.url,
      });
    }
  }

  const durationMs = Date.now() - started;

  return {
    startUrl,
    siteId,
    hostname,
    pagesVisited: pages.length,
    uniqueUrlsChecked: pages.length,
    pages,
    brokenLinks,
    linkChecks,
    durationMs,
  };
}
