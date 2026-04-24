/**
 * Scheduler — cron-driven in-process runner that fires audits on a schedule.
 *
 * Persists schedules to data/schedules.json (mode 0600). On server boot,
 * start() loads all schedules and sets up a single setInterval(60_000)
 * tick that evaluates every schedule's cron expression vs "now." When
 * a schedule is due, its action fires (currently hits /api/daily-report
 * internally).
 *
 * Cron expression support is deliberately minimal — we only handle the
 * 5-field cron (min hour dom month dow) with literal numbers, star
 * wildcards, and star-slash step syntax (like every-N-minutes). No ranges,
 * no comma lists. Enough for "every weekday at 6am" and "at :00 every hour"
 * — which is what users actually want. Sophisticated recurrences can be
 * expressed by creating multiple schedules.
 *
 * This module doesn't run the crawl directly — it POSTs to
 * /api/daily-report on the same server, which is the existing hardened
 * code path that triggers runs, renders HTML, and emails via n8n hooks.
 * So schedules inherit every existing crawl feature (PageSpeed, form
 * tests, enrichers, etc.).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SCHED_FILE = path.resolve("data", "schedules.json");
const TICK_INTERVAL_MS = 60_000;

export interface Schedule {
  id: string;
  name: string;
  /** 5-field cron: "min hour dom month dow". Example: "30 5 * * *" = daily 05:30 UTC. */
  cron: string;
  /** Sites to audit. Passed straight through to /api/daily-report. */
  sites: string[];
  /** Feature toggles mirroring /api/daily-report payload. */
  includePageSpeed?: boolean;
  includeFormTests?: boolean;
  maxPages?: number;
  /** Email recipients — if set, the server hits n8n's mail webhook after the run. */
  emailTo?: string[];
  /** When true, don't fire (lets user pause without deleting). */
  paused?: boolean;
  /** ISO timestamps populated by the runner. */
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: "ok" | "error";
  lastRunError?: string;
  nextRunPreview?: string;
}

let cache: Schedule[] | null = null;
let timerHandle: NodeJS.Timeout | null = null;
let dailyReportBaseUrl = "http://127.0.0.1:3847";

async function readFromDisk(): Promise<Schedule[]> {
  try {
    const raw = await fs.readFile(SCHED_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Schedule[]) : [];
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    return [];
  }
}

async function writeToDisk(list: Schedule[]): Promise<void> {
  await fs.mkdir(path.dirname(SCHED_FILE), { recursive: true });
  await fs.writeFile(SCHED_FILE, JSON.stringify(list, null, 2), { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(SCHED_FILE, 0o600); } catch { /* windows */ }
}

export async function listSchedules(): Promise<Schedule[]> {
  if (!cache) cache = await readFromDisk();
  return [...cache];
}

export async function createSchedule(input: Omit<Schedule, "id" | "createdAt" | "lastRunAt" | "lastRunStatus" | "lastRunError" | "nextRunPreview">): Promise<Schedule> {
  if (!input.cron || !parseCron(input.cron)) throw new Error(`Invalid cron expression: "${input.cron}"`);
  if (!input.name?.trim()) throw new Error("name required");
  if (!Array.isArray(input.sites) || input.sites.length === 0) throw new Error("sites required");
  const list = await listSchedules();
  const sched: Schedule = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  list.push(sched);
  await writeToDisk(list);
  cache = list;
  return sched;
}

export async function updateSchedule(id: string, updates: Partial<Schedule>): Promise<Schedule | null> {
  const list = await listSchedules();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  if (updates.cron && !parseCron(updates.cron)) throw new Error(`Invalid cron expression: "${updates.cron}"`);
  list[idx] = { ...list[idx]!, ...updates, id: list[idx]!.id, createdAt: list[idx]!.createdAt };
  await writeToDisk(list);
  cache = list;
  return list[idx]!;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const list = await listSchedules();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  await writeToDisk(next);
  cache = next;
  return true;
}

// ── Cron parsing ─────────────────────────────────────────────────────────

interface CronParsed {
  minutes: Set<number> | "*";
  hours: Set<number> | "*";
  dom: Set<number> | "*";
  months: Set<number> | "*";
  dow: Set<number> | "*";
}

function parseField(field: string, min: number, max: number): Set<number> | "*" | null {
  if (field === "*") return "*";
  const stepMatch = field.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isFinite(step) || step < 1) return null;
    const set = new Set<number>();
    for (let i = min; i <= max; i += step) set.add(i);
    return set;
  }
  const n = Number(field);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return new Set([n]);
}

