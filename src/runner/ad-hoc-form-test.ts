/**
 * Ad-hoc form tester — give it a URL, it auto-discovers the form(s) on the
 * page, fills each field with a sensible test value inferred from its type /
 * name / placeholder, clicks submit, and uses fuzzy success detection.
 *
 * This is the "paste-a-URL" companion to the selector-driven tests defined in
 * config/sites.json. Use it for quick smoke checks; use the config-driven
 * runner for reliable CI-style regressions against known forms.
 *
 * Risks to be aware of (the UI surfaces them):
 *   - It WILL click submit and post real data. Only point it at your own
 *     staging URLs unless you pass { dryRun: true }.
 *   - CAPTCHA-protected forms will either fail (headless) or require human
 *     interaction (headed + long timeout).
 *   - Values are obvious test strings ("QA-Agent Test", "qa-agent-test@
 *     example.com") so recipients can recognise and discard them.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";

export interface AdHocFormTestOptions {
  url: string;
  headless?: boolean;
  dryRun?: boolean;
  successTimeoutMs?: number;
  /** Absolute path to write a PNG screenshot. */
  screenshotPath: string;
}

export interface AdHocFieldReport {
  selector: string;
  name?: string;
  type?: string;
  action: "fill" | "check" | "uncheck" | "select" | "click" | "skip";
  value?: string;
  skippedReason?: string;
}

export interface AdHocFormTestResult {
  url: string;
  status: "passed" | "failed" | "uncertain" | "skipped";
  durationMs: number;
  errorMessage?: string;
  screenshotPath: string;
  formsFound: number;
  filledFields: AdHocFieldReport[];
  submitted: boolean;
  successSignal?: string;
  finalUrl?: string;
}

/** Canonical test email — obvious to any human inbox reader. */
const TEST_EMAIL = "qa-agent-test@example.com";
const TEST_NAME = "QA-Agent Test";
const TEST_FIRST = "QA";
const TEST_LAST = "Agent";
const TEST_COMPANY = "QA Agent Testing";
const TEST_PHONE = "+1-555-0100";
const TEST_URL = "https://example.com/";
const TEST_MESSAGE = "Automated smoke test from QA-Agent. Please disregard.";
const TEST_SUBJECT = "QA-Agent automated test";

/**
 * Pick a test value for an input field based on its metadata. Name matching
 * is hint-based (substring, case-insensitive) because production forms rarely
 * use canonical attribute names.
 */
function valueForField(meta: {
  type: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  tagName: string;
}): string {
  const t = (meta.type || "").toLowerCase();
  const hints = [meta.name, meta.id, meta.placeholder, meta.autocomplete].join(" ").toLowerCase();

  // Honour type first
  if (t === "email") return TEST_EMAIL;
  if (t === "tel") return TEST_PHONE;
  if (t === "url") return TEST_URL;
  if (t === "number") return "42";
  if (t === "date") return "2026-04-21";
  if (t === "time") return "12:00";
  if (t === "datetime-local") return "2026-04-21T12:00";
  if (t === "password") return "QaAgent-Test-2026!";
  if (t === "search") return "test";
  if (t === "color") return "#111111";

  // Textarea → message-like
  if (meta.tagName === "textarea") return TEST_MESSAGE;

  // Name hints
  if (/email/.test(hints)) return TEST_EMAIL;
  if (/(^|[^a-z])phone|mobile|tel(^|[^a-z])|cell/.test(hints)) return TEST_PHONE;
  if (/(^|[^a-z])website|url|link/.test(hints)) return TEST_URL;
  if (/company|organi[sz]ation|business|employer/.test(hints)) return TEST_COMPANY;
  if (/first.?name|given/.test(hints)) return TEST_FIRST;
  if (/last.?name|surname|family/.test(hints)) return TEST_LAST;
  if (/full.?name|^name$|\bname\b/.test(hints)) return TEST_NAME;
  if (/subject|topic/.test(hints)) return TEST_SUBJECT;
  if (/message|comment|enquir|inquir|question|details/.test(hints)) return TEST_MESSAGE;
  if (/(zip|postal)/.test(hints)) return "10001";
  if (/(city|town)/.test(hints)) return "New York";
  if (/state|province|region/.test(hints)) return "NY";
  if (/country/.test(hints)) return "United States";
  if (/address|street/.test(hints)) return "1 Test Way";

  // Final fallback
  return TEST_NAME;
}

/**
 * Enumerate the form elements on the page and return a test-plan per form.
 * Returns locators scoped by form index so we don't accidentally pick up
 * navbar search widgets that happen to live in a second <form>.
 */
