/**
 * Competitive Intent Fingerprinting — detects when the SERP intent
 * for a tracked keyword shifts before the operator's rank itself moves.
 *
 * Why it matters: SEMrush shows the rank delta. This shows the
 * intent shift that PRECEDES the delta — surface a competitor pivot
 * 1-2 weeks before it shows up as ranking movement.
 *
 * Fingerprint = pipe-separated tokens describing SERP layout +
 * top-3 URL-path archetypes. Stable + cheap (no LLM in extraction).
 *
 *   "informational|long-form|3-paa|featured-snippet|video-pack|tutorial|comparison|product"
 *
 * Pipeline:
 *   1. extractIntentSignature(serpResults) — pure function, ~0 ms.
 *   2. detectIntentShifts(domain) — walks position-db, finds
 *      consecutive snapshots whose fingerprints differ by ≥ N tokens.
 *   3. Top-3 most-consequential shifts are sent through runCouncil()
 *      so 4 advisors narrate "what the shift implies, who likely
 *      caused it, what to do".
 *
 * Returns an empty council when Ollama isn't reachable; the
 * deterministic shift list is still returned so the UI renders.
 */

import type { SerpResult, SerpResponse } from "../agentic/duckduckgo-serp.js";
import { searchSerp } from "../agentic/duckduckgo-serp.js";
import { runCouncil } from "./council-runner.js";
import type { CouncilAdvisor, CouncilContext, CouncilResult } from "./council-types.js";
import { loadTrackedPairs, readHistory } from "../position-db.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const INTENT_ADVISORS: CouncilAdvisor[] = [
  { id: "content",     name: "Content Strategist",   focus: "What content shape this new SERP rewards and how fast we must adapt" },
  { id: "technical",   name: "Technical SEO",        focus: "Schema / format / page-type changes implied by the new fingerprint" },
  { id: "competitive", name: "Competitive Analyst",  focus: "Which competitor likely drove the pivot and what they did differently" },
  { id: "performance", name: "Performance Engineer", focus: "Single highest-leverage action sized by effort/impact" },
];

// ── Fingerprint extraction ──────────────────────────────────────────────────

const ARCHETYPE_PATTERNS: Array<{ token: string; test: (url: string, title: string) => boolean }> = [
  { token: "tutorial",   test: (u, t) => /how[-_ ]to|tutorial|guide|step[-_ ]by/i.test(u) || /how to|tutorial|step by step/i.test(t) },
  { token: "comparison", test: (u, t) => /vs[-_/]|compare|comparison|alternative/i.test(u) || / vs |alternative|compared/i.test(t) },
  { token: "listicle",   test: (u, t) => /\/best[-_]|\/top[-_]?\d|\d+[-_](best|top|ways|tips)/i.test(u) || /^\d+\s/.test(t) || /best |top \d+/i.test(t) },
  { token: "review",     test: (u, t) => /review|honest|tested|hands[-_]on/i.test(u) || /review|tested|hands-on/i.test(t) },
  { token: "product",    test: (u, t) => /\/products?\/|\/shop\/|pricing|buy|features/i.test(u) || /pricing|buy now/i.test(t) },
  { token: "news",       test: (u, t) => /\/news\/|\/202\d\/|\/blog\/202\d/i.test(u) || /news|announcement|launches/i.test(t) },
  { token: "definition", test: (u, t) => /\/wiki\/|definition|what[-_ ]is|glossary/i.test(u) || /^what is |definition of/i.test(t) },
];

function detectArchetype(url: string, title: string): string | null {
  for (const a of ARCHETYPE_PATTERNS) {
    if (a.test(url, title)) return a.token;
  }
  return null;
}

function detectIntentClass(results: SerpResult[]): string {
  // Heuristic blend: if titles dominated by question-words → informational;
  // if dominated by product/buy → transactional; mixed → commercial.
  let q = 0, p = 0, n = 0, total = 0;
  for (const r of results.slice(0, 5)) {
    const blob = `${r.title} ${r.url}`.toLowerCase();
    total++;
    if (/\bhow\b|\bwhy\b|\bwhat\b|\bwhen\b|\bguide\b|\btutorial\b/.test(blob)) q++;
    if (/\bbuy\b|\bprice\b|\bshop\b|\bproduct\b|\bsale\b/.test(blob)) p++;
    if (/\bbest\b|\bvs\b|\bcompare\b|\breview\b/.test(blob)) n++;
  }
  if (total === 0) return "unspecified";
  const qf = q / total, pf = p / total, nf = n / total;
  if (pf >= 0.4) return "transactional";
  if (nf >= 0.4) return "commercial";
  if (qf >= 0.4) return "informational";
  return "mixed";
}

