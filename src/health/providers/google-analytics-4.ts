/**
 * Google Analytics 4 provider.
 *
 * For the user's own GA4 properties this returns REAL traffic metrics:
 * sessions, active users, engaged sessions, average engagement time,
 * bounce rate, and per-page screenPageViews. All first-party measurements
 * from Google's own analytics pipeline — no estimation, no LLM.
 *
 * Every numeric field is wrapped in DataPoint<number> with source
 * "google-analytics-4" and confidence "high".
 *
 * Endpoints used:
 *   GET  https://analyticsadmin.googleapis.com/v1beta/accountSummaries
 *        (list properties the user has access to)
 *   POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:runReport
 *        (dimensions + metrics query)
 *
 * Scope: https://www.googleapis.com/auth/analytics.readonly
 *
 * All calls go through `googleApiFetch()` which handles token refresh.
 */

import { googleApiFetch } from "./google-auth.js";
import { dp, type DataPoint } from "./types.js";
import { cacheGet, cacheSet } from "./rate-limit.js";

const PROVIDER = "google-analytics-4";
const TTL_MS = 10 * 60 * 1000;

export interface Ga4Property {
  propertyId: string;
  displayName: string;
  parentAccount: string;
}

interface AccountSummariesResponse {
  accountSummaries?: {
    account: string;
    displayName: string;
    propertySummaries?: {
      property: string; // "properties/123456"
      displayName: string;
      propertyType?: string;
    }[];
  }[];
}

/**
 * List every GA4 property the authenticated user has access to.
 */