async function planForms(page: Page): Promise<{ handle: Locator; fields: { locator: Locator; meta: AdHocFieldReport }[]; submit: Locator | null; formIdx: number }[]> {
  const plan: { handle: Locator; fields: { locator: Locator; meta: AdHocFieldReport }[]; submit: Locator | null; formIdx: number }[] = [];
  const forms = page.locator("form");
  const count = await forms.count();

  for (let f = 0; f < count; f++) {
    const form = forms.nth(f);
    // Skip hidden forms
    if (!(await form.isVisible().catch(() => false))) continue;

    const fields: { locator: Locator; meta: AdHocFieldReport }[] = [];
    const inputs = form.locator("input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])");
    const inputCount = await inputs.count();

    for (let i = 0; i < inputCount; i++) {
      const el = inputs.nth(i);
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;

      const props = await el.evaluate((node) => {
        const n = node as unknown as {
          tagName: string; id?: string;
          type?: string; name?: string;
          placeholder?: string; autocomplete?: string;
          required?: boolean;
        };
        return {
          tagName: String(n.tagName ?? "").toLowerCase(),
          type: String(n.type ?? ""),
          name: String(n.name ?? ""),
          id: String(n.id ?? ""),
          placeholder: String(n.placeholder ?? ""),
          autocomplete: String(n.autocomplete ?? ""),
          required: Boolean(n.required ?? false),
        };
      }).catch(() => null);
      if (!props) continue;

      const t = props.type.toLowerCase();

      // Skip submit/reset/button inputs — handled via submit locator later
      if (["submit", "reset", "button", "image"].includes(t)) continue;

      const selector = describeLocator(props);

      if (props.tagName === "select") {
        fields.push({
          locator: el,
          meta: { selector, name: props.name, type: "select", action: "select" },
        });
      } else if (t === "checkbox") {
        // Check required checkboxes (likely T&C); leave optional ones alone.
        fields.push({
          locator: el,
          meta: {
            selector,
            name: props.name,
            type: t,
            action: props.required ? "check" : "skip",
            skippedReason: props.required ? undefined : "optional checkbox",
          },
        });
      } else if (t === "radio") {
        // Radio: only the FIRST unique "name" group gets a click; others skip.
        fields.push({
          locator: el,
          meta: { selector, name: props.name, type: t, action: "click" },
        });
      } else if (t === "file") {
        fields.push({
          locator: el,
          meta: { selector, name: props.name, type: t, action: "skip", skippedReason: "file input — needs a real asset path" },
        });
      } else {
        const value = valueForField({
          tagName: props.tagName,
          type: props.type,
          name: props.name,
          id: props.id,
          placeholder: props.placeholder,
          autocomplete: props.autocomplete,
        });
        fields.push({
          locator: el,
          meta: { selector, name: props.name, type: t || props.tagName, action: "fill", value },
        });
      }
    }

    // De-dupe radio groups: only the first visible radio per `name` gets clicked.
    const seenRadioGroups = new Set<string>();
    for (const f of fields) {
      if (f.meta.type === "radio") {
        const key = f.meta.name ?? f.meta.selector;
        if (seenRadioGroups.has(key)) {
          f.meta.action = "skip";
          f.meta.skippedReason = "already clicked another option in this radio group";
        } else {
          seenRadioGroups.add(key);
        }
      }
    }

    // Submit button — prefer type=submit, fall back to the last button.
    let submit: Locator | null = form.locator('button[type="submit"], input[type="submit"]').first();
    if (!(await submit.count().then((c) => c > 0).catch(() => false))) {
      submit = form.locator("button").last();
      if (!(await submit.count().then((c) => c > 0).catch(() => false))) submit = null;
    }

    plan.push({ handle: form, fields, submit, formIdx: f });
  }

  return plan;
}

function describeLocator(p: { name: string; id: string; type: string; tagName: string }): string {
  if (p.id) return `#${p.id}`;
  if (p.name) return `${p.tagName}[name="${p.name}"]`;
  return `${p.tagName}[type="${p.type || "text"}"]`;
}

/**
 * Fuzzy success detection: polls for any of the common success signals.
 * Returns a short human-readable reason on success, or null on timeout.
 */
