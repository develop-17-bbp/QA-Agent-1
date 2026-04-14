import type { SiteHealthReport } from "../types.js";

interface AuditIssue {
  severity: "critical" | "warning" | "info";
  category: "seo" | "technical" | "performance" | "content" | "links";
  title: string;
  description: string;
  affectedUrls: string[];
}

interface CategoryScore { score: number; checks: number; passed: number; }

export function analyzeSiteAudit(reports: SiteHealthReport[]) {
  const issues: AuditIssue[] = [];
  const allPages = reports.flatMap(r => r.crawl.pages);
  const okPages = allPages.filter(p => p.ok);
  const totalPages = allPages.length;

  // SEO checks
  const missingTitle = allPages.filter(p => !p.documentTitle?.trim());
  if (missingTitle.length > 0) issues.push({ severity: "critical", category: "seo", title: "Missing page titles", description: `${missingTitle.length} page(s) have no title tag`, affectedUrls: missingTitle.map(p => p.url).slice(0, 20) });

  const missingH1 = allPages.filter(p => p.h1Count === 0);
  if (missingH1.length > 0) issues.push({ severity: "critical", category: "seo", title: "Missing H1 tags", description: `${missingH1.length} page(s) have no H1 heading`, affectedUrls: missingH1.map(p => p.url).slice(0, 20) });

  const multipleH1 = allPages.filter(p => p.h1Count !== undefined && p.h1Count > 1);
  if (multipleH1.length > 0) issues.push({ severity: "warning", category: "seo", title: "Multiple H1 tags", description: `${multipleH1.length} page(s) have more than one H1`, affectedUrls: multipleH1.map(p => p.url).slice(0, 20) });

  const missingMeta = allPages.filter(p => !p.metaDescriptionLength || p.metaDescriptionLength === 0);
  if (missingMeta.length > 0) issues.push({ severity: "critical", category: "seo", title: "Missing meta descriptions", description: `${missingMeta.length} page(s) have no meta description`, affectedUrls: missingMeta.map(p => p.url).slice(0, 20) });

  const shortMeta = allPages.filter(p => p.metaDescriptionLength !== undefined && p.metaDescriptionLength > 0 && p.metaDescriptionLength < 120);
  if (shortMeta.length > 0) issues.push({ severity: "warning", category: "seo", title: "Short meta descriptions", description: `${shortMeta.length} page(s) have meta descriptions under 120 characters`, affectedUrls: shortMeta.map(p => p.url).slice(0, 20) });

  const longMeta = allPages.filter(p => p.metaDescriptionLength !== undefined && p.metaDescriptionLength > 160);
  if (longMeta.length > 0) issues.push({ severity: "warning", category: "seo", title: "Long meta descriptions", description: `${longMeta.length} page(s) have meta descriptions over 160 characters`, affectedUrls: longMeta.map(p => p.url).slice(0, 20) });

  const missingCanonical = allPages.filter(p => !p.canonicalUrl);
  if (missingCanonical.length > 0) issues.push({ severity: "warning", category: "seo", title: "Missing canonical URLs", description: `${missingCanonical.length} page(s) have no canonical tag`, affectedUrls: missingCanonical.map(p => p.url).slice(0, 20) });

  const missingLang = allPages.filter(p => !p.documentLang);
  if (missingLang.length > 0) issues.push({ severity: "info", category: "seo", title: "Missing language attribute", description: `${missingLang.length} page(s) have no lang attribute`, affectedUrls: missingLang.map(p => p.url).slice(0, 20) });

  // Duplicate titles
  const titleCounts = new Map<string, string[]>();
  for (const p of allPages) {
    if (!p.documentTitle?.trim()) continue;
    const t = p.documentTitle.trim();
    const arr = titleCounts.get(t) ?? [];
    arr.push(p.url);
    titleCounts.set(t, arr);
  }
  const dupTitles = [...titleCounts.entries()].filter(([, urls]) => urls.length > 1);
  if (dupTitles.length > 0) issues.push({ severity: "warning", category: "content", title: "Duplicate titles", description: `${dupTitles.length} title(s) are used on multiple pages`, affectedUrls: dupTitles.flatMap(([, urls]) => urls).slice(0, 20) });

  // Technical checks
  const brokenLinks = reports.flatMap(r => r.crawl.brokenLinks);
  if (brokenLinks.length > 0) issues.push({ severity: "critical", category: "links", title: "Broken links detected", description: `${brokenLinks.length} broken link(s) found`, affectedUrls: [...new Set(brokenLinks.map(l => l.target))].slice(0, 20) });

  const failedPages = allPages.filter(p => !p.ok);
  if (failedPages.length > 0) issues.push({ severity: "critical", category: "technical", title: "Failed page fetches", description: `${failedPages.length} page(s) returned errors`, affectedUrls: failedPages.map(p => p.url).slice(0, 20) });

  const redirectPages = allPages.filter(p => p.status >= 300 && p.status < 400);
  if (redirectPages.length > 0) issues.push({ severity: "info", category: "technical", title: "Redirect pages", description: `${redirectPages.length} page(s) return redirects`, affectedUrls: redirectPages.map(p => p.url).slice(0, 20) });

  const slowPages = okPages.filter(p => p.durationMs > 4000);
  if (slowPages.length > 0) issues.push({ severity: "warning", category: "performance", title: "Slow loading pages", description: `${slowPages.length} page(s) take over 4 seconds to load`, affectedUrls: slowPages.map(p => p.url).slice(0, 20) });

  const verySlowPages = okPages.filter(p => p.durationMs > 8000);
  if (verySlowPages.length > 0) issues.push({ severity: "critical", category: "performance", title: "Very slow pages", description: `${verySlowPages.length} page(s) take over 8 seconds to load`, affectedUrls: verySlowPages.map(p => p.url).slice(0, 20) });

  const thinContent = allPages.filter(p => p.bodyBytes !== undefined && p.bodyBytes < 1000 && p.ok);
  if (thinContent.length > 0) issues.push({ severity: "warning", category: "content", title: "Thin content pages", description: `${thinContent.length} page(s) have very little content (< 1KB)`, affectedUrls: thinContent.map(p => p.url).slice(0, 20) });

  // Category scores
  function catScore(cat: string): CategoryScore {
    const catIssues = issues.filter(i => i.category === cat);
    const criticals = catIssues.filter(i => i.severity === "critical").length;
    const warnings = catIssues.filter(i => i.severity === "warning").length;
    const checks = totalPages > 0 ? Math.max(5, catIssues.length + 3) : 0;
    const passed = checks - criticals - warnings;
    const score = checks > 0 ? Math.max(0, Math.min(100, Math.round((passed / checks) * 100 - criticals * 10))) : 100;
    return { score, checks, passed: Math.max(0, passed) };
  }

  const categories = {
    seo: catScore("seo"),
    technical: catScore("technical"),
    performance: catScore("performance"),
    content: catScore("content"),
    links: catScore("links"),
  };

  const overall = Math.round(Object.values(categories).reduce((a, c) => a + c.score, 0) / 5);

  return {
    score: overall,
    categories,
    issues,
    summary: {
      totalPages,
      okPages: okPages.length,
      failedPages: failedPages.length,
      criticalIssues: issues.filter(i => i.severity === "critical").length,
      warnings: issues.filter(i => i.severity === "warning").length,
      info: issues.filter(i => i.severity === "info").length,
    },
  };
}
