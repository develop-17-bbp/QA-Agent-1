/**
 * Link Fix Advisor — one-line LLM remediation for broken links.
 *
 * The health crawl already knows WHERE each broken link was discovered
 * (`foundOn`) and WHY it failed (HTTP status / error). This module asks the
 * local LLM to produce a terse, single-sentence recommendation for each
 * one — the kind of action an SEO would take in a triage sheet.
 *
 * Batched in groups of 10 to keep individual LLM calls small. Cached by a
 * stable key so re-asking the same page doesn't re-run the model.
 */

import { generateText } from "../llm.js";
import { LlmCache } from "../cache.js";

export interface BrokenLinkInput {
  foundOn: string;
  target: string;
  status?: number;
  error?: string;
}

export interface LinkFixRecommendation {
  foundOn: string;
  target: string;
  recommendation: string;
}

function fixCacheKey(input: BrokenLinkInput): string {
  return `link-fix:${input.status ?? 0}:${(input.error ?? "").slice(0, 80)}:${input.target}`;
}

async function fetchBatch(batch: BrokenLinkInput[]): Promise<string[]> {
  const rows = batch.map((b, i) => `${i + 1}. Found on: ${b.foundOn}\n   Target: ${b.target}\n   Status: ${b.status ?? "network error"}${b.error ? ` — ${b.error}` : ""}`).join("\n\n");
  const prompt = `You are an SEO triage engineer. For each broken link below, give ONE actionable remediation in a single sentence (max 18 words). No preamble, no numbering, no markdown. Return ONLY a JSON array of ${batch.length} strings, in the same order.

Guidance:
- HTTP 404 → usually: add a 301 redirect to the correct/new URL, or remove the link from the origin page.
- HTTP 403 → check auth / bot blocking / user-agent restrictions on the target.
- HTTP 5xx → target server error; retry later or contact the asset owner.
- Network / timeout → target may be down; consider removing or hosting the asset internally.
- Mailto / tel with typo → correct the address on the origin page.

Broken links:
${rows}

Respond with ONLY a JSON array, e.g. ["...", "...", "..."].`;

  const raw = await generateText(prompt);
  const cleaned = raw.trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return batch.map(() => "Review the link target and either fix, redirect, or remove it from the origin page.");
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => (typeof x === "string" ? x.trim() : "")).map((s) => s || "Review the link target and either fix, redirect, or remove it from the origin page.");
    }
  } catch {
    /* fall through */
  }
  return batch.map(() => "Review the link target and either fix, redirect, or remove it from the origin page.");
}

export async function recommendLinkFixes(links: BrokenLinkInput[]): Promise<LinkFixRecommendation[]> {
  const results: LinkFixRecommendation[] = [];
  const toFetch: { idx: number; input: BrokenLinkInput }[] = [];

  for (let i = 0; i < links.length; i++) {
    const key = fixCacheKey(links[i]!);
    const cached = LlmCache.get(key);
    if (cached) {
      results.push({ foundOn: links[i]!.foundOn, target: links[i]!.target, recommendation: cached });
    } else {
      results.push({ foundOn: links[i]!.foundOn, target: links[i]!.target, recommendation: "" });
      toFetch.push({ idx: i, input: links[i]! });
    }
  }

  for (let i = 0; i < toFetch.length; i += 10) {
    const batch = toFetch.slice(i, i + 10);
    const recs = await fetchBatch(batch.map((x) => x.input));
    for (let j = 0; j < batch.length; j++) {
      const rec = recs[j] ?? "Review and either fix, redirect, or remove the link.";
      results[batch[j]!.idx] = {
        foundOn: batch[j]!.input.foundOn,
        target: batch[j]!.input.target,
        recommendation: rec,
      };
      LlmCache.set(fixCacheKey(batch[j]!.input), rec);
    }
  }

  return results;
}
