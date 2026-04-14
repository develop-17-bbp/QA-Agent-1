import type { SiteHealthReport } from "../types.js";
export function analyzeSiteAudit(reports: SiteHealthReport[]) {
  return { score: 0, issues: [], categories: {} };
}
