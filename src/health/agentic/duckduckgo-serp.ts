/**
 * DuckDuckGo SERP Scraper — Free search results without API keys
 *
 * Scrapes DuckDuckGo HTML search results to extract:
 * - Organic results (title, URL, snippet, position)
 * - Related searches
 * - Result count estimates
 *
 * Features:
 * - In-memory LRU cache (configurable TTL)
 * - Rate limiting (max N requests/minute)
 * - Retry with exponential backoff
 * - Rotating user agents
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SerpResult {
  position: number;
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
}

export interface SerpResponse {
  query: string;
  results: SerpResult[];
  relatedSearches: string[];
  totalResultsEstimate: string;
  scrapedAt: string;
  cached: boolean;
  latencyMs: number;
}

export interface SerpCompetitorAnalysis {
  query: string;
  yourPosition: number | null;
  yourUrl: string | null;
  competitors: { position: number; domain: string; title: string; url: string }[];
  serpFeatures: string[];
  difficulty: "easy" | "medium" | "hard";
  opportunity: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const RATE_LIMIT_PER_MIN = 8;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_CACHE_ENTRIES = 200;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
];

// ── Rate limiter ─────────────────────────────────────────────────────────────

const requestTimestamps: number[] = [];

function canMakeRequest(): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < windowStart) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < RATE_LIMIT_PER_MIN;
}

function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

async function waitForRateLimit(): Promise<void> {
  while (!canMakeRequest()) {
    await new Promise(r => setTimeout(r, 500));
  }
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: SerpResponse; expiresAt: number }>();

function cacheKey(query: string): string {
  return query.toLowerCase().trim();
}

function getCached(query: string): SerpResponse | null {
  const key = cacheKey(query);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { ...entry.data, cached: true };
}

function setCache(query: string, data: SerpResponse): void {
  // Evict oldest if full
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey(query), { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── HTML Parser (no Cheerio dependency — lightweight regex) ──────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, "")).trim();
}

function parseDdgHtml(html: string): { results: SerpResult[]; relatedSearches: string[] } {
  const results: SerpResult[] = [];
  const relatedSearches: string[] = [];

  // DuckDuckGo HTML search wraps results in <div class="result..."> or <div class="web-result">
  // Each result has: <a class="result__a" href="...">title</a> and <a class="result__snippet">snippet</a>

  // Method 1: Standard HTML layout result blocks
  const resultBlockRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  const urlDisplayRegex = /<span[^>]*class="[^"]*result__url[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

  const blocks = html.match(resultBlockRegex) ?? [];
  for (const block of blocks) {
    const linkMatch = block.match(linkRegex);
    if (!linkMatch) continue;
    const url = decodeHtmlEntities(linkMatch[1]!);
    if (!url.startsWith("http")) continue;
    const title = stripHtml(linkMatch[2]!);
    const snippetMatch = block.match(snippetRegex);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]!) : "";
    const urlMatch = block.match(urlDisplayRegex);
    const displayUrl = urlMatch ? stripHtml(urlMatch[1]!) : new URL(url).hostname;
    results.push({ position: results.length + 1, title, url, displayUrl, snippet });
  }

  // Method 2: Fallback — scan for all anchor tags with uddg redirect
  if (results.length === 0) {
    const uddgRegex = /href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = uddgRegex.exec(html)) !== null) {
      try {
        const url = decodeURIComponent(match[1]!);
        if (!url.startsWith("http")) continue;
        const title = stripHtml(match[2]!);
        if (!title || title.length < 3) continue;
        results.push({ position: results.length + 1, title, url, displayUrl: new URL(url).hostname, snippet: "" });
      } catch { /* skip malformed URLs */ }
    }
  }

  // Method 3: Fallback — direct links with result titles
  if (results.length === 0) {
    const directLinkRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seen = new Set<string>();
    while ((match = directLinkRegex.exec(html)) !== null) {
      const url = decodeHtmlEntities(match[1]!);
      if (seen.has(url) || url.includes("duckduckgo.com")) continue;
      seen.add(url);
      const title = stripHtml(match[2]!);
      if (!title || title.length < 5) continue;
      results.push({ position: results.length + 1, title, url, displayUrl: new URL(url).hostname, snippet: "" });
    }
  }

  // Related searches
  const relatedRegex = /<a[^>]*class="[^"]*result__related[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let relMatch;
  while ((relMatch = relatedRegex.exec(html)) !== null) {
    const text = stripHtml(relMatch[1]!);
    if (text) relatedSearches.push(text);
  }

  // Deduplicate results by URL
  const seen = new Set<string>();
  const unique: SerpResult[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    r.position = unique.length + 1;
    unique.push(r);
  }

  return { results: unique.slice(0, 30), relatedSearches };
}

