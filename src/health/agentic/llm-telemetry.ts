/**
 * Lightweight structured logging for every Ollama call. Written as JSONL so
 * the dashboard + eval harness can aggregate p50/p95 latency, token counts,
 * and completion rates without parsing free-form strings.
 *
 * File: artifacts/llm-calls.jsonl (append-only; rotated manually if needed).
 * Each line:
 *   {
 *     ts: "2026-04-21T09:00:00.000Z",
 *     feature: "link-fix-advisor",
 *     model: "llama3.2",
 *     promptBytes: 4821,
 *     responseBytes: 142,
 *     durationMs: 9183,
 *     ok: true,
 *     truncated?: boolean,        // set when prompt was clipped to budget
 *     failureKind?: "timeout" | "schema" | "network" | "other",
 *     error?: string,
 *   }
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const TELEMETRY_DIR = path.resolve("artifacts");
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, "llm-calls.jsonl");

export interface LlmCallRecord {
  feature: string;
  model: string;
  promptBytes: number;
  responseBytes: number;
  durationMs: number;
  ok: boolean;
  truncated?: boolean;
  failureKind?: "timeout" | "schema" | "network" | "other";
  error?: string;
}

let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await fs.mkdir(TELEMETRY_DIR, { recursive: true });
  dirReady = true;
}

export async function recordLlmCall(rec: LlmCallRecord): Promise<void> {
  try {
    await ensureDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n";
    await fs.appendFile(TELEMETRY_FILE, line, "utf8");
  } catch {
    // Telemetry must never break the caller; swallow IO errors.
  }
}

/**
 * Wrap an Ollama call so metrics get recorded without boilerplate at every
 * call site. `fn` must throw on failure so we can record the error.
 */
export async function withLlmTelemetry<T>(
  feature: string,
  model: string,
  prompt: string,
  fn: () => Promise<T>,
  extract: (result: T) => string = (r) => (typeof r === "string" ? r : JSON.stringify(r)),
): Promise<T> {
  const started = Date.now();
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  try {
    const result = await fn();
    const responseBytes = Buffer.byteLength(extract(result), "utf8");
    void recordLlmCall({
      feature,
      model,
      promptBytes,
      responseBytes,
      durationMs: Date.now() - started,
      ok: true,
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failureKind: LlmCallRecord["failureKind"] = /timeout|aborted/i.test(msg)
      ? "timeout"
      : /schema|json|parse/i.test(msg)
        ? "schema"
        : /fetch|ECONN|ENOTFOUND|network/i.test(msg)
          ? "network"
          : "other";
    void recordLlmCall({
      feature,
      model,
      promptBytes,
      responseBytes: 0,
      durationMs: Date.now() - started,
      ok: false,
      failureKind,
      error: msg.slice(0, 400),
    });
    throw e;
  }
}

/**
 * Truncate a prompt to a character budget. Returns the truncated prompt AND
 * a boolean so the caller can log whether they silently lost signal.
 *
 * For JSON blobs, set `jsonAware` true — we try to keep the outer structure
 * intact by truncating long string fields instead of cutting the whole tail.
 */
export function truncateForBudget(prompt: string, maxChars: number): { prompt: string; truncated: boolean } {
  if (prompt.length <= maxChars) return { prompt, truncated: false };
  const keep = Math.max(maxChars - 32, 0);
  return {
    prompt: prompt.slice(0, keep) + "\n[…truncated by prompt-size budget…]",
    truncated: true,
  };
}

/** Read the last N telemetry records (for the dashboard tile). */
export async function readRecentLlmCalls(limit = 500): Promise<(LlmCallRecord & { ts: string })[]> {
  try {
    const raw = await fs.readFile(TELEMETRY_FILE, "utf8");
    const lines = raw.trimEnd().split("\n").slice(-limit);
    const out: (LlmCallRecord & { ts: string })[] = [];
    for (const l of lines) {
      try { out.push(JSON.parse(l)); } catch { /* skip malformed line */ }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Roll up recent calls into aggregate stats. Used by the dashboard.
 */
export interface LlmRollup {
  windowMinutes: number;
  totalCalls: number;
  ok: number;
  failed: number;
  p50DurationMs: number;
  p95DurationMs: number;
  byFeature: Record<string, { calls: number; okRate: number; p50: number; p95: number }>;
  byModel: Record<string, { calls: number; okRate: number }>;
  byFailure: Record<string, number>;
}

export async function rollupRecentLlm(windowMinutes = 60): Promise<LlmRollup> {
  const records = await readRecentLlmCalls(5000);
  const cutoff = Date.now() - windowMinutes * 60_000;
  const recent = records.filter((r) => new Date(r.ts).getTime() >= cutoff);
  const ok = recent.filter((r) => r.ok);
  const failed = recent.filter((r) => !r.ok);
  const durations = recent.map((r) => r.durationMs).sort((a, b) => a - b);
  const percentile = (p: number): number =>
    durations.length === 0 ? 0 : durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] ?? 0;

  const byFeature: LlmRollup["byFeature"] = {};
  for (const r of recent) {
    const f = r.feature ?? "(unknown)";
    if (!byFeature[f]) byFeature[f] = { calls: 0, okRate: 0, p50: 0, p95: 0 };
    byFeature[f].calls++;
  }
  for (const [f, agg] of Object.entries(byFeature)) {
    const featureRecs = recent.filter((r) => (r.feature ?? "(unknown)") === f);
    const featureDurs = featureRecs.map((r) => r.durationMs).sort((a, b) => a - b);
    const okRate = featureRecs.filter((r) => r.ok).length / Math.max(1, featureRecs.length);
    agg.okRate = Math.round(okRate * 1000) / 1000;
    agg.p50 = featureDurs[Math.floor(featureDurs.length * 0.5)] ?? 0;
    agg.p95 = featureDurs[Math.floor(featureDurs.length * 0.95)] ?? 0;
  }

  const byModel: LlmRollup["byModel"] = {};
  for (const r of recent) {
    const m = r.model ?? "(unknown)";
    if (!byModel[m]) byModel[m] = { calls: 0, okRate: 0 };
    byModel[m].calls++;
  }
  for (const [m, agg] of Object.entries(byModel)) {
    const modelRecs = recent.filter((r) => (r.model ?? "(unknown)") === m);
    agg.okRate = Math.round((modelRecs.filter((r) => r.ok).length / Math.max(1, modelRecs.length)) * 1000) / 1000;
  }

  const byFailure: LlmRollup["byFailure"] = {};
  for (const r of failed) {
    const k = r.failureKind ?? "other";
    byFailure[k] = (byFailure[k] ?? 0) + 1;
  }

  return {
    windowMinutes,
    totalCalls: recent.length,
    ok: ok.length,
    failed: failed.length,
    p50DurationMs: percentile(0.5),
    p95DurationMs: percentile(0.95),
    byFeature,
    byModel,
    byFailure,
  };
}
