/** ISO 8601 time → safe filename segment (colons / dots → hyphens). */
export function isoToFilenameSegment(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/** Hostname → safe filename segment (dots → hyphens). */
export function hostnameToFilenameSegment(hostname: string): string {
  return hostname.replace(/\./g, "-").replace(/[^a-z0-9-]+/gi, "_");
}

/** Base name (no extension) for a per-site report: website + time generated. */
export function perSiteReportBaseName(hostname: string, finishedAtIso: string): string {
  return `report-${hostnameToFilenameSegment(hostname)}-${isoToFilenameSegment(finishedAtIso)}`;
}

/** Base name for the combined all-sites report at end of run. */
export function masterReportBaseName(runFinishedAtIso: string): string {
  return `MASTER-all-sites-${isoToFilenameSegment(runFinishedAtIso)}`;
}
