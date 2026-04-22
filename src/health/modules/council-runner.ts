/**
 * Council Runner — generic LLM-panel synthesis layer. Feature-agnostic:
 * takes any CouncilContext (keyword, backlinks, SERP, etc.) and returns
 * per-item advisor verdicts + an overall synthesis.
 *
 * See council-types.ts for the data contract.
 */

import { routeLlmJson } from "../agentic/llm-router.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";
import type { CouncilContext, CouncilResult, CouncilAgendaItem, CouncilVerdict } from "./council-types.js";

interface LlmOutput {
  verdicts?: Record<string, Record<string, string>>;
  synthesis?: string;
}

function formatAgendaLine(item: CouncilAgendaItem): string {
  const mParts: string[] = [];
  for (const [k, v] of Object.entries(item.metrics)) {
    if (v === undefined || v === null || v === "") continue;
    mParts.push(`${k}=${typeof v === "number" ? v.toLocaleString() : v}`);
  }
  return `- ${JSON.stringify(item.id)} (${item.label}${item.sublabel ? ` · ${item.sublabel}` : ""}; sources=${item.sources.join("+")}; score=${item.score}; ${mParts.join(", ") || "no magnitude"})`;
}

function pickAgenda(ctx: CouncilContext): CouncilAgendaItem[] {
  // Top 10 from top tier + top 5 from mid. If top is thin, borrow from mid.
  const top = ctx.tierTop.slice(0, 10);
  const mid = ctx.tierMid.slice(0, top.length < 4 ? 10 : 5);
  const picks = [...top, ...mid];
  if (picks.length < 5) picks.push(...ctx.tierBottom.slice(0, Math.min(5, ctx.tierBottom.length)));
  return picks;
}

function buildPrompt(ctx: CouncilContext, picks: CouncilAgendaItem[]): string {
  const advisorsBlock = ctx.advisors
    .map((a) => `  - id="${a.id}" — ${a.name}: ${a.focus}`)
    .join("\n");
  const verdictSchema = ctx.advisors
    .map((a) => `      "${a.id}": "<1 sentence from the ${a.name}'s perspective — max 25 words>"`)
    .join(",\n");
  const lines = picks.map(formatAgendaLine).join("\n");
  return [
    `You are a council of ${ctx.advisors.length} advisors for a ${ctx.featureLabel} review on target "${ctx.target}".`,
    `Consensus is measured across these data sources the product pulled: ${ctx.sourcesQueried.join(", ") || "(none)"}.`,
    ``,
    `COUNCIL MEMBERS (each will issue one verdict per item below):`,
    advisorsBlock,
    ``,
    `AGENDA — ${picks.length} items:`,
    lines,
    ``,
    `Respond ONLY with valid JSON matching this schema — no prose, no markdown fences:`,
    `{`,
    `  "verdicts": {`,
    `    "<item-id>": {`,
    `${verdictSchema}`,
    `    }`,
    `  },`,
    `  "synthesis": "<2-3 sentences: what pattern across these items does the council want the operator to act on first?>"`,
    `}`,
    ``,
    `Rules:`,
    `- Each advisor verdict is a single sentence, max 25 words.`,
    `- Reference the metric numbers when they support a point — specificity beats generality.`,
    `- Advisors should disagree or emphasize different angles when the data supports it. Don't echo.`,
    `- If an item is genuinely low-signal, an advisor may say so directly — do not fill with "needs more analysis".`,
    `- Use the exact item-id as the JSON key (same string, same quoting).`,
  ].join("\n");
}

/** Run an LLM council panel on the given context. Returns null when the
 *  context has nothing to discuss (all tiers empty). */
export async function runCouncil(ctx: CouncilContext): Promise<CouncilResult | null> {
  const picks = pickAgenda(ctx);
  if (picks.length === 0) return null;

  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  const prompt = buildPrompt(ctx, picks);
  const started = Date.now();

  const { data } = await withLlmTelemetry(
    `council-${ctx.feature}`,
    model,
    prompt,
    () => routeLlmJson<LlmOutput>(prompt, { preferOllama: true }),
  );

  const pickSet = new Set(picks.map((p) => p.id));
  const advisorIds = new Set(ctx.advisors.map((a) => a.id));
  const raw = data?.verdicts ?? {};
  const verdicts: Record<string, CouncilVerdict> = {};
  for (const [itemId, byAdvisor] of Object.entries(raw)) {
    if (!pickSet.has(itemId) || !byAdvisor) continue;
    const v: CouncilVerdict = {};
    for (const a of ctx.advisors) {
      const candidate = byAdvisor[a.id];
      v[a.id] = (typeof candidate === "string" ? candidate.trim() : "") || `(no ${a.name} verdict)`;
    }
    // Drop any unknown advisor keys the LLM might have added.
    for (const k of Object.keys(byAdvisor)) {
      if (!advisorIds.has(k)) continue;
    }
    verdicts[itemId] = v;
  }

  return {
    verdicts,
    synthesis: data?.synthesis?.trim() || "Council did not return a synthesis — re-run or switch models.",
    reviewedItemIds: picks.map((p) => p.id),
    model,
    durationMs: Date.now() - started,
  };
}
