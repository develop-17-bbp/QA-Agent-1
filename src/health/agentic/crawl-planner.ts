/**
 * Crawl Planner Agent — LLM-powered intelligent crawl planning
 *
 * Uses LLM to:
 * 1. Analyze site structure from initial pages to determine optimal crawl strategy
 * 2. Prioritize URLs based on SEO value, content depth, and business importance
 * 3. Adaptively adjust depth and breadth based on findings
 * 4. Identify high-value sections for deeper crawling
 */

import { routeLlmJson, type LlmResponse } from "./llm-router.js";
import { withLlmTelemetry } from "./llm-telemetry.js";

function plannerModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || "llama3.2";
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CrawlPlan {
  strategy: "breadth-first" | "depth-first" | "priority-guided" | "sitemap-first";
  maxDepth: number;
  prioritySections: string[];
  skipPatterns: string[];
  focusKeywords: string[];
  estimatedPages: number;
  reasoning: string;
  sectionWeights: Record<string, number>;
}

export interface UrlPriority {
  url: string;
  priority: number;      // 0-100
  reason: string;
  seoValue: "high" | "medium" | "low";
  suggestedDepth: number;
}

export interface CrawlInsight {
  type: "opportunity" | "issue" | "pattern";
  message: string;
  urls: string[];
  severity: "high" | "medium" | "low";
}

// ── Crawl planning ──────────────────────────────────────────────────────────

export async function planCrawl(
  startUrl: string,
  discoveredUrls: string[],
  pageData: { url: string; title: string; status: number; contentType?: string }[],
  memoryHint?: string,
): Promise<CrawlPlan> {
  const sampleUrls = discoveredUrls.slice(0, 50).join("\n");
  const pageSummary = pageData.slice(0, 20).map(p =>
    `${p.url} | ${p.title} | ${p.status} | ${p.contentType ?? "html"}`,
  ).join("\n");

  const memoryBlock = memoryHint ? `\nPRIOR MEMORY (use to bias the strategy — but reflect new evidence too):\n${memoryHint}\n` : "";
  const prompt = `You are an expert SEO crawler planner. Analyze this website and create an optimal crawl strategy.

Start URL: ${startUrl}
Discovered URLs (sample):
${sampleUrls}

Pages crawled so far:
${pageSummary}
${memoryBlock}
Return a JSON crawl plan with these fields:
{
  "strategy": "breadth-first" | "depth-first" | "priority-guided" | "sitemap-first",
  "maxDepth": number (1-10),
  "prioritySections": ["list of URL path prefixes to prioritize, e.g. /blog/, /products/"],
  "skipPatterns": ["URL patterns to skip, e.g. /tag/, /page/\\d+", "/wp-admin/"],
  "focusKeywords": ["keywords this site targets based on content"],
  "estimatedPages": number,
  "reasoning": "brief explanation of strategy choice",
  "sectionWeights": {"section_path": weight_0_to_100}
}

Consider: site structure, content types, SEO-important sections, duplicate content risk.`;

  try {
    const { data } = await withLlmTelemetry(
      "crawl-planner",
      plannerModel(),
      prompt,
      () => routeLlmJson<CrawlPlan>(prompt),
      (r) => JSON.stringify(r.data),
    );
    return {
      strategy: data.strategy || "priority-guided",
      maxDepth: Math.min(10, Math.max(1, data.maxDepth || 5)),
      prioritySections: Array.isArray(data.prioritySections) ? data.prioritySections : [],
      skipPatterns: Array.isArray(data.skipPatterns) ? data.skipPatterns : [],
      focusKeywords: Array.isArray(data.focusKeywords) ? data.focusKeywords : [],
      estimatedPages: data.estimatedPages || discoveredUrls.length,
      reasoning: data.reasoning || "Default strategy",
      sectionWeights: data.sectionWeights || {},
    };
  } catch {
    // Fallback: heuristic-based plan
    return buildHeuristicPlan(startUrl, discoveredUrls);
  }
}

