// ── Request Deduplication & Caching ──────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>();
const apiCache = new Map<string, { data: unknown; expiresAt: number }>();

function cacheKey(path: string, body?: Record<string, unknown>): string {
  return body ? `${path}:${JSON.stringify(body)}` : path;
}

function getCached<T>(key: string): T | undefined {
  const entry = apiCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { apiCache.delete(key); return undefined; }
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttlMs: number): void {
  if (apiCache.size > 200) {
    const first = apiCache.keys().next().value;
    if (first !== undefined) apiCache.delete(first);
  }
  apiCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Clear all cached API responses (call after mutations). */
export function clearApiCache(): void {
  apiCache.clear();
}

async function dedupFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number = 30_000): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetcher().then(data => {
    inflight.delete(key);
    setCache(key, data, ttlMs);
    return data;
  }).catch(err => {
    inflight.delete(key);
    throw err;
  });

  inflight.set(key, promise);
  return promise;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type HealthRunMeta = {
  runId: string;
  /** Human-readable label: "realdrseattle.com · Apr 21, 7:14 PM · 21 pages". */
  label?: string;
  startedAt?: string;
  durationMsTotal?: number;
  generatedAt: string;
  urlsSource: string;
  urlsFile?: string;
  totalSites: number;
  siteFailures: number;
  sites: {
    hostname: string;
    startUrl: string;
    failed: boolean;
    pagesVisited: number;
    brokenLinks: number;
    durationMs: number;
    reportHtmlHref: string;
    seoAuditHtmlHref?: string;
  }[];
  masterHtmlHref: string;
  runSummaryHtmlHref?: string;
  indexHtmlHref: string;
  /** Link to the AI-generated summary markdown for this run, if one was produced. */
  aiSummaryHref?: string;
  aiSummary?: { generatedAt?: string; skippedReason?: string };
  features?: {
    pageSpeedStrategies?: string[];
    viewportCheck?: boolean;
    seoAudit?: boolean;
  };
  /** Populated when one or more sites in the run were crawled agentically
   *  (LLM planner drove queue prioritization + mid-crawl replan). */
  agentic?: {
    ranCount: number;
    totalSites: number;
    strategies: string[];
    prioritySections: string[];
    focusKeywords: string[];
    replanCountTotal: number;
    reorderedCountTotal: number;
    plannerMsTotal: number;
  };
};

export type HistoryDay = { date: string; runs: HealthRunMeta[] };

export function fetchHistory(): Promise<{ days: HistoryDay[] }> {
  return dedupFetch("/api/history", async () => {
    const res = await fetch("/api/history");
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ days: HistoryDay[] }>;
  }, 15_000);
}

export async function fetchRunMeta(runId: string): Promise<HealthRunMeta | null> {
  const res = await fetch(`/api/run-meta?runId=${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return (await res.json()) as HealthRunMeta;
}

export async function startRun(body: {
  urlsText: string;
  pageSpeedBoth?: boolean;
  viewportCheck?: boolean;
  aiSummary?: boolean;
  seoAudit?: boolean;
  smartAnalysis?: boolean;
  maxPages?: number;
}): Promise<void> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new Error("A run is already in progress.");
  if (!res.ok) throw new Error(await res.text());
}

export function streamUrl(): string {
  return `${window.location.origin}/api/stream`;
}

export async function fetchAiSummary(runId: string): Promise<string | null> {
  const res = await fetch(`/api/ai-summary?runId=${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

export async function askAiAboutRun(runId: string, question: string): Promise<string> {
  const res = await fetch("/api/ai-run-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, question }),
  });
  const text = await res.text();
  let data: { answer?: string; error?: string };
  try {
    data = JSON.parse(text) as { answer?: string; error?: string };
  } catch {
    throw new Error(text || res.statusText);
  }
  if (!res.ok) throw new Error(data.error ?? (text || res.statusText));
  if (!data.answer?.trim()) throw new Error("Empty answer");
  return data.answer.trim();
}

// ---------------------------------------------------------------------------
// Keyword Research (standalone, LLM-assisted)
// ---------------------------------------------------------------------------

export async function fetchKeywordResearch(keyword: string, region = "US"): Promise<any> {
  const res = await fetch("/api/keyword-research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, region }),
  });
  if (!res.ok) {
    let errMsg: string;
    try { const d = await res.json() as { error?: string }; errMsg = d.error ?? res.statusText; } catch { errMsg = await res.text(); }
    throw new Error(errMsg);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// NLP Query Lab
// ---------------------------------------------------------------------------

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AnswerConfidence = "high" | "medium" | "low";

export type NlpQueryResponse = {
  answer: string;
  intent: string;
  clarification_needed: boolean;
  follow_up_question: string | null;
  /** "low" means the answer has no grounded citations — do not cite it as data. */
  confidence: AnswerConfidence;
  /** Crawl URLs that backed the answer. Empty when clarification-only or fallback. */
  citedPages: string[];
};

export async function queryNlp(
  query: string,
  runId: string,
  history: ChatMessage[],
): Promise<NlpQueryResponse> {
  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, runId, history }),
  });
  const text = await res.text();
  let data: NlpQueryResponse & { error?: string };
  try {
    data = JSON.parse(text) as NlpQueryResponse & { error?: string };
  } catch {
    throw new Error(text || res.statusText);
  }
  if (!res.ok) throw new Error(data.error ?? (text || res.statusText));
  if (!data.answer?.trim()) throw new Error("Empty answer");
  return data;
}

// ---------------------------------------------------------------------------
// SEMrush Feature API Functions
// ---------------------------------------------------------------------------

