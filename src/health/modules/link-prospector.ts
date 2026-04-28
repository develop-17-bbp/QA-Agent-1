/**
 * Zero-Budget Link Prospector — agentic outreach pipeline that needs
 * NO paid backlink-data API. Composes existing modules:
 *
 *   1. searchSerp(topicQuery)   → real-time SERP top-N from DDG.
 *      Sites already ranking for the topic are the strongest prospects:
 *      they care about the subject, they have authority, and they accept
 *      contextual mentions when the angle is right.
 *   2. Filter out target + competitor domains.
 *   3. For each prospect, fetch + extractArticle()   → derive the
 *      prospect's tone + topic focus.
 *   4. Single batched LLM call → personalized outreach per prospect:
 *      subject (≤8 words) + body (60-90 words) + 1-line CTA.
 *      Tone-matched to the prospect's content. Wrapped in
 *      withLlmTelemetry("link-prospector").
 *
 * Returns deterministic prospect list with empty email drafts when
 * Ollama is offline — so the operator can still see WHO to reach.
 *
 * Privacy: target domain + topic query + extracted prospect article
 * text reach Ollama. Nothing else. No external email-discovery API.
 */

import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { extractArticle } from "./voice-of-serp.js";
import { routeLlmJson, checkOllamaAvailable } from "../agentic/llm-router.js";
import { withLlmTelemetry } from "../agentic/llm-telemetry.js";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 600_000;
const PER_URL_TEXT_CAP = 1100;

export interface LinkProspectorInput {
  /** The site you're trying to build links to. */
  targetDomain: string;
  /** Optional explicit competitor list. Used only to exclude their domains
   *  from prospect output (you don't pitch your competitors). */
  competitorDomains?: string[];
  /** Topic / angle for the SERP search — usually a content theme that fits
   *  both the target's authority and the prospect site's audience. */
  topicQuery: string;
  region?: string;
  topN?: number;
}

export interface OutreachEmail {
  subject: string;
  body: string;
  cta: string;
}

export interface LinkProspect {
  rank: number;
  domain: string;
  url: string;
  title: string;
  /** Detected tone summary from the prospect's actual content. */
  tone?: string;
  /** Cleaned excerpt used in the outreach prompt (audit trail). */
  textSample?: string;
  fetchOk: boolean;
  fetchError?: string;
  /** Generated outreach. Absent when Ollama is offline. */
  email?: OutreachEmail;
  emailError?: string;
}

export interface LinkProspectorResult {
  targetDomain: string;
  topicQuery: string;
  region: string;
  fetchedAt: string;
  prospects: LinkProspect[];
  /** Domains we excluded (target + competitors). */
  excluded: string[];
  /** Set when LLM drafting was skipped or failed. */
  draftingError?: string;
  /** Privacy guarantee — link-prospector never reaches an external LLM. */
  privacyMode: "local-only";
}

interface DraftLlmOut {
  results?: Array<{
    index?: number;
    subject?: string;
    body?: string;
    cta?: string;
    tone?: string;
  }>;
}

function pickUserAgent(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
}

async function fetchHtml(url: string): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "GET", headers: { "User-Agent": pickUserAgent(), Accept: "text/html" }, redirect: "follow", signal: ctrl.signal });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const ct = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(ct)) return { ok: false, error: `non-html ${ct}` };
      const buf = await res.arrayBuffer();
      const bytes = buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf;
      return { ok: true, html: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 80) : "fetch failed" };
  }
}

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function domainOf(u: string): string {
  try { return normalizeDomain(new URL(u).hostname); } catch { return ""; }
}

function buildPrompt(input: LinkProspectorInput, prospects: LinkProspect[]): string {
  const lines = prospects
    .map((p, i) => {
      const sample = (p.textSample ?? "").slice(0, PER_URL_TEXT_CAP);
      return `[${i}] ${p.title} — ${p.url} (${p.domain})\nEXCERPT: ${sample}`;
    })
    .join("\n\n---\n\n");
  return [
    `You are a senior outreach specialist. Draft a personalized link-building email for each prospect below.`,
    `The sender represents "${input.targetDomain}" and wants to be cited in the prospect's content about "${input.topicQuery}".`,
    ``,
    `PROSPECTS (${prospects.length}):`,
    lines,
    ``,
    `Return ONLY this JSON (no fences, no prose):`,
    `{`,
    `  "results": [`,
    `    {`,
    `      "index": 0,`,
    `      "tone": "<one phrase describing the prospect's tone — technical / casual / promotional / academic>",`,
    `      "subject": "<≤ 8-word subject line specific to their content, no greetings>",`,
    `      "body": "<60-90 word email body — open with one specific reference to THEIR article, propose a relevant resource from ${input.targetDomain}, end with the CTA below>",`,
    `      "cta": "<one short ask, e.g. 'Worth a 5-minute look?'>"`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `Rules:`,
    `- Reference at least one specific phrase from the prospect's excerpt — never generic.`,
    `- Match THEIR tone (technical → technical, casual → casual). Don't ask them to match yours.`,
    `- Body must be in the operator's first person. No "Hi {{name}}" placeholders. No formulaic praise.`,
    `- If the excerpt is too thin to personalize, keep the body short and honest about that.`,
    `- Never invent statistics about the prospect's site.`,
  ].join("\n");
}

