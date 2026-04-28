/**
 * SPA Render Fallback — when an HTTP fetch returns a near-empty
 * document (typical SPA shell: <div id="root"></div>, no real
 * content), retry the fetch with a real Chromium browser so the
 * crawler captures the post-hydration HTML.
 *
 * Closes the "we miss content on Next/React/Vue/Angular sites" gap.
 *
 * Design:
 *   - Off by default. Opt-in via crawl-site option `headlessFallback: true`
 *     OR env QA_AGENT_HEADLESS_FALLBACK=1.
 *   - Triggered ONLY when the static fetch returned < BODY_THRESHOLD
 *     chars of <body> text OR matched a detectable SPA-shell pattern.
 *     This keeps the cost off the 95% of pages that already render fine.
 *   - Reuses the existing Playwright dependency (already used by
 *     viewport-check, screenshot, form-tests, startpage-serp).
 *   - Fully bounded: per-page cap (RENDER_TIMEOUT_MS) AND a global
 *     concurrency cap so a 1000-page SPA doesn't spawn 1000 browsers.
 *   - Telemetry: every fallback writes a one-line entry to
 *     artifacts/spa-renders.jsonl so operators can see what got retried.
 *
 * The shared Chromium browser is launched lazily on first call and
 * reused across the whole run; each fetch gets its own context for
 * isolation. Cleanup runs at process exit.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext } from "playwright";

const BODY_THRESHOLD = 500;
const RENDER_TIMEOUT_MS = 15_000;
const RENDER_LOG = path.join(process.cwd(), "artifacts", "spa-renders.jsonl");
const MAX_CONCURRENT = 3;

let _browser: Browser | null = null;
let _browserPromise: Promise<Browser> | null = null;
let _inflight = 0;
let _exitHooked = false;

async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser;
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    if (!_exitHooked) {
      _exitHooked = true;
      const cleanup = () => { _browser?.close().catch(() => {}); _browser = null; };
      process.once("exit", cleanup);
      process.once("SIGINT", () => { cleanup(); process.exit(130); });
      process.once("SIGTERM", () => { cleanup(); process.exit(143); });
    }
    _browser = b;
    return b;
  })();
  return _browserPromise;
}

async function logRender(entry: { url: string; trigger: string; renderedBytes: number; durationMs: number; ok: boolean; error?: string }): Promise<void> {
  try {
    await fs.mkdir(path.dirname(RENDER_LOG), { recursive: true });
    await fs.appendFile(RENDER_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch { /* non-fatal */ }
}

/** Return true when the given fetched body looks like an unrendered SPA
 *  shell — almost no <body> text and one of the recognizable framework
 *  hydration mounts. Cheap regex; no DOM parse. */
export function looksLikeSpaShell(html: string): boolean {
  if (!html) return true;
  // Strip script/style + tags to estimate visible text.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= BODY_THRESHOLD) return false;
  // Hydration mount detectors — Next.js, React CRA, Vue, Angular, Astro, Svelte.
  return (
    /<div\s+id=["']root["']/i.test(html) ||
    /<div\s+id=["']__next["']/i.test(html) ||
    /<div\s+id=["']app["']/i.test(html) ||
    /<app-root/i.test(html) ||
    /__nextjs_/i.test(html) ||
    /_astro/i.test(html) ||
    /sveltekit:body/i.test(html) ||
    /<script[^>]*src=["'][^"']*\/_next\//i.test(html) ||
    /react-dom/i.test(html) ||
    /window\.__NUXT__/.test(html)
  );
}

/** Render a URL via headless Chromium. Returns the post-hydration HTML
 *  + a few cheap signals callers care about. Throws on hard failure;
 *  callers should fall back to the original static body in that case. */
export async function renderWithPlaywright(url: string, opts: { timeoutMs?: number } = {}): Promise<{ html: string; status: number; durationMs: number }> {
  const timeoutMs = Math.max(3_000, Math.min(opts.timeoutMs ?? RENDER_TIMEOUT_MS, 30_000));
  // Cooperative concurrency limiter — block if too many SPA renders in flight.
  while (_inflight >= MAX_CONCURRENT) {
    await new Promise((r) => setTimeout(r, 100));
  }
  _inflight++;
  const started = Date.now();
  let context: BrowserContext | null = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (compatible; QA-Agent-SPA/1.0; +https://github.com/qa-agent)",
    });
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    const status = resp?.status() ?? 0;
    // Wait briefly for first contentful paint of body text.
    try {
      await page.waitForFunction(
        `() => (document.body?.innerText || "").trim().length > 200`,
        { timeout: Math.min(5_000, timeoutMs - 500) },
      );
    } catch { /* keep going — render anyway */ }
    const html = await page.content();
    const durationMs = Date.now() - started;
    void logRender({ url, trigger: "static-shell", renderedBytes: html.length, durationMs, ok: true });
    return { html, status, durationMs };
  } catch (e) {
    const durationMs = Date.now() - started;
    const error = e instanceof Error ? e.message.slice(0, 200) : "render failed";
    void logRender({ url, trigger: "static-shell", renderedBytes: 0, durationMs, ok: false, error });
    throw e;
  } finally {
    if (context) await context.close().catch(() => {});
    _inflight--;
  }
}

/** Convenience helper for the crawler: try the fetched static body
 *  first; if it looks like an SPA shell AND the caller opted in to
 *  fallback, render with Playwright and return that body instead.
 *  Returns the body to use + a flag so the crawler can record which
 *  pages got upgraded. */
export async function renderIfShell(url: string, staticHtml: string, enabled: boolean): Promise<{ html: string; rendered: boolean }> {
  if (!enabled) return { html: staticHtml, rendered: false };
  if (!looksLikeSpaShell(staticHtml)) return { html: staticHtml, rendered: false };
  try {
    const { html } = await renderWithPlaywright(url);
    return { html, rendered: true };
  } catch {
    // Hard render failure → fall back to the original body. Logged by renderWithPlaywright.
    return { html: staticHtml, rendered: false };
  }
}

/** Manual close hook for tests / scripts that want to release the
 *  browser before the process exits. */
export async function closeSpaRenderBrowser(): Promise<void> {
  const b = _browser;
  _browser = null;
  _browserPromise = null;
  if (b) await b.close().catch(() => {});
}
