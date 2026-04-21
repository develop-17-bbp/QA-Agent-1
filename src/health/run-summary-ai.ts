/**
 * QA run summary + Q&A generation.
 *
 * Every LLM call routes through the unified local-Ollama adapter in `./llm.js`.
 * This module is LLM-agnostic from the caller's perspective — it only exposes
 * the payload builder + two Markdown generators for the run dashboard.
 */

import { flattenInsights, hasPageSpeedInsights } from "./insight-utils.js";
import { generateText } from "./llm.js";
import type { PageFetchRecord, SiteHealthReport } from "./types.js";
import { withLlmTelemetry } from "./agentic/llm-telemetry.js";

const MODEL = () => process.env.OLLAMA_MODEL?.trim() || "llama3.2";

// ── Payload builder ─────────────────────────────────────────────────────────

function selectPagesForSpeedSample(
  pages: PageFetchRecord[],
  limit: number,
  preferAnalyzed: boolean,
): PageFetchRecord[] {
  if (preferAnalyzed) {
    const analyzed = pages.filter((p) => hasPageSpeedInsights(p));
    return analyzed.length > 0 ? analyzed.slice(0, limit) : pages.slice(0, limit);
  }
  return pages.slice(0, limit);
}

export type BuildRunSummaryPayloadOptions = {
  pageSpeedSampleLimit?: number;
  pageSpeedPreferAnalyzed?: boolean;
};

export type RunSummaryPayload = {
  runId: string;
  generatedAt: string;
  sites: {
    hostname: string;
    startUrl: string;
    pagesVisited: number;
    brokenLinks: number;
    failedPageFetches: number;
    avgPageMs?: number;
    pageSpeedSample?: { url: string; perfMobile?: number; perfDesktop?: number }[];
    viewportIssues?: { url: string; mobileOk: boolean; desktopOk: boolean }[];
  }[];
};

export function buildRunSummaryPayload(
  reports: SiteHealthReport[],
  runId: string,
  generatedAt: string,
  options?: BuildRunSummaryPayloadOptions,
): RunSummaryPayload {
  const speedLimit = options?.pageSpeedSampleLimit ?? 10;
  const speedPrefer = options?.pageSpeedPreferAnalyzed ?? false;
  return {
    runId,
    generatedAt,
    sites: reports.map((r) => {
      const pages = r.crawl.pages;
      const okPages = pages.filter((p) => p.ok);
      const avg =
        okPages.length > 0
          ? Math.round(okPages.reduce((a, p) => a + p.durationMs, 0) / okPages.length)
          : undefined;
      const failedPageFetches = pages.filter((p) => !p.ok).length;
      const speedPages = selectPagesForSpeedSample(pages, speedLimit, speedPrefer);
      const pageSpeedSample = speedPages.map((p) => {
        const fi = flattenInsights(p.insights);
        return {
          url: p.url,
          perfMobile: fi.find((x) => x.strategy === "mobile")?.scores?.performance,
          perfDesktop: fi.find((x) => x.strategy === "desktop")?.scores?.performance,
        };
      });
      const viewportIssues = r.crawl.viewportChecks?.slice(0, 10).map((v) => ({
        url: v.url,
        mobileOk: v.mobile.ok,
        desktopOk: v.desktop.ok,
      }));
      return {
        hostname: r.hostname,
        startUrl: r.startUrl,
        pagesVisited: r.crawl.pagesVisited,
        brokenLinks: r.crawl.brokenLinks.length,
        failedPageFetches,
        avgPageMs: avg,
        pageSpeedSample: pageSpeedSample.some((s) => s.perfMobile != null || s.perfDesktop != null)
          ? pageSpeedSample
          : undefined,
        viewportIssues: viewportIssues?.length ? viewportIssues : undefined,
      };
    }),
  };
}

// ── Summary + Q&A generation (local Ollama) ────────────────────────────────

export async function generateRunSummary(payload: RunSummaryPayload): Promise<string> {
  const prompt = `You are a senior QA lead. Given structured JSON from a health crawl, write a VERY SHORT skim-friendly summary for busy stakeholders.

Format (strict):
- Use Markdown only.
- First heading: ## Run at a glance
- Then ### Nutshell — 5–8 bullets max. One line per bullet, ~8–18 words, no nested bullets, no paragraphs.
- Then ### By site — for each hostname in the JSON, exactly 3 bullets:
  - **hostname** — (1) one-line verdict, (2) top risk or "No critical risks in data", (3) one next action.
- No "Executive Summary" essay blocks, no numbered sections like a report, no duplicate points between sections.
- Omit Lighthouse/viewport wording entirely if that data is missing or samples are empty.
- If brokenLinks > 0 or failedPageFetches > 0, state the counts in Nutshell.
- Do not add a Watch list section.
- Hard cap: ~220 words total.
- If the JSON contains no useful data, reply exactly: Not enough data to summarise this run.

JSON:
${JSON.stringify(payload, null, 2)}`;

  return withLlmTelemetry("run-summary", MODEL(), prompt, () => generateText(prompt));
}

/**
 * Answers a user question using only the structured run payload (no full HTML).
 * Keeps replies short for an in-app Q&A panel.
 */
export async function generateRunAnswer(payload: RunSummaryPayload, question: string): Promise<string> {
  const q = question.trim();
  if (!q) {
    throw new Error("Question is empty.");
  }

  const prompt = `You answer questions about ONE website health crawl run. Use ONLY the JSON below — do not invent URLs, scores, counts, or issues.

Rules:
- Very short: either 2–4 sentences OR up to 6 markdown bullet lines (- item), not both long.
- No preamble ("Based on the data…"). Lead with the answer.
- If the JSON does not contain enough information, reply exactly: Not in this run's report data.
- Use numbers from JSON when citing scores or counts.

Question:
${q}

Run data:
${JSON.stringify(payload, null, 2)}`;

  return withLlmTelemetry("run-qa", MODEL(), prompt, () => generateText(prompt));
}
