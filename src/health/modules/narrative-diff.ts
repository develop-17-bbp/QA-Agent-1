/**
 * Narrative Diff Engine — given two run IDs for the same operator's
 * crawls, produce a plain-English "what changed and why it matters"
 * story instead of a flat URL diff.
 *
 * Why it matters: SEMrush can show diffs (URLs added/removed, rank
 * deltas). Only QA-Agent can NARRATE them — the operator's full run
 * history sits on disk, so the LLM has total context with no SaaS
 * rate limits or tenant boundaries.
 *
 * Pipeline (deterministic → LLM):
 *   1. Read run-meta.json for both runs.
 *   2. For every site that appears in both runs, read the per-site
 *      report.json and compute structural deltas (sections, pages,
 *      broken links, durations).
 *   3. Hand the structured diff to the council; advisors must explain
 *      the change with a metric (the new "no verdict without a metric"
 *      rule from Phase A).
 *
 * Returns null narrative when Ollama is unavailable — the deterministic
 * deltas are still returned so the UI can render them.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { runCouncil } from "./council-runner.js";
import type { CouncilContext, CouncilAdvisor, CouncilResult } from "./council-types.js";
import type { SiteHealthReport } from "../types.js";
import type { HealthRunMeta } from "../orchestrate-health.js";

const DIFF_ADVISORS: CouncilAdvisor[] = [
  { id: "content",     name: "Content Strategist",   focus: "Which content changes drove the most-visible deltas (gain or loss)" },
  { id: "technical",   name: "Technical SEO",        focus: "Which crawl/perf/structural shifts caused the move (or are about to)" },
  { id: "competitive", name: "Competitive Analyst",  focus: "Whether competitor activity is the likely cause and what to monitor" },
  { id: "performance", name: "Performance Engineer", focus: "Concrete next action sized by effort vs impact" },
];

export interface SectionDelta {
  /** Section path prefix, e.g. "/blog/" or "/products/". */
  section: string;
  pagesA: number;
  pagesB: number;
  pagesDelta: number;
  /** Median page-load duration ms, A vs B. */
  durationMsA: number | null;
  durationMsB: number | null;
  brokenLinksA: number;
  brokenLinksB: number;
}

export interface SiteDelta {
  hostname: string;
  startUrl: string;
  pagesA: number;
  pagesB: number;
  brokenLinksA: number;
  brokenLinksB: number;
  /** Per-section deltas ordered by largest absolute pagesDelta first. */
  sections: SectionDelta[];
  /** URLs broken in B that weren't broken in A — the regressions. */
  newlyBrokenUrls: string[];
  /** URLs broken in A that aren't broken in B — the wins. */
  fixedBrokenUrls: string[];
}

export interface NarrativeDiffResult {
  runIdA: string;
  runIdB: string;
  metaA: HealthRunMeta | null;
  metaB: HealthRunMeta | null;
  sites: SiteDelta[];
  /** Sites that exist only in A or only in B — listed but not deeply diffed. */
  sitesOnlyInA: string[];
  sitesOnlyInB: string[];
  council: CouncilResult | null;
  councilError?: string;
  generatedAt: string;
}

function safeReadJson<T>(p: string): Promise<T | null> {
  return fs.readFile(p, "utf8").then((s) => JSON.parse(s) as T).catch(() => null);
}

function sectionOfUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    return seg ? `/${seg}/` : "/";
  } catch {
    return "/";
  }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function diffSite(reportA: SiteHealthReport, reportB: SiteHealthReport): SiteDelta {
  // Bucket pages by URL section.
  const sectionsA = new Map<string, { pages: number; durations: number[]; broken: number }>();
  const sectionsB = new Map<string, { pages: number; durations: number[]; broken: number }>();
  for (const p of reportA.crawl.pages) {
    const s = sectionOfUrl(p.url);
    const slot = sectionsA.get(s) ?? { pages: 0, durations: [], broken: 0 };
    slot.pages++;
    if (typeof p.durationMs === "number") slot.durations.push(p.durationMs);
    sectionsA.set(s, slot);
  }
  for (const p of reportB.crawl.pages) {
    const s = sectionOfUrl(p.url);
    const slot = sectionsB.get(s) ?? { pages: 0, durations: [], broken: 0 };
    slot.pages++;
    if (typeof p.durationMs === "number") slot.durations.push(p.durationMs);
    sectionsB.set(s, slot);
  }
  // Bucket broken links per section.
  for (const b of reportA.crawl.brokenLinks ?? []) {
    const s = sectionOfUrl(b.target);
    const slot = sectionsA.get(s) ?? { pages: 0, durations: [], broken: 0 };
    slot.broken++;
    sectionsA.set(s, slot);
  }
  for (const b of reportB.crawl.brokenLinks ?? []) {
    const s = sectionOfUrl(b.target);
    const slot = sectionsB.get(s) ?? { pages: 0, durations: [], broken: 0 };
    slot.broken++;
    sectionsB.set(s, slot);
  }
  const allSections = new Set<string>([...sectionsA.keys(), ...sectionsB.keys()]);
  const sections: SectionDelta[] = [];
  for (const s of allSections) {
    const a = sectionsA.get(s) ?? { pages: 0, durations: [], broken: 0 };
    const b = sectionsB.get(s) ?? { pages: 0, durations: [], broken: 0 };
    sections.push({
      section: s,
      pagesA: a.pages,
      pagesB: b.pages,
      pagesDelta: b.pages - a.pages,
      durationMsA: median(a.durations),
      durationMsB: median(b.durations),
      brokenLinksA: a.broken,
      brokenLinksB: b.broken,
    });
  }
  sections.sort((x, y) => Math.abs(y.pagesDelta) - Math.abs(x.pagesDelta));

  // Newly-broken vs fixed.
  const aBroken = new Set((reportA.crawl.brokenLinks ?? []).map((b) => b.target));
  const bBroken = new Set((reportB.crawl.brokenLinks ?? []).map((b) => b.target));
  const newlyBrokenUrls: string[] = [];
  const fixedBrokenUrls: string[] = [];
  for (const t of bBroken) if (!aBroken.has(t)) newlyBrokenUrls.push(t);
  for (const t of aBroken) if (!bBroken.has(t)) fixedBrokenUrls.push(t);

  return {
    hostname: reportB.hostname,
    startUrl: reportB.startUrl,
    pagesA: reportA.crawl.pagesVisited,
    pagesB: reportB.crawl.pagesVisited,
    brokenLinksA: aBroken.size,
    brokenLinksB: bBroken.size,
    sections: sections.slice(0, 8),
    newlyBrokenUrls: newlyBrokenUrls.slice(0, 10),
    fixedBrokenUrls: fixedBrokenUrls.slice(0, 10),
  };
}

function buildCouncilContext(runIdA: string, runIdB: string, sites: SiteDelta[]): CouncilContext {
  const items = sites.flatMap((s) =>
    s.sections.slice(0, 3).map((sec) => ({
      id: `${s.hostname}::${sec.section}`,
      label: `${s.hostname} ${sec.section}`,
      sublabel: `${sec.pagesA} → ${sec.pagesB} pages (Δ ${sec.pagesDelta > 0 ? "+" : ""}${sec.pagesDelta}); broken ${sec.brokenLinksA} → ${sec.brokenLinksB}; median ${sec.durationMsA ?? "n/a"} → ${sec.durationMsB ?? "n/a"} ms`,
      sources: ["run-meta", "site-report"],
      metrics: {
        pagesA: sec.pagesA,
        pagesB: sec.pagesB,
        pagesDelta: sec.pagesDelta,
        brokenLinksA: sec.brokenLinksA,
        brokenLinksB: sec.brokenLinksB,
        durationMsA: sec.durationMsA ?? "n/a",
        durationMsB: sec.durationMsB ?? "n/a",
      },
      score: Math.min(100, 30 + Math.abs(sec.pagesDelta) * 5 + Math.abs(sec.brokenLinksB - sec.brokenLinksA) * 8),
    })),
  );
  // Highest-impact items go to tierTop.
  items.sort((x, y) => y.score - x.score);
  return {
    feature: "narrative-diff",
    featureLabel: "Run-to-Run Diff",
    featureTagline: `Comparing run ${runIdA} → ${runIdB}. Advisors must explain WHY each section moved with the supplied numbers.`,
    target: `${runIdA} → ${runIdB}`,
    sourcesQueried: ["run-meta", "site-report"],
    sourcesFailed: [],
    tierTop: items.slice(0, 8),
    tierMid: items.slice(8, 14),
    tierBottom: [],
    totalItems: items.length,
    collectedAt: new Date().toISOString(),
    advisors: DIFF_ADVISORS,
  };
}

