/**
 * Hreflang enricher — validate `<link rel="alternate" hreflang>` declarations
 * across the whole crawl.
 *
 * Googlebot requires bidirectional confirmation: if page A declares page B
 * as the French alternate, page B must declare A as its English alternate.
 * When this fails, Google silently drops the hreflang signal for that pair
 * and serves the wrong locale to users. This enricher flags the common
 * failure modes:
 *
 *   - Non-mutual pairs (A → B declared, B doesn't list A back)
 *   - Missing x-default (no fallback for unmatched locales)
 *   - Invalid ISO codes (hreflang="en_us" instead of "en-us")
 *   - Self-targeting mismatch (page declares itself with a different lang)
 *
 * Reference:
 *   https://developers.google.com/search/docs/specialized/international/localized-versions
 */

import { load } from "cheerio";
import type { SiteHealthReport, HreflangFindings } from "../types.js";

/** ISO-639-1 language code + optional ISO-3166-1 region, or "x-default".
 *  Examples: "en", "en-US", "pt-BR", "x-default". We reject underscores
 *  (common CMS bug) and non-2-letter segments. */
const HREFLANG_RE = /^(x-default|[a-z]{2,3})(-[a-zA-Z]{2,4})?$/;

interface PageHreflangs {
  url: string;
  alternates: { hreflang: string; href: string }[];
  declaredLang?: string;
}

function normalizeUrl(href: string, base: string): string | null {
  try { return new URL(href, base).href; } catch { return null; }
}

export async function enrichHreflang(report: SiteHealthReport): Promise<HreflangFindings> {
  const pages: PageHreflangs[] = [];
  let pagesScanned = 0;

  for (const page of report.crawl.pages) {
    if (!page.retainedBody) continue;
    pagesScanned++;
    const alternates: { hreflang: string; href: string }[] = [];
    try {
      const $ = load(page.retainedBody);
      $("link[rel='alternate'][hreflang]").each((_, el) => {
        const hreflang = ($(el).attr("hreflang") ?? "").trim();
        const rawHref = ($(el).attr("href") ?? "").trim();
        if (!hreflang || !rawHref) return;
        const abs = normalizeUrl(rawHref, page.url);
        if (!abs) return;
        alternates.push({ hreflang, href: abs });
      });
    } catch { /* parse failure — skip */ }
    if (alternates.length > 0) {
      pages.push({ url: page.url, alternates, declaredLang: page.documentLang });
    }
  }

  const pagesWithHreflang = pages.length;

  // Build reciprocity map — for each (from→to) pair, do we see (to→from)?
  const byUrl = new Map<string, PageHreflangs>();
  for (const p of pages) byUrl.set(p.url, p);

  const nonMutualPairs: HreflangFindings["nonMutualPairs"] = [];
  const missingXDefault: string[] = [];
  const invalidLangs: HreflangFindings["invalidLangs"] = [];
  const selfTargetingMismatches: HreflangFindings["selfTargetingMismatches"] = [];

  for (const p of pages) {
    let hasXDefault = false;
    for (const alt of p.alternates) {
      if (!HREFLANG_RE.test(alt.hreflang)) {
        invalidLangs.push({ url: p.url, lang: alt.hreflang });
        continue;
      }
      if (alt.hreflang === "x-default") hasXDefault = true;
      // Self-targeting mismatch
      if (alt.href === p.url && p.declaredLang && alt.hreflang !== "x-default") {
        const altLang = alt.hreflang.split("-")[0]!.toLowerCase();
        const docLang = p.declaredLang.split("-")[0]!.toLowerCase();
        if (altLang !== docLang) {
          selfTargetingMismatches.push({ url: p.url, declaredLang: alt.hreflang, actualLang: p.declaredLang });
        }
      }
      // Reciprocity
      if (alt.href !== p.url) {
        const other = byUrl.get(alt.href);
        if (other) {
          const reciprocal = other.alternates.some((a) => a.href === p.url);
          if (!reciprocal) {
            nonMutualPairs.push({ from: p.url, to: alt.href, lang: alt.hreflang });
          }
        }
      }
    }
    if (!hasXDefault && p.alternates.length > 0) missingXDefault.push(p.url);
  }

  return {
    pagesWithHreflang,
    pagesScanned,
    nonMutualPairs: nonMutualPairs.slice(0, 200),
    missingXDefault: missingXDefault.slice(0, 200),
    invalidLangs: invalidLangs.slice(0, 200),
    selfTargetingMismatches: selfTargetingMismatches.slice(0, 100),
  };
}
