import type { SiteHealthReport } from "../types.js";

export function analyzePositions(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages.map(p => ({ ...p, hostname: r.hostname })));
  const keywords: { keyword: string; url: string; hostname: string; seoScore: number; titlePresent: boolean; metaPresent: boolean; h1Present: boolean; canonicalSet: boolean; loadTimeMs: number; status: number }[] = [];

  const stopwords = new Set(["with", "that", "this", "from", "have", "been", "your", "about", "more", "will", "page", "home"]);

  for (const page of allPages) {
    if (!page.ok || !page.documentTitle) continue;
    const words = page.documentTitle.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
    const phrases: string[] = [];
    for (let i = 0; i < words.length - 1; i++) phrases.push(`${words[i]} ${words[i + 1]}`);

    const kw = phrases[0] ?? words[0] ?? "";
    if (!kw) continue;

    let score = 0;
    if (page.documentTitle) score += 25;
    if (page.metaDescriptionLength && page.metaDescriptionLength > 0) score += 20;
    if (page.h1Count === 1) score += 20; else if (page.h1Count && page.h1Count > 0) score += 10;
    if (page.canonicalUrl) score += 15;
    if (page.documentLang) score += 5;
    if (page.durationMs < 2000) score += 10; else if (page.durationMs < 4000) score += 5;
    if (page.status === 200) score += 5;

    keywords.push({ keyword: kw, url: page.url, hostname: (page as any).hostname ?? "", seoScore: Math.min(100, score), titlePresent: !!page.documentTitle, metaPresent: (page.metaDescriptionLength ?? 0) > 0, h1Present: (page.h1Count ?? 0) > 0, canonicalSet: !!page.canonicalUrl, loadTimeMs: page.durationMs, status: page.status });
  }

  keywords.sort((a, b) => b.seoScore - a.seoScore);

  const distribution = { excellent: keywords.filter(k => k.seoScore >= 80).length, good: keywords.filter(k => k.seoScore >= 60 && k.seoScore < 80).length, needsWork: keywords.filter(k => k.seoScore >= 40 && k.seoScore < 60).length, poor: keywords.filter(k => k.seoScore < 40).length };
  const avgScore = keywords.length > 0 ? +(keywords.reduce((a, k) => a + k.seoScore, 0) / keywords.length).toFixed(1) : 0;

  const hostBreakdown = new Map<string, number[]>();
  for (const kw of keywords) { const arr = hostBreakdown.get(kw.hostname) ?? []; arr.push(kw.seoScore); hostBreakdown.set(kw.hostname, arr); }
  const hostStats = [...hostBreakdown.entries()].map(([h, scores]) => ({ hostname: h, keywordCount: scores.length, avgScore: +(scores.reduce((a, s) => a + s, 0) / scores.length).toFixed(1) }));

  return {
    keywords: keywords.slice(0, 50),
    distribution,
    summary: { totalKeywords: keywords.length, avgSeoScore: avgScore, topPerformers: distribution.excellent, needsImprovement: distribution.needsWork + distribution.poor },
    hostStats,
  };
}
