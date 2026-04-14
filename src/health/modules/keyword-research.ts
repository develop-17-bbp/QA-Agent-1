/**
 * SEMrush-style keyword research powered entirely by Gemini AI (free tier).
 * No paid APIs required — uses Gemini's knowledge for keyword analysis.
 */
import { generateGeminiText } from "../gemini-report.js";

// ── Types ────────────────────────────────────────────────────────────

export interface CountryVolume { country: string; code: string; volume: number }
export interface KeywordVariation { keyword: string; volume: number; difficulty: number }
export interface KeywordQuestion { keyword: string; volume: number; difficulty: number }
export interface KeywordCluster { label: string; keywords: string[] }
export interface SerpEntry { position: number; url: string; domain: string; title: string }

export interface KeywordResearchData {
  keyword: string;
  volume: number;
  globalVolume: number;
  countryVolumes: CountryVolume[];
  intent: "informational" | "commercial" | "navigational" | "transactional";
  cpc: number;
  difficulty: number;
  difficultyLabel: string;
  competitiveDensity: number;
  trend: number[];
  variations: KeywordVariation[];
  questions: KeywordQuestion[];
  clusters: KeywordCluster[];
  serp: SerpEntry[];
  serpFeatures: string[];
  totalResults: string;
  variationsTotalCount: number;
  variationsTotalVolume: number;
  questionsTotalCount: number;
  questionsTotalVolume: number;
}

function difficultyLabel(d: number): string {
  if (d >= 85) return "Very hard";
  if (d >= 70) return "Hard";
  if (d >= 50) return "Difficult";
  if (d >= 30) return "Possible";
  return "Easy";
}

// ── Main function ───────────────────────────────────────────────────

export async function researchKeyword(keyword: string): Promise<KeywordResearchData> {
  const prompt = `You are a professional SEO analyst with access to keyword research databases. Analyze the keyword "${keyword}" and provide comprehensive keyword research data.

Return ONLY valid JSON (no markdown, no code fences, no explanation):
{
  "volume": <estimated US monthly search volume as integer>,
  "globalVolume": <estimated worldwide monthly search volume as integer>,
  "countryVolumes": [
    {"country": "India", "code": "IN", "volume": <number>},
    {"country": "United States", "code": "US", "volume": <number>},
    {"country": "United Kingdom", "code": "UK", "volume": <number>},
    {"country": "Canada", "code": "CA", "volume": <number>},
    {"country": "Indonesia", "code": "ID", "volume": <number>},
    {"country": "Philippines", "code": "PH", "volume": <number>}
  ],
  "intent": "<informational|commercial|navigational|transactional>",
  "cpc": <estimated CPC in USD, e.g. 3.41>,
  "difficulty": <0-100 keyword difficulty score>,
  "competitiveDensity": <0.00-1.00>,
  "trend": [<12 integers: relative monthly search interest for last 12 months, scale 0-100>],
  "variations": [
    {"keyword": "<variation phrase>", "volume": <monthly volume>, "difficulty": <0-100>}
  ],
  "questions": [
    {"keyword": "<question about this topic>", "volume": <monthly volume>, "difficulty": <0-100>}
  ],
  "clusters": [
    {"label": "<cluster name>", "keywords": ["kw1", "kw2", "kw3", "kw4", "kw5"]}
  ],
  "serp": [
    {"position": 1, "url": "<likely #1 ranking URL>", "domain": "<domain>", "title": "<page title>"}
  ],
  "serpFeatures": ["<SERP feature like AI Overview, Knowledge Panel, Featured Snippet, People Also Ask, Top Stories, etc.>"],
  "totalResults": "<estimated total indexed results like 1.1B>",
  "variationsTotalCount": <total estimated keyword variations in the wild>,
  "variationsTotalVolume": <combined volume of all variations>,
  "questionsTotalCount": <total question-form keywords>,
  "questionsTotalVolume": <combined volume of all questions>
}

Rules:
- Provide exactly 10 keyword variations sorted by volume descending (include exact match as first entry)
- Provide exactly 5 question-form keywords sorted by volume descending
- Provide 5 keyword clusters with 5 keywords each (like a keyword strategy mind map)
- Provide top 10 likely SERP results (real websites that would rank for this)
- countryVolumes sorted by volume descending, top 6 countries
- Be realistic — base estimates on your knowledge of actual search data
- All volumes should be plausible integers, not rounded placeholders
- difficulty should reflect how competitive the keyword actually is`;

  try {
    const raw = await generateGeminiText(prompt);
    let text = raw.trim();
    if (text.startsWith("```")) {
      const lines = text.split("\n");
      text = lines.slice(1, lines[lines.length - 1]?.trim() === "```" ? -1 : undefined).join("\n");
    }
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
    const data = JSON.parse(json) as Record<string, unknown>;

    const diff = typeof data.difficulty === "number" ? data.difficulty : 50;

    return {
      keyword,
      volume: (data.volume as number) ?? 0,
      globalVolume: (data.globalVolume as number) ?? 0,
      countryVolumes: Array.isArray(data.countryVolumes) ? data.countryVolumes as CountryVolume[] : [],
      intent: (data.intent as KeywordResearchData["intent"]) ?? "informational",
      cpc: (data.cpc as number) ?? 0,
      difficulty: diff,
      difficultyLabel: difficultyLabel(diff),
      competitiveDensity: (data.competitiveDensity as number) ?? 0,
      trend: Array.isArray(data.trend) ? data.trend as number[] : new Array(12).fill(50),
      variations: Array.isArray(data.variations) ? (data.variations as KeywordVariation[]).slice(0, 10) : [],
      questions: Array.isArray(data.questions) ? (data.questions as KeywordQuestion[]).slice(0, 5) : [],
      clusters: Array.isArray(data.clusters) ? data.clusters as KeywordCluster[] : [],
      serp: Array.isArray(data.serp) ? (data.serp as SerpEntry[]).slice(0, 10) : [],
      serpFeatures: Array.isArray(data.serpFeatures) ? data.serpFeatures as string[] : [],
      totalResults: (data.totalResults as string) ?? "0",
      variationsTotalCount: (data.variationsTotalCount as number) ?? 0,
      variationsTotalVolume: (data.variationsTotalVolume as number) ?? 0,
      questionsTotalCount: (data.questionsTotalCount as number) ?? 0,
      questionsTotalVolume: (data.questionsTotalVolume as number) ?? 0,
    };
  } catch {
    return {
      keyword,
      volume: 0, globalVolume: 0, countryVolumes: [], intent: "informational",
      cpc: 0, difficulty: 50, difficultyLabel: "Difficult", competitiveDensity: 0,
      trend: new Array(12).fill(0), variations: [], questions: [],
      clusters: [{ label: keyword, keywords: [keyword] }],
      serp: [], serpFeatures: [], totalResults: "0",
      variationsTotalCount: 0, variationsTotalVolume: 0,
      questionsTotalCount: 0, questionsTotalVolume: 0,
    };
  }
}