export interface NarrativeDiffInput {
  runIdA: string;
  runIdB: string;
  outRoot?: string;
  includeLlm?: boolean;
}

export async function buildNarrativeDiff(input: NarrativeDiffInput): Promise<NarrativeDiffResult> {
  const outRoot = path.resolve(input.outRoot ?? "artifacts/health");
  const a = input.runIdA.trim();
  const b = input.runIdB.trim();
  if (!a || !b) throw new Error("runIdA and runIdB are required");
  if (!/^[a-zA-Z0-9._-]+$/.test(a) || !/^[a-zA-Z0-9._-]+$/.test(b)) throw new Error("invalid runId format");

  const metaA = await safeReadJson<HealthRunMeta>(path.join(outRoot, a, "run-meta.json"));
  const metaB = await safeReadJson<HealthRunMeta>(path.join(outRoot, b, "run-meta.json"));

  const sitesA = new Map<string, { reportPath: string }>();
  const sitesB = new Map<string, { reportPath: string }>();
  for (const s of metaA?.sites ?? []) {
    const dir = s.reportHtmlHref.split("/")[0] ?? "";
    if (dir) sitesA.set(s.hostname.toLowerCase(), { reportPath: path.join(outRoot, a, dir, "report.json") });
  }
  for (const s of metaB?.sites ?? []) {
    const dir = s.reportHtmlHref.split("/")[0] ?? "";
    if (dir) sitesB.set(s.hostname.toLowerCase(), { reportPath: path.join(outRoot, b, dir, "report.json") });
  }
  const onlyA = [...sitesA.keys()].filter((h) => !sitesB.has(h));
  const onlyB = [...sitesB.keys()].filter((h) => !sitesA.has(h));
  const common = [...sitesA.keys()].filter((h) => sitesB.has(h));

  const siteDeltas: SiteDelta[] = [];
  for (const host of common) {
    const reportA = await safeReadJson<SiteHealthReport>(sitesA.get(host)!.reportPath);
    const reportB = await safeReadJson<SiteHealthReport>(sitesB.get(host)!.reportPath);
    if (!reportA || !reportB) continue;
    siteDeltas.push(diffSite(reportA, reportB));
  }
  // Sort sites by total movement (page delta + broken delta) descending.
  siteDeltas.sort((x, y) => {
    const mx = Math.abs(x.pagesB - x.pagesA) + Math.abs(x.brokenLinksB - x.brokenLinksA);
    const my = Math.abs(y.pagesB - y.pagesA) + Math.abs(y.brokenLinksB - y.brokenLinksA);
    return my - mx;
  });

  let council: CouncilResult | null = null;
  let councilError: string | undefined;
  if (input.includeLlm !== false && siteDeltas.length > 0) {
    try {
      const ctx = buildCouncilContext(a, b, siteDeltas);
      council = await runCouncil(ctx);
    } catch (e) {
      councilError = e instanceof Error ? e.message.slice(0, 200) : "council failed";
    }
  }

  return {
    runIdA: a,
    runIdB: b,
    metaA,
    metaB,
    sites: siteDeltas,
    sitesOnlyInA: onlyA,
    sitesOnlyInB: onlyB,
    council,
    councilError,
    generatedAt: new Date().toISOString(),
  };
}
