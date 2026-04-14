import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";

export async function researchTopic(topic: string, reports?: SiteHealthReport[]) {
  let contextBlock = "";
  if (reports && reports.length > 0) {
    const titles = reports.flatMap(r => r.crawl.pages).filter(p => p.documentTitle).map(p => p.documentTitle).slice(0, 20);
    const hostnames = [...new Set(reports.map(r => r.hostname))];
    contextBlock = `\nExisting site context:\nSites: ${hostnames.join(", ")}\nExisting titles: ${titles.join(" | ")}\nConsider how this topic relates to existing content.`;
  }

  const prompt = `You are an expert content strategist and topic researcher. Research the topic: "${topic}"${contextBlock}

Return ONLY valid JSON (no markdown):
{
  "topic": "${topic}",
  "subtopics": [{ "name": "...", "relevance": "High", "contentIdeas": ["..."], "searchVolumeTrend": "Rising" }],
  "questions": [{ "question": "...", "type": "Informational", "difficulty": "Easy", "searchPotential": "High" }],
  "angles": [{ "angle": "...", "uniqueness": "High", "targetAudience": "...", "contentFormat": "Blog Post" }],
  "coverage": [{ "aspect": "...", "currentCoverage": "None", "opportunity": "High", "recommendedAction": "..." }],
  "competitiveLandscape": { "topFormats": ["Blog Posts"], "contentGaps": ["..."], "trendingAngles": ["..."] },
  "contentCalendar": [{ "week": 1, "topic": "...", "format": "Blog Post", "targetKeyword": "..." }]
}

Generate 8-10 subtopics, 10 questions, 5 angles, 5 coverage areas, competitive landscape, and 4-week calendar.`;

  const text = await generateText(prompt);
  try {
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { topic, subtopics: [], questions: [], angles: [], coverage: [], competitiveLandscape: {}, contentCalendar: [] };
  }
}
