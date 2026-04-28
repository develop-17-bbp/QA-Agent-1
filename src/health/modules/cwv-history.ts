/**
 * Core Web Vitals History — snapshot the operator's CrUX metrics
 * (LCP, INP, CLS, FCP, TTFB) on a regular cadence and detect
 * regressions across deploys. INP replaced FID in March 2024 and
 * is now a confirmed ranking signal; tracking it over 90 days vs
 * deploys is now table-stakes.
 *
 * Pipeline:
 *   1. snapshotCwv(url, formFactor)
 *      Fetches CrUX record + appends to data/cwv-history/<host>.jsonl.
 *   2. readCwvHistory(url, days)
 *      Returns the last N days of snapshots for trend rendering.
 *   3. detectRegressions(url)
 *      Compares latest snapshot to median of prior 7 — flags any
 *      metric where p75 worsened by ≥ regressionThreshold for that
 *      metric's tier (LCP +500ms, INP +50ms, CLS +0.05, etc.)
 *
 * Storage: append-only JSONL so we never lose history; a rotation
 * helper trims to the last 365 entries per host.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchCruxRecord, rateMetric, isCruxConfigured, type CruxRecord, type CruxFormFactor } from "../providers/crux.js";

const HISTORY_ROOT = path.join(process.cwd(), "data", "cwv-history");

export interface CwvSnapshot {
  url: string;
  formFactor: CruxFormFactor;
  fetchedAt: string;
  collectionFirstDate: string;
  collectionLastDate: string;
  lcpP75: number | null;
  inpP75: number | null;
  clsP75: number | null;
  fcpP75: number | null;
  ttfbP75: number | null;
  /** Per-metric pass/fail rating ("good" / "needs-improvement" / "poor"). */
  ratings: {
    lcp?: "good" | "needs-improvement" | "poor";
    inp?: "good" | "needs-improvement" | "poor";
    cls?: "good" | "needs-improvement" | "poor";
    fcp?: "good" | "needs-improvement" | "poor";
    ttfb?: "good" | "needs-improvement" | "poor";
  };
}

export interface CwvRegression {
  metric: "lcp" | "inp" | "cls" | "fcp" | "ttfb";
  beforeMedian: number;
  current: number;
  delta: number;
  /** True when delta crossed a Core Web Vitals tier boundary (good→needs / needs→poor). */
  crossedTier: boolean;
  severity: "info" | "warn" | "critical";
}

const REGRESSION_THRESHOLDS: Record<CwvRegression["metric"], number> = {
  lcp: 500,    // ms
  inp: 50,     // ms
  cls: 0.05,   // unitless
  fcp: 300,    // ms
  ttfb: 200,   // ms
};

function fileFor(url: string): string {
  let host = url;
  try { host = new URL(url).hostname; } catch { /* keep raw */ }
  return path.join(HISTORY_ROOT, `${host.replace(/[^\w.-]/g, "_")}.jsonl`);
}

function recordToSnapshot(rec: CruxRecord): CwvSnapshot {
  const lcp = rec.lcp.value;
  const inp = rec.inp.value;
  const cls = rec.cls.value;
  const fcp = rec.fcp.value;
  const ttfb = rec.ttfb.value;
  return {
    url: rec.url,
    formFactor: rec.formFactor,
    fetchedAt: new Date().toISOString(),
    collectionFirstDate: rec.collectionPeriod.firstDate,
    collectionLastDate: rec.collectionPeriod.lastDate,
    lcpP75: lcp?.p75 ?? null,
    inpP75: inp?.p75 ?? null,
    clsP75: cls?.p75 ?? null,
    fcpP75: fcp?.p75 ?? null,
    ttfbP75: ttfb?.p75 ?? null,
    ratings: {
      lcp: lcp ? rateMetric("lcp", lcp.p75) : undefined,
      inp: inp ? rateMetric("inp", inp.p75) : undefined,
      cls: cls ? rateMetric("cls", cls.p75) : undefined,
      fcp: fcp ? rateMetric("fcp", fcp.p75) : undefined,
      ttfb: ttfb ? rateMetric("ttfb", ttfb.p75) : undefined,
    },
  };
}