export async function listGa4Properties(): Promise<Ga4Property[]> {
  const cacheKey = `${PROVIDER}:properties`;
  const cached = cacheGet<Ga4Property[]>(cacheKey);
  if (cached) return cached;

  const data = await googleApiFetch<AccountSummariesResponse>(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
  );
  const props: Ga4Property[] = [];
  for (const acct of data.accountSummaries ?? []) {
    for (const p of acct.propertySummaries ?? []) {
      // Only include GA4 properties, not legacy UA
      if (p.propertyType && p.propertyType !== "PROPERTY_TYPE_ORDINARY") continue;
      const id = p.property.replace(/^properties\//, "");
      props.push({
        propertyId: id,
        displayName: p.displayName,
        parentAccount: acct.displayName,
      });
    }
  }
  cacheSet(cacheKey, props, TTL_MS);
  return props;
}

export interface Ga4ReportRow {
  dimensions: string[];
  metrics: Record<string, DataPoint<number>>;
}

export interface Ga4ReportOptions {
  propertyId: string;
  /** ISO date YYYY-MM-DD, `Ndaysago`, `today`, or `yesterday`. */
  startDate?: string;
  endDate?: string;
  dimensions?: string[];
  metrics?: string[];
  limit?: number;
  orderByMetric?: string;
  orderDesc?: boolean;
  filterPagePath?: string;
}

interface RawRunReportResponse {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  totals?: { metricValues: { value: string }[] }[];
  rowCount?: number;
}

/**
 * Run a GA4 Data API `runReport` and return every row with its metrics
 * wrapped in DataPoint. Dates default to the last 28 days (excluding today
 * since same-day data is still processing on Google's side).
 */
export async function runGa4Report(opts: Ga4ReportOptions): Promise<Ga4ReportRow[]> {
  const startDate = opts.startDate ?? "28daysAgo";
  const endDate = opts.endDate ?? "yesterday";
  const dimensions = opts.dimensions ?? ["pagePath"];
  const metrics = opts.metrics ?? ["screenPageViews", "activeUsers", "sessions"];
  const limit = Math.min(opts.limit ?? 100, 10000);

  const cacheKey = `${PROVIDER}:r:${opts.propertyId}:${startDate}:${endDate}:${dimensions.join(",")}:${metrics.join(",")}:${opts.filterPagePath ?? ""}:${limit}`;
  const cached = cacheGet<Ga4ReportRow[]>(cacheKey);
  if (cached) return cached;

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate, endDate }],
    dimensions: dimensions.map((n) => ({ name: n })),
    metrics: metrics.map((n) => ({ name: n })),
    limit,
  };
  if (opts.orderByMetric) {
    body.orderBys = [
      {
        metric: { metricName: opts.orderByMetric },
        desc: opts.orderDesc !== false,
      },
    ];
  }
  if (opts.filterPagePath) {
    body.dimensionFilter = {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "EXACT", value: opts.filterPagePath },
      },
    };
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(opts.propertyId)}:runReport`;
  const data = await googleApiFetch<RawRunReportResponse>(url, { method: "POST", body });

  const note = `GA4 · ${startDate} → ${endDate} · first-party`;
  const metricNames = (data.metricHeaders ?? []).map((h) => h.name);
  const rows: Ga4ReportRow[] = (data.rows ?? []).map((r) => {
    const dims = (r.dimensionValues ?? []).map((d) => d.value);
    const met: Record<string, DataPoint<number>> = {};
    (r.metricValues ?? []).forEach((v, i) => {
      const name = metricNames[i] ?? `metric${i}`;
      const n = Number(v.value);
      met[name] = dp<number>(Number.isFinite(n) ? n : 0, PROVIDER, "high", TTL_MS, note);
    });
    return { dimensions: dims, metrics: met };
  });
  cacheSet(cacheKey, rows, TTL_MS);
  return rows;
}

export interface Ga4PageTraffic {
  propertyId: string;
  page: string;
  screenPageViews: DataPoint<number>;
  activeUsers: DataPoint<number>;
  sessions: DataPoint<number>;
  averageSessionDuration: DataPoint<number>;
  bounceRate: DataPoint<number>;
  asOf: string;
}

/**
 * Look up real GA4 page traffic for a specific pagePath. Used by Content
 * Audit to overlay real sessions/users on top of the deterministic
 * quality score.
 */
export async function getGa4PageTraffic(
  propertyId: string,
  pagePath: string,
  daysBack = 28,
): Promise<Ga4PageTraffic | null> {
  const clean = pagePath.trim();
  if (!clean) return null;
  const rows = await runGa4Report({
    propertyId,
    startDate: `${daysBack}daysAgo`,
    endDate: "yesterday",
    dimensions: ["pagePath"],
    metrics: ["screenPageViews", "activeUsers", "sessions", "averageSessionDuration", "bounceRate"],
    filterPagePath: clean,
    limit: 1,
  });
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    propertyId,
    page: r.dimensions[0] ?? clean,
    screenPageViews: r.metrics.screenPageViews ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    activeUsers: r.metrics.activeUsers ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    sessions: r.metrics.sessions ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    averageSessionDuration: r.metrics.averageSessionDuration ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    bounceRate: r.metrics.bounceRate ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    asOf: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Batch version — one runReport call returns a map of pagePath → traffic
 * metrics. Used by Content Audit so we don't round-trip N times.
 */
export async function getGa4PageTrafficBatch(
  propertyId: string,
  daysBack = 28,
  limit = 500,
): Promise<Map<string, Ga4PageTraffic>> {
  const rows = await runGa4Report({
    propertyId,
    startDate: `${daysBack}daysAgo`,
    endDate: "yesterday",
    dimensions: ["pagePath"],
    metrics: ["screenPageViews", "activeUsers", "sessions", "averageSessionDuration", "bounceRate"],
    orderByMetric: "screenPageViews",
    orderDesc: true,
    limit,
  });
  const map = new Map<string, Ga4PageTraffic>();
  const asOf = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    const page = r.dimensions[0];
    if (!page) continue;
    map.set(page, {
      propertyId,
      page,
      screenPageViews: r.metrics.screenPageViews ?? dp<number>(0, PROVIDER, "high", TTL_MS),
      activeUsers: r.metrics.activeUsers ?? dp<number>(0, PROVIDER, "high", TTL_MS),
      sessions: r.metrics.sessions ?? dp<number>(0, PROVIDER, "high", TTL_MS),
      averageSessionDuration: r.metrics.averageSessionDuration ?? dp<number>(0, PROVIDER, "high", TTL_MS),
      bounceRate: r.metrics.bounceRate ?? dp<number>(0, PROVIDER, "high", TTL_MS),
      asOf,
    });
  }
  return map;
}

export interface Ga4PropertyTotals {
  propertyId: string;
  activeUsers: DataPoint<number>;
  sessions: DataPoint<number>;
  screenPageViews: DataPoint<number>;
  averageSessionDuration: DataPoint<number>;
  bounceRate: DataPoint<number>;
  asOf: string;
}

/**
 * Site-wide totals for the property over the last N days. Useful for
 * showing "your site has X real users last 28 days" next to the DDG
 * scrape estimates on Traffic Analytics / Domain Overview.
 */
export async function getGa4PropertyTotals(
  propertyId: string,
  daysBack = 28,
): Promise<Ga4PropertyTotals | null> {
  const rows = await runGa4Report({
    propertyId,
    startDate: `${daysBack}daysAgo`,
    endDate: "yesterday",
    dimensions: [], // no grouping — single row of totals
    metrics: ["activeUsers", "sessions", "screenPageViews", "averageSessionDuration", "bounceRate"],
    limit: 1,
  });
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    propertyId,
    activeUsers: r.metrics.activeUsers ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    sessions: r.metrics.sessions ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    screenPageViews: r.metrics.screenPageViews ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    averageSessionDuration: r.metrics.averageSessionDuration ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    bounceRate: r.metrics.bounceRate ?? dp<number>(0, PROVIDER, "high", TTL_MS),
    asOf: new Date().toISOString().slice(0, 10),
  };
}
