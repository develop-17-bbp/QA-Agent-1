import type { SiteHealthReport } from "../types.js";
export async function analyzeLocalSeo(businessName: string, location: string, reports?: SiteHealthReport[]) {
  return { businessName, location, localKeywords: [], listingRecommendations: [], gbpTips: [] };
}
