import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { FormConfig, SiteConfig } from "../config/schema.js";
import type { SiteRunResult } from "../types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertSuccess(page: Page, site: SiteConfig): Promise<void> {
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

async function runCaptchaBeforeSubmit(
  page: Page,
  captcha: FormConfig["captcha"],
  headless: boolean,
): Promise<void> {
  if (!captcha || captcha.strategy === "none") return;

  if (captcha.strategy === "pause_after_fields") {
    if (headless) {
      throw new Error(
        'CAPTCHA strategy "pause_after_fields" needs a visible browser — re-run with `npm run run -- --headed` (or `qa-agent run --headed`) so a human can solve the challenge before submit.',
      );
    }
    const ms = captcha.pauseMs ?? 120_000;
    console.log(
      `[qa-agent] CAPTCHA pause ${ms}ms — solve the challenge in the browser window; the run will continue and click submit automatically.`,
    );
    await sleep(ms);
    return;
  }

  if (captcha.strategy === "wait_for_selector") {
    const sel = captcha.waitSelector;
    if (!sel?.trim()) {
      throw new Error('CAPTCHA strategy "wait_for_selector" requires captcha.waitSelector in config');
    }
    const timeout = captcha.waitTimeoutMs ?? 120_000;
    await page.locator(sel).first().waitFor({ state: "visible", timeout });
  }
}

async function runLiveAgentFlow(page: Page, site: SiteConfig, headless: boolean): Promise<void> {
  const la = site.liveAgent;
  if (!la || la.enabled === false) return;

  const timeout = la.timeoutMs ?? 120_000;
  const scope = la.frameSelector ? page.frameLocator(la.frameSelector) : page;

  await scope.locator(la.openChatSelector).first().click({ timeout: Math.min(30_000, timeout) });
  await scope.locator(la.messageInputSelector).first().waitFor({ state: "visible", timeout: 30_000 });
  await scope.locator(la.messageInputSelector).first().fill(la.visitorMessage);

  if (la.sendSelector) {
    await scope.locator(la.sendSelector).first().click();
  } else {
    await scope.locator(la.messageInputSelector).first().press("Enter");
  }

  if (!headless) {
    console.log(
      `[qa-agent] Waiting up to ${timeout}ms for agent message containing: ${JSON.stringify(la.agentMessageContains)}`,
    );
  }

  await scope
    .getByText(la.agentMessageContains, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout });
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

    const la = site.liveAgent;
    const runLiveFirst =
      la && la.enabled !== false && la.runBeforeForms === true;

    if (runLiveFirst) {
      await runLiveAgentFlow(page, site, headless);
    }

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
          case "click":
            await first.click();
            break;
          default:
            await first.fill(field.value);
        }

        if (field.delayAfterMs !== undefined && field.delayAfterMs > 0) {
          await sleep(field.delayAfterMs);
        }
      }

      await runCaptchaBeforeSubmit(page, form.captcha, headless);

      const submit = form.selector
        ? root.locator(form.submit.selector).first()
        : page.locator(form.submit.selector).first();
      await submit.click();
    }

    const runLiveAfter =
      la && la.enabled !== false && la.runBeforeForms !== true;

    if (runLiveAfter) {
      await runLiveAgentFlow(page, site, headless);
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
