/**
 * Multi-source RSS / JSON-feed aggregator for brand + topic monitoring.
 *
 * The Brand Monitor used to rely on URLScan + Common Crawl, which gives a
 * sparse historical snapshot. This aggregator pulls from ~6 genuinely free,
 * unlimited sources in parallel and returns a chronological feed of
 * mentions — closer to what paid brand-monitoring tools (Brand24, Mention,
 * Meltwater) charge hundreds of dollars per month for.
 *
 * Sources:
 *   - Google News RSS    : news.google.com/rss/search?q=
 *   - Reddit search      : reddit.com/search.rss?q=
 *   - HackerNews Algolia : hn.algolia.com/api/v1/search?query=
 *   - GDELT Doc API      : api.gdeltproject.org/api/v2/doc/doc?query=
 *   - Stack Exchange     : api.stackexchange.com/2.3/search/advanced?q=
 *   - Wayback CDX        : web.archive.org/cdx/search/cdx?url=*.brand.com
 *
 * All endpoints are keyless. Each source has a short per-request cache so
 * repeat queries within an hour don't hammer them. Output rows carry a
 * `source` tag so the UI can color-code or filter.
 */

import { ProviderError } from "./types.js";
import { cacheGet, cacheSet } from "./rate-limit.js";

export type MentionSource =
  | "google-news"
  | "reddit"
  | "hackernews"
  | "gdelt"
  | "stackexchange"
  | "wayback-cdx";

export interface BrandMention {
  source: MentionSource;
  url: string;
  title: string;
  publisher?: string;
  snippet?: string;
  publishedAt?: string;
  /** Score like upvotes / share count when the source provides it. */
  score?: number;
}

export interface BrandMentionsBundle {
  query: string;
  fetchedAt: string;
  mentions: BrandMention[];
  bySource: Record<MentionSource, number>;
  providersHit: MentionSource[];
  providersFailed: MentionSource[];
  /** Coarse sentiment histogram when we can infer it cheaply from title text. */
  titleTone: { positive: number; neutral: number; negative: number };
}

const PROVIDER = "rss-aggregator";
const TTL_MS = 60 * 60 * 1000; // 1h cache per query — cheap for RSS, no point hitting every call
const REQUEST_TIMEOUT_MS = 12_000;

function inferTone(text: string): "positive" | "negative" | "neutral" {
  const t = text.toLowerCase();
  // Extremely coarse lexicon; Ollama does the real sentiment pass downstream.
  if (/\b(launch(ed)?|win(s)?|great|love|record|boost|acquire|award|milestone|growth)\b/.test(t)) return "positive";
  if (/\b(fail(ed|ure)?|hack|breach|lawsuit|fired|laid off|shutdown|scandal|crash|outage|bug|regress)\b/.test(t)) return "negative";
  return "neutral";
}

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 QA-Agent/1.0 (+brand monitor; free feed aggregator)",
        Accept: "application/rss+xml, application/xml, application/json, */*",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { return null; }
}

// ── Google News RSS ─────────────────────────────────────────────────────────

async function fetchGoogleNews(query: string, locale = "en-US"): Promise<BrandMention[]> {
  const [hl, geo] = locale.includes("-") ? [locale, locale.split("-")[1]!] : [locale, "US"];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(geo)}&ceid=${encodeURIComponent(geo)}%3A${encodeURIComponent(hl.split("-")[0] ?? "en")}`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) throw new ProviderError("google-news", `HTTP ${res?.status ?? "net"}`);
  const xml = await res.text();
  return parseRssItems(xml, "google-news");
}

// ── Reddit search RSS ───────────────────────────────────────────────────────

async function fetchReddit(query: string): Promise<BrandMention[]> {
  const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=new&limit=25`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) throw new ProviderError("reddit", `HTTP ${res?.status ?? "net"}`);
  const xml = await res.text();
  return parseRssItems(xml, "reddit");
}

// ── HackerNews Algolia ──────────────────────────────────────────────────────

