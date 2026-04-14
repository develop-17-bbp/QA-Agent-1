import type { SiteHealthReport } from "../types.js";
export async function trackPosts(reports: SiteHealthReport[], baseline?: SiteHealthReport[]) {
  return { posts: [], changes: [], trends: [] };
}
