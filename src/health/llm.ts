/**
 * Unified LLM adapter — single import point for all modules.
 *
 * Wraps the agentic LLM router (Gemini → Ollama fallback with circuit breaker)
 * with response caching. Drop-in replacement for `generateGeminiText()`.
 *
 * Usage:
 *   import { generateText } from "../llm.js";
 *   const result = await generateText(prompt);
 */

import { routeLlm, routeLlmJson, type LlmResponse } from "./agentic/llm-router.js";
import { LlmCache } from "./cache.js";

/**
 * Generate text via LLM (Gemini primary → Ollama fallback).
 * Cached for 15 minutes by prompt content hash.
 *
 * Drop-in replacement for `generateGeminiText()` — same signature.
 */
export async function generateText(prompt: string): Promise<string> {
  // Check cache first
  const cached = LlmCache.get(prompt);
  if (cached) return cached;

  const result = await routeLlm(prompt);
  LlmCache.set(prompt, result.text);
  return result.text;
}

/**
 * Generate text with full metadata (provider, latency, fallback status).
 * Cached for 15 minutes by prompt content hash.
 */
export async function generateTextWithMeta(prompt: string): Promise<LlmResponse> {
  const cached = LlmCache.get(prompt);
  if (cached) {
    return { text: cached, provider: "gemini", model: "cached", latencyMs: 0, fromFallback: false };
  }

  const result = await routeLlm(prompt);
  LlmCache.set(prompt, result.text);
  return result;
}

/**
 * Generate structured JSON via LLM with automatic parsing.
 * NOT cached (JSON prompts are typically unique per request context).
 */
export { routeLlmJson } from "./agentic/llm-router.js";

/**
 * Re-exports for direct access when needed (e.g., agent-coordinator).
 */
export { routeLlm, getRouterStats, checkOllamaAvailable, resetRouterStats } from "./agentic/llm-router.js";
export type { LlmResponse } from "./agentic/llm-router.js";
