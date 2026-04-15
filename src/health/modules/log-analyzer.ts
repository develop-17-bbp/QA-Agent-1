import { generateText } from "../llm.js";
import { dp, type DataPoint } from "../providers/types.js";

// ── Unit 10 honesty goal ────────────────────────────────────────────────
//
// The old version parsed log lines correctly (that part was already real)
// but then asked the LLM to invent 5–8 "SEO insights" as a bullet list.
// Users read those as facts about THEIR logs, even though the LLM only
// saw a short summary line. It also returned every numeric field as a
// bare number with no provenance.
//
// This rewrite:
//   1. Wraps every numeric field (totalRequests, uniqueUrls, errorRate,
//      botPercent, parsedLines, per-URL hits) in DataPoint<number>.
//   2. Attaches a DataQuality envelope — providersHit: ["log-file"] on
//      success, providersFailed: ["log-file"] when the log is empty or
//      unparseable.
//   3. Replaces the LLM bullet list with a single ≤3-sentence qualitative
//      summary keyed off the REAL parsed top URLs + status + bot mix. No
//      invented URLs, counts, or sites — just "why this matters" text.
//
// Everything in the parser remains deterministic. The LLM never touches
// a number. If the LLM call fails the page still has everything it needs.
//
// ────────────────────────────────────────────────────────────────────────

type DataQuality = {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};

const LOG_TTL = 10 * 60 * 1000;

export interface LogUrlHit {
  url: string;
  hits: DataPoint<number>;
}

export interface LogAnalysisResult {
  totalRequests: DataPoint<number>;
  parsedLines: DataPoint<number>;
  urlHits: LogUrlHit[];
  statusDistribution: Record<string, DataPoint<number>>;
  botTraffic: Record<string, DataPoint<number>>;
  methods: Record<string, DataPoint<number>>;
  hourlyTraffic: { hour: number; count: DataPoint<number> }[];
  /** LLM-generated ≤3-sentence qualitative summary. Verify before acting. */
  commentary: string;
  summary: {
    uniqueUrls: DataPoint<number>;
    errorRate: DataPoint<number>;
    botPercent: DataPoint<number>;
    topBots: string[];
  };
  dataQuality: DataQuality;
}

function emptyResult(reason: string): LogAnalysisResult {
  return {
    totalRequests: dp<number>(0, "log-file", "low", LOG_TTL, reason),
    parsedLines: dp<number>(0, "log-file", "low", LOG_TTL, reason),
    urlHits: [],
    statusDistribution: {},
    botTraffic: {},
    methods: {},
    hourlyTraffic: [],
    commentary: "",
    summary: {
      uniqueUrls: dp<number>(0, "log-file", "low", LOG_TTL, reason),
      errorRate: dp<number>(0, "log-file", "low", LOG_TTL, reason),
      botPercent: dp<number>(0, "log-file", "low", LOG_TTL, reason),
      topBots: [],
    },
    dataQuality: {
      realDataFields: [],
      estimatedFields: [],
      missingFields: ["log-content"],
      providersHit: [],
      providersFailed: ["log-file"],
    },
  };
}

