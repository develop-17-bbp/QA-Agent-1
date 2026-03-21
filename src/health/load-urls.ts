import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * One root URL per line. Empty lines and lines starting with # are ignored.
 */
export async function loadUrlsFromTxt(filePath: string): Promise<string[]> {
  const absolute = path.resolve(filePath);
  const raw = await readFile(absolute, "utf8");
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
