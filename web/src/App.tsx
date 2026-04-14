import { Route, Routes, useLocation } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import Dashboard from "./pages/Dashboard";
import RunHistory from "./pages/RunHistory";
import ReportsHub from "./pages/ReportsHub";
import RunDetail from "./pages/RunDetail";
import Upload from "./pages/Upload";
import QueryLab from "./pages/QueryLab";
import SiteAudit from "./pages/SiteAudit";
import OnPageSeoChecker from "./pages/OnPageSeoChecker";
import PositionTracking from "./pages/PositionTracking";
import DomainOverview from "./pages/DomainOverview";
import OrganicRankings from "./pages/OrganicRankings";
import TopPages from "./pages/TopPages";
import CompareDomains from "./pages/CompareDomains";
import KeywordGap from "./pages/KeywordGap";
import BacklinkGap from "./pages/BacklinkGap";
import KeywordOverview from "./pages/KeywordOverview";
import KeywordMagicTool from "./pages/KeywordMagicTool";
import KeywordStrategyBuilder from "./pages/KeywordStrategyBuilder";
import KeywordManager from "./pages/KeywordManager";
import SeoWritingAssistant from "./pages/SeoWritingAssistant";
import SeoContentTemplate from "./pages/SeoContentTemplate";
import TopicResearch from "./pages/TopicResearch";
import ContentAudit from "./pages/ContentAudit";
import PostTracking from "./pages/PostTracking";
import Backlinks from "./pages/Backlinks";
import ReferringDomains from "./pages/ReferringDomains";
import BacklinkAudit from "./pages/BacklinkAudit";
import TrafficAnalytics from "./pages/TrafficAnalytics";
import BrandMonitoring from "./pages/BrandMonitoring";
import LogFileAnalyzer from "./pages/LogFileAnalyzer";
import LocalSeo from "./pages/LocalSeo";
import SerpAnalyzer from "./pages/SerpAnalyzer";
import AgenticCrawl from "./pages/AgenticCrawl";

function DashboardRoute() {
  const { state } = useLocation();
  const urlsText = (state as { urlsText?: string } | undefined)?.urlsText;
  return <Dashboard initialUrls={urlsText} />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Workspace */}
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/history" element={<RunHistory />} />
        <Route path="/reports" element={<ReportsHub />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/run/:runId" element={<RunDetail />} />

        {/* SEO Audit */}
        <Route path="/site-audit" element={<SiteAudit />} />
        <Route path="/onpage-seo-checker" element={<OnPageSeoChecker />} />
        <Route path="/position-tracking" element={<PositionTracking />} />

        {/* Competitive Analysis */}
        <Route path="/domain-overview" element={<DomainOverview />} />
        <Route path="/organic-rankings" element={<OrganicRankings />} />
        <Route path="/top-pages" element={<TopPages />} />
        <Route path="/compare-domains" element={<CompareDomains />} />
        <Route path="/keyword-gap" element={<KeywordGap />} />
        <Route path="/backlink-gap" element={<BacklinkGap />} />
        <Route path="/traffic-analytics" element={<TrafficAnalytics />} />

        {/* Keyword Research */}
        <Route path="/keyword-overview" element={<KeywordOverview />} />
        <Route path="/keyword-magic-tool" element={<KeywordMagicTool />} />
        <Route path="/keyword-strategy" element={<KeywordStrategyBuilder />} />
        <Route path="/keyword-manager" element={<KeywordManager />} />

        {/* Content Marketing */}
        <Route path="/seo-writing-assistant" element={<SeoWritingAssistant />} />
        <Route path="/topic-research" element={<TopicResearch />} />
        <Route path="/seo-content-template" element={<SeoContentTemplate />} />
        <Route path="/content-audit" element={<ContentAudit />} />
        <Route path="/post-tracking" element={<PostTracking />} />

        {/* Link Building */}
        <Route path="/backlinks" element={<Backlinks />} />
        <Route path="/referring-domains" element={<ReferringDomains />} />
        <Route path="/backlink-audit" element={<BacklinkAudit />} />

        {/* AI Tools */}
        <Route path="/query-lab" element={<QueryLab />} />
        <Route path="/serp-analyzer" element={<SerpAnalyzer />} />
        <Route path="/agentic-crawl" element={<AgenticCrawl />} />

        {/* Monitoring */}
        <Route path="/brand-monitoring" element={<BrandMonitoring />} />
        <Route path="/log-file-analyzer" element={<LogFileAnalyzer />} />

        {/* Local SEO */}
        <Route path="/local-seo" element={<LocalSeo />} />
      </Route>
    </Routes>
  );
}
