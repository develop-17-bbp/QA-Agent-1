import type { SiteHealthReport } from "../types.js";
import { generateGeminiText } from "../gemini-report.js";
export async function buildKeywordStrategy(reports: SiteHealthReport[]) {
  return { priorityKeywords: [], contentGaps: [], clusters: [], actionPlan: [] };
}
