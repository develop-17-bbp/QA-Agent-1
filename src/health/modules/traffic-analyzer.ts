import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";

export async function analyzeTraffic(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const okPages = allPages.filter(p => p.ok);
  const hostnames = [...new Set(reports.map(r => r.hostname))];
  const titles = okPages.map(p => p.documentTitle).filter(Boolean).slice(0, 20);

  const pageMetrics = okPages.map(p => {
    const potential = (p.documentTitle ? 25 : 0) + ((p.metaDescriptionLength ?? 0) > 50 ? 20 : 0) + (p.h1Count === 1 ? 20 : 0) + (p.durationMs < 2000 ? 20 : 0) + (p.canonicalUrl ? 15 : 0);
    return { url: p.url, title: p.documentTitle ?? "", potential, loadTimeMs: p.durationMs, bodyBytes: p.bodyBytes ?? 0 };
  }).sort((a, b) => b.potential - a.potential);

  const prompt = `Analyze these website pages and estimate traffic patterns. Sites: ${hostnames.join(", ")}
Pages: ${allPages.length}, OK: ${okPages.length}. Titles: ${titles.slice(0, 10).join(" | ")}
Avg load: ${okPages.length > 0 ? Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length) : 0}ms

Return ONLY valid JSON (no markdown):
{
  "monthlyTrafficEstimate": "5K-10K",
  "trafficTrend": [{ "month": "Jan", "estimated": 5000 }, { "month": "Feb", "estimated": 5500 }, { "month": "Mar", "estimated": 6000 }, { "month": "Apr", "estimated": 5800 }, { "month": "May", "estimated": 6200 }, { "month": "Jun", "estimated": 6500 }],
  "trafficSources": { "organic": 55, "direct": 20, "referral": 15, "social": 7, "paid": 3 },
  "topLandingPages": [{ "url": "/", "estimatedVisits": "1K-2K", "bounceRate": "45%", "avgTimeOnPage": "2:30" }],
  "geoDistribution": [{ "country": "United States", "share": 40 }],
  "deviceBreakdown": { "desktop": 55, "mobile": 38, "tablet": 7 },
  "insights": ["..."],
  "recommendations": ["..."]
}

Estimate 6-month trend, top 5 pages, geo, device breakdown, and 4-5 actionable insights.`;

  let geminiData: any = {};
  try {
    const text = await generateText(prompt);
    geminiData = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
  } catch { /* use defaults */ }

  return {
    monthlyTrafficEstimate: geminiData.monthlyTrafficEstimate ?? "Unknown",
    trafficTrend: geminiData.trafficTrend ?? [],
    trafficSources: geminiData.trafficSources ?? { organic: 0, direct: 0, referral: 0, social: 0, paid: 0 },
    topLandingPages: pageMetrics.slice(0, 10).map(pm => ({ url: pm.url, title: pm.title, organicPotential: pm.potential, loadTimeMs: pm.loadTimeMs })),
    geoDistribution: geminiData.geoDistribution ?? [],
    deviceBreakdown: geminiData.deviceBreakdown ?? { desktop: 55, mobile: 38, tablet: 7 },
    insights: geminiData.insights ?? [],
    recommendations: geminiData.recommendations ?? [],
    crawlStats: { totalPages: allPages.length, okPages: okPages.length, avgLoadTime: okPages.length > 0 ? Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length) : 0 },
  };
}
