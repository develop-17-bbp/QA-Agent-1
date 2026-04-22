/**
 * Diagnostic probe — hits every external provider QA-Agent depends on and
 * prints a single-screen summary of which are live, which are mis-configured,
 * and which returned a soft "not enough data" response.
 *
 * Usage:
 *   npx tsx scripts/diag-providers.ts
 *
 * Safe to run on any machine — only performs low-cost read calls with tiny
 * sample inputs (example.com / "test" keyword). Rate limits are respected
 * (each provider is called once).
 */
import "dotenv/config";

type Status = "live" | "unconfigured" | "error" | "empty";
interface ProbeRow {
  provider: string;
  status: Status;
  detail: string;
  latencyMs: number;
}

const rows: ProbeRow[] = [];

async function probe(name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    rows.push({ provider: name, status: "live", detail, latencyMs: Date.now() - t0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status: Status =
      /not set|not configured|missing|unconfigured|not yet consented|not connected|visit \/google-connections/i.test(msg) ? "unconfigured" :
      /no data|empty|not in index|not in top|no results|no snapshots|page not found|site not verified/i.test(msg) ? "empty" : "error";
    rows.push({ provider: name, status, detail: msg.slice(0, 140), latencyMs: Date.now() - t0 });
  }
}

async function main() {
  const sampleDomain = "example.com";
  const sampleUrl = "https://example.com/";
  const sampleKw = "coffee";

  // ── Google-family ────────────────────────────────────────────────────────
  await probe("Google Ads Keyword Planner", async () => {
    const { fetchKeywordVolume, isGoogleAdsConfigured } = await import("../src/health/providers/google-ads.js");
    if (!isGoogleAdsConfigured()) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN / CUSTOMER_ID not set");
    const r = await fetchKeywordVolume([sampleKw], "US");
    return r.length > 0 ? `${r.length} keyword(s) returned` : "no keywords returned";
  });

  await probe("Chrome UX Report", async () => {
    const { fetchCruxRecord, isCruxConfigured } = await import("../src/health/providers/crux.js");
    if (!isCruxConfigured()) throw new Error("CRUX_API_KEY not set");
    const rec = await fetchCruxRecord(sampleUrl, "PHONE");
    return rec ? "p75 metrics returned" : "no real-user data for URL (empty)";
  });

  await probe("Google OAuth (GSC+GA4+Ads)", async () => {
    const { isOauthConfigured, getConnectionStatus } = await import("../src/health/providers/google-auth.js");
    if (!isOauthConfigured()) throw new Error("GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET not set");
    const s = await getConnectionStatus();
    if (!s.connected) throw new Error("OAuth configured but not yet consented — visit /google-connections");
    return `connected as ${s.email ?? "(unknown email)"} · scopes: ${s.scopes.length}`;
  });

  await probe("Google Trends", async () => {
    const { fetchKeywordTrend } = await import("../src/health/providers/google-trends.js");
    const t = await fetchKeywordTrend(sampleKw, "US");
    const points = t.trend12mo?.value?.length ?? 0;
    return `${points} monthly points`;
  });

  await probe("Google Suggest", async () => {
    const { fetchSuggestions } = await import("../src/health/providers/google-suggest.js");
    const s = await fetchSuggestions(sampleKw, "en");
    return `${s.value.length} suggestions`;
  });

  await probe("PageSpeed Insights", async () => {
    const { resolvePageSpeedApiKey } = await import("../src/health/pagespeed-insights.js");
    if (!resolvePageSpeedApiKey()) throw new Error("PAGESPEED_API_KEY not set");
    return "API key present (live calls happen during crawl)";
  });

  // ── Third-party providers ────────────────────────────────────────────────
  await probe("OpenPageRank", async () => {
    const { fetchDomainAuthority, isOpenPageRankConfigured } = await import("../src/health/providers/open-page-rank.js");
    if (!isOpenPageRankConfigured()) throw new Error("OPR_API_KEY not set");
    const r = await fetchDomainAuthority(sampleDomain);
    return `DA ${r.authority0to100.value}/100 · PR ${r.pageRankDecimal.value}`;
  });

  await probe("Mozilla Observatory", async () => {
    const { fetchSecurityGrade } = await import("../src/health/providers/mozilla-observatory.js");
    const r = await fetchSecurityGrade(sampleDomain);
    return `grade ${r.grade.value ?? "—"} · score ${r.score.value ?? "—"}`;
  });

  await probe("Wayback Machine", async () => {
    const { fetchClosestSnapshot } = await import("../src/health/providers/wayback-machine.js");
    const r = await fetchClosestSnapshot(sampleUrl);
    return r.value ? `closest snapshot at ${r.value.timestamp}` : "no snapshots";
  });

  await probe("URLScan", async () => {
    const mod = await import("../src/health/providers/urlscan.js");
    if (!mod.isUrlscanConfigured()) throw new Error("URLSCAN_API_KEY not set");
    const r = await mod.searchDomainReferences(sampleDomain, 5);
    return `${r.value.length} reference(s) indexed`;
  });

  await probe("Cloudflare Radar", async () => {
    const mod = await import("../src/health/providers/cloudflare-radar.js");
    if (!mod.isCloudflareRadarConfigured()) throw new Error("CLOUDFLARE_API_TOKEN not set");
    const r = await mod.fetchDomainRank(sampleDomain);
    return r ? `rank #${r.rank.value}` : "not in top-domains set";
  });

  await probe("Bing Webmaster Tools", async () => {
    const mod = await import("../src/health/providers/bing-webmaster.js");
    if (!mod.isBingWmtConfigured()) throw new Error("BING_WEBMASTER_API_KEY not set");
    const r = await mod.fetchBingLinkCounts(sampleUrl);
    return r ? `${r.value.totalLinks} inbound link(s)` : "site not verified in Bing Webmaster Tools";
  });

  await probe("Yandex Webmaster Tools", async () => {
    const mod = await import("../src/health/providers/yandex-webmaster.js");
    if (!mod.isYandexWebmasterConfigured()) throw new Error("YANDEX_WEBMASTER_API_KEY + YANDEX_WEBMASTER_USER_ID not set");
    const r = await mod.fetchYandexSites();
    return `${r.value.length} verified host(s)`;
  });

  await probe("Naver Search Advisor", async () => {
    const mod = await import("../src/health/providers/naver-webmaster.js");
    if (!mod.isNaverWebmasterConfigured()) throw new Error("NAVER_CLIENT_ID + NAVER_CLIENT_SECRET not set");
    const r = await mod.fetchNaverSites();
    return `${r.value.length} verified site(s)`;
  });

  await probe("Brave Search", async () => {
    const mod = await import("../src/health/providers/brave-search.js");
    if (!mod.isBraveConfigured()) throw new Error("BRAVE_SEARCH_API_KEY not set");
    const r = await mod.searchBrave(sampleKw, "US");
    return `${r.value.results.length} results`;
  });

  await probe("Tranco rank", async () => {
    const mod = await import("../src/health/providers/tranco-rank.js");
    const r = await mod.fetchDomainRank(sampleDomain);
    return r ? `rank #${r.currentRank.value} (${r.percentile.value} pctile)` : "not in Tranco list";
  });

  await probe("Common Crawl", async () => {
    const mod = await import("../src/health/providers/common-crawl.js");
    const r = await mod.approximateReferringDomains(sampleDomain);
    return `~${r.value} referring domains (approx)`;
  });

  await probe("Wikipedia Pageviews", async () => {
    const mod = await import("../src/health/providers/wikipedia-pageviews.js");
    const r = await mod.fetchBestMatchPageviews(["Coffee"]);
    return r ? `${r.value}/mo avg` : "page not found";
  });

  // ── Local ────────────────────────────────────────────────────────────────
  await probe("Ollama (local LLM)", async () => {
    const { checkOllamaAvailable } = await import("../src/health/agentic/llm-router.js");
    const ok = await checkOllamaAvailable(true);
    if (!ok) throw new Error("Ollama not reachable — start with `ollama serve`");
    return "ready";
  });

  // ── Render ───────────────────────────────────────────────────────────────
  const widest = Math.max(...rows.map((r) => r.provider.length));
  const DOT: Record<Status, string> = { live: "\x1b[32m●\x1b[0m", unconfigured: "\x1b[33m○\x1b[0m", empty: "\x1b[90m●\x1b[0m", error: "\x1b[31m●\x1b[0m" };
  const LABEL: Record<Status, string> = { live: "LIVE        ", unconfigured: "UNCONFIGURED", empty: "EMPTY       ", error: "ERROR       " };

  console.log("\n  QA-Agent provider diagnostics");
  console.log("  ─────────────────────────────\n");
  for (const r of rows) {
    const pad = " ".repeat(widest - r.provider.length);
    console.log(`  ${DOT[r.status]} ${r.provider}${pad}  ${LABEL[r.status]}  ${r.latencyMs}ms  ${r.detail}`);
  }

  const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<Status, number>);
  console.log(`\n  ${counts.live ?? 0} live · ${counts.unconfigured ?? 0} unconfigured · ${counts.empty ?? 0} empty · ${counts.error ?? 0} error\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
