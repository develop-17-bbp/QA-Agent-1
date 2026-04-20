import * as fs from "node:fs";
import * as path from "node:path";
import { generateText } from "../llm.js";
import { fetchKeywordVolume, isGoogleAdsConfigured } from "../providers/google-ads.js";

const DATA_DIR = path.join(process.cwd(), "keyword-lists");
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function listPath(name: string) { return path.join(DATA_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`); }

export async function loadKeywordLists() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  const lists = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8")) as { name: string; keywords: string[]; createdAt?: string; updatedAt?: string };
      return { name: data.name, keywordCount: data.keywords.length, keywords: data.keywords, createdAt: data.createdAt ?? "", updatedAt: data.updatedAt ?? "" };
    } catch { return null; }
  }).filter(Boolean);
  return { lists };
}

export async function saveKeywordList(name: string, keywords: string[]) {
  ensureDir();
  const fp = listPath(name);
  const now = new Date().toISOString();
  let existing: any = {};
  if (fs.existsSync(fp)) { try { existing = JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { /* ignore */ } }
  const data = { name, keywords, createdAt: existing.createdAt ?? now, updatedAt: now };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
  return { name, keywords, savedAt: now };
}

export async function deleteKeywordList(name: string) {
  const fp = listPath(name);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  return { deleted: name };
}

export async function analyzeKeywordList(keywords: string[], region = "US") {
  if (keywords.length === 0) return { clusters: [], priority: [], contentCalendar: [], summary: { region, volumeSource: "none" } };

  // Enrich with real volume data for the selected region when Google Ads is configured.
  // The LLM is then told to ground its difficulty/priority calls on those numbers instead
  // of guessing from the keyword text alone.
  let volumeLines = "";
  let volumeSource: "google-ads" | "none" = "none";
  if (isGoogleAdsConfigured()) {
    try {
      const results = await fetchKeywordVolume(keywords.slice(0, 20), region);
      if (results.length > 0) {
        volumeSource = "google-ads";
        volumeLines = results
          .map((r) => `- ${r.keyword}: ${r.avgMonthlySearches.value ?? "?"}/mo, competition=${r.competition.value ?? "?"}, index=${r.competitionIndex.value ?? "?"}`)
          .join("\n");
      }
    } catch {
      /* volume enrichment is best-effort — fall back to LLM-only ranges */
    }
  }

  const volumeBlock = volumeLines
    ? `\n\nReal Google Ads Keyword Planner data for region ${region} (use these exact figures — do not invent numbers):\n${volumeLines}\n\nFor keywords not listed above, write "Unknown" for volume rather than guessing.`
    : `\n\n(No real volume data available — Google Ads not configured. Use qualitative ranges like "High / Medium / Low" and label volume as "Estimated".)`;

  const prompt = `Analyze these keywords and provide strategic insights. Target region: ${region}. Keywords: ${keywords.join(", ")}${volumeBlock}

Return ONLY valid JSON (no markdown):
{
  "clusters": [{ "name": "Cluster", "keywords": ["kw1"], "intent": "Informational", "avgDifficulty": "Medium", "totalVolume": "5K-10K" }],
  "priority": [{ "keyword": "...", "priority": "High", "difficulty": "Medium", "volume": "1K-10K", "intent": "Informational", "recommendation": "Create pillar content" }],
  "contentCalendar": [{ "week": 1, "keyword": "...", "contentType": "Blog Post", "title": "...", "notes": "..." }],
  "summary": { "totalKeywords": ${keywords.length}, "clusterCount": 4, "avgDifficulty": "Medium", "topIntent": "Informational", "quickWins": 3, "region": "${region}", "volumeSource": "${volumeSource}", "insights": ["..."] }
}

Provide 3-6 clusters, priority for each keyword, 4-week calendar, and summary.`;

  const text = await generateText(prompt);
  try {
    const parsed = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
    // Ensure region/volumeSource are always reported in the summary even if the LLM drops them.
    parsed.summary = { ...(parsed.summary ?? {}), region, volumeSource };
    return parsed;
  } catch {
    return { clusters: [], priority: keywords.map(k => ({ keyword: k, priority: "Medium", difficulty: "Unknown", volume: "Unknown", intent: "Unknown", recommendation: "Research further" })), contentCalendar: [], summary: { totalKeywords: keywords.length, region, volumeSource } };
  }
}
