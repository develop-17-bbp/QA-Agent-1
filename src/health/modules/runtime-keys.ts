/**
 * Runtime-keys store — per-installation overlay for API keys that users
 * paste into the dashboard UI instead of editing `.env`.
 *
 * Rationale: requiring a dashboard user to SSH in, edit `.env`, and
 * restart the server every time they want to connect Ahrefs / Semrush /
 * DataForSEO / etc. kills the "just click Connect" UX. Persisting pasted
 * keys to a file we own (mode 0600) lets every provider's isXxxConfigured()
 * resolver look at runtime keys first, then fall through to process.env —
 * so operators who prefer .env still get the old behavior and users who
 * paste into the UI get instant effect.
 *
 * File: data/runtime-keys.json — flat Record<envVarName, value>.
 *   Example: { "AHREFS_API_TOKEN": "ap-xxxxx", "SEMRUSH_API_KEY": "smr-xxxxx" }
 *
 * Security notes:
 *   - The file is chmod 0600 on Unix; on Windows file ACLs default to user-only.
 *     Don't commit data/ to git (already gitignored).
 *   - Keys are never logged or returned via the status API — only a
 *     "configured: bool" + "source: runtime|env" shape is exposed.
 *   - Keys are read into an in-memory cache on first call and on every
 *     setRuntimeKeys() call. No polling of disk — if you edit the file
 *     by hand, restart.
 *   - Providers that cache aggressively (rate-limit layer) won't pick up
 *     a new key until their cache expires; quitting the dashboard and
 *     restarting is the clean way to force a full refresh.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const KEYS_FILE = path.resolve("data", "runtime-keys.json");

type KeyMap = Record<string, string>;

let cache: KeyMap | null = null;
let loadPromise: Promise<KeyMap> | null = null;

async function readFromDisk(): Promise<KeyMap> {
  try {
    const raw = await fs.readFile(KEYS_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: KeyMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim().length > 0) out[k] = v;
    }
    return out;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return {};
    return {};
  }
}

async function writeToDisk(map: KeyMap): Promise<void> {
  await fs.mkdir(path.dirname(KEYS_FILE), { recursive: true });
  await fs.writeFile(KEYS_FILE, JSON.stringify(map, null, 2), { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(KEYS_FILE, 0o600); } catch { /* windows — ACL handles it */ }
}

async function ensureLoaded(): Promise<KeyMap> {
  if (cache) return cache;
  if (!loadPromise) loadPromise = readFromDisk().then((m) => { cache = m; return m; });
  return loadPromise;
}

/** Synchronous getter. Returns undefined if the cache hasn't been primed
 *  yet; callers that absolutely need an answer at startup should call
 *  `primeRuntimeKeys()` first. Providers call this on the hot path, and
 *  the dashboard server primes on boot, so by the time a user hits any
 *  endpoint the cache is ready. */
export function getRuntimeKey(name: string): string | undefined {
  if (!cache) return undefined;
  const v = cache[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Resolver used by every provider. Runtime-keys override process.env —
 *  intentionally, so a user who pastes a key in the UI can refresh behavior
 *  without touching the .env file. */
export function resolveKey(name: string): string | undefined {
  const runtime = getRuntimeKey(name);
  if (runtime) return runtime;
  const env = process.env[name];
  return typeof env === "string" && env.trim() ? env.trim() : undefined;
}

/** Prime the cache from disk. Call once at server boot. */
export async function primeRuntimeKeys(): Promise<void> {
  await ensureLoaded();
}

/** Return names only (values redacted). The Connections hub uses this to
 *  show which keys were set via UI vs .env so operators can tell them apart. */
export function listRuntimeKeyNames(): string[] {
  if (!cache) return [];
  return Object.keys(cache);
}

/** Upsert a batch of keys. Values with empty/whitespace string DELETE the
 *  matching entry (so the modal "clear" button works with the same endpoint). */
export async function setRuntimeKeys(updates: KeyMap): Promise<void> {
  await ensureLoaded();
  const next: KeyMap = { ...(cache ?? {}) };
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v !== "string" || v.trim().length === 0) {
      delete next[k];
    } else {
      next[k] = v.trim();
    }
  }
  await writeToDisk(next);
  cache = next;
}

/** Delete a single key. */
export async function clearRuntimeKey(name: string): Promise<void> {
  await setRuntimeKeys({ [name]: "" });
}

/** Returns which well-known env-var-style names are considered sensitive
 *  so the dashboard can mask them during re-display. (The values are never
 *  sent to the client, but the list of which NAMES exist is safe.) */
export function isSensitiveKeyName(name: string): boolean {
  return /(?:TOKEN|KEY|SECRET|PASSWORD|CLIENT_ID)$/i.test(name);
}