export async function analyzeLogFile(logContent: string): Promise<LogAnalysisResult> {
  if (!logContent || !logContent.trim()) {
    return emptyResult("no log content provided");
  }

  const lines = logContent.split("\n").filter((l) => l.trim());
  const totalLines = lines.length;

  // Parse common log formats (Apache/Nginx combined)
  const urlHits = new Map<string, number>();
  const statusDist = new Map<number, number>();
  const botHits = new Map<string, number>();
  const methodDist = new Map<string, number>();
  const hourDist = new Map<number, number>();

  // Common log format: IP - - [date] "METHOD URL PROTO" STATUS SIZE "REFERER" "UA"
  const logRegex = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+\S+"\s+(\d+)\s+\S+\s+"[^"]*"\s+"([^"]*)"/;
  // Simplified: just IP, method, URL, status
  const simpleRegex = /^(\S+).*?"(\w+)\s+(\S+).*?"\s+(\d+)/;

  const knownBots = ["googlebot", "bingbot", "yandex", "baidu", "duckduckbot", "slurp", "msnbot", "semrush", "ahrefs", "majestic", "screaming frog", "mj12bot", "dotbot"];

  let parsedLines = 0;
  for (const line of lines) {
    const combinedMatch = logRegex.exec(line);
    const simpleMatch = combinedMatch ? null : simpleRegex.exec(line);
    const match = combinedMatch ?? simpleMatch;
    if (!match) continue;

    parsedLines++;

    const isCombined = combinedMatch !== null;
    const url = isCombined ? match[4] : match[3];
    const status = parseInt(isCombined ? match[5] : match[4], 10);
    const ua = isCombined ? match[6] : "";
    const method = isCombined ? match[3] : match[2];
    const dateStr = isCombined ? match[2] : "";

    if (url) urlHits.set(url, (urlHits.get(url) ?? 0) + 1);
    if (!isNaN(status)) statusDist.set(status, (statusDist.get(status) ?? 0) + 1);
    if (method) methodDist.set(method, (methodDist.get(method) ?? 0) + 1);

    // Extract hour
    const hourMatch = dateStr.match(/:(\d{2}):/);
    if (hourMatch) { const h = parseInt(hourMatch[1], 10); hourDist.set(h, (hourDist.get(h) ?? 0) + 1); }

    // Bot detection
    const uaLower = ua.toLowerCase();
    for (const bot of knownBots) {
      if (uaLower.includes(bot)) { botHits.set(bot, (botHits.get(bot) ?? 0) + 1); break; }
    }
  }

  if (parsedLines === 0) {
    return {
      ...emptyResult(`${totalLines} lines present but none matched Apache/Nginx format`),
      parsedLines: dp<number>(0, "log-file", "high", LOG_TTL, `${totalLines} lines present but none matched Apache/Nginx format`),
      totalRequests: dp<number>(totalLines, "log-file", "high", LOG_TTL, "raw line count — nothing parseable"),
    };
  }

  const realDataFieldsSet = new Set<string>();
  const parseNote = `parsed from log file (${parsedLines}/${totalLines} lines matched)`;

  const topUrls: LogUrlHit[] = [...urlHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([url, hits]) => {
      realDataFieldsSet.add("urlHits");
      return { url, hits: dp<number>(hits, "log-file", "high", LOG_TTL, parseNote) };
    });

  const statusDistribution: Record<string, DataPoint<number>> = {};
  for (const [code, count] of [...statusDist.entries()].sort((a, b) => a[0] - b[0])) {
    statusDistribution[String(code)] = dp<number>(count, "log-file", "high", LOG_TTL, parseNote);
    realDataFieldsSet.add("statusDistribution");
  }

  const botTraffic: Record<string, DataPoint<number>> = {};
  for (const [bot, count] of [...botHits.entries()].sort((a, b) => b[1] - a[1])) {
    botTraffic[bot] = dp<number>(count, "log-file", "high", LOG_TTL, parseNote);
    realDataFieldsSet.add("botTraffic");
  }

  const methods: Record<string, DataPoint<number>> = {};
  for (const [m, count] of [...methodDist.entries()].sort((a, b) => b[1] - a[1])) {
    methods[m] = dp<number>(count, "log-file", "high", LOG_TTL, parseNote);
    realDataFieldsSet.add("methods");
  }

  const hourlyTraffic = [...hourDist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, count]) => {
      realDataFieldsSet.add("hourlyTraffic");
      return { hour, count: dp<number>(count, "log-file", "high", LOG_TTL, parseNote) };
    });

  const totalBotHits = [...botHits.values()].reduce((a, b) => a + b, 0);
  const errorCount = [...statusDist.entries()].filter(([s]) => s >= 400).reduce((a, [, c]) => a + c, 0);
  const errorRateValue = parsedLines > 0 ? +((errorCount / parsedLines) * 100).toFixed(1) : 0;
  const botPercentValue = parsedLines > 0 ? +((totalBotHits / parsedLines) * 100).toFixed(1) : 0;

  realDataFieldsSet.add("totalRequests");
  realDataFieldsSet.add("uniqueUrls");
  realDataFieldsSet.add("errorRate");
  realDataFieldsSet.add("botPercent");
  realDataFieldsSet.add("parsedLines");

  // ── LLM commentary — ≤3 sentences over REAL parsed findings ─────────────
  const estimatedFields: string[] = [];
  let commentary = "";
  if (topUrls.length > 0) {
    const topUrlSummary = topUrls.slice(0, 5).map((u) => `${u.url} (${u.hits.value} hits)`).join(", ");
    const topBotSummary = Object.entries(botTraffic).slice(0, 3).map(([b, d]) => `${b}: ${d.value}`).join(", ") || "no bot hits detected";
    const prompt = `You are a technical SEO engineer. Given these REAL parsed log findings, write a 2-3 sentence qualitative explanation of WHY the pattern matters for SEO, crawl budget, or errors. Do NOT invent URLs, counts, or metrics. Do NOT output a list.

Parsed findings:
- Lines parsed: ${parsedLines} of ${totalLines}
- Error rate: ${errorRateValue}%
- Bot traffic: ${botPercentValue}% (${topBotSummary})
- Top URLs: ${topUrlSummary}

Return plain text only, no JSON, no markdown headers.`;
    try {
      const raw = await generateText(prompt);
      commentary = raw.replace(/```[\s\S]*?```/g, "").trim().slice(0, 600);
      if (commentary) estimatedFields.push("commentary");
    } catch {
      commentary = "";
    }
  }

  return {
    totalRequests: dp<number>(parsedLines, "log-file", "high", LOG_TTL, parseNote),
    parsedLines: dp<number>(parsedLines, "log-file", "high", LOG_TTL, `${parsedLines} of ${totalLines} lines matched Apache/Nginx format`),
    urlHits: topUrls,
    statusDistribution,
    botTraffic,
    methods,
    hourlyTraffic,
    commentary,
    summary: {
      uniqueUrls: dp<number>(urlHits.size, "log-file", "high", LOG_TTL, parseNote),
      errorRate: dp<number>(errorRateValue, "log-file", "high", LOG_TTL, `${errorCount} of ${parsedLines} parsed requests had status ≥ 400`),
      botPercent: dp<number>(botPercentValue, "log-file", "high", LOG_TTL, `${totalBotHits} of ${parsedLines} parsed requests matched a known bot UA`),
      topBots: Object.keys(botTraffic).slice(0, 3),
    },
    dataQuality: {
      realDataFields: Array.from(realDataFieldsSet),
      estimatedFields,
      missingFields: [],
      providersHit: ["log-file"],
      providersFailed: [],
    } satisfies DataQuality,
  };
}
