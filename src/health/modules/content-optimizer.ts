import type { SiteHealthReport } from "../types.js";
import { generateGeminiText } from "../gemini-report.js";
export async function analyzeWritingAssistant(url: string, reports: SiteHealthReport[]) {
  return { url, scores: {}, recommendations: [] };
}
export async function generateContentTemplate(keyword: string) {
  return { keyword, title: "", metaDescription: "", headings: [], keywords: [] };
}
