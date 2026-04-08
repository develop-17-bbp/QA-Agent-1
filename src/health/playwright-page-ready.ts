import type { Page, Response } from "playwright";

export type PlaywrightWaitUntil = "load" | "domcontentloaded" | "networkidle";

/** Default is `load` (DOM + resources). Override with `QA_AGENT_SCREENSHOT_WAIT_UNTIL` (load|domcontentloaded|networkidle). */
export function resolveScreenshotWaitUntil(): PlaywrightWaitUntil {
  const v = process.env.QA_AGENT_SCREENSHOT_WAIT_UNTIL?.trim().toLowerCase();
  if (v === "domcontentloaded" || v === "networkidle" || v === "load") return v;
  return "load";
}

function contentWaitBudget(navigationTimeoutMs: number): number {
  const fromEnv = Number(process.env.QA_AGENT_SCREENSHOT_CONTENT_TIMEOUT_MS ?? "");
  if (Number.isFinite(fromEnv) && fromEnv >= 1000 && fromEnv <= 120_000) {
    return Math.min(fromEnv, Math.max(2000, navigationTimeoutMs - 500));
  }
  return Math.max(2500, Math.min(15_000, navigationTimeoutMs - 1000));
}

/**
 * Best-effort wait for webfonts so screenshots are not missing text.
 * Does not fail the capture if fonts hang.
 */
export async function waitForWebFontsBestEffort(page: Page, capMs: number): Promise<void> {
  const ms = Math.min(Math.max(500, capMs), 8000);
  try {
    await Promise.race([
      page.evaluate(`async () => {
        try {
          const d = document;
          if (d.fonts && d.fonts.ready) await d.fonts.ready;
        } catch (_) { /* ignore */ }
      }`),
      new Promise<void>((r) => setTimeout(r, ms)),
    ]);
  } catch {
    /* ignore */
  }
}

/**
 * Resolves when the document looks painted: meaningful height, text, or visible media.
 * Avoids attaching screenshots of blank shells (slow JS, errors, white screen).
 */
export async function waitForRenderableContent(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    `() => {
      const doc = document.documentElement;
      const body = document.body;
      if (!body) return false;

      const scrollH = Math.max(
        body.scrollHeight,
        doc ? doc.scrollHeight : 0,
        body.offsetHeight,
        doc ? doc.offsetHeight : 0,
      );

      const text = (body.innerText || "").replace(/\\s+/g, " ").trim();

      if (scrollH < 16 && text.length < 2) return false;

      if (text.length >= 10) return true;

      if (document.querySelector("img[src], picture source, svg, canvas, video, iframe[src]")) {
        return true;
      }

      if (scrollH >= 120) return true;

      return false;
    }`,
    { timeout: timeoutMs },
  );
}

/**
 * Navigate and ensure we do not screenshot a failed or empty view.
 * @throws Error with a short message suitable for report `error` fields.
 */
export async function preparePageForVisualCapture(
  page: Page,
  url: string,
  navigationTimeoutMs: number,
  waitUntil: PlaywrightWaitUntil,
): Promise<Response> {
  const res = await page.goto(url, {
    waitUntil,
    timeout: navigationTimeoutMs,
  });

  if (!res) {
    throw new Error("No HTTP response (navigation failed).");
  }

  const status = res.status();
  if (status >= 400) {
    throw new Error(`HTTP ${status} — page did not load successfully before capture.`);
  }

  const fontCap = Math.min(6000, Math.max(1000, Math.floor(navigationTimeoutMs / 3)));
  await waitForWebFontsBestEffort(page, fontCap);

  const contentMs = contentWaitBudget(navigationTimeoutMs);
  try {
    await waitForRenderableContent(page, contentMs);
  } catch (e) {
    const hint =
      "Timed out waiting for visible content (text, media, or layout). The page may be a slow SPA, blocked, or stuck behind a consent wall—try a longer crawl timeout or QA_AGENT_SCREENSHOT_CONTENT_TIMEOUT_MS.";
    if (e instanceof Error && /timeout/i.test(e.message)) {
      throw new Error(hint);
    }
    throw e;
  }

  return res;
}