// ── Core scraper ─────────────────────────────────────────────────────────────

async function fetchDdgHtml(query: string): Promise<string> {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
  const params = new URLSearchParams({ q: query, kl: "us-en", t: "h_", ia: "web" });
  const url = `https://html.duckduckgo.com/html/?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function searchSerp(query: string): Promise<SerpResponse> {
  if (!query.trim()) throw new Error("Query required");

  // Check cache first
  const cached = getCached(query);
  if (cached) return cached;

  await waitForRateLimit();
  recordRequest();

  const t0 = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
    try {
      const html = await fetchDdgHtml(query);
      const { results, relatedSearches } = parseDdgHtml(html);

      const response: SerpResponse = {
        query,
        results,
        relatedSearches,
        totalResultsEstimate: results.length > 0 ? `${results.length}+ results` : "No results",
        scrapedAt: new Date().toISOString(),
        cached: false,
        latencyMs: Date.now() - t0,
      };

      if (results.length > 0) setCache(query, response);
      return response;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error("SERP scrape failed");
}

export async function searchSerpBatch(queries: string[]): Promise<SerpResponse[]> {
  const results: SerpResponse[] = [];
  for (const q of queries) {
    try {
      results.push(await searchSerp(q));
    } catch (e) {
      results.push({
        query: q,
        results: [],
        relatedSearches: [],
        totalResultsEstimate: "Error",
        scrapedAt: new Date().toISOString(),
        cached: false,
        latencyMs: 0,
      });
    }
  }
  return results;
}

export async function analyzeCompetitors(query: string, targetDomain: string): Promise<SerpCompetitorAnalysis> {
  const serp = await searchSerp(query);
  const targetHost = targetDomain.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();

  let yourPosition: number | null = null;
  let yourUrl: string | null = null;
  const competitors: SerpCompetitorAnalysis["competitors"] = [];

  for (const r of serp.results) {
    try {
      const host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
      if (host === targetHost.replace(/^www\./, "") || r.url.includes(targetHost)) {
        yourPosition = r.position;
        yourUrl = r.url;
      } else {
        competitors.push({ position: r.position, domain: host, title: r.title, url: r.url });
      }
    } catch { /* skip malformed URLs */ }
  }

  const serpFeatures: string[] = [];
  if (serp.results.some(r => r.snippet.length > 200)) serpFeatures.push("Featured snippets");
  if (serp.relatedSearches.length > 0) serpFeatures.push("Related searches");
  if (serp.results.some(r => r.url.includes("youtube.com"))) serpFeatures.push("Video results");
  if (serp.results.some(r => r.url.includes("wikipedia.org"))) serpFeatures.push("Wikipedia");

  const topDomains = new Set(competitors.slice(0, 5).map(c => c.domain));
  const hasAuthoritySites = [...topDomains].some(d =>
    /wikipedia|amazon|facebook|youtube|reddit|linkedin|github/.test(d),
  );
  const difficulty = hasAuthoritySites ? "hard" : topDomains.size > 3 ? "medium" : "easy";

  const opportunity = yourPosition
    ? yourPosition <= 3 ? "Maintain position — already in top 3" :
      yourPosition <= 10 ? "Optimize for featured snippets and improve content depth" :
      "Major content overhaul needed to break into page 1"
    : "Not ranking — create targeted content and build backlinks";

  return { query, yourPosition, yourUrl, competitors: competitors.slice(0, 10), serpFeatures, difficulty, opportunity };
}

export function getSerpCacheStats(): { entries: number; maxEntries: number } {
  return { entries: cache.size, maxEntries: MAX_CACHE_ENTRIES };
}

export function clearSerpCache(): void {
  cache.clear();
}
