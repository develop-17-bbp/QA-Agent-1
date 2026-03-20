import { readFile } from "node:fs/promises";
import path from "node:path";
import { sitesConfigSchema, type SitesConfig } from "./schema.js";

export async function loadSitesConfig(filePath: string): Promise<SitesConfig> {
  const absolute = path.resolve(filePath);
  const raw = await readFile(absolute, "utf8");
  const json: unknown = JSON.parse(raw);
  return sitesConfigSchema.parse(json);
}
