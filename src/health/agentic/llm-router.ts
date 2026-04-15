/**
 * LLM Router — Local Ollama only.
 *
 * Remote providers were removed to eliminate paid-API quota dependencies.
 * Every LLM call in the system now routes to a local Ollama instance.
 *
 * Still exports the same surface (routeLlm, routeLlmJson, getRouterStats) so
 * callers don't need to change. The `provider` field is kept for backwards
 * compatibility but will always be "ollama".
 */

// ── Provider config ──────────────────────────────────────────────────────────

const OLLAMA_MODEL = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
const REQUEST_TIMEOUT_MS = 60_000;   // local models can be slower than cloud
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface LlmResponse {
  text: string;
  provider: "ollama";
  model: string;
  latencyMs: number;
  /** Always false — kept for interface compatibility with the old remote→Ollama router. */
  fromFallback: boolean;
}

export interface LlmRouterStats {
  /** Remote-provider metrics. Always zeroed today — router is Ollama-only, slot kept for legacy UIs. */
  remote: { requests: number; failures: number; avgLatencyMs: number; circuitOpen: boolean };
  ollama: { requests: number; failures: number; avgLatencyMs: number; available: boolean };
  totalRequests: number;
}

// ── Runtime state ────────────────────────────────────────────────────────────

let ollamaTotalRequests = 0;
let ollamaTotalFailures = 0;
let ollamaTotalLatency = 0;
let ollamaAvailable: boolean | null = null;
let lastHealthCheckAt = 0;
const HEALTH_RECHECK_MS = 30_000;

// ── Ollama health check ──────────────────────────────────────────────────────

export async function checkOllamaAvailable(force = false): Promise<boolean> {
  if (!force && ollamaAvailable !== null && Date.now() - lastHealthCheckAt < HEALTH_RECHECK_MS) {
    return ollamaAvailable;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    lastHealthCheckAt = Date.now();
    if (!res.ok) {
      ollamaAvailable = false;
      return false;
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models ?? [];
    const baseName = OLLAMA_MODEL.split(":")[0]!;
    ollamaAvailable = models.some((m) => m.name.includes(baseName));
    return ollamaAvailable;
  } catch {
    lastHealthCheckAt = Date.now();
    ollamaAvailable = false;
    return false;
  }
}

// ── Ollama call ──────────────────────────────────────────────────────────────

async function callOllama(prompt: string, jsonMode: boolean): Promise<{ text: string; model: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: jsonMode ? 0.1 : 0.4 },
    };
    if (jsonMode) body.format = "json";

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
    }
    const data = (await res.json()) as { response?: string };
    const text = data.response?.trim();
    if (!text) throw new Error("Ollama returned empty response");
    return { text, model: OLLAMA_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main router ──────────────────────────────────────────────────────────────

export async function routeLlm(
  prompt: string,
  options?: { preferOllama?: boolean; jsonMode?: boolean },
): Promise<LlmResponse> {
  if (ollamaAvailable === null) await checkOllamaAvailable();
  if (!ollamaAvailable) {
    // Give it one more chance — Ollama may have just been started
    await checkOllamaAvailable(true);
  }
  if (!ollamaAvailable) {
    throw new Error(
      `Ollama not available at ${OLLAMA_BASE}. Start Ollama and pull the '${OLLAMA_MODEL}' model (ollama pull ${OLLAMA_MODEL}).`,
    );
  }

  const jsonMode = options?.jsonMode === true;
  const t0 = Date.now();
  ollamaTotalRequests++;
  try {
    const result = await callOllama(prompt, jsonMode);
    const latency = Date.now() - t0;
    ollamaTotalLatency += latency;
    return {
      text: result.text,
      provider: "ollama",
      model: result.model,
      latencyMs: latency,
      fromFallback: false,
    };
  } catch (e) {
    ollamaTotalFailures++;
    throw e;
  }
}

// ── Structured JSON generation ───────────────────────────────────────────────

export async function routeLlmJson<T>(
  prompt: string,
  options?: { preferOllama?: boolean },
): Promise<{ data: T; meta: Omit<LlmResponse, "text"> }> {
  const result = await routeLlm(prompt, { ...options, jsonMode: true });
  let cleaned = result.text;
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1]!;
  try {
    const data = JSON.parse(cleaned) as T;
    return {
      data,
      meta: {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        fromFallback: result.fromFallback,
      },
    };
  } catch {
    const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as T;
      return {
        data,
        meta: {
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          fromFallback: result.fromFallback,
        },
      };
    }
    throw new Error(`Ollama returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getRouterStats(): LlmRouterStats {
  const avgLatency =
    ollamaTotalRequests > 0
      ? Math.round(ollamaTotalLatency / Math.max(1, ollamaTotalRequests - ollamaTotalFailures))
      : 0;
  return {
    // Kept for interface parity — no remote-provider traffic is ever recorded.
    remote: { requests: 0, failures: 0, avgLatencyMs: 0, circuitOpen: false },
    ollama: {
      requests: ollamaTotalRequests,
      failures: ollamaTotalFailures,
      avgLatencyMs: avgLatency,
      available: ollamaAvailable ?? false,
    },
    totalRequests: ollamaTotalRequests,
  };
}

export function resetRouterStats(): void {
  ollamaTotalRequests = 0;
  ollamaTotalFailures = 0;
  ollamaTotalLatency = 0;
}
