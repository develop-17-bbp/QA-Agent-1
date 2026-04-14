import type { SiteHealthReport } from "../types.js";
export function analyzeTopPages(reports: SiteHealthReport[]) {
  return { pages: [], summary: {} };
}
export function compareDomains(sets: { runId: string; reports: SiteHealthReport[] }[]) {
  return { domains: [], comparison: {} };
}