export async function snapshotCwv(url: string, formFactor: CruxFormFactor = "PHONE"): Promise<CwvSnapshot> {
  if (!isCruxConfigured()) throw new Error("CrUX not configured — set CRUX_API_KEY (or REUSE_PAGESPEED_KEY_FOR_CRUX=true)");
  const rec = await fetchCruxRecord(url, formFactor);
  if (!rec) throw new Error("CrUX has no field data for this URL — origin too small or unverified.");
  const snap = recordToSnapshot(rec);
  try {
    await fs.mkdir(HISTORY_ROOT, { recursive: true });
    await fs.appendFile(fileFor(url), JSON.stringify(snap) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch { /* non-fatal */ }
  return snap;
}

export async function readCwvHistory(url: string, days = 90): Promise<CwvSnapshot[]> {
  try {
    const raw = await fs.readFile(fileFor(url), "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const out: CwvSnapshot[] = [];
    for (const line of lines) {
      try {
        const s = JSON.parse(line) as CwvSnapshot;
        if (new Date(s.fetchedAt).getTime() >= cutoff) out.push(s);
      } catch { /* skip malformed */ }
    }
    return out;
  } catch { return []; }
}

export interface RegressionInput {
  url: string;
  formFactor?: CruxFormFactor;
  /** When true (default), takes a fresh snapshot before comparing. */
  refresh?: boolean;
}

export interface RegressionResult {
  url: string;
  current: CwvSnapshot | null;
  /** The snapshots used for the median baseline. */
  baseline: { count: number; medianFetchedAt: string | null };
  regressions: CwvRegression[];
  improvements: CwvRegression[];
  generatedAt: string;
}

function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1]! + sorted[m]!) / 2 : sorted[m]!;
}

export async function detectCwvRegressions(input: RegressionInput): Promise<RegressionResult> {
  const formFactor = input.formFactor ?? "PHONE";
  let current: CwvSnapshot | null = null;
  if (input.refresh !== false) {
    try { current = await snapshotCwv(input.url, formFactor); } catch { /* fall through */ }
  }
  const history = await readCwvHistory(input.url, 30);
  // Use everything BEFORE the latest as baseline. Need ≥ 2 historical points.
  const sorted = history.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  const latest = current ?? sorted[sorted.length - 1] ?? null;
  const prior = sorted.slice(0, -1).slice(-7); // last 7 prior

  const regressions: CwvRegression[] = [];
  const improvements: CwvRegression[] = [];

  if (latest && prior.length >= 2) {
    const metrics: CwvRegression["metric"][] = ["lcp", "inp", "cls", "fcp", "ttfb"];
    const fieldByMetric: Record<CwvRegression["metric"], keyof CwvSnapshot> = {
      lcp: "lcpP75", inp: "inpP75", cls: "clsP75", fcp: "fcpP75", ttfb: "ttfbP75",
    };
    for (const m of metrics) {
      const field = fieldByMetric[m];
      const cur = latest[field] as number | null;
      const baselineVals = prior.map((s) => s[field] as number | null).filter((v): v is number => typeof v === "number");
      if (cur == null || baselineVals.length < 2) continue;
      const med = median(baselineVals);
      if (!Number.isFinite(med)) continue;
      const delta = cur - med;
      const threshold = REGRESSION_THRESHOLDS[m];
      const isRegression = delta > threshold;
      const isImprovement = delta < -threshold;
      if (!isRegression && !isImprovement) continue;
      const beforeRating = rateMetric(m, med);
      const currentRating = rateMetric(m, cur);
      const crossedTier = beforeRating !== currentRating;
      let severity: CwvRegression["severity"] = "info";
      if (Math.abs(delta) >= threshold * 3) severity = "critical";
      else if (Math.abs(delta) >= threshold * 2 || crossedTier) severity = "warn";
      const item: CwvRegression = {
        metric: m,
        beforeMedian: +med.toFixed(3),
        current: +cur.toFixed(3),
        delta: +delta.toFixed(3),
        crossedTier,
        severity,
      };
      if (isRegression) regressions.push(item);
      else improvements.push(item);
    }
  }

  return {
    url: input.url,
    current: latest,
    baseline: {
      count: prior.length,
      medianFetchedAt: prior.length > 0 ? prior[Math.floor(prior.length / 2)]?.fetchedAt ?? null : null,
    },
    regressions,
    improvements,
    generatedAt: new Date().toISOString(),
  };
}