async function fetchHackerNews(query: string): Promise<BrandMention[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=25`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) throw new ProviderError("hackernews", `HTTP ${res?.status ?? "net"}`);
  const data = (await res.json().catch(() => null)) as { hits?: unknown[] } | null;
  const hits = Array.isArray(data?.hits) ? data!.hits : [];
  const out: BrandMention[] = [];
  for (const h of hits) {
    const hit = h as Record<string, unknown>;
    const storyUrl = typeof hit.url === "string" ? hit.url : "";
    const title = typeof hit.title === "string" ? hit.title : "";
    if (!title) continue;
    out.push({
      source: "hackernews",
      url: storyUrl || `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`,
      title,
      publisher: "Hacker News",
      publishedAt: typeof hit.created_at === "string" ? hit.created_at : undefined,
      score: typeof hit.points === "number" ? hit.points : undefined,
    });
  }
  return out;
}

// ── GDELT Doc API ───────────────────────────────────────────────────────────

async function fetchGdelt(query: string): Promise<BrandMention[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=25&sort=datedesc`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) throw new ProviderError("gdelt", `HTTP ${res?.status ?? "net"}`);
  const data = (await res.json().catch(() => null)) as { articles?: unknown[] } | null;
  const articles = Array.isArray(data?.articles) ? data!.articles : [];
  const out: BrandMention[] = [];
  for (const a of articles) {
    const art = a as Record<string, unknown>;
    const u = typeof art.url === "string" ? art.url : "";
    const title = typeof art.title === "string" ? art.title : "";
    if (!u || !title) continue;
    out.push({
      source: "gdelt",
      url: u,
      title,
      publisher: typeof art.domain === "string" ? (art.domain as string) : undefined,
      publishedAt: typeof art.seendate === "string" ? normalizeGdeltDate(art.seendate as string) : undefined,
    });
  }
  return out;
}

