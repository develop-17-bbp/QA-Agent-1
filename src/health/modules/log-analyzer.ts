import { generateGeminiText } from "../gemini-report.js";

export async function analyzeLogFile(logContent: string) {
  const lines = logContent.split("\n").filter(l => l.trim());
  const totalRequests = lines.length;

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

  for (const line of lines) {
    const match = logRegex.exec(line) ?? simpleRegex.exec(line);
    if (!match) continue;

    const url = logRegex.exec(line) ? match[4] : match[3];
    const status = parseInt(logRegex.exec(line) ? match[5] : match[4], 10);
    const ua = logRegex.exec(line) ? match[6] : "";
    const method = logRegex.exec(line) ? match[3] : match[2];
    const dateStr = logRegex.exec(line) ? match[2] : "";

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

  const topUrls = [...urlHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([url, hits]) => ({ url, hits }));
  const statusDistribution = Object.fromEntries([...statusDist.entries()].sort((a, b) => a[0] - b[0]));
  const botTraffic = Object.fromEntries([...botHits.entries()].sort((a, b) => b[1] - a[1]));
  const methods = Object.fromEntries([...methodDist.entries()].sort((a, b) => b[1] - a[1]));
  const hourlyTraffic = [...hourDist.entries()].sort((a, b) => a[0] - b[0]).map(([hour, count]) => ({ hour, count }));

  // SEO insights via Gemini
  let seoInsights: string[] = [];
  try {
    const prompt = `Analyze this web server log summary for SEO insights:
Total requests: ${totalRequests}
Top URLs: ${topUrls.slice(0, 10).map(u => `${u.url} (${u.hits})`).join(", ")}
Status codes: ${JSON.stringify(statusDistribution)}
Bot traffic: ${JSON.stringify(botTraffic)}
Methods: ${JSON.stringify(methods)}

Return ONLY a JSON array of 5-8 specific SEO insights as strings. Focus on crawl budget, bot behavior, error patterns, and optimization opportunities. No markdown.`;
    const text = await generateGeminiText(prompt);
    seoInsights = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
  } catch { seoInsights = ["Review 4xx errors for broken links", "Monitor bot crawl frequency"]; }

  const totalBotHits = Object.values(botTraffic).reduce((a: number, b: any) => a + (b as number), 0);

  return {
    totalRequests,
    urlHits: topUrls,
    statusDistribution,
    botTraffic,
    methods,
    hourlyTraffic,
    seoInsights,
    summary: {
      uniqueUrls: urlHits.size,
      errorRate: totalRequests > 0 ? +(([...statusDist.entries()].filter(([s]) => s >= 400).reduce((a, [, c]) => a + c, 0)) / totalRequests * 100).toFixed(1) : 0,
      botPercent: totalRequests > 0 ? +((totalBotHits as number) / totalRequests * 100).toFixed(1) : 0,
      topBots: Object.keys(botTraffic).slice(0, 3),
    },
  };
}