async function detectSuccess(page: Page, initialUrl: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  const pattern = /thank|received|confirmed|submit+ed|success|complete|sent|we'?ll be in touch|got your message/i;

  while (Date.now() - start < timeoutMs) {
    try {
      // URL change with success hint
      const current = page.url();
      if (current !== initialUrl) {
        if (pattern.test(current)) return `URL redirected to ${current}`;
      }
      // Success text anywhere on the page
      const bodyText = (await page.innerText("body", { timeout: 1500 }).catch(() => "")) || "";
      const match = bodyText.match(pattern);
      if (match) return `Visible text matched /${match[0]}/i`;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function runAdHocFormTest(options: AdHocFormTestOptions): Promise<AdHocFormTestResult> {
  const started = Date.now();
  const headless = options.headless ?? true;
  const dryRun = options.dryRun ?? false;
  const successTimeoutMs = options.successTimeoutMs ?? 15_000;
  let browser: Browser | undefined;

  await mkdir(path.dirname(options.screenshotPath), { recursive: true });

  const report: AdHocFormTestResult = {
    url: options.url,
    status: "failed",
    durationMs: 0,
    screenshotPath: options.screenshotPath,
    formsFound: 0,
    filledFields: [],
    submitted: false,
  };

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const initialUrl = page.url();

    const plan = await planForms(page);
    report.formsFound = plan.length;

    if (plan.length === 0) {
      await page.screenshot({ path: options.screenshotPath, fullPage: true });
      report.status = "failed";
      report.errorMessage = "No visible <form> found on the page.";
      return finalize(report, started);
    }

    // Prefer the first form that has a text/email field — skips navbar searches.
    const interesting = plan.find((p) => p.fields.some((f) => ["email", "text", "tel", "textarea"].includes(f.meta.type ?? "")));
    const target = interesting ?? plan[0]!;

    for (const { locator, meta } of target.fields) {
      try {
        if (meta.action === "fill" && typeof meta.value === "string") {
          await locator.scrollIntoViewIfNeeded().catch(() => undefined);
          await locator.fill(meta.value, { timeout: 8_000 });
        } else if (meta.action === "select") {
          // First non-placeholder, non-disabled option
          const firstValue = await locator.evaluate((el) => {
            const sel = el as unknown as { options: ArrayLike<{ disabled?: boolean; value?: string; hidden?: boolean }> };
            const opts = Array.from(sel.options ?? []);
            for (const o of opts) {
              if (o.disabled) continue;
              if (!o.value) continue;
              if (o.hidden) continue;
              return o.value;
            }
            return null;
          }).catch(() => null);
          if (firstValue) {
            await locator.selectOption({ value: firstValue }).catch(() => undefined);
            meta.value = firstValue;
          } else {
            meta.action = "skip";
            meta.skippedReason = "no selectable option";
          }
        } else if (meta.action === "check") {
          await locator.check({ timeout: 5_000 }).catch(() => undefined);
        } else if (meta.action === "click") {
          await locator.click({ timeout: 5_000 }).catch(() => undefined);
        }
        report.filledFields.push(meta);
      } catch (e) {
        meta.action = "skip";
        meta.skippedReason = (e as Error).message?.slice(0, 120) ?? "fill error";
        report.filledFields.push(meta);
      }
    }

    if (dryRun) {
      await page.screenshot({ path: options.screenshotPath, fullPage: true });
      report.status = "skipped";
      report.errorMessage = "dryRun: fields filled but submit NOT clicked";
      return finalize(report, started);
    }

    if (!target.submit) {
      await page.screenshot({ path: options.screenshotPath, fullPage: true });
      report.status = "failed";
      report.errorMessage = "Could not locate a submit button in the form.";
      return finalize(report, started);
    }

    await target.submit.click({ timeout: 15_000 });
    report.submitted = true;

    const signal = await detectSuccess(page, initialUrl, successTimeoutMs);
    report.finalUrl = page.url();

    if (signal) {
      report.status = "passed";
      report.successSignal = signal;
    } else {
      report.status = "uncertain";
      report.errorMessage = `Submit clicked but no success signal matched within ${successTimeoutMs}ms. Inspect the screenshot manually.`;
    }

    await page.screenshot({ path: options.screenshotPath, fullPage: true });
    return finalize(report, started);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.status = "failed";
    report.errorMessage = message;
    if (browser) {
      try {
        const pages = browser.contexts().flatMap((c) => c.pages());
        const p = pages[0];
        if (p) await p.screenshot({ path: options.screenshotPath, fullPage: true }).catch(() => undefined);
      } catch {
        /* best effort */
      }
    }
    return finalize(report, started);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

function finalize(r: AdHocFormTestResult, started: number): AdHocFormTestResult {
  r.durationMs = Date.now() - started;
  return r;
}