function buildHeuristicPlan(startUrl: string, urls: string[]): CrawlPlan {
  const pathCounts = new Map<string, number>();
  for (const u of urls) {
    try {
      const segments = new URL(u).pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        const section = `/${segments[0]}/`;
        pathCounts.set(section, (pathCounts.get(section) ?? 0) + 1);
      }
    } catch { /* skip */ }
  }

  const sorted = [...pathCounts.entries()].sort((a, b) => b[1] - a[1]);
  const prioritySections = sorted.slice(0, 5).map(([s]) => s);
  const skipPatterns = ["/tag/", "/page/", "/wp-admin/", "/cart/", "/checkout/", "/my-account/", "/feed/"];
  const weights: Record<string, number> = {};
  for (const [section, count] of sorted.slice(0, 10)) {
    weights[section] = Math.min(100, Math.round((count / urls.length) * 200));
  }

  return {
    strategy: urls.length > 100 ? "priority-guided" : "breadth-first",
    maxDepth: urls.length > 500 ? 3 : 5,
    prioritySections,
    skipPatterns,
    focusKeywords: [],
    estimatedPages: urls.length,
    reasoning: "Heuristic plan based on URL structure analysis",
    sectionWeights: weights,
  };
}

// ── URL prioritization ───────────────────────────────────────────────────────

export async function prioritizeUrls(
  urls: string[],
  siteContext: { hostname: string; focusKeywords: string[]; prioritySections: string[] },
): Promise<UrlPriority[]> {
  if (urls.length === 0) return [];

  // For small sets, use LLM. For large sets, use heuristics.
  if (urls.length <= 30) {
    return await llmPrioritize(urls, siteContext);
  }
  return heuristicPrioritize(urls, siteContext);
}

async function llmPrioritize(
  urls: string[],
  ctx: { hostname: string; focusKeywords: string[]; prioritySections: string[] },
): Promise<UrlPriority[]> {
  const prompt = `Prioritize these URLs for SEO crawling. Site: ${ctx.hostname}
Focus keywords: ${ctx.focusKeywords.join(", ") || "none"}
Priority sections: ${ctx.prioritySections.join(", ") || "none"}

URLs:
${urls.join("\n")}

Return JSON array: [{"url": "...", "priority": 0-100, "reason": "brief", "seoValue": "high"|"medium"|"low", "suggestedDepth": 1-5}]
Sort by priority descending.`;

  try {
    const { data } = await withLlmTelemetry(
      "url-prioritization",
      plannerModel(),
      prompt,
      () => routeLlmJson<UrlPriority[]>(prompt),
      (r) => JSON.stringify(r.data),
    );
    if (Array.isArray(data)) return data;
  } catch { /* fallback below */ }
  return heuristicPrioritize(urls, ctx);
}

function heuristicPrioritize(
  urls: string[],
  ctx: { focusKeywords: string[]; prioritySections: string[] },
): UrlPriority[] {
  return urls.map(url => {
    let priority = 50;
    let reason = "Default priority";
    let seoValue: "high" | "medium" | "low" = "medium";

    try {
      const parsed = new URL(url);
      const path = parsed.pathname.toLowerCase();
      const depth = path.split("/").filter(Boolean).length;

      // Boost homepage and top-level pages
      if (depth <= 1) { priority += 20; reason = "Top-level page"; }

      // Boost priority sections
      if (ctx.prioritySections.some(s => path.startsWith(s.toLowerCase()))) {
        priority += 15;
        reason = "Priority section";
      }

      // Boost pages with keywords in URL
      if (ctx.focusKeywords.some(kw => path.includes(kw.toLowerCase().replace(/\s+/g, "-")))) {
        priority += 15;
        reason = "Contains focus keyword";
      }

      // Penalize deep pages
      if (depth > 4) priority -= 10;

      // Penalize pagination, tags, archives
      if (/\/(page|tag|category|archive|author)\//.test(path)) {
        priority -= 20;
        reason = "Pagination/taxonomy page";
        seoValue = "low";
      }

      // Boost product/blog/service pages
      if (/\/(product|blog|service|about|contact)/.test(path)) {
        priority += 10;
        seoValue = "high";
      }

      priority = Math.max(0, Math.min(100, priority));
      if (priority >= 70) seoValue = "high";
      else if (priority < 40) seoValue = "low";
    } catch { /* skip */ }

    return { url, priority, reason, seoValue, suggestedDepth: priority >= 70 ? 3 : 1 };
  }).sort((a, b) => b.priority - a.priority);
}

