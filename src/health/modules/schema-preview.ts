/**
 * Schema.org Rich-Result Preview — given a URL, fetches HTML, parses
 * JSON-LD blocks, and tells you which Google rich-result type this
 * page would render in SERP. Closes the "I added schema but Google
 * doesn't show the rich result" guesswork.
 */

import { load } from "cheerio";

const FETCH_TIMEOUT_MS = 8_000;

export type RichResultType =
  | "article" | "faq" | "howto" | "recipe" | "product" | "review"
  | "video" | "event" | "organization" | "breadcrumb" | "local-business" | "none";

export interface SchemaPreviewItem {
  schemaType: string;
  /** What rich result would render. */
  richResult: RichResultType;
  /** Required fields present (true) or missing (with the missing list in `missingRequired`). */
  isValid: boolean;
  missingRequired: string[];
  /** Short human-readable preview snippet (e.g. "FAQ: 3 Q&A pairs would render"). */
  preview: string;
  /** Raw fields lifted from the JSON-LD for the UI to render. */
  raw: Record<string, unknown>;
}

export interface SchemaPreviewResult {
  url: string;
  fetchedAt: string;
  blocksFound: number;
  items: SchemaPreviewItem[];
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QA-Agent-Schema/1.0)", Accept: "text/html" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function classifyRichResult(schemaType: string): RichResultType {
  const t = schemaType.toLowerCase();
  if (t === "article" || t === "newsarticle" || t === "blogposting") return "article";
  if (t === "faqpage") return "faq";
  if (t === "howto") return "howto";
  if (t === "recipe") return "recipe";
  if (t === "product") return "product";
  if (t === "review" || t === "aggregaterating") return "review";
  if (t === "videoobject") return "video";
  if (t === "event") return "event";
  if (t === "organization" || t === "corporation") return "organization";
  if (t === "breadcrumblist") return "breadcrumb";
  if (t === "localbusiness" || t.endsWith("business")) return "local-business";
  return "none";
}

function checkRequired(rich: RichResultType, fields: Record<string, unknown>): { valid: boolean; missing: string[]; preview: string } {
  const missing: string[] = [];
  switch (rich) {
    case "faq": {
      const items = (fields.mainEntity as unknown[] | undefined) ?? [];
      if (!Array.isArray(items) || items.length === 0) missing.push("mainEntity[]");
      return { valid: missing.length === 0, missing, preview: `FAQ: ${Array.isArray(items) ? items.length : 0} Q&A pair(s) would render` };
    }
    case "howto": {
      if (!fields.name) missing.push("name");
      const steps = (fields.step as unknown[] | undefined) ?? [];
      if (!Array.isArray(steps) || steps.length === 0) missing.push("step[]");
      return { valid: missing.length === 0, missing, preview: `HowTo: "${fields.name ?? "?"}" with ${Array.isArray(steps) ? steps.length : 0} step(s)` };
    }
    case "recipe": {
      if (!fields.name) missing.push("name");
      if (!fields.recipeIngredient) missing.push("recipeIngredient");
      if (!fields.recipeInstructions) missing.push("recipeInstructions");
      return { valid: missing.length === 0, missing, preview: `Recipe card: "${fields.name ?? "?"}"` };
    }
    case "article": {
      if (!fields.headline) missing.push("headline");
      if (!fields.author) missing.push("author");
      if (!fields.datePublished) missing.push("datePublished");
      return { valid: missing.length === 0, missing, preview: `Article: "${fields.headline ?? "?"}"` };
    }
    case "product": {
      if (!fields.name) missing.push("name");
      if (!fields.offers && !fields.aggregateRating) missing.push("offers OR aggregateRating");
      return { valid: missing.length === 0, missing, preview: `Product: "${fields.name ?? "?"}"` };
    }
    case "review": {
      if (!fields.itemReviewed) missing.push("itemReviewed");
      if (!fields.reviewRating) missing.push("reviewRating");
      return { valid: missing.length === 0, missing, preview: `Review (${(fields.reviewRating as any)?.ratingValue ?? "?"}/5)` };
    }
    case "video": {
      if (!fields.name) missing.push("name");
      if (!fields.thumbnailUrl) missing.push("thumbnailUrl");
      if (!fields.uploadDate) missing.push("uploadDate");
      return { valid: missing.length === 0, missing, preview: `Video: "${fields.name ?? "?"}"` };
    }
    case "event": {
      if (!fields.name) missing.push("name");
      if (!fields.startDate) missing.push("startDate");
      if (!fields.location) missing.push("location");
      return { valid: missing.length === 0, missing, preview: `Event: "${fields.name ?? "?"}"` };
    }
    case "local-business": {
      if (!fields.name) missing.push("name");
      if (!fields.address) missing.push("address");
      if (!fields.telephone) missing.push("telephone");
      return { valid: missing.length === 0, missing, preview: `Local business: "${fields.name ?? "?"}"` };
    }
    case "breadcrumb": {
      const items = (fields.itemListElement as unknown[] | undefined) ?? [];
      if (!Array.isArray(items) || items.length === 0) missing.push("itemListElement[]");
      return { valid: missing.length === 0, missing, preview: `Breadcrumbs: ${Array.isArray(items) ? items.length : 0} hop(s)` };
    }
    case "organization": {
      if (!fields.name) missing.push("name");
      if (!fields.url) missing.push("url");
      return { valid: missing.length === 0, missing, preview: `Organization: "${fields.name ?? "?"}"` };
    }
    default:
      return { valid: false, missing: [], preview: "no rich-result mapping for this schema type" };
  }
}

export async function previewSchema(url: string): Promise<SchemaPreviewResult> {
  const html = await fetchHtml(url);
  const $ = load(html);
  const items: SchemaPreviewItem[] = [];
  const blocks = $('script[type="application/ld+json"]').toArray();
  for (const b of blocks) {
    const raw = $(b).html() ?? "";
    if (!raw.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    // Schemas can be objects, arrays, or graph-wrapped — flatten.
    const flatten = (v: unknown): Record<string, unknown>[] => {
      if (!v || typeof v !== "object") return [];
      if (Array.isArray(v)) return v.flatMap(flatten);
      const obj = v as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) return (obj["@graph"] as unknown[]).flatMap(flatten);
      return [obj];
    };
    for (const node of flatten(parsed)) {
      const type = node["@type"];
      const schemaType = Array.isArray(type) ? String(type[0] ?? "") : String(type ?? "");
      if (!schemaType) continue;
      const rich = classifyRichResult(schemaType);
      const { valid, missing, preview } = checkRequired(rich, node);
      items.push({
        schemaType,
        richResult: rich,
        isValid: valid,
        missingRequired: missing,
        preview,
        raw: node,
      });
    }
  }
  return {
    url,
    fetchedAt: new Date().toISOString(),
    blocksFound: blocks.length,
    items,
  };
}
