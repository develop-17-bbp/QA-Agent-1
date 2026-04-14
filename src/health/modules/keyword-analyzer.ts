import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";

export function extractKeywords(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const kwMap = new Map<string, { count: number; urls: string[] }>();

  for (const p of allPages) {
    if (!p.documentTitle) continue;
    const words = p.documentTitle.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(w => w.length > 2);
    const stopwords = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "been", "have", "has", "had", "not", "but", "all", "can", "her", "his", "one", "our", "out", "you"]);
    const meaningful = words.filter(w => !stopwords.has(w));

    for (const w of meaningful) {
      const e = kwMap.get(w) ?? { count: 0, urls: [] };
      e.count++;
      if (e.urls.length < 5) e.urls.push(p.url);
      kwMap.set(w, e);
    }
    for (let i = 0; i < meaningful.length - 1; i++) {
      const bigram = `${meaningful[i]} ${meaningful[i + 1]}`;
      const e = kwMap.get(bigram) ?? { count: 0, urls: [] };
      e.count++;
      if (e.urls.length < 5) e.urls.push(p.url);
      kwMap.set(bigram, e);
    }
  }

  const keywords = [...kwMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 50)
    .map(([kw, data]) => ({
      keyword: kw,
      frequency: data.count,
      density: allPages.length > 0 ? +(data.count / allPages.length * 100).toFixed(1) : 0,
      urls: data.urls,
    }));

  const intentMap = { informational: 0, commercial: 0, transactional: 0, navigational: 0 };
  for (const p of allPages) {
    const u = p.url.toLowerCase();
    if (/blog|article|guide|how|what|why|learn/.test(u)) intentMap.informational++;
    else if (/product|buy|price|shop|store|cart/.test(u)) intentMap.transactional++;
    else if (/review|compare|best|top|vs/.test(u)) intentMap.commercial++;
    else intentMap.navigational++;
  }

  return { keywords, totalPages: allPages.length, uniqueKeywords: kwMap.size, intentDistribution: intentMap, topKeywords: keywords.slice(0, 10) };
}

export async function generateMagicKeywords(seed: string) {
  const prompt = `You are an expert SEO keyword researcher. For the seed keyword "${seed}", generate a comprehensive keyword research report.

Return ONLY valid JSON (no markdown, no backticks):
{
  "keywords": [
    { "keyword": "example keyword", "volume": "1K-10K", "difficulty": "Medium", "intent": "Informational", "cpc": "$0.50-$1.00", "trend": "Rising", "source": "Related" }
  ],
  "clusters": [
    { "name": "Cluster Name", "keywords": ["kw1", "kw2", "kw3"] }
  ]
}

Generate exactly 25 keywords covering: 5 exact/phrase match variations, 5 question-based (how, what, why, best), 5 long-tail (3-5 words), 5 commercial intent (buy, price, review), 5 related/LSI keywords.
Group into 4-6 thematic clusters.
Volume: "0-100", "100-1K", "1K-10K", "10K-100K", "100K+". Difficulty: "Easy", "Medium", "Hard", "Very Hard". Intent: "Informational", "Commercial", "Transactional", "Navigational". Trend: "Rising", "Stable", "Declining".`;

  const text = await generateText(prompt);
  try {
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const data = JSON.parse(clean);
    return { seed, keywords: data.keywords ?? [], clusters: data.clusters ?? [] };
  } catch {
    return { seed, keywords: [], clusters: [] };
  }
}