// ── Real-time crawl insights ─────────────────────────────────────────────────

export async function generateCrawlInsights(
  pages: { url: string; title: string; status: number; durationMs: number; bodyBytes?: number; h1Count?: number }[],
): Promise<CrawlInsight[]> {
  if (pages.length === 0) return [];

  // Heuristic insights (fast, no LLM)
  const insights: CrawlInsight[] = [];

  // Slow pages
  const slowPages = pages.filter(p => p.durationMs > 3000);
  if (slowPages.length > 0) {
    insights.push({
      type: "issue",
      message: `${slowPages.length} pages take >3s to load — investigate server performance`,
      urls: slowPages.slice(0, 5).map(p => p.url),
      severity: slowPages.length > pages.length * 0.3 ? "high" : "medium",
    });
  }

  // Missing titles
  const noTitle = pages.filter(p => !p.title?.trim());
  if (noTitle.length > 0) {
    insights.push({
      type: "issue",
      message: `${noTitle.length} pages missing document title — critical SEO issue`,
      urls: noTitle.slice(0, 5).map(p => p.url),
      severity: "high",
    });
  }

  // Multiple H1s
  const multiH1 = pages.filter(p => p.h1Count && p.h1Count > 1);
  if (multiH1.length > 0) {
    insights.push({
      type: "issue",
      message: `${multiH1.length} pages have multiple H1 tags — should have exactly one`,
      urls: multiH1.slice(0, 5).map(p => p.url),
      severity: "medium",
    });
  }

  // Thin content
  const thin = pages.filter(p => p.bodyBytes != null && p.bodyBytes < 1500 && p.status === 200);
  if (thin.length > 0) {
    insights.push({
      type: "opportunity",
      message: `${thin.length} pages have thin content (<1.5KB) — expand for better rankings`,
      urls: thin.slice(0, 5).map(p => p.url),
      severity: "medium",
    });
  }

  // Error pages
  const errors = pages.filter(p => p.status >= 400);
  if (errors.length > 0) {
    insights.push({
      type: "issue",
      message: `${errors.length} pages returning HTTP errors (4xx/5xx)`,
      urls: errors.slice(0, 5).map(p => p.url),
      severity: errors.length > 5 ? "high" : "medium",
    });
  }

  // Fast pages pattern
  const fastPages = pages.filter(p => p.durationMs < 500 && p.status === 200);
  if (fastPages.length > pages.length * 0.5) {
    insights.push({
      type: "pattern",
      message: `${Math.round(fastPages.length / pages.length * 100)}% of pages load under 500ms — excellent performance`,
      urls: [],
      severity: "low",
    });
  }

  // URL structure patterns
  const pathDepths = pages.map(p => { try { return new URL(p.url).pathname.split("/").filter(Boolean).length; } catch { return 0; } });
  const avgDepth = pathDepths.reduce((a, b) => a + b, 0) / (pathDepths.length || 1);
  if (avgDepth > 4) {
    insights.push({
      type: "opportunity",
      message: `Average URL depth is ${avgDepth.toFixed(1)} — consider flattening site architecture`,
      urls: [],
      severity: "medium",
    });
  }

  return insights;
}
