import * as fs from "node:fs";
import * as path from "node:path";
import { generateGeminiText } from "../gemini-report.js";

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

export async function analyzeKeywordList(keywords: string[]) {
  if (keywords.length === 0) return { clusters: [], priority: [], contentCalendar: [], summary: {} };

  const prompt = `Analyze these keywords and provide strategic insights. Keywords: ${keywords.join(", ")}

Return ONLY valid JSON (no markdown):
{
  "clusters": [{ "name": "Cluster", "keywords": ["kw1"], "intent": "Informational", "avgDifficulty": "Medium", "totalVolume": "5K-10K" }],
  "priority": [{ "keyword": "...", "priority": "High", "difficulty": "Medium", "volume": "1K-10K", "intent": "Informational", "recommendation": "Create pillar content" }],
  "contentCalendar": [{ "week": 1, "keyword": "...", "contentType": "Blog Post", "title": "...", "notes": "..." }],
  "summary": { "totalKeywords": ${keywords.length}, "clusterCount": 4, "avgDifficulty": "Medium", "topIntent": "Informational", "quickWins": 3, "insights": ["..."] }
}

Provide 3-6 clusters, priority for each keyword, 4-week calendar, and summary.`;

  const text = await generateGeminiText(prompt);
  try {
    return JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
  } catch {
    return { clusters: [], priority: keywords.map(k => ({ keyword: k, priority: "Medium", difficulty: "Unknown", volume: "Unknown", intent: "Unknown", recommendation: "Research further" })), contentCalendar: [], summary: { totalKeywords: keywords.length } };
  }
}
