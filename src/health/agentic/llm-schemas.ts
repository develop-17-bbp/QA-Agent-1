/**
 * Structured-output schemas for Ollama LLM responses. Every LLM-producing
 * function should pass its raw response through `parseWithSchema()` — that
 * way we catch malformed/rambly outputs at the boundary instead of letting
 * them leak into the UI as "AI synthesis unavailable" or worse, ugly text.
 *
 * We stay dependency-free (no Zod runtime) — the schemas are plain validator
 * functions returning a typed result. Keeps the bundle lean and avoids
 * package-lock churn for a feature that only runs server-side.
 */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; raw: string };

/** Strip ```json fences, leading "Here is…" preamble, and trailing notes. */
export function extractJsonPayload(raw: string): string {
  let s = raw.trim();
  // ```json … ``` fence
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) s = fence[1]!.trim();
  // Grab the first top-level { … } or [ … ] block.
  const first = s.search(/[[{]/);
  if (first > 0) s = s.slice(first);
  // Trim trailing non-JSON tail after the last closing brace/bracket.
  const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastBrace > 0 && lastBrace < s.length - 1) s = s.slice(0, lastBrace + 1);
  return s;
}

function tryParseJson<T = unknown>(raw: string): T | null {
  try { return JSON.parse(extractJsonPayload(raw)) as T; } catch { return null; }
}

// ─── Link Fix Advisor ────────────────────────────────────────────────────────

export interface LinkFixRecommendation {
  index: number;
  recommendation: string;
  action: "redirect" | "remove" | "fix-typo" | "contact-owner" | "restore" | "other";
}

export function parseLinkFixRecommendations(raw: string, expected: number): ParseResult<LinkFixRecommendation[]> {
  const parsed = tryParseJson<unknown>(raw);
  if (!parsed) return { ok: false, error: "not valid JSON", raw };
  const arr = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { items?: unknown[] }).items) ? (parsed as { items: unknown[] }).items : null;
  if (!arr) return { ok: false, error: "response is not an array", raw };
  const out: LinkFixRecommendation[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i] as Record<string, unknown>;
    if (!item || typeof item !== "object") continue;
    const recommendation = typeof item.recommendation === "string"
      ? item.recommendation.trim()
      : typeof item.fix === "string"
        ? (item.fix as string).trim()
        : "";
    if (!recommendation) continue;
    const actionRaw = typeof item.action === "string" ? (item.action as string).toLowerCase() : "other";
    const action: LinkFixRecommendation["action"] =
      ["redirect", "remove", "fix-typo", "contact-owner", "restore"].includes(actionRaw)
        ? (actionRaw as LinkFixRecommendation["action"])
        : "other";
    out.push({
      index: typeof item.index === "number" ? item.index : i,
      recommendation: recommendation.slice(0, 300),
      action,
    });
  }
  if (out.length === 0) return { ok: false, error: "no recommendations parsed", raw };
  // Pad missing slots with empty recommendations so index alignment holds.
  while (out.length < expected) out.push({ index: out.length, recommendation: "", action: "other" });
  return { ok: true, value: out };
}

// ─── AI Competitive Estimator ────────────────────────────────────────────────

export interface CompetitiveEstimate {
  monthlyVisitsRange: { min: number; max: number };
  backlinksRange: { min: number; max: number };
  keywordUniverseRange: { min: number; max: number };
  confidence: "high" | "medium" | "low";
  notes: string;
}

function isRange(v: unknown): v is { min: number; max: number } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.min === "number" && typeof o.max === "number" && o.max >= o.min;
}

export function parseCompetitiveEstimate(raw: string): ParseResult<CompetitiveEstimate> {
  const parsed = tryParseJson<Record<string, unknown>>(raw);
  if (!parsed) return { ok: false, error: "not valid JSON", raw };
  if (!isRange(parsed.monthlyVisitsRange)) return { ok: false, error: "monthlyVisitsRange missing/invalid", raw };
  if (!isRange(parsed.backlinksRange)) return { ok: false, error: "backlinksRange missing/invalid", raw };
  if (!isRange(parsed.keywordUniverseRange)) return { ok: false, error: "keywordUniverseRange missing/invalid", raw };
  const confRaw = String(parsed.confidence ?? "medium").toLowerCase();
  const confidence: CompetitiveEstimate["confidence"] =
    confRaw === "high" || confRaw === "medium" || confRaw === "low" ? confRaw : "medium";
  return {
    ok: true,
    value: {
      monthlyVisitsRange: parsed.monthlyVisitsRange as { min: number; max: number },
      backlinksRange: parsed.backlinksRange as { min: number; max: number },
      keywordUniverseRange: parsed.keywordUniverseRange as { min: number; max: number },
      confidence,
      notes: typeof parsed.notes === "string" ? (parsed.notes as string).slice(0, 500) : "",
    },
  };
}

// ─── AI Run Summary ──────────────────────────────────────────────────────────

export interface RunSummary {
  headline: string;
  keyFindings: string[];
  topRisks: string[];
  recommendedActions: string[];
}

export function parseRunSummary(raw: string): ParseResult<RunSummary> {
  const parsed = tryParseJson<Record<string, unknown>>(raw);
  if (!parsed) return { ok: false, error: "not valid JSON", raw };
  const arrayOf = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string").map((s) => (s as string).slice(0, 250)) : [];
  const headline = typeof parsed.headline === "string" ? (parsed.headline as string).slice(0, 200) : "";
  if (!headline) return { ok: false, error: "headline missing", raw };
  return {
    ok: true,
    value: {
      headline,
      keyFindings: arrayOf(parsed.keyFindings),
      topRisks: arrayOf(parsed.topRisks),
      recommendedActions: arrayOf(parsed.recommendedActions),
    },
  };
}

// ─── Helper: run with retry ──────────────────────────────────────────────────

/**
 * Run an LLM call with 1 retry on schema failure. On the retry we prepend a
 * stricter instruction to the prompt ("return ONLY valid JSON matching…").
 */
export async function callWithSchemaRetry<T>(
  call: (stricterPrompt: string | null) => Promise<string>,
  parse: (raw: string) => ParseResult<T>,
  strictHint: string,
): Promise<ParseResult<T>> {
  const first = await call(null);
  const firstParse = parse(first);
  if (firstParse.ok) return firstParse;
  const second = await call(`STRICT: ${strictHint} Return ONLY valid JSON, no prose.`);
  return parse(second);
}
