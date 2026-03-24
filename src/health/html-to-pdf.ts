import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

/** Release Playwright browser (e.g. before process exit). */
export async function closeHealthPdfBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

/**
 * Render a local HTML file to PDF (uses Chromium; requires `npx playwright install chromium` once).
 */
export async function renderHtmlFileToPdf(absHtmlPath: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(absHtmlPath).href, {
      waitUntil: "load",
      timeout: 600_000,
    });
    await page.emulateMedia({ media: "screen" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
