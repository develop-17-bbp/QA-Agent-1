/**
 * Shared types for real-data providers.
 *
 * Every provider returns values wrapped in `DataPoint<T>` so the rest of the
 * system can track where a number came from and how much to trust it. The LLM
 * receives real DataPoints as context and is strictly instructed never to
 * invent numbers — if a field has no DataPoint, it is reported as missing,
 * not guessed.
 */

export type Confidence = "high" | "medium" | "low";

export interface DataPoint<T> {
  /** The actual value. */
  value: T;
  /** Which provider produced this value (e.g. "google-trends"). */
  source: string;
  /**
   * How much to trust the value.
   * - "high":   directly measured by a first-party signal (e.g. Bing Webmaster volume, Cloudflare Radar rank).
   * - "medium": derived from a proxy indicator (e.g. Google Trends relative volume calibrated against a known anchor).
   * - "low":    approximate / sparse / small sample.
   */
  confidence: Confidence;
  /** ISO timestamp of when this data point was fetched. */
  fetchedAt: string;
  /** How long callers should cache this value, in ms. */
  ttlMs: number;
  /** Optional note explaining the value or its limits. */
  note?: string;
}

export function dp<T>(
  value: T,
  source: string,
  confidence: Confidence,
  ttlMs: number,
  note?: string,
): DataPoint<T> {
  return { value, source, confidence, fetchedAt: new Date().toISOString(), ttlMs, note };
}

/**
 * An aggregated result for keyword research, with each numeric field wrapped
 * in its own DataPoint so the UI can show per-field confidence badges and
 * sources.
 */
export interface KeywordRealData {
  keyword: string;
  relativeVolume?: DataPoint<number>;       // Google Trends 0-100
  estimatedVolume?: DataPoint<number>;      // calibrated monthly search estimate
  trend12mo?: DataPoint<{ month: string; value: number }[]>;
  relatedQueries?: DataPoint<string[]>;
  autocompleteSuggestions?: DataPoint<string[]>;
  topicPageviews?: DataPoint<number>;       // Wikipedia monthly pageviews
  intent?: DataPoint<"informational" | "commercial" | "navigational" | "transactional">;
  historicalSerps?: DataPoint<{ capturedAt: string; url: string }[]>;
  missingFields: string[];                  // fields we could not populate
  providersHit: string[];                   // providers that responded with data
  providersFailed: string[];                // providers that errored or returned nothing
}

export interface BacklinkRealData {
  domain: string;
  referringDomains?: DataPoint<number>;
  inboundLinks?: DataPoint<number>;
  domainAuthority?: DataPoint<number>;      // OpenPageRank 0-10 → 0-100
  sampleBacklinks?: DataPoint<{ fromUrl: string; anchor?: string; firstSeen?: string }[]>;
  historicalSnapshots?: DataPoint<{ timestamp: string; count: number }[]>;
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
}

export interface TrafficRealData {
  domain: string;
  trancoRank?: DataPoint<number>;           // 1..1_000_000
  globalPercentile?: DataPoint<number>;     // 0..100 of all ranked domains
  cloudflareRadarRank?: DataPoint<number>;
  domainAuthority?: DataPoint<number>;
  monthlyEstimate?: DataPoint<string>;      // e.g. "1M-5M", "100K-500K"
  topCountries?: DataPoint<{ country: string; share: number }[]>;
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
}

/** Error thrown when a provider cannot be reached. Callers should catch and degrade gracefully. */
export class ProviderError extends Error {
  constructor(public readonly provider: string, message: string, public readonly cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