export function parseCron(expr: string): CronParsed | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mi, h, dm, mo, dw] = parts as [string, string, string, string, string];
  const minutes = parseField(mi, 0, 59);
  const hours = parseField(h, 0, 23);
  const dom = parseField(dm, 1, 31);
  const months = parseField(mo, 1, 12);
  const dow = parseField(dw, 0, 6);
  if (!minutes || !hours || !dom || !months || !dow) return null;
  return { minutes, hours, dom, months, dow };
}

function matches(set: Set<number> | "*", value: number): boolean {
  return set === "*" ? true : set.has(value);
}

function dueAt(cron: CronParsed, now: Date): boolean {
  return matches(cron.minutes, now.getUTCMinutes())
    && matches(cron.hours, now.getUTCHours())
    && matches(cron.dom, now.getUTCDate())
    && matches(cron.months, now.getUTCMonth() + 1)
    && matches(cron.dow, now.getUTCDay());
}

/** Compute the next fire time for a schedule, looking up to `maxLookMinutes` ahead. */
export function nextRun(expr: string, from: Date = new Date(), maxLookMinutes = 60 * 24 * 7): Date | null {
  const cron = parseCron(expr);
  if (!cron) return null;
  const probe = new Date(from);
  probe.setUTCSeconds(0, 0);
  probe.setUTCMinutes(probe.getUTCMinutes() + 1);
  for (let i = 0; i < maxLookMinutes; i++) {
    if (dueAt(cron, probe)) return new Date(probe);
    probe.setUTCMinutes(probe.getUTCMinutes() + 1);
  }
  return null;
}

// ── Runner ────────────────────────────────────────────────────────────────

async function fireSchedule(sched: Schedule): Promise<void> {
  try {
    const token = process.env.DAILY_REPORT_TOKEN?.trim();
    const res = await fetch(`${dailyReportBaseUrl}/api/daily-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        sites: sched.sites,
        includePageSpeed: sched.includePageSpeed,
        includeFormTests: sched.includeFormTests,
        maxPages: sched.maxPages,
        emailTo: sched.emailTo,
      }),
      signal: AbortSignal.timeout(30 * 60 * 1000), // 30 min max per fire
    });
    await updateSchedule(sched.id, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: res.ok ? "ok" : "error",
      lastRunError: res.ok ? undefined : `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
    });
  } catch (e) {
    await updateSchedule(sched.id, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "error",
      lastRunError: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    });
  }
}

/** Tick every minute — evaluate every non-paused schedule. */
async function tick(): Promise<void> {
  const now = new Date();
  now.setUTCSeconds(0, 0);
  const list = await listSchedules();
  for (const s of list) {
    if (s.paused) continue;
    const cron = parseCron(s.cron);
    if (!cron) continue;
    if (!dueAt(cron, now)) continue;
    // Guard against double-fire within the same minute
    if (s.lastRunAt) {
      const last = new Date(s.lastRunAt);
      if (last.getUTCFullYear() === now.getUTCFullYear()
        && last.getUTCMonth() === now.getUTCMonth()
        && last.getUTCDate() === now.getUTCDate()
        && last.getUTCHours() === now.getUTCHours()
        && last.getUTCMinutes() === now.getUTCMinutes()) continue;
    }
    void fireSchedule(s);
  }
}

export function startScheduler(baseUrl?: string): void {
  if (baseUrl) dailyReportBaseUrl = baseUrl;
  if (timerHandle) return;
  // Fire tick once immediately after a short delay so server boot finishes first.
  setTimeout(() => { void tick(); }, 5000);
  timerHandle = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  // Don't block process exit
  if (typeof timerHandle.unref === "function") timerHandle.unref();
}

export function stopScheduler(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}
