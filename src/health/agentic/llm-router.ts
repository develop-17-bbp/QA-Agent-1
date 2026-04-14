/**
 * LLM Router — Gemini (primary) → Ollama Llama 3.2 (fallback)
 *
 * Circuit-breaker pattern: after N consecutive Gemini failures, routes to Ollama
 * for a cooldown period before retrying Gemini. Tracks latency for both providers.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Provider config ──────────────────────────────────────────────────────────

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-1.5-flash"];
const OLLAMA_MODEL = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";

// Circuit breaker settings
const CB_FAILURE_THRESHOLD = 3;          // consecutive failures to trip
const CB_COOLDOWN_MS = 60_000;           // 1 min cooldown before retry
const REQUEST_TIMEOUT_MS = 30_000;       // per-request timeout

// ── Types ────────────────────────────────────────────────────────────────────

export interface LlmResponse {
  text: string;
  provider: "gemini" | "ollama";
  model: string;
  latencyMs: number;
  fromFallback: boolean;
}

export interface LlmRouterStats {
  gemini: { requests: number; failures: number; avgLatencyMs: number; circuitOpen: boolean };
  ollama: { requests: number; failures: number; avgLatencyMs: number; available: boolean };
  totalRequests: number;
}

// ── Circuit breaker state ────────────────────────────────────────────────────

let geminiConsecutiveFailures = 0;
let geminiCircuitOpenedAt = 0;
let geminiTotalRequests = 0;
let geminiTotalFailures = 0;
let geminiTotalLatency = 0;
let ollamaTotalRequests = 0;
let ollamaTotalFailures = 0;
let ollamaTotalLatency = 0;
let ollamaAvailable: boolean | null = null;

function isGeminiCircuitOpen(): boolean {
  if (geminiConsecutiveFailures < CB_FAILURE_THRESHOLD) return false;
  if (Date.now() - geminiCircuitOpenedAt > CB_COOLDOWN_MS) {
    // Half-open: allow one request through
    geminiConsecutiveFailures = CB_FAILURE_THRESHOLD - 1;
    return false;
  }
  return true;
}

function resolveGeminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim();
}

// ── Ollama health check ──────────────────────────────────────────────────────

export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json() as { models?: { name: string }[] };
    const models = data.models ?? [];
    ollamaAvailable = models.some(m => m.name.includes(OLLAMA_MODEL.split(":")[0]));
    return ollamaAvailable;
  } catch {
    ollamaAvailable = false;
    return false;
  }
}

// ── Gemini call ──────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<{ text: string; model: string }> {
  const key = resolveGeminiKey();
  if (!key) throw new Error("No Gemini API key");
  const genAI = new GoogleGenerativeAI(key);

  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const modelName = GEMINI_MODELS[i]!;
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const res = await model.generateContent(prompt);
      const text = res.response.text()?.trim();
      if (!text) continue;
      return { text, model: modelName };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/503|429|404|UNAVAILABLE|RESOURCE_EXHAUSTED|not found/i.test(msg) && i < GEMINI_MODELS.length - 1) continue;
      throw e;
    }
  }
  throw new Error("All Gemini models exhausted");
}

// ── Ollama call ──────────────────────────────────────────────────────────────

async function callOllama(prompt: string): Promise<{ text: string; model: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 2);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as { response?: string };
    const text = data.response?.trim();
    if (!text) throw new Error("Ollama returned empty response");
    return { text, model: OLLAMA_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main router ──────────────────────────────────────────────────────────────

export async function routeLlm(prompt: string, options?: { preferOllama?: boolean; jsonMode?: boolean }): Promise<LlmResponse> {
  const jsonWrap = options?.jsonMode
    ? "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no explanation."
    : "";
  const fullPrompt = prompt + jsonWrap;

  const useOllamaFirst = options?.preferOllama || (!resolveGeminiKey() && ollamaAvailable !== false);

  // Try primary provider
  if (!useOllamaFirst && !isGeminiCircuitOpen()) {
    const t0 = Date.now();
    geminiTotalRequests++;
    try {
      const result = await callGemini(fullPrompt);
      const latency = Date.now() - t0;
      geminiTotalLatency += latency;
      geminiConsecutiveFailures = 0;
      return { text: result.text, provider: "gemini", model: result.model, latencyMs: latency, fromFallback: false };
    } catch {
      geminiTotalFailures++;
      geminiConsecutiveFailures++;
      if (geminiConsecutiveFailures >= CB_FAILURE_THRESHOLD) {
        geminiCircuitOpenedAt = Date.now();
      }
      // Fall through to Ollama
    }
  }

  // Fallback to Ollama
  if (ollamaAvailable === null) await checkOllamaAvailable();
  if (ollamaAvailable) {
    const t0 = Date.now();
    ollamaTotalRequests++;
    try {
      const result = await callOllama(fullPrompt);
      const latency = Date.now() - t0;
      ollamaTotalLatency += latency;
      return { text: result.text, provider: "ollama", model: result.model, latencyMs: latency, fromFallback: !useOllamaFirst };
    } catch {
      ollamaTotalFailures++;
    }
  }

  // Last resort: try Gemini even if circuit is open
  if (resolveGeminiKey()) {
    const t0 = Date.now();
    geminiTotalRequests++;
    try {
      const result = await callGemini(fullPrompt);
      const latency = Date.now() - t0;
      geminiTotalLatency += latency;
      geminiConsecutiveFailures = 0;
      return { text: result.text, provider: "gemini", model: result.model, latencyMs: latency, fromFallback: true };
    } catch (e) {
      geminiTotalFailures++;
      geminiConsecutiveFailures++;
      throw new Error(`All LLM providers failed. Gemini: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error("No LLM provider available. Set GEMINI_API_KEY or start Ollama with llama3.2.");
}

// ── Structured JSON generation ───────────────────────────────────────────────

export async function routeLlmJson<T>(prompt: string, options?: { preferOllama?: boolean }): Promise<{ data: T; meta: Omit<LlmResponse, "text"> }> {
  const result = await routeLlm(prompt, { ...options, jsonMode: true });
  let cleaned = result.text;
  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1]!;
  try {
    const data = JSON.parse(cleaned) as T;
    return { data, meta: { provider: result.provider, model: result.model, latencyMs: result.latencyMs, fromFallback: result.fromFallback } };
  } catch {
    // Try to extract JSON object/array from response
    const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as T;
      return { data, meta: { provider: result.provider, model: result.model, latencyMs: result.latencyMs, fromFallback: result.fromFallback } };
    }
    throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getRouterStats(): LlmRouterStats {
  return {
    gemini: {
      requests: geminiTotalRequests,
      failures: geminiTotalFailures,
      avgLatencyMs: geminiTotalRequests > 0 ? Math.round(geminiTotalLatency / (geminiTotalRequests - geminiTotalFailures || 1)) : 0,
      circuitOpen: isGeminiCircuitOpen(),
    },
    ollama: {
      requests: ollamaTotalRequests,
      failures: ollamaTotalFailures,
      avgLatencyMs: ollamaTotalRequests > 0 ? Math.round(ollamaTotalLatency / (ollamaTotalRequests - ollamaTotalFailures || 1)) : 0,
      available: ollamaAvailable ?? false,
    },
    totalRequests: geminiTotalRequests + ollamaTotalRequests,
  };
}

export function resetRouterStats(): void {
  geminiConsecutiveFailures = 0;
  geminiCircuitOpenedAt = 0;
  geminiTotalRequests = 0;
  geminiTotalFailures = 0;
  geminiTotalLatency = 0;
  ollamaTotalRequests = 0;
  ollamaTotalFailures = 0;
  ollamaTotalLatency = 0;
}
