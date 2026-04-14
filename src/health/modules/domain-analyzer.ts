import type { SiteHealthReport } from "../types.js";

function scoreSeo(pages: any[]): number {
  if (pages.length === 0) return 0;
  let total = 0;
  for (const p of pages) {
    let s = 0;
    if (p.documentTitle?.trim()) s += 25;
    if (p.metaDescriptionLength && p.metaDescriptionLength >= 120 && p.metaDescriptionLength <= 160) s += 20;
    else if (p.metaDescriptionLength && p.metaDescriptionLength > 0) s += 10;
    if (p.h1Count === 1) s += 20;
    else if (p.h1Count && p.h1Count > 0) s += 10;
    if (p.canonicalUrl) s += 20;
    if (p.documentLang) s += 15;
    total += s;
  }
  return Math.round(total / pages.length);
}

function scorePerf(pages: any[]): number {
  if (pages.length === 0) return 0;
  const okPages = pages.filter((p: any) => p.ok);
  if (okPages.length === 0) return 0;
  let total = 0;
  for (const p of okPages) {
    let s = 0;
    if (p.durationMs < 1000) s += 40;
    else if (p.durationMs < 2000) s += 30;
    else if (p.durationMs < 4000) s += 20;
    else s += 5;
    // PageSpeed scores
    const ins = p.insights;
    if (ins) {
      const perf = ins.mobile?.scores?.performance ?? ins.desktop?.scores?.performance ?? ins.scores?.performance;
      if (typeof perf === "number") s += Math.round(perf * 0.6);
      else s += 30; // no data, neutral
    } else {
      s += 30;
    }
    total += s;
  }
  return Math.min(100, Math.round(total / okPages.length));
}

function scoreContent(pages: any[]): number {
  if (pages.length === 0) return 0;
  let total = 0;
  for (const p of pages) {
    let s = 0;
    const bytes = p.bodyBytes ?? 0;
    if (bytes > 5000) s += 40;
    else if (bytes > 2000) s += 25;
    else if (bytes > 500) s += 10;
    const ml = p.metaDescriptionLength ?? 0;
    if (ml >= 120 && ml <= 160) s += 30;
    else if (ml > 0) s += 15;
    if (p.documentTitle?.trim()) s += 30;
    total += s;
  }
  return Math.round(total / pages.length);
}

function scoreTechnical(pages: any[], brokenCount: number): number {
  if (pages.length === 0) return 0;
  const okRate = pages.filter((p: any) => p.ok).length / pages.length;
  const errorRate = pages.filter((p: any) => !p.ok).length / pages.length;
  const brokenRate = Math.min(1, brokenCount / Math.max(1, pages.length));
  return Math.round(Math.max(0, (okRate * 50 + (1 - errorRate) * 25 + (1 - brokenRate) * 25) * 1));
}

function scoreLinks(pages: any[], brokenCount: number): number {
  if (pages.length === 0) return 0;
  const penalty = Math.min(50, brokenCount * 5);
  const base = pages.length > 1 ? 80 : 50;
  return Math.max(0, base - penalty);
}

export function analyzeDomain(reports: SiteHealthReport[]) {
  const sites = reports.map(r => {
    const pages = r.crawl.pages;
    const okPages = pages.filter(p => p.ok);
    const avgLoadMs = okPages.length > 0 ? Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length) : 0;
    const brokenCount = r.crawl.brokenLinks.length;
    const seo = scoreSeo(pages);
    const performance = scorePerf(pages);
    const content = scoreContent(pages);
    const technical = scoreTechnical(pages, brokenCount);
    const links = scoreLinks(pages, brokenCount);
    const overall = Math.round((seo + performance + content + technical + links) / 5);
    const issues: string[] = [];
    if (seo < 50) issues.push("Poor SEO optimization");
    if (performance < 50) issues.push("Performance issues");
    if (brokenCount > 0) issues.push(`${brokenCount} broken links`);
    const failedPages = pages.filter(p => !p.ok).length;
    if (failedPages > 0) issues.push(`${failedPages} failed pages`);
    return {
      hostname: r.hostname,
      scores: { seo, performance, content, technical, links, overall },
      pageCount: pages.length,
      avgLoadMs,
      brokenLinks: brokenCount,
      issues,
    };
  });
  return { sites };
}

export function analyzeOrganicRankings(reports: SiteHealthReport[]) {
  const rankings: { url: string; title: string; score: number; hostname: string; factors: { title: number; meta: number; h1: number; speed: number; status: number } }[] = [];
  for (const r of reports) {
    for (const p of r.crawl.pages) {
      let titleScore = 0, metaScore = 0, h1Score = 0, speedScore = 0, statusScore = 0;
      if (p.documentTitle?.trim()) titleScore = p.documentTitle.length >= 30 && p.documentTitle.length <= 60 ? 25 : 15;
      const ml = p.metaDescriptionLength ?? 0;
      if (ml >= 120 && ml <= 160) metaScore = 20;
      else if (ml > 0) metaScore = 10;
      if (p.h1Count === 1) h1Score = 20;
      else if (p.h1Count && p.h1Count > 0) h1Score = 10;
      if (p.ok && p.durationMs < 2000) speedScore = 20;
      else if (p.ok && p.durationMs < 4000) speedScore = 10;
      else if (p.ok) speedScore = 5;
      statusScore = p.status === 200 ? 15 : p.ok ? 10 : 0;
      const score = titleScore + metaScore + h1Score + speedScore + statusScore;
      rankings.push({ url: p.url, title: p.documentTitle ?? "", score, hostname: r.hostname, factors: { title: titleScore, meta: metaScore, h1: h1Score, speed: speedScore, status: statusScore } });
    }
  }
  rankings.sort((a, b) => b.score - a.score);
  const dist = { excellent: rankings.filter(r => r.score >= 80).length, good: rankings.filter(r => r.score >= 60 && r.score < 80).length, average: rankings.filter(r => r.score >= 40 && r.score < 60).length, poor: rankings.filter(r => r.score < 40).length };
  return { rankings, distribution: dist };
}
