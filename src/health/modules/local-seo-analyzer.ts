import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";

// ── Unit 6 honesty goal ──────────────────────────────────────────────────────
//
// The OLD version asked the LLM to invent local keywords, GBP tips, citation
// sources, NAP scores, ranking factors, review targets, and competitor
// analysis — every field a pure hallucination with no basis in the user's
// actual site. A local SEO agency would immediately lose trust.
//
// This rewrite converts the feature to a CHECKLIST-FIRST output. Every check
// is a deterministic test against real crawl data plus one HTTP re-fetch of
// the business's start URL for JSON-LD / tel: / address pattern detection.
//
// The LLM is restricted to ONE job: producing a plain-text fix suggestion for
// each failed checklist item. It never invents scores, ranks, or "likelihoods".
//
// ─────────────────────────────────────────────────────────────────────────────

type DataQuality = {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};

export type CheckStatus = "pass" | "fail" | "na";
export type CheckCategory = "NAP & Contact" | "Schema Markup" | "Localization" | "Discoverability";

export interface LocalSeoCheck {
  id: string;
  category: CheckCategory;
  label: string;
  status: CheckStatus;
  /** Short text evidence pointing at the crawl field or snippet that decided the check. */
  evidence?: string;
  /** LLM-generated plain-text fix suggestion — only set for failed checks. */
  fixSuggestion?: string;
}

export interface LocalSeoResult {
  businessName: string;
  location: string;
  startUrl: string;
  checks: LocalSeoCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    na: number;
  };
  meta: {
    pagesScanned: number;
    hostnames: string[];
    htmlFetched: boolean;
    htmlFetchError?: string;
  };
  dataQuality: DataQuality;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;
const TEL_HREF_RE = /href=["']tel:[^"']+["']/i;
const STREET_RE = /\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Ave|Avenue|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Place|Pl|Court|Ct|Parkway|Pkwy|Highway|Hwy)\b/;

interface JsonLdBlock {
  raw: string;
  type?: string | string[];
  data: Record<string, unknown>;
}

function extractJsonLd(html: string): JsonLdBlock[] {
  const blocks: JsonLdBlock[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim() ?? "";
    try {
      const parsed = JSON.parse(raw);
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        if (it && typeof it === "object") {
          const obj = it as Record<string, unknown>;
          blocks.push({ raw, type: obj["@type"] as string | string[] | undefined, data: obj });
          // walk @graph if present
          const graph = obj["@graph"];
          if (Array.isArray(graph)) {
            for (const g of graph) {
              if (g && typeof g === "object") {
                const gobj = g as Record<string, unknown>;
                blocks.push({ raw, type: gobj["@type"] as string | string[] | undefined, data: gobj });
              }
            }
          }
        }
      }
    } catch { /* skip malformed */ }
  }
  return blocks;
}

function hasJsonLdType(blocks: JsonLdBlock[], wanted: string | RegExp): boolean {
  for (const b of blocks) {
    const types = Array.isArray(b.type) ? b.type : [b.type];
    for (const t of types) {
      if (!t || typeof t !== "string") continue;
      if (wanted instanceof RegExp ? wanted.test(t) : t === wanted) return true;
    }
  }
  return false;
}

function findInJsonLd(blocks: JsonLdBlock[], keys: string[]): boolean {
  const keySet = new Set(keys);
  const walk = (v: unknown): boolean => {
    if (v && typeof v === "object") {
      if (Array.isArray(v)) return v.some(walk);
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (keySet.has(k) && val != null) return true;
        if (walk(val)) return true;
      }
    }
    return false;
  };
  return blocks.some((b) => walk(b.data));
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QA-Agent/1.0)" },
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(tid);
    return null;
  }
}