async function postApiRaw<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function postApi<T>(path: string, body: Record<string, unknown>, ttlMs: number = 30_000): Promise<T> {
  const key = cacheKey(path, body);
  return dedupFetch<T>(key, () => postApiRaw<T>(path, body), ttlMs);
}

// Run-based endpoints (require runId)
export function fetchSiteAudit(runId: string) { return postApi<any>("/api/site-audit", { runId }); }
export function fetchPositionTracking(runId: string) { return postApi<any>("/api/position-tracking", { runId }); }
export function fetchDomainOverview(runId: string) { return postApi<any>("/api/domain-overview", { runId }); }
export function fetchOrganicRankings(runId: string) { return postApi<any>("/api/organic-rankings", { runId }); }
export function fetchTopPages(runId: string) { return postApi<any>("/api/top-pages", { runId }); }
export function fetchKeywordOverview(runId: string) { return postApi<any>("/api/keyword-overview", { runId }); }
export function fetchKeywordStrategy(runId: string) { return postApi<any>("/api/keyword-strategy", { runId }); }
export function fetchBacklinks(runId: string) { return postApi<any>("/api/backlinks", { runId }); }
export function fetchReferringDomains(runId: string) { return postApi<any>("/api/referring-domains", { runId }); }
export function fetchBacklinkAudit(runId: string) { return postApi<any>("/api/backlink-audit", { runId }); }
export function fetchTrafficAnalytics(runId: string) { return postApi<any>("/api/traffic-analytics", { runId }); }
export function fetchContentAudit(runId: string) { return postApi<any>("/api/content-audit", { runId }); }
export function fetchOnPageSeoChecker(runId: string, url: string) { return postApi<any>("/api/onpage-seo-checker", { runId, url }); }

// Multi-run endpoints
export function fetchCompareDomains(runIds: string[]) { return postApi<any>("/api/compare-domains", { runIds }); }
export function fetchKeywordGap(runIdA: string, runIdB: string) { return postApi<any>("/api/keyword-gap", { runIdA, runIdB }); }
export function fetchBacklinkGap(runIdA: string, runIdB: string) { return postApi<any>("/api/backlink-gap", { runIdA, runIdB }); }
export function fetchPostTracking(runId: string, baselineRunId?: string) { return postApi<any>("/api/post-tracking", { runId, baselineRunId }); }

// Standalone LLM-assisted endpoints (no runId required)
export function fetchKeywordMagic(seedKeyword: string, region = "US") { return postApi<any>("/api/keyword-magic", { seedKeyword, region }); }
export function fetchSeoWritingAssistant(runId: string, url: string) { return postApi<any>("/api/seo-writing-assistant", { runId, url }); }
export function fetchSeoContentTemplate(keyword: string) { return postApi<any>("/api/seo-content-template", { keyword }); }
export function fetchTopicResearch(topic: string, runId?: string) { return postApi<any>("/api/topic-research", { topic, runId }); }
export function fetchBrandMonitoring(brandName: string, runId: string, opts?: { withSentiment?: boolean; competitors?: string[] }) {
  return postApi<any>("/api/brand-monitor", { brandName, runId, withSentiment: opts?.withSentiment === true, competitors: opts?.competitors });
}
export function fetchLogAnalysis(logContent: string) { return postApi<any>("/api/log-analyzer", { logContent }); }
export function fetchLocalSeo(businessName: string, location: string, runId?: string) { return postApi<any>("/api/local-seo", { businessName, location, runId }); }

// Keyword Manager
export function fetchKeywordLists() { return postApi<any>("/api/keyword-lists", {}); }
export function saveKeywordListApi(name: string, keywords: string[]) { return postApi<any>("/api/keyword-lists/save", { name, keywords }); }
export function deleteKeywordListApi(name: string) { return postApi<any>("/api/keyword-lists/delete", { name }); }
export function analyzeKeywordListApi(keywords: string[], region?: string) { return postApi<any>("/api/keyword-lists/analyze", { keywords, region }); }

// Agentic Pipeline
export function startAgenticPipeline(targetUrl: string, keywords: string[]) { return postApi<{ sessionId: string; status: string }>("/api/agentic/start", { targetUrl, keywords }); }
export function fetchAgenticSession(sessionId: string) { return postApi<any>("/api/agentic/session", { sessionId }); }
export async function fetchAgenticSessions(): Promise<any[]> { const res = await fetch("/api/agentic/sessions"); if (!res.ok) throw new Error(await res.text()); return res.json() as Promise<any[]>; }

// SERP Analysis
export function fetchSerpAnalysis(keywords: string[], targetDomain?: string, region?: string) { return postApi<any>("/api/serp-analysis", { keywords, targetDomain, region }); }
export function fetchSerpSearch(query: string, region?: string) { return postApi<any>("/api/serp-search", { query, region }); }

// External backlinks (OPR + Common Crawl + URLScan + Wayback)
export function fetchExternalBacklinks(domain: string) { return postApi<any>("/api/external-backlinks", { domain }); }

// Domain Authority (OpenPageRank)
export function fetchDomainAuthority(domain: string) {
  return dedupFetch(`/api/domain-authority:${domain}`, () => postApi<any>("/api/domain-authority", { domain }), 60 * 60 * 1000);
}

// Keyword Suggestions (Google Autocomplete — no key needed)
// country is an ISO 2-letter code (e.g. "US", "IN") for the gl param.
export function fetchKeywordSuggestions(keyword: string, locale = "en", country = "") {
  return postApi<{ suggestions: string[]; questions: string[]; source: string }>("/api/keyword-suggestions", { keyword, locale, country });
}

