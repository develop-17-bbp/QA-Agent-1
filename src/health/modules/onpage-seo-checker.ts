import type { SiteHealthReport } from "../types.js";
export async function checkOnPageSeo(url: string, reports: SiteHealthReport[]) {
  return { url, overallScore: 0, checks: [], recommendations: [] };
}
