import type { SiteHealthReport } from "../types.js";
export function analyzeBacklinks(reports: SiteHealthReport[]) {
  return { totalLinks: 0, topLinked: [], orphanPages: [] };
}
export function analyzeReferringDomains(reports: SiteHealthReport[]) {
  return { sections: [] };
}
export function auditBacklinks(reports: SiteHealthReport[]) {
  return { healthy: 0, broken: 0, redirected: 0, links: [] };
}
