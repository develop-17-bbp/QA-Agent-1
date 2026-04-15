/**
 * Unified LLM adapter — single import point for all modules.
 *
 * Routes every call to a local Ollama instance. Gemini has been removed to
 * eliminate paid-API quota dependencies. Responses are cached for 15 minutes
 * by prompt content hash.
 *
 * Usage:
 *   import { generateText } from "../llm.js";
 *   const result = await generateText(prompt);
 */

import { routeLlm, routeLlmJson, type LlmResponse } from "./agentic/llm-router.js";
import { LlmCache } from "./cache.js";

/**
 * Generate text via local Ollama. Cached for 15 minutes by prompt hash.
 */
export async function generateText(prompt: string): Promise<string> {
  const cached = LlmCache.get(prompt);
  if (cached) return cached;

  const result = await routeLlm(prompt);
  LlmCache.set(prompt, result.text);
  return result.text;
}

/**
 * Generate text with full metadata (model name, latency).
 */
export async function generateTextWithMeta(prompt: string): Promise<LlmResponse> {
  const cached = LlmCache.get(prompt);
  if (cached) {
    return { text: cached, provider: "ollama", model: "cached", latencyMs: 0, fromFallback: false };
  }
  const result = await routeLlm(prompt);
  LlmCache.set(prompt, result.text);
  return result;
}

/**
 * Generate structured JSON via local Ollama with automatic parsing.
 * NOT cached — JSON prompts are usually unique per request context.
 */
export { routeLlmJson } from "./agentic/llm-router.js";

export {
  routeLlm,
  getRouterStats,
  checkOllamaAvailable,
  resetRouterStats,
} from "./agentic/llm-router.js";
export type { LlmResponse } from "./agentic/llm-router.js";