/** GDELT returns YYYYMMDDTHHMMSSZ — normalise to ISO. */
function normalizeGdeltDate(s: string): string | undefined {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

// ── StackExchange ────────────────────────────────────────────────────────────

async function fetchStackExchange(query: string, site = "stackoverflow"): Promise<BrandMention[]> {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=activity&q=${encodeURIComponent(query)}&site=${encodeURIComponent(site)}&pagesize=25`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) throw new ProviderError("stackexchange", `HTTP ${res?.status ?? "net"}`);
  const data = (await res.json().catch(() => null)) as { items?: unknown[] } | null;
  const items = Array.isArray(data?.items) ? data!.items : [];
  const out: BrandMention[] = [];
  for (const it of items) {
    const q = it as Record<string, unknown>;
    const link = typeof q.link === "string" ? q.link : "";
    const title = typeof q.title === "string" ? decodeHtmlEntities(q.title as string) : "";
    if (!link || !title) continue;
    out.push({
      source: "stackexchange",
      url: link,
      title,
      publisher: "Stack Exchange",
      publishedAt: typeof q.last_activity_date === "number" ? new Date((q.last_activity_date as number) * 1000).toISOString() : undefined,
      score: typeof q.score === "number" ? (q.score as number) : undefined,
    });
  }
  return out;
}

// ── Wayback Machine CDX (URL discovery, useful for domain queries) ──────────

async function fetchWaybackCdx(domainQuery: string): Promise<BrandMention[]> {
  // Only meaningful when the query looks like a hostname. Skip otherwise.
  const host = domainQuery.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return [];
  const url = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent("*." + host)}&output=json&fl=original,timestamp&limit=25&from=${String(new Date().getFullYear() - 1)}0101`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) throw new ProviderError("wayback-cdx", `HTTP ${res?.status ?? "net"}`);
  const rows = (await res.json().catch(() => null)) as unknown[][] | null;
  if (!Array.isArray(rows) || rows.length <= 1) return [];
  const out: BrandMention[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const u = String(r[0] ?? "");
    const ts = String(r[1] ?? "");
    if (!u) continue;
    out.push({
      source: "wayback-cdx",
      url: u,
      title: `Wayback snapshot: ${u}`,
      publisher: "web.archive.org",
      publishedAt: ts.length >= 14
        ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`
        : undefined,
    });
  }
  return out;
}

// ── Shared RSS helpers ──────────────────────────────────────────────────────

function parseRssItems(xml: string, source: MentionSource): BrandMention[] {
  const items: BrandMention[] = [];
  // Match <item>…</item> OR Atom <entry>…</entry> because Reddit uses Atom.
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks) {
    const rawTitle = pickTag(block, "title");
    const link =
      pickTag(block, "link") ||
      pickAttr(block, "link", "href") ||
      "";
    const pubDate = pickTag(block, "pubDate") || pickTag(block, "updated") || pickTag(block, "published");
    const description = stripTags(pickTag(block, "description") || pickTag(block, "summary") || pickTag(block, "content") || "");
    const title = stripTags(rawTitle);
    if (!title || !link) continue;
    items.push({
      source,
      url: cleanLink(link, source),
      title: decodeHtmlEntities(title),
      publisher: pickTag(block, "source") || pickTag(block, "author") || undefined,
      snippet: description ? decodeHtmlEntities(description).slice(0, 280) : undefined,
      publishedAt: pubDate ? normalizeRssDate(pubDate) : undefined,
    });
    if (items.length >= 25) break;
  }
  return items;
}

function pickTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1]?.trim() ?? "";
}

function pickAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = xml.match(re);
  return m?.[1] ?? "";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));
}

function normalizeRssDate(s: string): string | undefined {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Reddit wraps links in trackers; strip if possible. Google News wraps in
 *  news.google.com/rss/articles/... — leave as-is; it 302s to the real URL. */
function cleanLink(href: string, source: MentionSource): string {
  if (source === "reddit") {
    try {
      const u = new URL(href);
      if (u.hostname.endsWith("reddit.com")) return u.href;
    } catch { /* skip */ }
  }
  return href;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export interface FetchBrandMentionsOptions {
  query: string;
  /** Limit the number of sources queried (useful on slow networks). */
  sources?: MentionSource[];
  /** Override GDELT locale etc. */
  googleNewsLocale?: string;
}

export async function fetchBrandMentions(options: FetchBrandMentionsOptions): Promise<BrandMentionsBundle> {
  const query = options.query.trim();
  if (!query) throw new ProviderError(PROVIDER, "Empty query");
  const sources: MentionSource[] = options.sources ?? [
    "google-news", "reddit", "hackernews", "gdelt", "stackexchange", "wayback-cdx",
  ];
  const cacheKey = `${PROVIDER}:${sources.sort().join(",")}:${query.toLowerCase()}`;
  const cached = cacheGet<BrandMentionsBundle>(cacheKey);
  if (cached) return cached;

  const jobs = sources.map<Promise<{ source: MentionSource; rows: BrandMention[] }>>((source) => {
    const run = (): Promise<BrandMention[]> => {
      switch (source) {
        case "google-news": return fetchGoogleNews(query, options.googleNewsLocale);
        case "reddit": return fetchReddit(query);
        case "hackernews": return fetchHackerNews(query);
        case "gdelt": return fetchGdelt(query);
        case "stackexchange": return fetchStackExchange(query);
        case "wayback-cdx": return fetchWaybackCdx(query);
      }
    };
    return run().then((rows) => ({ source, rows })).catch(() => ({ source, rows: [] as BrandMention[] }));
  });

  const settled = await Promise.allSettled(jobs);
  const all: BrandMention[] = [];
  const bySource: Record<MentionSource, number> = {
    "google-news": 0, reddit: 0, hackernews: 0, gdelt: 0, stackexchange: 0, "wayback-cdx": 0,
  };
  const providersHit: MentionSource[] = [];
  const providersFailed: MentionSource[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const { source, rows } = r.value;
    if (rows.length > 0) providersHit.push(source);
    else providersFailed.push(source);
    bySource[source] = rows.length;
    all.push(...rows);
  }

  // Chronological — newest first
  all.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  // Coarse tone histogram from titles
  const titleTone = { positive: 0, neutral: 0, negative: 0 };
  for (const m of all) {
    const t = inferTone(m.title);
    if (t === "positive") titleTone.positive++;
    else if (t === "negative") titleTone.negative++;
    else titleTone.neutral++;
  }

  const bundle: BrandMentionsBundle = {
    query,
    fetchedAt: new Date().toISOString(),
    mentions: all.slice(0, 200),
    bySource,
    providersHit,
    providersFailed,
    titleTone,
  };
  cacheSet(cacheKey, bundle, TTL_MS);
  return bundle;
}
