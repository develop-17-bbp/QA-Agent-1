/** Emitted during `orchestrateHealthCheck` for live dashboards (SSE). */
export type HealthProgressEvent =
  | {
      type: "run_start";
      runId: string;
      runDir: string;
      totalSites: number;
      sites: { siteId: string; hostname: string; startUrl: string }[];
    }
  | {
      type: "site_start";
      siteId: string;
      hostname: string;
      startUrl: string;
      index: number;
      totalSites: number;
    }
  | {
      type: "site_complete";
      siteId: string;
      hostname: string;
      startUrl: string;
      index: number;
      totalSites: number;
      failed: boolean;
      pagesVisited: number;
      brokenLinks: number;
      durationMs: number;
    }
  | {
      type: "site_error";
      siteId: string;
      hostname: string;
      startUrl: string;
      index: number;
      totalSites: number;
      message: string;
    }
  | {
      type: "run_complete";
      runId: string;
      runDir: string;
      siteFailures: number;
      totalSites: number;
    }
  | { type: "run_error"; message: string };
