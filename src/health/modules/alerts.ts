/**
 * Alerts — threshold-triggered webhooks/logs for rank + backlink changes.
 *
 * Two change detectors, both driven by existing persisted data:
 *
 *   1. Rank change: for every tracked (domain, keyword) pair in position-db,
 *      compare the latest snapshot vs the one before it. When the delta
 *      exceeds `rankDropThreshold` positions (default 3), log an alert
 *      and POST to the configured webhook if set.
 *
 *   2. Backlink change: for every domain that has an Ahrefs WMT CSV bundle,
 *      compare referring-domain count against the previous bundle snapshot
 *      stored in data/alerts-state.json. When the net delta exceeds
 *      `backlinkDropThreshold` (default 10), fire an alert.
 *
 * Outputs:
 *   - Every fire is appended to data/alerts.jsonl (one line each)
 *   - When ALERT_WEBHOOK_URL is configured, fired alerts POST as JSON
 *   - /api/alerts returns the last N alerts for the UI
 *
 * Scheduled via the same minute-ticker as scheduler.ts — we call
 * runAlertsCheck() on a loose cadence (every 15 minutes) from the
 * server boot path.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { readHistory, loadTrackedPairs } from "../position-db.js";
import { loadAwtBundle } from "../providers/ahrefs-webmaster-csv.js";
import { resolveKey } from "./runtime-keys.js";

const ALERTS_LOG = path.resolve("artifacts", "alerts.jsonl");
const STATE_FILE = path.resolve("data", "alerts-state.json");

export type AlertSeverity = "info" | "warn" | "critical";
export type AlertKind = "rank-drop" | "rank-gain" | "backlink-drop" | "backlink-gain";

export interface AlertRecord {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  target: string;           // domain or "domain::keyword"
  summary: string;          // one-line headline
  delta: number;            // signed change magnitude
  before?: number;
  after?: number;
  firedAt: string;          // ISO
  webhookStatus?: "ok" | "skipped" | "failed";
}

interface AlertsState {
  /** Keyed by alert signature so we don't fire the same thing twice. */
  lastFired: Record<string, { firedAt: string; snapshot: number }>;
  /** Per-domain snapshot of last observed referring-domain count. */
  lastBacklinkSnapshot: Record<string, number>;
}

async function readState(): Promise<AlertsState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Partial<AlertsState>;
      return {
        lastFired: obj.lastFired ?? {},
        lastBacklinkSnapshot: obj.lastBacklinkSnapshot ?? {},
      };
    }
  } catch { /* missing or corrupt — return empty */ }
  return { lastFired: {}, lastBacklinkSnapshot: {} };
}

async function writeState(state: AlertsState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
}

async function appendLog(alert: AlertRecord): Promise<void> {
  try {
    await fs.mkdir(path.dirname(ALERTS_LOG), { recursive: true });
    await fs.appendFile(ALERTS_LOG, JSON.stringify(alert) + "\n", "utf8");
  } catch { /* log failure is non-fatal */ }
}

