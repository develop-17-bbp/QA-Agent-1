/**
 * Lightweight type shim so daily-report.ts can reference the orchestrator's
 * options without a circular import into health-dashboard-server.
 */
export interface HealthDashboardOrchestrateOptions {
  maxPages?: number;
  pageSpeed?: { enabled: boolean };
}
