import type { SiteConfig } from "./config/schema.js";

export type SiteRunStatus = "passed" | "failed" | "skipped";

export interface SiteRunResult {
  siteId: string;
  siteName: string;
  url: string;
  status: SiteRunStatus;
  durationMs: number;
  errorMessage?: string;
  screenshotPath?: string;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  results: SiteRunResult[];
  configPath: string;
}

export interface RunSiteContext {
  site: SiteConfig;
  artifactsDir: string;
  runId: string;
}