async function fireWebhook(alert: AlertRecord): Promise<"ok" | "skipped" | "failed"> {
  const url = resolveKey("ALERT_WEBHOOK_URL");
  if (!url) return "skipped";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

function severityForRankChange(delta: number): AlertSeverity {
  const abs = Math.abs(delta);
  if (abs >= 10) return "critical";
  if (abs >= 5) return "warn";
  return "info";
}
function severityForBacklinkChange(delta: number): AlertSeverity {
  const abs = Math.abs(delta);
  if (abs >= 50) return "critical";
  if (abs >= 20) return "warn";
  return "info";
}

export interface RunAlertsOptions {
  rankDropThreshold?: number;
  rankGainThreshold?: number;
  backlinkDropThreshold?: number;
  backlinkGainThreshold?: number;
  /** When true, emits info-level alerts even for small changes. Default false. */
  includeInfo?: boolean;
}

export interface RunAlertsResult {
  checked: { rankPairs: number; backlinkDomains: number };
  fired: AlertRecord[];
  skipped: { reason: string; target: string }[];
}

export async function runAlertsCheck(options: RunAlertsOptions = {}): Promise<RunAlertsResult> {
  const rankDropThreshold = options.rankDropThreshold ?? 3;
  const rankGainThreshold = options.rankGainThreshold ?? 5;
  const blDrop = options.backlinkDropThreshold ?? 10;
  const blGain = options.backlinkGainThreshold ?? 20;

  const state = await readState();
  const fired: AlertRecord[] = [];
  const skipped: { reason: string; target: string }[] = [];

  // ── Rank changes ──
  const pairs = await loadTrackedPairs();
  for (const pair of pairs) {
    try {
      const snapshots = await readHistory(pair.domain, pair.keyword);
      if (snapshots.length < 2) { skipped.push({ reason: "<2 snapshots", target: `${pair.domain}::${pair.keyword}` }); continue; }
      // Most recent two non-null positions
      const withPos = snapshots.filter((s) => typeof s.position === "number") as Array<{ at: string; position: number }>;
      if (withPos.length < 2) { skipped.push({ reason: "<2 rank samples", target: `${pair.domain}::${pair.keyword}` }); continue; }
      const latest = withPos[withPos.length - 1]!;
      const prior = withPos[withPos.length - 2]!;
      const delta = latest.position - prior.position; // positive = rank number increased (got worse)
      const isDrop = delta >= rankDropThreshold;
      const isGain = delta <= -rankGainThreshold;
      if (!isDrop && !isGain) continue;
      const sig = `rank::${pair.domain}::${pair.keyword}::${latest.at}`;
      if (state.lastFired[sig]) continue; // already fired for this snapshot
      const kind: AlertKind = isDrop ? "rank-drop" : "rank-gain";
      const alert: AlertRecord = {
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        severity: severityForRankChange(delta),
        target: `${pair.domain}::${pair.keyword}`,
        summary: isDrop
          ? `"${pair.keyword}" on ${pair.domain} dropped ${Math.abs(delta)} position${Math.abs(delta) === 1 ? "" : "s"} (${prior.position} → ${latest.position})`
          : `"${pair.keyword}" on ${pair.domain} climbed ${Math.abs(delta)} position${Math.abs(delta) === 1 ? "" : "s"} (${prior.position} → ${latest.position})`,
        delta,
        before: prior.position,
        after: latest.position,
        firedAt: new Date().toISOString(),
      };
      alert.webhookStatus = await fireWebhook(alert);
      await appendLog(alert);
      state.lastFired[sig] = { firedAt: alert.firedAt, snapshot: latest.position };
      fired.push(alert);
    } catch (e) {
      skipped.push({ reason: e instanceof Error ? e.message.slice(0, 80) : "error", target: `${pair.domain}::${pair.keyword}` });
    }
  }

  // ── Backlink changes (per-domain, via AWT CSV bundle) ──
  // Inspect every domain we have a tracked pair for (they're the domains the user cares about).
  const backlinkDomains = [...new Set(pairs.map((p) => p.domain))];
  let checkedBacklinks = 0;
  for (const domain of backlinkDomains) {
    try {
      const bundle = await loadAwtBundle(domain);
      if (!bundle) continue;
      checkedBacklinks++;
      const current = bundle.summary.totalReferringDomains ?? 0;
      const prior = state.lastBacklinkSnapshot[domain];
      if (typeof prior !== "number") {
        // First observation — just record, don't fire.
        state.lastBacklinkSnapshot[domain] = current;
        continue;
      }
      const delta = current - prior;
      const isDrop = delta <= -blDrop;
      const isGain = delta >= blGain;
      if (!isDrop && !isGain) continue;
      const sig = `backlink::${domain}::${bundle.importedAt}`;
      if (state.lastFired[sig]) continue;
      const kind: AlertKind = isDrop ? "backlink-drop" : "backlink-gain";
      const alert: AlertRecord = {
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        severity: severityForBacklinkChange(delta),
        target: domain,
        summary: isDrop
          ? `${domain} lost ${Math.abs(delta)} referring domain${Math.abs(delta) === 1 ? "" : "s"} (${prior} → ${current})`
          : `${domain} gained ${Math.abs(delta)} referring domain${Math.abs(delta) === 1 ? "" : "s"} (${prior} → ${current})`,
        delta,
        before: prior,
        after: current,
        firedAt: new Date().toISOString(),
      };
      alert.webhookStatus = await fireWebhook(alert);
      await appendLog(alert);
      state.lastFired[sig] = { firedAt: alert.firedAt, snapshot: current };
      state.lastBacklinkSnapshot[domain] = current;
      fired.push(alert);
    } catch (e) {
      skipped.push({ reason: e instanceof Error ? e.message.slice(0, 80) : "error", target: domain });
    }
  }

  await writeState(state);
  return {
    checked: { rankPairs: pairs.length, backlinkDomains: checkedBacklinks },
    fired,
    skipped,
  };
}

export async function readRecentAlerts(limit = 100): Promise<AlertRecord[]> {
  try {
    const raw = await fs.readFile(ALERTS_LOG, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const out: AlertRecord[] = [];
    for (const line of lines.slice(-limit)) {
      try { out.push(JSON.parse(line) as AlertRecord); } catch { /* skip bad line */ }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

let timer: NodeJS.Timeout | null = null;
/** Start the background alert checker — fires every 15 minutes. Safe to call repeatedly. */
export function startAlertsTicker(): void {
  if (timer) return;
  const EVERY = 15 * 60_000;
  timer = setInterval(() => { void runAlertsCheck().catch(() => {}); }, EVERY);
  if (typeof timer.unref === "function") timer.unref();
}
