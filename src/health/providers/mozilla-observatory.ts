/**
 * Mozilla Observatory — HTTPS / security header grading.
 *
 * https://developer.mozilla.org/en-US/observatory
 *
 * No auth required. POSTing to the v2 analyze endpoint triggers a fresh
 * scan for the host and returns a grade (A+ … F), a 0-135 score, and a
 * breakdown of which security tests passed / failed. Useful as a trust
 * signal on client sites.
 *
 * Rate limit is lenient but we cache per host for an hour since security
 * headers rarely change during a session.
 */

import { dp, ProviderError, type DataPoint } from "./types.js";
import { cacheGet, cacheSet, registerLimit, tryConsume } from "./rate-limit.js";

const PROVIDER = "mozilla-observatory";
registerLimit(PROVIDER, 200, 60 * 60 * 1000);
const TTL_MS = 60 * 60 * 1000;

type Grade = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "D-" | "F";

export interface SecurityGradeResult {
  host: string;
  grade: DataPoint<Grade | null>;
  score: DataPoint<number | null>;
  testsPassed: DataPoint<number>;
  testsFailed: DataPoint<number>;
  failedTests: DataPoint<{ name: string; expectation: string; result: string; scoreModifier: number }[]>;
  scanUrl: DataPoint<string>;
  details: {
    contentSecurityPolicy: boolean;
    httpStrictTransportSecurity: boolean;
    xContentTypeOptions: boolean;
    xFrameOptions: boolean;
    referrerPolicy: boolean;
    subresourceIntegrity: boolean;
  };
}

type AnalyzeResponse = {
  grade?: string;
  score?: number;
  tests_failed?: number;
  tests_passed?: number;
  tests_quantity?: number;
  details_url?: string;
  tests?: Record<string, { name: string; expectation?: string; result?: string; score_modifier?: number; pass?: boolean }>;
};

function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function isGrade(g: unknown): g is Grade {
  return typeof g === "string" && /^(A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F)$/.test(g);
}

export async function fetchSecurityGrade(domain: string): Promise<SecurityGradeResult> {
  const host = normalizeHost(domain);
  if (!host) throw new ProviderError(PROVIDER, "Empty host");

  const cacheKey = `${PROVIDER}:${host}`;
  const cached = cacheGet<SecurityGradeResult>(cacheKey);
  if (cached) return cached;

  if (!tryConsume(PROVIDER)) {
    throw new ProviderError(PROVIDER, "Rate limit exhausted (200/hour)");
  }

  const res = await fetch(`https://observatory-api.mdn.mozilla.net/api/v2/analyze?host=${encodeURIComponent(host)}`, {
    method: "POST",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new ProviderError(PROVIDER, `Observatory ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as AnalyzeResponse;
  const grade = isGrade(data.grade) ? data.grade : null;
  const tests = data.tests ?? {};
  const failedTests = Object.values(tests)
    .filter((t) => t && t.pass === false)
    .map((t) => ({
      name: t.name ?? "unknown",
      expectation: t.expectation ?? "",
      result: t.result ?? "",
      scoreModifier: typeof t.score_modifier === "number" ? t.score_modifier : 0,
    }));

  const testPresent = (key: string): boolean => {
    const t = tests[key];
    return !!t && t.pass !== false;
  };

  const result: SecurityGradeResult = {
    host,
    grade: dp(grade, PROVIDER, "high", TTL_MS, "A+ (best) … F (worst)"),
    score: dp(typeof data.score === "number" ? data.score : null, PROVIDER, "high", TTL_MS, "0-135 scale"),
    testsPassed: dp(typeof data.tests_passed === "number" ? data.tests_passed : 0, PROVIDER, "high", TTL_MS),
    testsFailed: dp(typeof data.tests_failed === "number" ? data.tests_failed : failedTests.length, PROVIDER, "high", TTL_MS),
    failedTests: dp(failedTests, PROVIDER, "high", TTL_MS, "Each failed header test with its negative score impact"),
    scanUrl: dp(data.details_url ?? `https://developer.mozilla.org/en-US/observatory/analyze?host=${encodeURIComponent(host)}`, PROVIDER, "high", TTL_MS),
    details: {
      contentSecurityPolicy: testPresent("content-security-policy"),
      httpStrictTransportSecurity: testPresent("strict-transport-security"),
      xContentTypeOptions: testPresent("x-content-type-options"),
      xFrameOptions: testPresent("x-frame-options"),
      referrerPolicy: testPresent("referrer-policy"),
      subresourceIntegrity: testPresent("subresource-integrity"),
    },
  };

  cacheSet(cacheKey, result, TTL_MS);
  return result;
}

/** Convenience — always returns SOMETHING, never throws. Use when the caller wants graceful null. */
export async function fetchSecurityGradeSafe(domain: string): Promise<SecurityGradeResult | null> {
  try { return await fetchSecurityGrade(domain); } catch { return null; }
}
