import type { SiteHealthReport } from "../types.js";
export function analyzePositions(reports: SiteHealthReport[]) {
  return { keywords: [], distribution: {}, summary: {} };
}