function detectFormat(results: SerpResult[]): string {
  let avgWords = 0;
  for (const r of results) avgWords += (r.title?.split(/\s+/).length ?? 0);
  avgWords = results.length > 0 ? avgWords / results.length : 0;
  if (avgWords > 11) return "long-form";
  if (avgWords < 6) return "short-form";
  return "medium";
}

export function extractIntentSignature(response: SerpResponse): string {
  const tokens: string[] = [];
  if (!response?.results || response.results.length === 0) return "(empty)";
  const top = response.results.slice(0, 5);
  tokens.push(detectIntentClass(top));
  tokens.push(detectFormat(top));
  // Top-3 archetypes from the URL+title pairs.
  const archetypes = new Set<string>();
  for (const r of top.slice(0, 3)) {
    const a = detectArchetype(r.url, r.title);
    if (a) archetypes.add(a);
  }
  for (const a of [...archetypes].slice(0, 3)) tokens.push(a);
  return tokens.join("|");
}

/** Fingerprint a keyword on demand — fetches DDG SERP and computes. */
export async function fingerprintKeyword(keyword: string, region = "us-en"): Promise<{ signature: string; response: SerpResponse }> {
  const response = await searchSerp(keyword, region);
  return { signature: extractIntentSignature(response), response };
}

// ── Shift detection ─────────────────────────────────────────────────────────

export interface IntentShift {
  domain: string;
  keyword: string;
  fromAt: string;
  toAt: string;
  fromSignature: string;
  toSignature: string;
  /** Token-level Hamming distance — count of token positions that differ. */
  distance: number;
  /** Tokens added in the new signature. */
  added: string[];
  /** Tokens removed from the old signature. */
  removed: string[];
}

function diffSignatures(from: string, to: string): { distance: number; added: string[]; removed: string[] } {
  const fromSet = new Set(from.split("|").filter(Boolean));
  const toSet = new Set(to.split("|").filter(Boolean));
  const added: string[] = [];
  const removed: string[] = [];
  for (const t of toSet) if (!fromSet.has(t)) added.push(t);
  for (const t of fromSet) if (!toSet.has(t)) removed.push(t);
  return { distance: added.length + removed.length, added, removed };
}

export interface DetectIntentShiftsInput {
  domain: string;
  /** Minimum token-distance to count as a shift. Default 2. */
  minDistance?: number;
  /** Lookback in days. Default 90. */
  windowDays?: number;
  includeLlm?: boolean;
}

export interface IntentShiftsResult {
  domain: string;
  windowDays: number;
  pairsChecked: number;
  pairsWithFingerprintHistory: number;
  shifts: IntentShift[];
  council: CouncilResult | null;
  councilError?: string;
  generatedAt: string;
}

