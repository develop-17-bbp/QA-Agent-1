import type { SiteHealthReport } from "../types.js";
export function analyzeDomain(reports: SiteHealthReport[]) {
  return { sites: [], overallScore: 0 };
}
export function analyzeOrganicRankings(reports: SiteHealthReport[]) {
  return { rankings: [], distribution: {} };
}
