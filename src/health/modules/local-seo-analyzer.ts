import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";

export async function analyzeLocalSeo(businessName: string, location: string, reports?: SiteHealthReport[]) {
  let siteContext = "";
  if (reports && reports.length > 0) {
    const allPages = reports.flatMap(r => r.crawl.pages);
    const hostnames = [...new Set(reports.map(r => r.hostname))];
    const titles = allPages.filter(p => p.documentTitle).map(p => p.documentTitle).slice(0, 10);
    siteContext = `\nWebsite: ${hostnames.join(", ")}\nPages crawled: ${allPages.length}\nSample titles: ${titles.join(" | ")}`;
  }

  const prompt = `You are a local SEO expert. Provide a comprehensive local SEO analysis for "${businessName}" in ${location}.${siteContext}

Return ONLY valid JSON (no markdown):
{
  "localKeywords": [
    { "keyword": "${businessName} ${location}", "volume": "100-1K", "difficulty": "Medium", "intent": "Local", "priority": "High" }
  ],
  "listingRecommendations": [
    { "platform": "Google Business Profile", "action": "...", "priority": "High", "impact": "High" }
  ],
  "gbpTips": [
    { "category": "Profile Optimization", "tip": "...", "priority": "High" }
  ],
  "napConsistency": {
    "score": 85,
    "issues": ["..."],
    "recommendations": ["..."]
  },
  "localRankingFactors": [
    { "factor": "Google Business Profile", "importance": "Critical", "currentStatus": "Needs Setup", "action": "..." }
  ],
  "reviewStrategy": {
    "platforms": ["Google", "Yelp"],
    "targetReviews": 50,
    "tips": ["..."],
    "responseTemplates": { "positive": "...", "negative": "..." }
  },
  "citationSources": [
    { "name": "Yelp", "url": "yelp.com", "priority": "High", "type": "General" }
  ],
  "competitorAnalysis": {
    "topCompetitors": ["..."],
    "differentiators": ["..."],
    "opportunities": ["..."]
  },
  "schemaMarkup": {
    "type": "LocalBusiness",
    "recommended": ["name", "address", "phone", "openingHours", "geo"],
    "snippet": "..."
  }
}

Generate: 10 local keywords, 5 listing recommendations, 8 GBP tips, NAP analysis, 6 ranking factors, review strategy, 10 citation sources, competitor analysis, and schema markup guidance.`;

  const text = await generateText(prompt);
  try {
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return { businessName, location, ...JSON.parse(clean) };
  } catch {
    return {
      businessName, location,
      localKeywords: [{ keyword: `${businessName} ${location}`, volume: "Unknown", difficulty: "Medium", intent: "Local", priority: "High" }],
      listingRecommendations: [{ platform: "Google Business Profile", action: "Create and optimize your listing", priority: "High", impact: "High" }],
      gbpTips: [{ category: "Setup", tip: "Claim and verify your Google Business Profile", priority: "High" }],
      napConsistency: { score: 0, issues: ["Unable to analyze"], recommendations: ["Ensure consistent NAP across all listings"] },
      localRankingFactors: [],
      reviewStrategy: { platforms: ["Google"], targetReviews: 50, tips: ["Ask satisfied customers for reviews"], responseTemplates: {} },
      citationSources: [],
      competitorAnalysis: { topCompetitors: [], differentiators: [], opportunities: [] },
      schemaMarkup: { type: "LocalBusiness", recommended: ["name", "address", "phone"], snippet: "" },
    };
  }
}