export async function analyzeLocalSeo(
  businessName: string,
  location: string,
  reports?: SiteHealthReport[],
): Promise<LocalSeoResult> {
  const businessLower = businessName.trim().toLowerCase();
  const locationLower = location.trim().toLowerCase();
  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const realDataFields: string[] = [];
  const estimatedFields: string[] = [];
  const missingFields: string[] = [];

  const allPages = reports?.flatMap((r) => r.crawl.pages) ?? [];
  const hostnames = [...new Set(reports?.map((r) => r.hostname) ?? [])];
  const startUrl = reports?.[0]?.startUrl ?? "";
  let startPage = allPages.find((p) => p.url === startUrl) ?? allPages[0];

  if (allPages.length > 0) {
    providersHit.push("crawl");
    realDataFields.push("crawl-fields");
  } else {
    missingFields.push("crawl");
  }

  // ── Re-fetch the start URL for schema + NAP detection ───────────────────
  let html = "";
  let htmlFetched = false;
  let htmlFetchError: string | undefined;
  if (startUrl) {
    const res = await fetchHtml(startUrl);
    if (res) {
      html = res;
      htmlFetched = true;
      providersHit.push("http-refetch");
      realDataFields.push("start-url-html");
    } else {
      htmlFetchError = "HTTP re-fetch failed";
      providersFailed.push("http-refetch");
    }
  } else {
    missingFields.push("start-url");
  }

  const jsonLd = html ? extractJsonLd(html) : [];

  // ── Build deterministic checks ──────────────────────────────────────────
  const checks: LocalSeoCheck[] = [];

  // NAP & Contact
  checks.push({
    id: "nap-phone-tel-link",
    category: "NAP & Contact",
    label: "Phone number present as tel: link",
    status: html ? (TEL_HREF_RE.test(html) ? "pass" : "fail") : "na",
    evidence: html ? (TEL_HREF_RE.test(html) ? "href='tel:...' found in start page HTML" : "No tel: link found on start page") : "start page HTML unavailable",
  });

  checks.push({
    id: "nap-phone-pattern",
    category: "NAP & Contact",
    label: "Visible phone number pattern",
    status: html ? (PHONE_RE.test(html.replace(/<[^>]+>/g, " ")) ? "pass" : "fail") : "na",
    evidence: html ? (PHONE_RE.test(html.replace(/<[^>]+>/g, " ")) ? "Phone-shaped number detected in body text" : "No phone pattern in body") : "start page HTML unavailable",
  });

  checks.push({
    id: "nap-street-address",
    category: "NAP & Contact",
    label: "Street address pattern in body",
    status: html ? (STREET_RE.test(html.replace(/<[^>]+>/g, " ")) ? "pass" : "fail") : "na",
    evidence: html ? (STREET_RE.test(html.replace(/<[^>]+>/g, " ")) ? "Street-shaped address detected" : "No street pattern found") : "start page HTML unavailable",
  });

  checks.push({
    id: "nap-business-name-in-title",
    category: "NAP & Contact",
    label: "Business name appears in a crawl page title",
    status: allPages.some((p) => p.documentTitle?.toLowerCase().includes(businessLower)) ? "pass" : "fail",
    evidence: `${allPages.filter((p) => p.documentTitle?.toLowerCase().includes(businessLower)).length} of ${allPages.length} crawl titles contain the business name`,
  });

  checks.push({
    id: "nap-contact-page",
    category: "NAP & Contact",
    label: "Contact page discovered in crawl",
    status: allPages.some((p) => /contact/i.test(p.url)) ? "pass" : "fail",
    evidence: allPages.some((p) => /contact/i.test(p.url)) ? "URL matching /contact/ found" : "No contact-page URL in crawl",
  });

  // Schema Markup
  checks.push({
    id: "schema-localbusiness",
    category: "Schema Markup",
    label: "JSON-LD LocalBusiness (or subtype) present",
    status: hasJsonLdType(jsonLd, /LocalBusiness|Organization|Restaurant|Store|Dentist|Hotel|AutoRepair|Hospital/) ? "pass" : "fail",
    evidence: hasJsonLdType(jsonLd, /LocalBusiness|Organization|Restaurant|Store|Dentist|Hotel|AutoRepair|Hospital/) ? "LocalBusiness/Org schema found" : html ? "No LocalBusiness/Org schema in JSON-LD" : "HTML unavailable",
  });

  checks.push({
    id: "schema-postal-address",
    category: "Schema Markup",
    label: "JSON-LD PostalAddress present",
    status: hasJsonLdType(jsonLd, "PostalAddress") || findInJsonLd(jsonLd, ["address"]) ? "pass" : "fail",
    evidence: hasJsonLdType(jsonLd, "PostalAddress") ? "PostalAddress schema found" : findInJsonLd(jsonLd, ["address"]) ? "address field on JSON-LD entity" : html ? "No address data in schema" : "HTML unavailable",
  });

  checks.push({
    id: "schema-opening-hours",
    category: "Schema Markup",
    label: "JSON-LD openingHours / openingHoursSpecification present",
    status: findInJsonLd(jsonLd, ["openingHours", "openingHoursSpecification"]) ? "pass" : "fail",
    evidence: findInJsonLd(jsonLd, ["openingHours", "openingHoursSpecification"]) ? "openingHours field in schema" : html ? "No hours in JSON-LD" : "HTML unavailable",
  });

  checks.push({
    id: "schema-geo",
    category: "Schema Markup",
    label: "JSON-LD geo coordinates present",
    status: findInJsonLd(jsonLd, ["geo"]) ? "pass" : "fail",
    evidence: findInJsonLd(jsonLd, ["geo"]) ? "geo field in schema" : html ? "No geo in JSON-LD" : "HTML unavailable",
  });

  // Localization
  checks.push({
    id: "loc-html-lang",
    category: "Localization",
    label: "<html lang> attribute declared",
    status: startPage?.documentLang ? "pass" : "fail",
    evidence: startPage?.documentLang ? `lang="${startPage.documentLang}"` : "No documentLang on start page",
  });

  checks.push({
    id: "loc-hreflang",
    category: "Localization",
    label: "hreflang alternate tags declared",
    status: html ? (/<link[^>]+rel=["']alternate["'][^>]+hreflang=/i.test(html) ? "pass" : "fail") : "na",
    evidence: html ? (/<link[^>]+rel=["']alternate["'][^>]+hreflang=/i.test(html) ? "hreflang link tags found" : "No hreflang tags found") : "HTML unavailable",
  });

  checks.push({
    id: "loc-geo-meta",
    category: "Localization",
    label: "geo.position or ICBM meta tags",
    status: html ? (/<meta[^>]+name=["'](?:geo\.position|ICBM|geo\.placename|geo\.region)["']/i.test(html) ? "pass" : "fail") : "na",
    evidence: html ? (/<meta[^>]+name=["'](?:geo\.position|ICBM|geo\.placename|geo\.region)["']/i.test(html) ? "geo.* meta tag found" : "No geo meta tags") : "HTML unavailable",
  });

  // Discoverability
  checks.push({
    id: "disco-map-embed",
    category: "Discoverability",
    label: "Map embed present",
    status: html ? (/(?:google\.com\/maps|maps\.google\.com|openstreetmap\.org|\/embed\/maps)/i.test(html) ? "pass" : "fail") : "na",
    evidence: html ? (/(?:google\.com\/maps|maps\.google\.com|openstreetmap\.org|\/embed\/maps)/i.test(html) ? "Map embed detected" : "No map embed found") : "HTML unavailable",
  });

  checks.push({
    id: "disco-location-in-title",
    category: "Discoverability",
    label: "Location appears in any page title",
    status: allPages.some((p) => p.documentTitle?.toLowerCase().includes(locationLower)) ? "pass" : "fail",
    evidence: `${allPages.filter((p) => p.documentTitle?.toLowerCase().includes(locationLower)).length} of ${allPages.length} titles contain the location`,
  });

  checks.push({
    id: "disco-canonical",
    category: "Discoverability",
    label: "Start page declares a canonical URL",
    status: startPage?.canonicalUrl ? "pass" : "fail",
    evidence: startPage?.canonicalUrl ? `canonical=${startPage.canonicalUrl}` : "No canonical on start page",
  });

  // ── LLM fix suggestions for failed checks (one batched call) ────────────
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length > 0) {
    const prompt = `You are a local SEO advisor. For each failed local SEO check below, write one short plain-text suggestion (≤120 chars) telling the user exactly what to add or fix. Return ONLY a JSON array of strings in the same order — no keys, no markdown.

Failed checks:
${failed.map((c, i) => `${i + 1}. [${c.category}] ${c.label} — evidence: ${c.evidence ?? ""}`).join("\n")}`;

    try {
      const text = await generateText(prompt);
      const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(clean) as unknown;
      if (Array.isArray(parsed) && parsed.length === failed.length) {
        for (let i = 0; i < failed.length; i++) {
          const s = parsed[i];
          failed[i].fixSuggestion = typeof s === "string" ? s.slice(0, 180) : "Fix this issue to improve local SEO.";
        }
        estimatedFields.push("fixSuggestion");
      } else {
        for (const f of failed) f.fixSuggestion = "Fix this issue to improve local SEO.";
      }
    } catch {
      for (const f of failed) f.fixSuggestion = "Fix this issue to improve local SEO.";
    }
  }

  const passed = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const naCount = checks.filter((c) => c.status === "na").length;

  return {
    businessName: businessName.trim(),
    location: location.trim(),
    startUrl: startUrl || "",
    checks,
    summary: { total: checks.length, passed, failed: failCount, na: naCount },
    meta: {
      pagesScanned: allPages.length,
      hostnames,
      htmlFetched,
      htmlFetchError,
    },
    dataQuality: {
      realDataFields: Array.from(new Set(realDataFields)),
      estimatedFields: Array.from(new Set(estimatedFields)),
      missingFields,
      providersHit: Array.from(new Set(providersHit)),
      providersFailed: Array.from(new Set(providersFailed)),
    } satisfies DataQuality,
  };
}
