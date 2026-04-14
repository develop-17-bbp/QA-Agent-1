import type { SiteHealthReport } from "../types.js";
import { generateGeminiText } from "../gemini-report.js";

export async function analyzeWritingAssistant(url: string, reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const page = allPages.find(p => p.url === url) ?? allPages[0];
  if (!page) return { url, scores: {}, recommendations: [], error: "Page not found in crawl data" };

  const prompt = `You are an expert SEO writing assistant. Analyze this page and provide optimization recommendations.

URL: ${page.url}
Title: ${page.documentTitle ?? "Missing"}
Meta Description Length: ${page.metaDescriptionLength ?? 0} chars
H1 Count: ${page.h1Count ?? 0}
Has Canonical: ${page.canonicalUrl ? "Yes" : "No"}
Language: ${page.documentLang ?? "Not set"}
Body Size: ${page.bodyBytes ?? 0} bytes
Load Time: ${page.durationMs}ms
Status: ${page.status}

Return ONLY valid JSON (no markdown):
{
  "scores": { "readability": 75, "seo": 70, "tone": 80, "originality": 65, "overall": 73 },
  "recommendations": [
    { "category": "SEO", "priority": "High", "issue": "...", "suggestion": "...", "impact": "High" }
  ],
  "wordCountEstimate": 500,
  "keywordsDetected": ["keyword1"],
  "readabilityLevel": "Intermediate",
  "contentType": "Landing Page"
}

Provide 8-10 specific recommendations covering title, meta, headings, content length, keywords, readability, internal linking, and technical SEO.`;

  const text = await generateGeminiText(prompt);
  try {
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return { url: page.url, ...JSON.parse(clean) };
  } catch {
    return { url: page.url, scores: { readability: 0, seo: 0, tone: 0, originality: 0, overall: 0 }, recommendations: [] };
  }
}

export async function generateContentTemplate(keyword: string) {
  const prompt = `You are an expert SEO content strategist. Create a comprehensive content template for: "${keyword}"

Return ONLY valid JSON (no markdown):
{
  "keyword": "${keyword}",
  "title": "SEO-optimized title (50-60 chars)",
  "metaDescription": "Meta description (150-160 chars)",
  "headings": [{ "level": "h1", "text": "..." }, { "level": "h2", "text": "..." }],
  "keywords": { "primary": ["${keyword}"], "secondary": ["..."], "lsi": ["..."] },
  "contentBrief": { "targetWordCount": 1500, "readabilityLevel": "Intermediate", "tone": "Professional", "targetAudience": "...", "uniqueAngle": "..." },
  "outline": [{ "section": "Introduction", "wordCount": 150, "keyPoints": ["..."] }],
  "seoChecklist": ["Include primary keyword in title", "Use keyword in first 100 words"]
}

Create a detailed template with 8-12 headings, 5-7 outline sections, and 8-10 checklist items.`;

  const text = await generateGeminiText(prompt);
  try {
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { keyword, title: "", metaDescription: "", headings: [], keywords: { primary: [keyword], secondary: [], lsi: [] }, contentBrief: {}, outline: [], seoChecklist: [] };
  }
}
