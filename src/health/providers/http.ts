/**
 * Shared HTTP helper for providers.
 *
 * - Per-request timeout via AbortController
 * - Retries once on transient network errors / 5xx
 * - Friendly User-Agent so free endpoints don't block us
 * - Returns `undefined` on failure so callers can degrade gracefully
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_UA = "QA-Agent-SEO/1.0 (+https://github.com/develop-17-bbp/QA-Agent; contact: qa-agent)";

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  retries?: number;
}

export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response | undefined> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? 1;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": DEFAULT_UA, Accept: "application/json, text/plain, */*", ...(opts.headers ?? {}) },
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await sleep(250 + Math.random() * 250);
          continue;
        }
        return res; // let caller inspect 4xx status
      }
      return res;
    } catch {
      clearTimeout(t);
      if (attempt < retries) {
        await sleep(250 + Math.random() * 250);
        continue;
      }
      return undefined;
    }
  }
  return undefined;
}

export async function httpGetJson<T>(url: string, opts?: HttpOptions): Promise<T | undefined> {
  const res = await httpGet(url, opts);
  if (!res || !res.ok) return undefined;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export async function httpGetText(url: string, opts?: HttpOptions): Promise<string | undefined> {
  const res = await httpGet(url, opts);
  if (!res || !res.ok) return undefined;
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
