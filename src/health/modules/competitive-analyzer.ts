import type { SiteHealthReport } from "../types.js";

export function analyzeTopPages(reports: SiteHealthReport[]) {
  const pages: { url: string; hostname: string; score: number; title: string; loadMs: number; perfScore?: number }[] = [];
  for (const r of reports) {
    for (const p of r.crawl.pages) {
      if (!p.ok) continue;
      let score = 0;
      if (p.documentTitle?.trim()) score += 20;
      if (p.metaDescriptionLength && p.metaDescriptionLength >= 120) score += 15;
      if (p.h1Count === 1) score += 15;
      if (p.canonicalUrl) score += 10;
      if (p.durationMs < 2000) score += 20;
      else if (p.durationMs < 4000) score += 10;
      if (p.status === 200) score += 10;
      if (p.documentLang) score += 5;
      if (p.bodyBytes && p.bodyBytes > 3000) score += 5;
      const ins = p.insights as any;
      const perf = ins?.mobile?.scores?.performance ?? ins?.desktop?.scores?.performance ?? ins?.scores?.performance;
      const perfNum = typeof perf === "number" ? Math.round(perf * 100) : undefined;
      pages.push({ url: p.url, hostname: r.hostname, score, title: p.documentTitle ?? "", loadMs: p.durationMs, perfScore: perfNum });
    }
  }
  pages.sort((a, b) => b.score - a.score);
  const avgScore = pages.length > 0 ? Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length) : 0;
  return {
    pages,
    summary: {
      totalPages: pages.length,
      avgScore,
      bestUrl: pages[0]?.url ?? "",
      worstUrl: pages[pages.length - 1]?.url ?? "",
    },
  };
}

export function compareDomains(sets: { runId: string; reports: SiteHealthReport[] }[]) {
  const domains = sets.map(s => {
    const reports = s.reports;
    const allPages = reports.flatMap(r => r.crawl.pages);
    const okPages = allPages.filter(p => p.ok);
    const avgLoadMs = okPages.length > 0 ? Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length) : 0;
    const seoScore = allPages.length > 0 ? Math.round(allPages.filter(p => p.documentTitle?.trim() && p.h1Count && p.h1Count > 0).length / allPages.length * 100) : 0;
    const perfScore = avgLoadMs < 2000 ? 90 : avgLoadMs < 4000 ? 60 : 30;
    const contentScore = allPages.length > 0 ? Math.round(allPages.filter(p => (p.bodyBytes ?? 0) > 2000).length / allPages.length * 100) : 0;
    const techScore = allPages.length > 0 ? Math.round(okPages.length / allPages.length * 100) : 0;
    const linkScore = Math.max(0, 100 - reports.reduce((a, r) => a + r.crawl.brokenLinks.length, 0) * 10);
    return {
      runId: s.runId,
      hostname: reports.map(r => r.hostname).join(", ") || s.runId,
      scores: { seo: seoScore, performance: perfScore, content: contentScore, technical: techScore, links: Math.min(100, linkScore) },
      pageCount: allPages.length,
      avgLoadMs,
    };
  });
  const winner = domains.reduce((best, d) => {
    const bTotal = Object.values(best.scores).reduce((a, b) => a + b, 0);
    const dTotal = Object.values(d.scores).reduce((a, b) => a + b, 0);
    return dTotal > bTotal ? d : best;
  }, domains[0]);
  return { domains, comparison: { winner: winner?.runId ?? "", metrics: ["seo", "performance", "content", "technical", "links"] } };
}
