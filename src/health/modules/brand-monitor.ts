import type { SiteHealthReport } from "../types.js";
import { generateGeminiText } from "../gemini-report.js";

export async function analyzeBrandPresence(brandName: string, reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const hostnames = [...new Set(reports.map(r => r.hostname))];
  const brandLower = brandName.toLowerCase();

  // Direct brand mentions in titles
  const titleMentions = allPages.filter(p => p.documentTitle?.toLowerCase().includes(brandLower));
  // Brand in URLs
  const urlMentions = allPages.filter(p => p.url.toLowerCase().includes(brandLower));
  // Unique pages with any mention
  const mentionUrls = new Set([...titleMentions.map(p => p.url), ...urlMentions.map(p => p.url)]);

  const prompt = `Analyze brand presence for "${brandName}" across ${allPages.length} crawled pages from ${hostnames.join(", ")}.
Title mentions: ${titleMentions.length}, URL mentions: ${urlMentions.length}
Sample titles with brand: ${titleMentions.slice(0, 5).map(p => p.documentTitle).join(" | ") || "None"}
Total pages: ${allPages.length}

Return ONLY valid JSON (no markdown):
{
  "visibilityScore": 72,
  "sentimentBreakdown": { "positive": 60, "neutral": 30, "negative": 10 },
  "brandStrength": { "awareness": 70, "authority": 65, "consistency": 75, "reputation": 68 },
  "mentions": [{ "context": "...", "sentiment": "positive", "url": "...", "importance": "High" }],
  "competitors": [{ "name": "...", "estimatedVisibility": 65 }],
  "recommendations": ["...", "..."],
  "alerts": ["...", "..."]
}

Provide visibility score, sentiment breakdown, brand strength metrics, top mentions with context, 3 competitors, 5 recommendations, and any alerts.`;

  let geminiData: any = {};
  try {
    const text = await generateGeminiText(prompt);
    geminiData = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
  } catch { /* fallback below */ }

  return {
    brandName,
    mentionCount: mentionUrls.size,
    titleMentions: titleMentions.length,
    urlMentions: urlMentions.length,
    visibilityScore: geminiData.visibilityScore ?? (mentionUrls.size > 0 ? Math.min(100, Math.round(mentionUrls.size / allPages.length * 100 * 5)) : 0),
    sentimentBreakdown: geminiData.sentimentBreakdown ?? { positive: 0, neutral: 100, negative: 0 },
    brandStrength: geminiData.brandStrength ?? { awareness: 0, authority: 0, consistency: 0, reputation: 0 },
    mentions: geminiData.mentions ?? titleMentions.slice(0, 10).map(p => ({ context: p.documentTitle ?? "", sentiment: "neutral", url: p.url, importance: "Medium" })),
    competitors: geminiData.competitors ?? [],
    recommendations: geminiData.recommendations ?? [],
    alerts: geminiData.alerts ?? [],
    crawlStats: { totalPages: allPages.length, pagesWithMentions: mentionUrls.size, hostnames },
  };
}
