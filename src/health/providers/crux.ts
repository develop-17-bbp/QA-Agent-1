/**
 * Chrome UX Report (CrUX) API — real-user Web Vitals from Chrome users.
 *
 * https://developer.chrome.com/docs/crux/api
 *
 * Unlike PageSpeed Insights (which runs Lighthouse in a lab), CrUX reports
 * aggregated field data: the 75th-percentile experience of real Chrome users
 * who visited the URL (or origin) in the last 28 days.
 *
 * Requires a Google API key with "Chrome UX Report API" enabled. Free tier:
 * 150 requests per 100 seconds per user, 25k/day. Either CRUX_API_KEY or
 * GOOGLE_API_KEY (fallback) is used — many teams enable both CrUX and
 * PageSpeed Insights on the same key.
 *
 * A 404 from the API is not an error — it means Google doesn't have enough
 * real-user samples for that URL. We return `null` so callers can gracefully
 * fall back to lab data.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";
import { resolveKey } from "../modules/runtime-keys.js";

const PROVIDER = "crux";
registerLimit(PROVIDER, 25_000, 24 * 60 * 60 * 1000);
const TTL_MS = 24 * 60 * 60 * 1000;

export type CruxFormFactor = "PHONE" | "DESKTOP" | "TABLET" | "ALL_FORM_FACTORS";

const METRICS = [
  "largest_contentful_paint",
  "interaction_to_next_paint",
  "cumulative_layout_shift",
  "first_contentful_paint",
  "experimental_time_to_first_byte",
] as const;

export interface CruxMetric {
  /** 75th-percentile value — what 75% of real visits were at or below. */
  p75: number;
  /** Rating buckets (good/needs-improvement/poor) as fractions of visits. */
  histogram: { start: number; end?: number; density: number }[];
}

export interface CruxRecord {
  url: string;
  formFactor: CruxFormFactor;
  collectionPeriod: { firstDate: string; lastDate: string };
  lcp: DataPoint<CruxMetric | null>;
  inp: DataPoint<CruxMetric | null>;
  cls: DataPoint<CruxMetric | null>;
  fcp: DataPoint<CruxMetric | null>;
  ttfb: DataPoint<CruxMetric | null>;
}

function resolveCruxKey(): string | undefined {
  // Primary: CRUX_API_KEY, then GOOGLE_API_KEY (shared Google key). Third
  // fallback: reuse PAGESPEED_API_KEY when REUSE_PAGESPEED_KEY_FOR_CRUX=true.
  // This avoids forcing users to generate a second GCP key if they've already
  // enabled "Chrome UX Report API" on the same project as PageSpeed Insights.
  const direct = resolveKey("CRUX_API_KEY") || resolveKey("GOOGLE_API_KEY");
  if (direct) return direct;
  if ((resolveKey("REUSE_PAGESPEED_KEY_FOR_CRUX") ?? "").toLowerCase() === "true") {
    const shared = resolveKey("PAGESPEED_API_KEY");
    if (shared) return shared;
  }
  return undefined;
}

export function isCruxConfigured(): boolean {
  return !!resolveCruxKey();
}

type ApiMetric = {
  histogram?: { start: number; end?: number; density: number }[];
  percentiles?: { p75?: number | string };
};

type ApiResponse = {
  record?: {
    metrics?: Record<string, ApiMetric>;
    collectionPeriod?: {
      firstDate: { year: number; month: number; day: number };
      lastDate: { year: number; month: number; day: number };
    };
  };
};

function toMetric(raw: ApiMetric | undefined): CruxMetric | null {
  if (!raw?.percentiles?.p75 && raw?.percentiles?.p75 !== 0) return null;
  const p75 = typeof raw.percentiles.p75 === "string" ? Number(raw.percentiles.p75) : raw.percentiles.p75;
  if (!Number.isFinite(p75)) return null;
  return {
    p75,
    histogram: (raw.histogram ?? []).map((h) => ({ start: Number(h.start), end: h.end != null ? Number(h.end) : undefined, density: Number(h.density) })),
  };
}

function dateToIso(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export async function fetchCruxRecord(
  url: string,
  formFactor: CruxFormFactor = "PHONE",
): Promise<CruxRecord | null> {
  const key = resolveCruxKey();
  if (!key) {
    throw new ProviderError(
      PROVIDER,
      "CRUX_API_KEY not set. Enable 'Chrome UX Report API' in Google Cloud and set CRUX_API_KEY (or reuse GOOGLE_API_KEY).",
    );
  }

  const cacheKey = `${PROVIDER}:${formFactor}:${url}`;
  const cached = cacheGet<CruxRecord | null>(cacheKey);
  if (cached !== undefined) return cached;

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "CrUX rate limit reached (25k/day)");
  }

  const body: Record<string, unknown> = {
    url,
    metrics: [...METRICS],
  };
  if (formFactor !== "ALL_FORM_FACTORS") body.formFactor = formFactor;

  const res = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404) {
    cacheSet(cacheKey, null, TTL_MS);
    return null;
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new ProviderError(PROVIDER, `CrUX API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as ApiResponse;
  const rec = data.record;
  if (!rec?.metrics) {
    cacheSet(cacheKey, null, TTL_MS);
    return null;
  }

  const period = rec.collectionPeriod
    ? { firstDate: dateToIso(rec.collectionPeriod.firstDate), lastDate: dateToIso(rec.collectionPeriod.lastDate) }
    : { firstDate: "", lastDate: "" };

  const wrap = (key: (typeof METRICS)[number], note: string) =>
    dp(toMetric(rec.metrics?.[key]), PROVIDER, "high", TTL_MS, note);

  const record: CruxRecord = {
    url,
    formFactor,
    collectionPeriod: period,
    lcp: wrap("largest_contentful_paint", "Largest Contentful Paint (ms) — good ≤2500"),
    inp: wrap("interaction_to_next_paint", "Interaction to Next Paint (ms) — good ≤200"),
    cls: wrap("cumulative_layout_shift", "Cumulative Layout Shift — good ≤0.1"),
    fcp: wrap("first_contentful_paint", "First Contentful Paint (ms) — good ≤1800"),
    ttfb: wrap("experimental_time_to_first_byte", "Time to First Byte (ms) — good ≤800"),
  };

  cacheSet(cacheKey, record, TTL_MS);
  return record;
}

/** Rating a p75 value against Google's thresholds. */
export function rateMetric(metric: "lcp" | "inp" | "cls" | "fcp" | "ttfb", p75: number): "good" | "needs-improvement" | "poor" {
  const thresholds = {
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
    fcp: [1800, 3000],
    ttfb: [800, 1800],
  } as const;
  const [good, poor] = thresholds[metric];
  if (p75 <= good) return "good";
  if (p75 <= poor) return "needs-improvement";
  return "poor";
}