export async function detectIntentShifts(input: DetectIntentShiftsInput): Promise<IntentShiftsResult> {
  const minDistance = Math.max(1, input.minDistance ?? 2);
  const windowDays = Math.max(7, Math.min(input.windowDays ?? 90, 365));
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const targetDomain = input.domain.trim().toLowerCase();
  const allPairs = await loadTrackedPairs();
  const myPairs = allPairs.filter((p) => p.domain.trim().toLowerCase() === targetDomain);

  const shifts: IntentShift[] = [];
  let withHistory = 0;
  for (const pair of myPairs) {
    try {
      const history = await readHistory(pair.domain, pair.keyword);
      const withSig = history.filter((h) => typeof h.intentSignature === "string" && h.intentSignature.length > 0 && new Date(h.at).getTime() >= cutoff) as Array<{ at: string; intentSignature: string }>;
      if (withSig.length < 2) continue;
      withHistory++;
      // Walk consecutive pairs; emit a shift when they differ enough.
      for (let i = 1; i < withSig.length; i++) {
        const prev = withSig[i - 1]!;
        const curr = withSig[i]!;
        if (prev.intentSignature === curr.intentSignature) continue;
        const d = diffSignatures(prev.intentSignature, curr.intentSignature);
        if (d.distance < minDistance) continue;
        shifts.push({
          domain: pair.domain,
          keyword: pair.keyword,
          fromAt: prev.at,
          toAt: curr.at,
          fromSignature: prev.intentSignature,
          toSignature: curr.intentSignature,
          distance: d.distance,
          added: d.added,
          removed: d.removed,
        });
      }
    } catch { /* skip pair on error */ }
  }
  // Most-consequential shifts first (largest distance, then most-recent).
  shifts.sort((a, b) => b.distance - a.distance || b.toAt.localeCompare(a.toAt));

  // Top-3 → council narration.
  let council: CouncilResult | null = null;
  let councilError: string | undefined;
  if (input.includeLlm !== false && shifts.length > 0) {
    try {
      const items = shifts.slice(0, 6).map((s) => ({
        id: `${s.domain}::${s.keyword}`,
        label: `"${s.keyword}" (${s.domain})`,
        sublabel: `${s.fromSignature} → ${s.toSignature}`,
        sources: ["serp-fingerprint", "position-db"],
        metrics: {
          distance: s.distance,
          added: s.added.join(",") || "none",
          removed: s.removed.join(",") || "none",
          fromAt: s.fromAt,
          toAt: s.toAt,
        },
        score: 100 - Math.max(0, (Date.now() - new Date(s.toAt).getTime()) / (24 * 60 * 60 * 1000)),
      }));
      const ctx: CouncilContext = {
        feature: "intent-fingerprint",
        featureLabel: "Competitive Intent Fingerprint",
        featureTagline: `Detected SERP intent shifts for ${targetDomain}'s tracked keywords. Advisors must explain WHO likely caused each shift and what we should do — referencing the added/removed tokens.`,
        target: targetDomain,
        sourcesQueried: ["serp-fingerprint", "position-db"],
        sourcesFailed: [],
        tierTop: items.slice(0, 3),
        tierMid: items.slice(3, 6),
        tierBottom: [],
        totalItems: items.length,
        collectedAt: new Date().toISOString(),
        advisors: INTENT_ADVISORS,
      };
      council = await runCouncil(ctx);
    } catch (e) {
      councilError = e instanceof Error ? e.message.slice(0, 200) : "council failed";
    }
  } else if (shifts.length === 0) {
    councilError = "no shifts detected — need ≥2 snapshots with intentSignature in the window";
  }

  return {
    domain: targetDomain,
    windowDays,
    pairsChecked: myPairs.length,
    pairsWithFingerprintHistory: withHistory,
    shifts,
    council,
    councilError,
    generatedAt: new Date().toISOString(),
  };
}

// ── Bulk on-demand fingerprint refresh (so users have data immediately) ─────

const FINGERPRINTS_DEBUG_FILE = path.join(process.cwd(), "data", "intent-fingerprints-debug.jsonl");

/** Compute current fingerprint for every tracked pair on a domain. Useful
 *  to seed the history when no snapshots have intentSignature yet. */
export async function snapshotFingerprintsNow(domain: string, region = "us-en"): Promise<{ keyword: string; signature: string; error?: string }[]> {
  const targetDomain = domain.trim().toLowerCase();
  const pairs = (await loadTrackedPairs()).filter((p) => p.domain.trim().toLowerCase() === targetDomain);
  const out: { keyword: string; signature: string; error?: string }[] = [];
  for (const pair of pairs) {
    try {
      const { signature } = await fingerprintKeyword(pair.keyword, region);
      out.push({ keyword: pair.keyword, signature });
      // Append to debug log for now (write-into-history will be wired into
      // gsc-auto-track / position-tracker in a follow-up commit so backfill
      // is opt-in and doesn't write to immutable old snapshots).
      try {
        await writeFile(FINGERPRINTS_DEBUG_FILE, JSON.stringify({ at: new Date().toISOString(), domain: targetDomain, keyword: pair.keyword, signature }) + "\n", { flag: "a" });
      } catch { /* non-fatal */ }
    } catch (e) {
      out.push({ keyword: pair.keyword, signature: "", error: e instanceof Error ? e.message.slice(0, 80) : "fingerprint failed" });
    }
  }
  return out;
}
