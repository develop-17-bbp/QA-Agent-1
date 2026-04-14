import type { SiteHealthReport } from "./types.js";

export interface SmartAnalysisResult {
  summary: string;
  criticalIssues: { title: string; description: string; severity: "critical" | "high" | "medium" | "low"; pages: string[] }[];
  recommendations: { title: string; description: string; priority: number }[];
  generatedAt: string;
  model: string;
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";

async function detectModel(): Promise<string | undefined> {
  const explicit = process.env.OLLAMA_MODEL?.trim();
  if (explicit) return explicit;
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { models?: { name: string }[] };
    return data.models?.[0]?.name;
  } catch {
    return undefined;
  }
}

/**
 * Run autonomous smart analysis on crawl results using a locally-running Ollama model.
 * Returns prioritized findings and recommendations.
 */
export async function runSmartAnalysis(reports: SiteHealthReport[]): Promise<SmartAnalysisResult> {
  const model = await detectModel();
  if (!model) throw new Error("Ollama is not running or no model available");

  const condensed = reports.map((r) => ({
    hostname: r.hostname,
    startUrl: r.startUrl,
    pagesVisited: r.crawl.pagesVisited,
    brokenLinks: r.crawl.brokenLinks.length,
    brokenLinkDetails: r.crawl.brokenLinks.slice(0, 20),
    pagesSample: r.crawl.pages.slice(0, 30).map((p) => ({
      url: p.url,
      status: p.status,
      ok: p.ok,
      durationMs: p.durationMs,
      title: p.documentTitle,
      metaDescLen: p.metaDescriptionLength,
      h1Count: p.h1Count,
      lang: p.documentLang,
    })),
  }));

  const prompt = `You are an expert web QA analyst. Analyze the following crawl data and provide:
1. An executive summary (2-3 sentences)
2. Critical issues ranked by severity (critical/high/medium/low)
3. Specific fix recommendations ranked by priority

Crawl data:
${JSON.stringify(condensed, null, 2)}

Respond ONLY with valid JSON matching this schema:
{
  "summary": "string",
  "criticalIssues": [{"title": "string", "description": "string", "severity": "critical|high|medium|low", "pages": ["url1"]}],
  "recommendations": [{"title": "string", "description": "string", "priority": 1}]
}`;

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      format: "json",
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { message?: { content?: string } };
  const raw = data.message?.content ?? "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { summary: raw, criticalIssues: [], recommendations: [] };
  }

  return {
    summary: parsed.summary ?? "",
    criticalIssues: Array.isArray(parsed.criticalIssues) ? parsed.criticalIssues : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    generatedAt: new Date().toISOString(),
    model,
  };
}
