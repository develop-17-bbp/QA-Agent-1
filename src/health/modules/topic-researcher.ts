import type { SiteHealthReport } from "../types.js";
import { generateGeminiText } from "../gemini-report.js";
export async function researchTopic(topic: string, reports?: SiteHealthReport[]) {
  return { topic, subtopics: [], questions: [], angles: [], coverage: [] };
}