export async function findLinkProspects(input: LinkProspectorInput): Promise<LinkProspectorResult> {
  const target = normalizeDomain(input.targetDomain);
  if (!target) throw new Error("targetDomain is required");
  const topicQuery = input.topicQuery.trim();
  if (!topicQuery) throw new Error("topicQuery is required");
  const region = input.region?.trim() || "us-en";
  const topN = Math.max(3, Math.min(input.topN ?? 10, 20));
  const competitors = (input.competitorDomains ?? []).map(normalizeDomain).filter(Boolean);
  const excluded = new Set<string>([target, ...competitors]);

  // Step 1 — SERP search for the topic.
  const serp = await searchSerp(topicQuery, region);

  // Step 2 — filter prospects.
  const candidates: LinkProspect[] = [];
  const seenDomains = new Set<string>();
  for (const r of serp.results.slice(0, 20)) {
    const dom = domainOf(r.url);
    if (!dom || excluded.has(dom) || seenDomains.has(dom)) continue;
    seenDomains.add(dom);
    candidates.push({
      rank: r.position,
      domain: dom,
      url: r.url,
      title: r.title || r.url,
      fetchOk: false,
    });
    if (candidates.length >= topN) break;
  }

  // Step 3 — fetch + extract per prospect (bounded concurrency).
  const concurrency = 4;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= candidates.length) return;
        const p = candidates[i]!;
        const fetched = await fetchHtml(p.url);
        if (!fetched.ok) {
          p.fetchOk = false;
          p.fetchError = fetched.error;
          continue;
        }
        try {
          const { text } = extractArticle(fetched.html);
          p.fetchOk = true;
          p.textSample = text.slice(0, PER_URL_TEXT_CAP);
        } catch (e) {
          p.fetchOk = false;
          p.fetchError = e instanceof Error ? e.message.slice(0, 80) : "extract failed";
        }
      }
    }),
  );

  const drafts: LinkProspect[] = candidates.filter((c) => c.fetchOk && c.textSample);
  let draftingError: string | undefined;

  // Step 4 — single batched LLM call to draft outreach.
  if (drafts.length > 0) {
    const ollamaUp = await checkOllamaAvailable();
    if (ollamaUp) {
      const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
      const prompt = buildPrompt(input, drafts);
      try {
        const { data } = await withLlmTelemetry(
          "link-prospector",
          model,
          prompt,
          () => routeLlmJson<DraftLlmOut>(prompt, { preferOllama: true }),
        );
        const arr = Array.isArray(data?.results) ? data!.results! : [];
        for (const r of arr) {
          if (typeof r.index !== "number" || r.index < 0 || r.index >= drafts.length) continue;
          const p = drafts[r.index]!;
          if (typeof r.tone === "string") p.tone = r.tone.trim().slice(0, 60);
          if (typeof r.subject === "string" && typeof r.body === "string" && typeof r.cta === "string") {
            p.email = {
              subject: r.subject.trim().slice(0, 120),
              body: r.body.trim().slice(0, 1200),
              cta: r.cta.trim().slice(0, 160),
            };
          }
        }
      } catch (e) {
        draftingError = e instanceof Error ? e.message.slice(0, 200) : "drafting failed";
        for (const p of drafts) p.emailError = "draft skipped (LLM error)";
      }
    } else {
      draftingError = "Ollama not reachable — prospects returned without email drafts";
      for (const p of drafts) p.emailError = "LLM offline";
    }
  } else {
    draftingError = "no fetchable prospects";
  }

  return {
    targetDomain: target,
    topicQuery,
    region,
    fetchedAt: new Date().toISOString(),
    prospects: candidates,
    excluded: [...excluded],
    draftingError,
    privacyMode: "local-only",
  };
}
