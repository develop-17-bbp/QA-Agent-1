/**
 * Structured-data (JSON-LD) enricher — extract and sanity-check schema.org
 * blocks from every crawled HTML page.
 *
 * Why this matters: JSON-LD is the single biggest rich-result lever in
 * modern SEO. A broken `Product` schema (missing price/offer) costs you
 * merchant-listing eligibility; a broken `BreadcrumbList` loses navigation
 * carousels. Crawlers like Google's Rich Results Test enforce required
 * properties per @type — this enricher mirrors that check at a basic
 * level so operators can see issues before publishing.
 *
 * Scope: parse all `<script type="application/ld+json">` blocks, count by
 * @type, flag blocks with missing required properties for the common
 * types. Doesn't revalidate full schema.org — that's a separate rabbit
 * hole. Focuses on the "would this get a rich result" question.
 */

import { load } from "cheerio";
import type { SiteHealthReport, StructuredDataFindings } from "../types.js";

/** Minimum required-property list per common @type. Sourced from
 *  schema.org + Google Rich Results docs. This is intentionally
 *  conservative — we flag missing required props, not missing
 *  recommended ones (those are too opinionated). */
const REQUIRED_PROPS: Record<string, string[]> = {
  Product: ["name"],
  Article: ["headline"],
  NewsArticle: ["headline"],
  BlogPosting: ["headline"],
  Organization: ["name"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Recipe: ["name", "recipeIngredient"],
  Event: ["name", "startDate"],
  LocalBusiness: ["name", "address"],
  Review: ["itemReviewed", "reviewRating"],
  Offer: ["price", "priceCurrency"],
  VideoObject: ["name", "contentUrl"],
  HowTo: ["name", "step"],
};

function extractTypes(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const maybeType = (node as Record<string, unknown>)["@type"];
  if (typeof maybeType === "string") return [maybeType];
  if (Array.isArray(maybeType)) return maybeType.filter((t): t is string => typeof t === "string");
  return [];
}

function checkBlock(block: unknown, issues: Set<string>, types: Set<string>): void {
  if (!block) return;
  if (Array.isArray(block)) {
    for (const entry of block) checkBlock(entry, issues, types);
    return;
  }
  if (typeof block !== "object") return;
  const record = block as Record<string, unknown>;
  // @graph is a container of entities — recurse.
  if (Array.isArray(record["@graph"])) {
    for (const entry of record["@graph"]) checkBlock(entry, issues, types);
    return;
  }
  const t = extractTypes(record);
  for (const type of t) {
    types.add(type);
    const required = REQUIRED_PROPS[type];
    if (!required) continue;
    for (const prop of required) {
      if (record[prop] == null || record[prop] === "") {
        issues.add(`${type} missing required "${prop}"`);
      }
    }
  }
}

export async function enrichStructuredData(report: SiteHealthReport): Promise<StructuredDataFindings> {
  const byType: Record<string, number> = {};
  const perPage: StructuredDataFindings["pages"] = [];
  let pagesWithSchema = 0;
  let pagesScanned = 0;
  let invalidJsonBlocks = 0;

  for (const page of report.crawl.pages) {
    if (!page.retainedBody) continue;
    pagesScanned++;
    const pageTypes = new Set<string>();
    const pageIssues = new Set<string>();
    let blocksTotal = 0;
    let blocksInvalidJson = 0;
    try {
      const $ = load(page.retainedBody);
      $("script[type='application/ld+json']").each((_, el) => {
        blocksTotal++;
        const raw = $(el).contents().text().trim();
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          checkBlock(parsed, pageIssues, pageTypes);
        } catch {
          blocksInvalidJson++;
          invalidJsonBlocks++;
        }
      });
    } catch { /* cheerio parse failure — skip silently */ }

    if (blocksTotal > 0) {
      pagesWithSchema++;
      for (const t of pageTypes) byType[t] = (byType[t] ?? 0) + 1;
      perPage.push({
        url: page.url,
        types: [...pageTypes].sort(),
        issues: [...pageIssues].sort(),
        blocksTotal,
        blocksInvalidJson,
      });
    } else if (blocksInvalidJson > 0) {
      perPage.push({ url: page.url, types: [], issues: ["invalid JSON in JSON-LD block"], blocksTotal, blocksInvalidJson });
    }
  }

  // Cap per-page list so the persisted report doesn't blow up on big sites.
  const cappedPages = perPage.slice(0, 500);

  return {
    pagesWithSchema,
    pagesScanned,
    byType,
    pages: cappedPages,
    invalidJsonBlocks,
  };
}