// Keyword Trends (Google Trends)
export function fetchKeywordTrends(keyword: string, geo = "") {
  return postApi<any>("/api/keyword-trends", { keyword, geo });
}

// Position tracker sweep (records into history-db)
// strictHost: when false (default), wikipedia.org matches en.wikipedia.org. When true, exact host equality only.
export function trackPositions(
  pairs: { domain: string; keyword: string; strictHost?: boolean }[],
  opts?: { delayMs?: number; strictHost?: boolean },
) {
  return postApi<any>("/api/position-track", {
    pairs,
    delayMs: opts?.delayMs,
    strictHost: opts?.strictHost,
  });
}

// History readers (JSON time series)
export async function fetchKeywordHistory(domain: string, keyword: string): Promise<any> {
  const res = await fetch(`/api/history/keyword?domain=${encodeURIComponent(domain)}&keyword=${encodeURIComponent(keyword)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function fetchBacklinkHistoryApi(domain: string): Promise<any> {
  const res = await fetch(`/api/history/backlinks?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function fetchTrafficHistory(domain: string): Promise<any> {
  const res = await fetch(`/api/history/traffic?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function fetchHistoryStats(): Promise<any> {
  const res = await fetch("/api/history/stats");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Tracked pairs — position history CRUD
export async function fetchTrackedPairs(): Promise<any[]> {
  const res = await fetch("/api/tracked-pairs");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function addTrackedPairApi(domain: string, keyword: string): Promise<any> {
  const res = await fetch("/api/tracked-pairs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, keyword }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function removeTrackedPairApi(domain: string, keyword: string): Promise<any> {
  const res = await fetch("/api/tracked-pairs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, keyword, remove: true }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function fetchPositionHistoryForKeyword(domain: string, keyword: string): Promise<any> {
  const res = await fetch(`/api/history/keyword?domain=${encodeURIComponent(domain)}&keyword=${encodeURIComponent(keyword)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Keyword Volume (Google Ads Keyword Planner)
export async function fetchKeywordVolume(keywords: string[], geo = "US"): Promise<any> {
  const res = await fetch("/api/keyword-volume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords, geo }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Chrome UX Report (real-user Web Vitals)
export async function fetchCrux(url: string, formFactor: "PHONE" | "DESKTOP" | "TABLET" = "PHONE"): Promise<any> {
  const res = await fetch(`/api/crux?url=${encodeURIComponent(url)}&formFactor=${formFactor}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Mozilla Observatory — HTTPS / security header grade (A+ … F)
export async function fetchSecurityGrade(domain: string): Promise<any> {
  const res = await fetch(`/api/security-grade?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Wayback Machine — first/last snapshot + yearly coverage (no auth)
export async function fetchWayback(url: string): Promise<any> {
  const res = await fetch(`/api/wayback?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Geo targets (country list for the region picker)
export type GeoTarget = { iso: string; name: string };
let _geoCache: Promise<{ targets: GeoTarget[] }> | null = null;
export function fetchGeoTargets(): Promise<{ targets: GeoTarget[] }> {
  if (!_geoCache) {
    _geoCache = fetch("/api/geo-targets")
      .then((r) => { if (!r.ok) throw new Error("failed to load regions"); return r.json(); })
      .catch((e) => { _geoCache = null; throw e; });
  }
  return _geoCache;
}

// Form tests (legacy `qa-agent run` surfaced on the dashboard)
export type FormTestSite = {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  forms: number;
  hasLiveAgent: boolean;
  captcha: "none" | "pause_after_fields" | "wait_for_selector" | null;
  success: "url_contains" | "text_visible" | "selector_visible";
};
export async function fetchFormTestSites(): Promise<{ configured: boolean; error?: string; sites?: FormTestSite[] }> {
  const res = await fetch("/api/form-tests/sites");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function runFormTest(payload: { siteId?: string; headless?: boolean }): Promise<any> {
  const res = await fetch("/api/form-tests/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type AdHocFieldReport = {
  selector: string;
  name?: string;
  type?: string;
  action: "fill" | "check" | "uncheck" | "select" | "click" | "skip";
  value?: string;
  skippedReason?: string;
};
export type AdHocFormTestResult = {
  runId: string;
  url: string;
  status: "passed" | "failed" | "uncertain" | "skipped";
  durationMs: number;
  errorMessage?: string;
  screenshotPath: string;
  formsFound: number;
  filledFields: AdHocFieldReport[];
  submitted: boolean;
  successSignal?: string;
  finalUrl?: string;
};
export async function runAdHocFormTest(payload: { url: string; headless?: boolean; dryRun?: boolean }): Promise<AdHocFormTestResult> {
  const res = await fetch("/api/form-tests/ad-hoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// AI one-line fix recommendations for a batch of broken links.
export type BrokenLinkInput = { foundOn: string; target: string; status?: number; error?: string; anchorText?: string; linkContext?: string };
export type LinkFixRecommendation = { foundOn: string; target: string; recommendation: string };
export async function fetchLinkFixRecommendations(links: BrokenLinkInput[]): Promise<{ recommendations: LinkFixRecommendation[] }> {
  const res = await fetch("/api/link-fix-recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// All broken links across a run, flat with site hostname for triage.
export type BrokenLinkRow = {
  siteHostname: string;
  foundOn: string;
  target: string;
  status?: number;
  error?: string;
  durationMs?: number;
  anchorText?: string;
  linkContext?: string;
  outerHtml?: string;
};
export async function fetchBrokenLinks(runId: string): Promise<{ runId: string; generatedAt: string; links: BrokenLinkRow[] }> {
  const res = await fetch(`/api/broken-links/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Keyword Impact Predictor — "what if my site targeted this keyword?"
export async function fetchKeywordImpact(payload: { url: string; keyword: string; region: string }): Promise<any> {
  const res = await fetch("/api/keyword-impact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// AI Competitive Estimator — free-tier ranges for any domain's backlinks, traffic, keyword universe.
export type CompetitiveEstimateSignals = {
  domain: string;
  fetchedAt: string;
  trancoRank?: { value: number; source: string; confidence: string };
  trancoPercentile?: { value: number; source: string; confidence: string };
  domainAuthority?: { value: number; source: string; confidence: string };
  cloudflareRank?: { value: number; source: string; confidence: string };
  wikipediaMonthlyViews?: { value: number; source: string; confidence: string };
  googleTrendsLatest?: { value: number; source: string; confidence: string };
  cruxPresent?: { value: boolean; source: string; confidence: string };
  commonCrawlReferringHosts?: { value: number; source: string; confidence: string };
  commonCrawlDomainHits?: { value: number; source: string; confidence: string };
  serpVisibilityCount?: { value: number; source: string; confidence: string };
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};
export type CompetitiveEstimateResponse = {
  domain: string;
  fetchedAt: string;
  signals: CompetitiveEstimateSignals;
  baseline: { backlinks: number; monthlyOrganicTraffic: number; keywordUniverse: number };
  estimates: {
    backlinks: { min: number; max: number; mid: number; confidence: "high" | "medium" | "low" };
    monthlyOrganicTraffic: { min: number; max: number; mid: number; confidence: "high" | "medium" | "low" };
    keywordUniverse: { estimate: number; confidence: "high" | "medium" | "low" };
  };
  methodology: string;
  caveats: string[];
  drivers: string[];
  llmAvailable: boolean;
  llmError?: string;
};
export async function fetchCompetitiveEstimate(domain: string): Promise<CompetitiveEstimateResponse> {
  const res = await fetch(`/api/competitive-estimate?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Competitor Rank Tracker — DDG + Brave cross-check for competitor keyword positions.
export type CompetitorRankPair = { domain: string; keyword: string; isCompetitor?: boolean; regionCode?: string };
export type CompetitorRankSnapshot = {
  at: string;
  position: number | null;
  ddgRank?: number | null;
  braveRank?: number | null;
  discrepancy?: boolean;
  regionCode?: string;
  clicks: number;
  impressions: number;
  ctr: number;
};
export type CompetitorRankStats = {
  domain: string;
  keyword: string;
  regionCode: string;
  latest: CompetitorRankSnapshot | null;
  delta7d: number | null;
  delta30d: number | null;
  best: number | null;
  worst: number | null;
  snapshotCount: number;
};
export type CompetitorRankResult = {
  domain: string;
  keyword: string;
  regionCode: string;
  ddgRank: number | null;
  braveRank: number | null;
  discrepancy: boolean;
  checkedAt: string;
  errors: Partial<Record<"ddg" | "brave", string>>;
};
export async function listCompetitorRank(): Promise<{ pairs: CompetitorRankPair[]; stats: CompetitorRankStats[] }> {
  const res = await fetch("/api/competitor-rank");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function addCompetitorRank(domain: string, keyword: string, regionCode = "US"): Promise<CompetitorRankResult> {
  const res = await fetch("/api/competitor-rank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, keyword, regionCode }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function removeCompetitorRank(domain: string, keyword: string): Promise<void> {
  const res = await fetch(`/api/competitor-rank/${encodeURIComponent(domain)}/${encodeURIComponent(keyword)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}
export async function fetchCompetitorRankHistory(domain: string, keyword: string): Promise<{ domain: string; keyword: string; history: CompetitorRankSnapshot[] }> {
  const res = await fetch(`/api/competitor-rank-history/${encodeURIComponent(domain)}/${encodeURIComponent(keyword)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// GSC Links CSV import (Google deprecated the API — feed the UI export here).
export async function uploadGscLinksCsv(domain: string, csv: string): Promise<{ ok: boolean; reportType: string; rowCount: number }> {
  const res = await fetch("/api/gsc-links/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, csv }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Unified integrations hub status — aggregate state of every connection (OAuth + key + CSV + paid BYOK).
export type IntegrationCard = {
  connected: boolean;
  connectionKind?: "oauth" | "api-key" | "api-keys" | "api-token" | "csv-upload" | "via-google-oauth" | "local" | "none";
  oauthClientConfigured?: boolean;
  configured?: boolean;
  email?: string;
  scopes?: string[];
  connectedAt?: string;
  connectUrl?: string;
  uploadFlowUrl?: string;
  apiKeyVar?: string;
  helpUrl?: string;
  covers?: string[];
  price: string;
};
export type ByokProviderStatus = {
  id: string;
  label: string;
  description: string;
  signUpUrl: string;
  pricingHint: string;
  configured: boolean;
  envVars: string[];
};
export type IntegrationsStatus = {
  google: IntegrationCard;
  bing: IntegrationCard;
  yandex: IntegrationCard;
  naver: IntegrationCard;
  ahrefsWebmaster: IntegrationCard;
  pagespeed: IntegrationCard;
  openPageRank: IntegrationCard;
  urlscan: IntegrationCard;
  cloudflareRadar: IntegrationCard;
  ollama: IntegrationCard;
  byok: ByokProviderStatus[];
  /** Env-var names that were saved via the dashboard UI (runtime-keys store)
   *  rather than .env — lets the UI show a "saved from browser" badge. */
  runtimeKeys?: string[];
};
export async function fetchIntegrationsStatus(): Promise<IntegrationsStatus> {
  const res = await fetch("/api/integrations/status");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Paste keys from the UI — server persists them to data/runtime-keys.json
 *  and every provider reads runtime-keys first, then .env. No restart. */
export async function saveRuntimeKeys(updates: Record<string, string>): Promise<{ saved: string[]; rejected: string[]; active: string[] }> {
  const res = await fetch("/api/integrations/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function clearRuntimeKey(name: string): Promise<void> {
  const res = await fetch(`/api/integrations/keys/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

// Ahrefs Webmaster Tools CSV import — 95% paid-Ahrefs parity for your verified site, free.
export type AwtSummary = {
  totalBacklinks: number;
  totalReferringDomains: number;
  dofollow: number;
  nofollow: number;
  avgDr: number;
  topReferringDomains: { domain: string; links: number }[];
  anchorTextFrequency: { anchor: string; count: number }[];
};
export async function uploadAwtCsv(domain: string, csv: string): Promise<{ ok: boolean; rowCount: number; summary: AwtSummary }> {
  const res = await fetch("/api/awt/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, csv }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function fetchAwtBundle(domain: string): Promise<{ bundle: (AwtSummary & { domain: string; importedAt: string; backlinks: unknown[] }) | null }> {
  const res = await fetch(`/api/awt/${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Brand + topic monitor via RSS / JSON-feed aggregation (Google News, Reddit, HN, GDELT, Stack Exchange, Wayback).
export type BrandMentionRow = {
  source: "google-news" | "reddit" | "hackernews" | "gdelt" | "stackexchange" | "wayback-cdx";
  url: string;
  title: string;
  publisher?: string;
  snippet?: string;
  publishedAt?: string;
  score?: number;
};
export type BrandMentionsBundle = {
  query: string;
  fetchedAt: string;
  mentions: BrandMentionRow[];
  bySource: Record<string, number>;
  providersHit: string[];
  providersFailed: string[];
  titleTone: { positive: number; neutral: number; negative: number };
};
export function fetchBrandMentionsAggregated(query: string, sources?: string[]): Promise<BrandMentionsBundle> {
  return postApi<BrandMentionsBundle>("/api/brand-mentions", { query, sources });
}

// ── Council — cross-source consensus + LLM advisor panel ──────────────────
export type CouncilFeature = "keywords" | "backlinks" | "serp" | "authority" | "vitals" | "site-audit";
export interface CouncilAdvisor {
  id: string;
  name: string;
  focus: string;
}
export interface CouncilAgendaItem {
  id: string;
  label: string;
  sublabel?: string;
  sources: string[];
  metrics: Record<string, number | string | undefined>;
  score: number;
  rawVariants?: string[];
}
export interface CouncilContext {
  feature: CouncilFeature;
  featureLabel: string;
  featureTagline: string;
  target: string;
  sourcesQueried: string[];
  sourcesFailed: { source: string; reason: string }[];
  tierTop: CouncilAgendaItem[];
  tierMid: CouncilAgendaItem[];
  tierBottom: CouncilAgendaItem[];
  totalItems: number;
  collectedAt: string;
  advisors: CouncilAdvisor[];
}
export interface CouncilResult {
  verdicts: Record<string, Record<string, string>>;
  synthesis: string;
  reviewedItemIds: string[];
  model: string;
  durationMs: number;
}
export interface CouncilResponse {
  context: CouncilContext;
  council: CouncilResult | { error: string } | null;
  elapsed: { aggregateMs: number; llmMs: number };
}
export function runCouncilApi(
  feature: CouncilFeature,
  domain: string,
  extras?: { keywords?: string[]; competitors?: string[]; urls?: string[]; runId?: string; includeLlm?: boolean },
): Promise<CouncilResponse> {
  return postApi<CouncilResponse>("/api/council", {
    feature,
    domain,
    keywords: extras?.keywords,
    competitors: extras?.competitors,
    urls: extras?.urls,
    runId: extras?.runId,
    includeLlm: extras?.includeLlm !== false,
  });
}

// ── Forecast — 30-day rank projections grounded in the operator's own history ──
export interface KeywordForecast {
  domain: string;
  keyword: string;
  latestRank: number | null;
  projectedRank: number | null;
  projectedDelta: number | null;
  confidenceR2: number;
  sampleCount: number;
  confidenceBand: "high" | "medium" | "low";
  windowDays: number;
  slopePerDay: number | null;
}
export interface ForecastAggregate {
  domain: string;
  windowDays: number;
  pairsTracked: number;
  pairsForecastable: number;
  atRiskKeywords: KeywordForecast[];
  breakthroughKeywords: KeywordForecast[];
  avgProjectedDelta: number;
  medianConfidenceR2: number;
  generatedAt: string;
}
export interface ForecastResponse {
  aggregate: ForecastAggregate;
  perKeyword: KeywordForecast[];
  council: CouncilResult | null;
  councilError?: string;
}
export function fetchForecastApi(domain: string, extras?: { windowDays?: number; projectDays?: number; includeLlm?: boolean }): Promise<ForecastResponse> {
  return postApi<ForecastResponse>("/api/forecast", {
    domain,
    windowDays: extras?.windowDays,
    projectDays: extras?.projectDays,
    includeLlm: extras?.includeLlm !== false,
  });
}

// ── DataForSEO live backlinks — per-link rows ─────────────────────────────
export interface BacklinkRow {
  pageFrom: string;
  pageTo: string;
  anchor: string;
  itemType: string;
  dofollow: boolean;
  domainRankFrom: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  isLive: boolean;
}
export interface BacklinksLiveResponse {
  domain: string;
  totalCount: number;
  rows: BacklinkRow[];
  summary: {
    referringDomains: number | null;
    backlinks: number | null;
    dofollowPct: number | null;
    averageDr: number | null;
  };
  fetchedAt: string;
}
export function fetchBacklinksLive(domain: string, limit = 200): Promise<BacklinksLiveResponse> {
  return postApi<BacklinksLiveResponse>("/api/backlinks-live", { domain, limit });
}

// ── Zero-Budget Link Prospector — SERP-derived outreach drafts ────────────
export interface OutreachEmail {
  subject: string;
  body: string;
  cta: string;
}
export interface LinkProspect {
  rank: number;
  domain: string;
  url: string;
  title: string;
  tone?: string;
  textSample?: string;
  fetchOk: boolean;
  fetchError?: string;
  email?: OutreachEmail;
  emailError?: string;
}
export interface LinkProspectorResponse {
  targetDomain: string;
  topicQuery: string;
  region: string;
  fetchedAt: string;
  prospects: LinkProspect[];
  excluded: string[];
  draftingError?: string;
  privacyMode: "local-only";
}
export function fetchLinkProspects(input: { targetDomain: string; topicQuery: string; competitorDomains?: string[]; region?: string; topN?: number }): Promise<LinkProspectorResponse> {
  return postApi<LinkProspectorResponse>("/api/link-prospector", input);
}

// ── Competitive Intent Fingerprint — SERP-intent shift detection ──────────
export interface IntentShift {
  domain: string;
  keyword: string;
  fromAt: string;
  toAt: string;
  fromSignature: string;
  toSignature: string;
  distance: number;
  added: string[];
  removed: string[];
}
export interface IntentShiftsResponse {
  domain: string;
  windowDays: number;
  pairsChecked: number;
  pairsWithFingerprintHistory: number;
  shifts: IntentShift[];
  council: CouncilResult | null;
  councilError?: string;
  generatedAt: string;
}
export function fetchIntentShifts(domain: string, extras?: { minDistance?: number; windowDays?: number; includeLlm?: boolean }): Promise<IntentShiftsResponse> {
  return postApi<IntentShiftsResponse>("/api/intent-shifts", { domain, ...extras });
}
export function snapshotIntentFingerprintsNow(domain: string, region?: string): Promise<{ domain: string; region: string; fingerprints: { keyword: string; signature: string; error?: string }[] }> {
  return postApi("/api/intent-fingerprint-now", { domain, region });
}

// ── Narrative Diff — run-to-run comparison with LLM narration ─────────────
export interface NarrativeSectionDelta {
  section: string;
  pagesA: number;
  pagesB: number;
  pagesDelta: number;
  durationMsA: number | null;
  durationMsB: number | null;
  brokenLinksA: number;
  brokenLinksB: number;
}
export interface NarrativeSiteDelta {
  hostname: string;
  startUrl: string;
  pagesA: number;
  pagesB: number;
  brokenLinksA: number;
  brokenLinksB: number;
  sections: NarrativeSectionDelta[];
  newlyBrokenUrls: string[];
  fixedBrokenUrls: string[];
}
export interface NarrativeDiffResponse {
  runIdA: string;
  runIdB: string;
  metaA: any | null;
  metaB: any | null;
  sites: NarrativeSiteDelta[];
  sitesOnlyInA: string[];
  sitesOnlyInB: string[];
  council: CouncilResult | null;
  councilError?: string;
  generatedAt: string;
}
export function fetchNarrativeDiff(runIdA: string, runIdB: string, includeLlm = true): Promise<NarrativeDiffResponse> {
  return postApi<NarrativeDiffResponse>("/api/narrative-diff", { runIdA, runIdB, includeLlm });
}

// ── Voice-of-SERP — top-10 SERP narrative synthesis ───────────────────────
export interface VoiceOfSerpPage {
  rank: number;
  url: string;
  domain: string;
  title: string;
  wordCount: number;
  signals: {
    hasH2List: boolean;
    hasComparisonTable: boolean;
    hasFaqStructured: boolean;
    paragraphCount: number;
  };
  textSample: string;
  fetchOk: boolean;
  fetchError?: string;
}
export interface VoiceSynthesisResponse {
  dominantTopics: string[];
  formatProfile: string;
  tone: string;
  depthSignals: string[];
  coverageGaps: string[];
  whyTheyWin: string;
  model: string;
  durationMs: number;
}
export interface VoiceOfSerpResponse {
  keyword: string;
  region: string;
  fetchedAt: string;
  pages: VoiceOfSerpPage[];
  aggregate: {
    avgWordCount: number;
    medianWordCount: number;
    listLayoutPct: number;
    comparisonTablePct: number;
    faqPct: number;
    successfulFetches: number;
  };
  voice: VoiceSynthesisResponse | null;
  voiceError?: string;
}
export function fetchVoiceOfSerp(keyword: string, extras?: { region?: string; topN?: number }): Promise<VoiceOfSerpResponse> {
  return postApi<VoiceOfSerpResponse>("/api/voice-of-serp", {
    keyword,
    region: extras?.region,
    topN: extras?.topN,
  });
}

// ── Bulk Keyword Analyzer — paste many keywords, get SEMrush-style table ──
export interface BulkKeywordRow {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpcUsd: number | null;
  competitionLabel: "LOW" | "MEDIUM" | "HIGH" | null;
  volumeSource: string | null;
  intent: "informational" | "commercial" | "navigational" | "transactional";
  wordCount: number;
}
export interface BulkKeywordResult {
  region: string;
  rows: BulkKeywordRow[];
  meta: {
    requestedCount: number;
    processedCount: number;
    provider: "google-ads" | "dataforseo" | "none";
    durationMs: number;
    skippedReasons: { reason: string; count: number }[];
  };
}
export function analyzeBulkKeywordsApi(keywords: string[], extras?: { region?: string; provider?: "google-ads" | "dataforseo" | "auto" }): Promise<BulkKeywordResult> {
  return postApi<BulkKeywordResult>("/api/bulk-keywords", { keywords, region: extras?.region, provider: extras?.provider });
}

// ── Term Intel — universal cross-source lookup for any term ──────────────
export type TermIntelSourceStatus = "ok" | "no-data" | "not-configured" | "error";
export type TermIntelDetail =
  | { kind: "table"; columns: string[]; rows: (string | number)[][] }
  | { kind: "list"; items: string[] }
  | { kind: "serp"; results: { position: number; url: string; title: string }[] }
  | { kind: "trend"; monthly: number[] }
  | { kind: "text"; text: string };
export interface TermIntelSource {
  id: string;
  name: string;
  category: "volume" | "editorial" | "anchor" | "serp" | "topic";
  status: TermIntelSourceStatus;
  headline: string;
  metric?: string;
  detail?: TermIntelDetail;
  reason?: string;
}
export interface TermIntelResult {
  term: string;
  region: string;
  fetchedAt: string;
  perSource: TermIntelSource[];
  sourcesHit: string[];
  sourcesMissed: string[];
}
export interface TermIntelResponse {
  intel: TermIntelResult;
  context: CouncilContext;
  council: CouncilResult | { error: string } | null;
  elapsed: { gatherMs: number; llmMs: number };
}
export function runTermIntelApi(term: string, extras?: { region?: string; domain?: string; includeLlm?: boolean }): Promise<TermIntelResponse> {
  return postApi<TermIntelResponse>("/api/term-intel", {
    term,
    region: extras?.region,
    domain: extras?.domain,
    includeLlm: extras?.includeLlm !== false,
  });
}

// Startpage SERP — ~0.9 correlation with Google, free, Playwright-backed.
export type StartpageSerpResult = { position: number; title: string; url: string; displayUrl?: string; snippet?: string };
export type StartpageSerpResponse = { query: string; region: string; fetchedAt: string; results: StartpageSerpResult[]; selectorVariant: string; durationMs: number };
export function fetchStartpageSerp(query: string, region = "US"): Promise<StartpageSerpResponse> {
  return postApi<StartpageSerpResponse>("/api/serp-startpage", { query, region });
}

// LLM Router Stats
export function fetchLlmStats(): Promise<any> {
  return dedupFetch("/api/llm-stats", async () => {
    const res = await fetch("/api/llm-stats");
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }, 10_000);
}

// ---------------------------------------------------------------------------
// Google Search Console + Google Analytics 4 integration
// ---------------------------------------------------------------------------

export type GoogleConnectionStatus = {
  connected: boolean;
  configured: boolean;
  email?: string;
  scopes: string[];
  connectedAt?: string;
};

export async function fetchGoogleAuthStatus(): Promise<GoogleConnectionStatus> {
  const res = await fetch("/api/auth/google/status", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<GoogleConnectionStatus>;
}

/** Starts OAuth flow by navigating the browser to the /api/auth/google/start redirect. */
export function startGoogleAuth(): void {
  window.location.href = "/api/auth/google/start";
}

export async function disconnectGoogleAuth(): Promise<void> {
  const res = await fetch("/api/auth/google/disconnect", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  clearApiCache();
}

export type GscSite = { siteUrl: string; permissionLevel: string };

export async function fetchGscSites(): Promise<GscSite[]> {
  return dedupFetch("/api/gsc/sites", async () => {
    const res = await fetch("/api/gsc/sites");
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { sites?: GscSite[] };
    return data.sites ?? [];
  }, 60_000);
}

export async function queryGscAnalytics(body: {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  dimensions?: ("query" | "page" | "country" | "device" | "searchAppearance")[];
  filter?: { dimension: "query" | "page"; operator: "contains" | "equals" | "notContains"; expression: string };
  rowLimit?: number;
  startRow?: number;
}): Promise<any[]> {
  const resp = await postApi<{ rows?: any[] }>("/api/gsc/query", body, 60_000);
  return resp.rows ?? [];
}

export async function fetchGscKeywordStats(siteUrl: string, keyword: string, daysBack?: number): Promise<any | null> {
  const resp = await postApi<{ stats?: any | null }>("/api/gsc/keyword", { siteUrl, keyword, daysBack }, 60_000);
  return resp.stats ?? null;
}

export async function fetchGscPageStats(siteUrl: string, pageUrl: string, daysBack?: number): Promise<any | null> {
  const resp = await postApi<{ stats?: any | null }>("/api/gsc/page", { siteUrl, pageUrl, daysBack }, 60_000);
  return resp.stats ?? null;
}

export async function fetchGscPagesBatch(siteUrl: string, daysBack?: number, rowLimit?: number): Promise<any[]> {
  const resp = await postApi<{ pages?: any[] }>("/api/gsc/pages-batch", { siteUrl, daysBack, rowLimit }, 60_000);
  return resp.pages ?? [];
}

export type Ga4Property = { propertyId: string; displayName: string; parentAccount: string };

export async function fetchGa4Properties(): Promise<Ga4Property[]> {
  return dedupFetch("/api/ga4/properties", async () => {
    const res = await fetch("/api/ga4/properties");
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { properties?: Ga4Property[] };
    return data.properties ?? [];
  }, 60_000);
}

export async function runGa4Report(body: {
  propertyId: string;
  startDate?: string;
  endDate?: string;
  dimensions?: string[];
  metrics?: string[];
  limit?: number;
  orderByMetric?: string;
  orderDesc?: boolean;
  filterPagePath?: string;
}): Promise<any[]> {
  const resp = await postApi<{ rows?: any[] }>("/api/ga4/report", body, 60_000);
  return resp.rows ?? [];
}

export async function fetchGa4PageTraffic(propertyId: string, pagePath: string, daysBack?: number): Promise<any | null> {
  const resp = await postApi<{ traffic?: any | null }>("/api/ga4/page", { propertyId, pagePath, daysBack }, 60_000);
  return resp.traffic ?? null;
}

/**
 * Returns a list of `{ page, screenPageViews, activeUsers, ... }` entries where
 * each metric is a DataPoint<number>. `page` is the GA4 pagePath.
 */
export async function fetchGa4PagesBatch(propertyId: string, daysBack?: number, limit?: number): Promise<any[]> {
  const resp = await postApi<{ pages?: any[] }>("/api/ga4/pages-batch", { propertyId, daysBack, limit }, 60_000);
  return resp.pages ?? [];
}

export async function fetchGa4Totals(propertyId: string, daysBack?: number): Promise<any | null> {
  const resp = await postApi<{ totals?: any | null }>("/api/ga4/totals", { propertyId, daysBack }, 60_000);
  return resp.totals ?? null;
}

// ---------------------------------------------------------------------------
// File Upload
// ---------------------------------------------------------------------------

export async function parseUrlsFile(file: File): Promise<string[]> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/parse-urls-file", { method: "POST", body: fd });
  const text = await res.text();
  let data: { urls?: string[]; error?: string };
  try {
    data = JSON.parse(text) as { urls?: string[]; error?: string };
  } catch {
    throw new Error(text || "Upload failed");
  }
  if (!res.ok) throw new Error(data.error ?? text);
  return data.urls ?? [];
}

// ---------------------------------------------------------------------------
// Report / PDF URLs
// ---------------------------------------------------------------------------

export function reportIndexUrl(runId: string): string {
  return `/reports/${encodeURIComponent(runId)}/index.html`;
}

export function pdfUrl(runId: string, fileRel: string, opts?: { download?: boolean }): string {
  const q = new URLSearchParams();
  q.set("runId", runId);
  q.set("file", fileRel);
  if (opts?.download) q.set("download", "1");
  return `/api/pdf?${q.toString()}`;
}

export function normalizeReportHtmlRel(rel: string): string {
  return rel.replace(/^\.\//, "").replace(/\\/g, "/");
}

export function combinedReportHtmlUrl(run: HealthRunMeta): string {
  const rel = run.masterHtmlHref?.trim() ? normalizeReportHtmlRel(run.masterHtmlHref) : "master.html";
  const segments = rel.split("/").map(encodeURIComponent).join("/");
  return `/reports/${encodeURIComponent(run.runId)}/${segments}`;
}

export function runSummaryReportHtmlUrl(run: HealthRunMeta): string {
  const rel = run.runSummaryHtmlHref?.trim() ? normalizeReportHtmlRel(run.runSummaryHtmlHref) : "run-summary.html";
  const segments = rel.split("/").map(encodeURIComponent).join("/");
  return `/reports/${encodeURIComponent(run.runId)}/${segments}`;
}

export function siteReportHtmlUrl(runId: string, reportHtmlHref: string): string {
  const rel = normalizeReportHtmlRel(reportHtmlHref);
  const segments = rel.split("/").map(encodeURIComponent).join("/");
  return `/reports/${encodeURIComponent(runId)}/${segments}`;
}

export function seoAuditReportHtmlUrl(runId: string, seoAuditHtmlHref: string): string {
  const rel = normalizeReportHtmlRel(seoAuditHtmlHref);
  const segments = rel.split("/").map(encodeURIComponent).join("/");
  return `/reports/${encodeURIComponent(runId)}/${segments}`;
}

export function combinedPdfUrl(run: HealthRunMeta, opts?: { download?: boolean }): string {
  const rel = run.masterHtmlHref?.trim()
    ? normalizeReportHtmlRel(run.masterHtmlHref)
    : run.runSummaryHtmlHref?.trim()
      ? normalizeReportHtmlRel(run.runSummaryHtmlHref)
      : "master.html";
  return pdfUrl(run.runId, rel, opts);
}

export function sitePdfUrl(runId: string, reportHtmlHref: string, opts?: { download?: boolean }): string {
  return pdfUrl(runId, normalizeReportHtmlRel(reportHtmlHref), opts);
}

export type SiteStatusValue = "open" | "ok" | "working" | "resolved";

export type SiteStatusOverridesPayload = {
  runId: string;
  savedAt?: string;
  sites: Record<string, { status: SiteStatusValue; editedAt?: string }>;
};

export async function fetchSiteStatusOverrides(runId: string): Promise<SiteStatusOverridesPayload | null> {
  const res = await fetch(`/reports/${encodeURIComponent(runId)}/site-status-overrides.json`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SiteStatusOverridesPayload>;
}

export async function saveSiteStatusOverrides(
  runId: string,
  sites: Record<string, SiteStatusValue>,
): Promise<{ sites: Record<string, { status: SiteStatusValue; editedAt: string }>; savedAt: string }> {
  const sitesNested = Object.fromEntries(
    Object.entries(sites).map(([hostname, status]) => [hostname, { status }]),
  );
  const res = await fetch("/api/site-status-overrides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, sites: sitesNested }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ sites: Record<string, { status: SiteStatusValue; editedAt: string }>; savedAt: string }>;
}
