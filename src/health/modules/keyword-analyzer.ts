import type { SiteHealthReport } from "../types.js";
import { generateGeminiText } from "../gemini-report.js";
export function extractKeywords(reports: SiteHealthReport[]) {
  return { keywords: [] };
}
export async function generateMagicKeywords(seed: string) {
  return { seed, keywords: [] };
}
