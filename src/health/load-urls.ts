import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * One root URL per line. Empty lines and lines starting with # are ignored.
 */
export async function loadUrlsFromTxt(filePath: string): Promise<string[]> {
  const absolute = path.resolve(filePath);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      throw new Error(
        `URLs file not found: ${absolute}\n` +
          `Create it (e.g. copy config/urls.example.txt to config/urls.txt) or pass --urls <path> to an existing file.`,
      );
    }
    throw e;
  }
  return parseUrlsFromText(raw);
}

/** Parse one URL per line (same rules as the URLs file). */
export function parseUrlsFromText(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const urls: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    try {
      const u = new URL(t);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      urls.push(u.href);
    } catch {
      /* skip invalid */
    }
  }
  return urls;
}

export function siteIdFromUrl(url: string): string {
  const h = new URL(url).hostname;
  return h.replace(/[^a-z0-9.-]+/gi, "_");
}

/**
 * Unique directory name per line in urls.txt (1-based index + hostname).
 * Prevents two lines with the same hostname from overwriting the same folder.
 */
export function healthSiteOutputDirName(lineIndex: number, startUrl: string): string {
  const id = siteIdFromUrl(startUrl);
  const n = String(lineIndex + 1).padStart(3, "0");
  return `${n}-${id}`;
}
