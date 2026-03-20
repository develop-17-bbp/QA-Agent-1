import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { SiteConfig } from "../config/schema.js";
import type { SiteRunResult } from "../types.js";

async function assertSuccess(page: import("playwright").Page, site: SiteConfig): Promise<void> {
  const check = site.success;
  switch (check.type) {
    case "url_contains": {
      const url = page.url();
      if (!url.includes(check.value)) {
        throw new Error(`Expected URL to contain "${check.value}", got: ${url}`);
      }
      return;
    }
    case "text_visible": {
      const timeout = check.timeoutMs ?? 15_000;
      // Ignore hidden copies in the DOM (e.g. Webflow .w-form-done placeholder text).
      await page
        .getByText(check.value, { exact: false })
        .locator("visible=true")
        .first()
        .waitFor({ state: "visible", timeout });
      return;
    }
    case "selector_visible": {
      const timeout = check.timeoutMs ?? 15_000;
      await page.locator(check.selector).first().waitFor({ state: "visible", timeout });
      return;
    }
    default: {
      const _exhaustive: never = check;
      throw new Error(`Unknown success check: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export async function runSite(
  site: SiteConfig,
  options: { artifactsDir: string; runId: string; headless?: boolean },
): Promise<SiteRunResult> {
  const started = Date.now();
  const headless = options.headless ?? true;
  let browser: Browser | undefined;

  await mkdir(options.artifactsDir, { recursive: true });
  const screenshotPath = path.join(options.artifactsDir, `${site.id}-${options.runId}.png`);

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    for (const form of site.forms) {
      const root = form.selector ? page.locator(form.selector) : page.locator("body");

      for (const field of form.fields) {
        const loc = form.selector ? root.locator(field.selector) : page.locator(field.selector);
        const first = loc.first();
        await first.waitFor({ state: "visible", timeout: 20_000 });

        switch (field.action) {
          case "fill":
            await first.fill(field.value);
            break;
          case "select":
            await first.selectOption({ label: field.value }).catch(async () => {
              await first.selectOption({ value: field.value });
            });
            break;
          case "check":
            await first.check();
            break;
          case "uncheck":
            await first.uncheck();
            break;
          default:
            await first.fill(field.value);
        }
      }

      const submit = form.selector
        ? root.locator(form.submit.selector).first()
        : page.locator(form.submit.selector).first();
      await submit.click();
    }

    await assertSuccess(page, site);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await context.close();
    await browser.close();
    browser = undefined;

    return {
      siteId: site.id,
      siteName: site.name,
      url: site.url,
      status: "passed",
      durationMs: Date.now() - started,
      screenshotPath,
    };
  } catch (err) {
    if (browser) {
      try {
        const contexts = browser.contexts();
        for (const ctx of contexts) {
          const pages = ctx.pages();
          const p = pages[0];
          if (p) await p.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
          await ctx.close();
        }
        await browser.close();
      } catch {
        /* best effort */
      }
      browser = undefined;
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      siteId: site.id,
      siteName: site.name,
      url: site.url,
      status: "failed",
      durationMs: Date.now() - started,
      errorMessage: message,
      screenshotPath,
    };
  }
}
