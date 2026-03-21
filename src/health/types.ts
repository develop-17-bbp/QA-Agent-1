export interface BrokenLinkRecord {
  /** Page where the bad link was found */
  foundOn: string;
  /** Resolved target URL */
  target: string;
  status?: number;
  error?: string;
}

export interface PageFetchRecord {
  url: string;
  status: number;
  ok: boolean;
  error?: string;
}

export interface CrawlSiteResult {
  startUrl: string;
  siteId: string;
  hostname: string;
  pagesVisited: number;
  uniqueUrlsChecked: number;
  pages: PageFetchRecord[];
  brokenLinks: BrokenLinkRecord[];
  durationMs: number;
}

export interface PageSpeedMetrics {
  url: string;
  strategy: "mobile" | "desktop";
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
  error?: string;
}

export interface SiteHealthReport {
  siteId: string;
  hostname: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  crawl: CrawlSiteResult;
  pageSpeed?: PageSpeedMetrics;
}
