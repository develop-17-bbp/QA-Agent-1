import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/history": "Run History",
  "/reports": "Reports",
  "/upload": "Import",
  "/url-report": "URL Report",
  "/site-audit": "Site Audit",
  "/onpage-seo-checker": "On-Page SEO Checker",
  "/position-tracking": "Position Tracking",
  "/domain-overview": "Domain Overview",
  "/organic-rankings": "Organic Rankings",
  "/top-pages": "Top Pages",
  "/compare-domains": "Compare Domains",
  "/keyword-gap": "Keyword Gap",
  "/backlink-gap": "Backlink Gap",
  "/traffic-analytics": "Traffic Analytics",
  "/keyword-overview": "Keyword Overview",
  "/keyword-magic-tool": "Keyword Magic Tool",
  "/keyword-strategy": "Keyword Strategy",
  "/keyword-manager": "Keyword Manager",
  "/seo-writing-assistant": "SEO Writing Assistant",
  "/topic-research": "Topic Research",
  "/seo-content-template": "Content Template",
  "/content-audit": "Content Audit",
  "/post-tracking": "Post Tracking",
  "/backlinks": "Backlinks",
  "/referring-domains": "Referring Domains",
  "/backlink-audit": "Backlink Audit",
  "/query-lab": "Query Lab",
  "/serp-analyzer": "SERP Analyzer",
  "/agentic-crawl": "Agentic Crawl",
  "/brand-monitoring": "Brand Monitoring",
  "/log-file-analyzer": "Log File Analyzer",
  "/local-seo": "Local SEO",
  "/google-connections": "Google Connections",
};

export function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = TITLES[pathname] ?? "QA Agent";
    document.title = `${title} — QA Agent`;
  }, [pathname]);
}
