import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import AppLayout from "./components/AppLayout";

// ── Eager loads (core pages) ──────────────────────────────────────────────
import Dashboard from "./pages/Dashboard";

// ── Lazy loads (code-split per route) ─────────────────────────────────────
const RunHistory = lazy(() => import("./pages/RunHistory"));
const ReportsHub = lazy(() => import("./pages/ReportsHub"));
const RunDetail = lazy(() => import("./pages/RunDetail"));
const Upload = lazy(() => import("./pages/Upload"));
const QueryLab = lazy(() => import("./pages/QueryLab"));
const SiteAudit = lazy(() => import("./pages/SiteAudit"));
const OnPageSeoChecker = lazy(() => import("./pages/OnPageSeoChecker"));
const PositionTracking = lazy(() => import("./pages/PositionTracking"));
const DomainOverview = lazy(() => import("./pages/DomainOverview"));
const OrganicRankings = lazy(() => import("./pages/OrganicRankings"));
const TopPages = lazy(() => import("./pages/TopPages"));
const CompareDomains = lazy(() => import("./pages/CompareDomains"));
const KeywordGap = lazy(() => import("./pages/KeywordGap"));
const BacklinkGap = lazy(() => import("./pages/BacklinkGap"));
const KeywordOverview = lazy(() => import("./pages/KeywordOverview"));
const KeywordMagicTool = lazy(() => import("./pages/KeywordMagicTool"));
const KeywordStrategyBuilder = lazy(() => import("./pages/KeywordStrategyBuilder"));
const KeywordManager = lazy(() => import("./pages/KeywordManager"));
const SeoWritingAssistant = lazy(() => import("./pages/SeoWritingAssistant"));
const SeoContentTemplate = lazy(() => import("./pages/SeoContentTemplate"));
const TopicResearch = lazy(() => import("./pages/TopicResearch"));
const ContentAudit = lazy(() => import("./pages/ContentAudit"));
const PostTracking = lazy(() => import("./pages/PostTracking"));
const Backlinks = lazy(() => import("./pages/Backlinks"));
const ReferringDomains = lazy(() => import("./pages/ReferringDomains"));
const BacklinkAudit = lazy(() => import("./pages/BacklinkAudit"));
const TrafficAnalytics = lazy(() => import("./pages/TrafficAnalytics"));
const BrandMonitoring = lazy(() => import("./pages/BrandMonitoring"));
const LogFileAnalyzer = lazy(() => import("./pages/LogFileAnalyzer"));
const LocalSeo = lazy(() => import("./pages/LocalSeo"));
const SerpAnalyzer = lazy(() => import("./pages/SerpAnalyzer"));
const AgenticCrawl = lazy(() => import("./pages/AgenticCrawl"));
const GoogleConnections = lazy(() => import("./pages/GoogleConnections"));
const IntegrationsHub = lazy(() => import("./pages/IntegrationsHub"));
const UrlReport = lazy(() => import("./pages/UrlReport"));
const FormTests = lazy(() => import("./pages/FormTests"));
const KeywordImpact = lazy(() => import("./pages/KeywordImpact"));
const LinkFixAdvisor = lazy(() => import("./pages/LinkFixAdvisor"));
const CompetitiveEstimator = lazy(() => import("./pages/CompetitiveEstimator"));
const CompetitorRankTracker = lazy(() => import("./pages/CompetitorRankTracker"));
const Council = lazy(() => import("./pages/Council"));
const TermIntel = lazy(() => import("./pages/TermIntel"));
const BulkKeywords = lazy(() => import("./pages/BulkKeywords"));
const Schedules = lazy(() => import("./pages/Schedules"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Forecast = lazy(() => import("./pages/Forecast"));
const VoiceOfSerp = lazy(() => import("./pages/VoiceOfSerp"));
const NarrativeDiff = lazy(() => import("./pages/NarrativeDiff"));
const IntentFingerprint = lazy(() => import("./pages/IntentFingerprint"));

function LazyFallback() {
  return (
    <div className="qa-loading-panel" style={{ minHeight: 300 }}>
      <span className="qa-spinner qa-spinner--lg" />
      <span style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</span>
    </div>
  );
}

function DashboardRoute() {
  const { state } = useLocation();
  const urlsText = (state as { urlsText?: string } | undefined)?.urlsText;
  return <Dashboard initialUrls={urlsText} />;
}

export default function App() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Workspace */}
          <Route path="/" element={<DashboardRoute />} />
          <Route path="/history" element={<RunHistory />} />
          <Route path="/reports" element={<ReportsHub />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/run/:runId" element={<RunDetail />} />

          {/* SEO Audit */}
          <Route path="/url-report" element={<UrlReport />} />
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
          <Route path="/competitive-estimator" element={<CompetitiveEstimator />} />
          <Route path="/competitor-rank-tracker" element={<CompetitorRankTracker />} />

          {/* Keyword Research */}
          <Route path="/keyword-overview" element={<KeywordOverview />} />
          <Route path="/keyword-magic-tool" element={<KeywordMagicTool />} />
          <Route path="/keyword-impact" element={<KeywordImpact />} />
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

          {/* Form / flow tests (Playwright) */}
          <Route path="/form-tests" element={<FormTests />} />

          {/* AI-powered link fix advisor */}
          <Route path="/link-fix-advisor" element={<LinkFixAdvisor />} />

          {/* Integrations */}
          <Route path="/google-connections" element={<GoogleConnections />} />
          <Route path="/integrations" element={<IntegrationsHub />} />
          <Route path="/council" element={<Council />} />
          <Route path="/term-intel" element={<TermIntel />} />
          <Route path="/bulk-keywords" element={<BulkKeywords />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/voice-of-serp" element={<VoiceOfSerp />} />
          <Route path="/narrative-diff" element={<NarrativeDiff />} />
          <Route path="/intent-fingerprint" element={<IntentFingerprint />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
