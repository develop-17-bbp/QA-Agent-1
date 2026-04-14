import type { SiteHealthReport } from "../types.js";
export async function auditContent(reports: SiteHealthReport[]) {
  return { pages: [], summary: {}, recommendations: [] };
}
