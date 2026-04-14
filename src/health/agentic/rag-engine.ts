/**
 * RAG (Retrieval-Augmented Generation) Engine
 *
 * BM25-style TF-IDF retrieval over crawl report data. Chunks SiteHealthReport[]
 * into per-page documents and retrieves the most relevant ones for a given query.
 * Pure TypeScript — no vector DB or external dependencies.
 */

import type { SiteHealthReport } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface Document {
  id: string;
  url: string;
  site: string;
  text: string;
  terms: Map<string, number>; // term → frequency
  length: number; // total term count
}

interface BM25Index {
  docs: Document[];
  df: Map<string, number>; // term → document frequency
  avgDl: number; // average document length
  totalDocs: number;
}

export interface RetrievedChunk {
  url: string;
  site: string;
  text: string;
  score: number;
}

// ── Index Store ──────────────────────────────────────────────────────────────

const indexStore = new Map<string, BM25Index>();

// ── Tokenizer ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "of", "in", "to", "and", "or", "for",
  "on", "at", "by", "as", "be", "was", "are", "with", "that", "this",
  "from", "has", "have", "had", "not", "but", "all", "can", "her", "his",
  "its", "may", "new", "one", "our", "out", "own", "say", "she", "too",
  "use", "way", "who", "how", "each", "will", "up", "if", "do", "no",
  "so", "we", "my", "he", "me",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

// ── Document Builder ─────────────────────────────────────────────────────────

function buildDocument(page: {
  url: string;
  documentTitle?: string;
  metaDescriptionLength?: number;
  h1Count?: number;
  canonicalUrl?: string;
  status: number;
  ok: boolean;
  durationMs: number;
  bodyBytes?: number;
  documentLang?: string;
  error?: string;
  insights?: unknown;
}, site: string, idx: number): Document {
  const parts: string[] = [];

  parts.push(`url: ${page.url}`);
  parts.push(`site: ${site}`);
  if (page.documentTitle) parts.push(`title: ${page.documentTitle}`);
  parts.push(`status: ${page.status}`);
  parts.push(`ok: ${page.ok}`);
  parts.push(`load time: ${page.durationMs}ms`);
  if (page.bodyBytes) parts.push(`size: ${page.bodyBytes} bytes`);
  if (page.h1Count !== undefined) parts.push(`h1 count: ${page.h1Count}`);
  if (page.metaDescriptionLength !== undefined) parts.push(`meta description length: ${page.metaDescriptionLength}`);
  if (page.canonicalUrl) parts.push(`canonical: ${page.canonicalUrl}`);
  if (page.documentLang) parts.push(`language: ${page.documentLang}`);
  if (page.error) parts.push(`error: ${page.error}`);

  // Extract performance insights
  const ins = page.insights as Record<string, unknown> | undefined;
  if (ins) {
    if ("mobile" in ins) {
      const mobile = ins.mobile as { scores?: Record<string, number>; metrics?: Record<string, number> } | undefined;
      if (mobile?.scores?.performance !== undefined) parts.push(`mobile performance: ${mobile.scores.performance}`);
      if (mobile?.metrics?.lcpMs !== undefined) parts.push(`lcp: ${mobile.metrics.lcpMs}ms`);
      if (mobile?.metrics?.fcpMs !== undefined) parts.push(`fcp: ${mobile.metrics.fcpMs}ms`);
      if (mobile?.metrics?.cls !== undefined) parts.push(`cls: ${mobile.metrics.cls}`);
      if (mobile?.metrics?.tbtMs !== undefined) parts.push(`tbt: ${mobile.metrics.tbtMs}ms`);
    }
    if ("desktop" in ins) {
      const desktop = ins.desktop as { scores?: Record<string, number> } | undefined;
      if (desktop?.scores?.performance !== undefined) parts.push(`desktop performance: ${desktop.scores.performance}`);
    }
  }

  // Issue flags
  if (!page.ok) parts.push("issue: page failed to load");
  if (page.h1Count === 0) parts.push("issue: missing h1");
  if (page.h1Count !== undefined && page.h1Count > 1) parts.push("issue: multiple h1 tags");
  if (page.metaDescriptionLength !== undefined && page.metaDescriptionLength === 0) parts.push("issue: missing meta description");
  if (page.metaDescriptionLength !== undefined && page.metaDescriptionLength < 120 && page.metaDescriptionLength > 0) parts.push("issue: short meta description");
  if (page.status >= 400) parts.push(`issue: http ${page.status} error`);
  if (page.status >= 300 && page.status < 400) parts.push("issue: redirect");
  if (page.durationMs > 3000) parts.push("issue: slow page load");

  const text = parts.join(". ");
  const tokens = tokenize(text);

  return {
    id: `${site}:${idx}`,
    url: page.url,
    site,
    text,
    terms: termFrequencies(tokens),
    length: tokens.length,
  };
}

// ── Index Builder ────────────────────────────────────────────────────────────

export function buildIndex(runId: string, reports: SiteHealthReport[]): void {
  const docs: Document[] = [];

  for (const report of reports) {
    // Index individual pages
    report.crawl.pages.forEach((page, idx) => {
      docs.push(buildDocument(page, report.hostname, idx));
    });

    // Index broken links as separate documents
    for (const bl of report.crawl.brokenLinks.slice(0, 100)) {
      const text = `broken link: target ${bl.target} found on ${bl.foundOn} status ${bl.status ?? "unknown"} error ${bl.error ?? "none"} site ${report.hostname}`;
      const tokens = tokenize(text);
      docs.push({
        id: `${report.hostname}:bl:${bl.target}`,
        url: bl.target,
        site: report.hostname,
        text,
        terms: termFrequencies(tokens),
        length: tokens.length,
      });
    }
  }

  // Build document frequency map
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.terms.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const totalLength = docs.reduce((sum, d) => sum + d.length, 0);

  indexStore.set(runId, {
    docs,
    df,
    avgDl: docs.length > 0 ? totalLength / docs.length : 0,
    totalDocs: docs.length,
  });
}

// ── BM25 Retrieval ───────────────────────────────────────────────────────────

const K1 = 1.2;
const B = 0.75;

function scoreBM25(query: string[], doc: Document, index: BM25Index): number {
  let score = 0;
  const { df, avgDl, totalDocs } = index;

  for (const term of query) {
    const docFreq = df.get(term) ?? 0;
    if (docFreq === 0) continue;

    const tf = doc.terms.get(term) ?? 0;
    if (tf === 0) continue;

    // IDF component
    const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);

    // TF component with length normalization
    const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (doc.length / avgDl)));

    score += idf * tfNorm;
  }

  return score;
}

export function retrieve(runId: string, query: string, topK: number = 15): RetrievedChunk[] {
  const index = indexStore.get(runId);
  if (!index || index.docs.length === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const scored = index.docs.map(doc => ({
    doc,
    score: scoreBM25(queryTerms, doc, index),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, topK)
    .filter(s => s.score > 0)
    .map(s => ({
      url: s.doc.url,
      site: s.doc.site,
      text: s.doc.text,
      score: s.score,
    }));
}

// ── Index Management ─────────────────────────────────────────────────────────

export function clearIndex(runId: string): boolean {
  return indexStore.delete(runId);
}

export function hasIndex(runId: string): boolean {
  return indexStore.has(runId);
}

export function getIndexStats(runId: string): { docs: number; terms: number } | null {
  const index = indexStore.get(runId);
  if (!index) return null;
  return { docs: index.totalDocs, terms: index.df.size };
}
