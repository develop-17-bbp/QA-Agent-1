import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";

export async function buildKeywordStrategy(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const okPages = allPages.filter(p => p.ok);
  const titles = okPages.map(p => p.documentTitle).filter(Boolean).slice(0, 30);
  const urls = okPages.map(p => p.url).slice(0, 30);
  const hostnames = [...new Set(reports.map(r => r.hostname))];

  const prompt = `You are an expert SEO strategist. Analyze these crawled website pages and build a comprehensive keyword strategy.

Sites: ${hostnames.join(", ")}
Total pages: ${allPages.length}
Sample titles: ${titles.slice(0, 15).join(" | ")}
Sample URLs: ${urls.slice(0, 15).join(" | ")}

Return ONLY valid JSON (no markdown, no backticks):
{
  "priorityKeywords": [
    { "keyword": "...", "priority": "High", "currentPresence": "Weak", "opportunity": "...", "recommendedAction": "..." }
  ],
  "contentGaps": [
    { "topic": "...", "description": "...", "suggestedKeywords": ["..."], "contentType": "Blog Post" }
  ],
  "clusters": [
    { "name": "...", "theme": "...", "keywords": ["..."], "pillarPage": "...", "supportingContent": ["..."] }
  ],
  "actionPlan": [
    { "phase": "Quick Wins (0-30 days)", "actions": ["..."] },
    { "phase": "Medium Term (30-90 days)", "actions": ["..."] },
    { "phase": "Long Term (90+ days)", "actions": ["..."] }
  ],
  "competitiveInsights": { "strengths": ["..."], "weaknesses": ["..."], "opportunities": ["..."] }
}

Generate 10 priority keywords, 5 content gaps, 4 topic clusters, 3-phase action plan, and competitive insights.`;

  const text = await generateText(prompt);
  try {
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const data = JSON.parse(clean);
    return { ...data, meta: { totalPages: allPages.length, sitesAnalyzed: hostnames.length, hostnames } };
  } catch {
    return { priorityKeywords: [], contentGaps: [], clusters: [], actionPlan: [], competitiveInsights: { strengths: [], weaknesses: [], opportunities: [] }, meta: { totalPages: allPages.length, sitesAnalyzed: hostnames.length, hostnames } };
  }
}
