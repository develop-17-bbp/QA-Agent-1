/**
 * Public API token store — per-installation API keys for external
 * tools (Looker Studio / Zapier / agency dashboards) that need to
 * query QA-Agent without a browser session.
 *
 * Storage: data/api-tokens.json (mode 0600). Token format:
 *   "qa_<32-char-hex>" — recognizable prefix for ops grep + secret-scanners.
 *
 * Each token record carries:
 *   - label (operator-supplied — e.g. "Looker Studio", "Zapier")
 *   - createdAt + lastUsedAt
 *   - rate-limit counters (in-memory, per token)
 *   - scopes (default ["read"]; future-proof for write scopes)
 *
 * Authentication is via "X-API-Key" header OR ?api_key=… query
 * param. Rate limit: 60 requests/minute per token (configurable).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const TOKENS_FILE = path.join(process.cwd(), "data", "api-tokens.json");
const RATE_LIMIT_PER_MIN = 60;

export interface ApiToken {
  id: string;
  /** Plaintext token — `qa_…`. Returned only on creation; afterwards we display only `qa_…<last-4>`. */
  token: string;
  label: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** True when explicitly disabled by the operator. */
  disabled: boolean;
}

export interface ApiTokenSummary {
  id: string;
  /** Masked: "qa_…abcd". The full token is only ever shown once at creation time. */
  tokenMask: string;
  label: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  disabled: boolean;
}

interface TokenStore {
  tokens: ApiToken[];
}

let cache: TokenStore | null = null;
const requestTimestamps = new Map<string, number[]>();

async function readStore(): Promise<TokenStore> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(TOKENS_FILE, "utf8");
    const parsed = JSON.parse(raw) as TokenStore;
    cache = { tokens: Array.isArray(parsed?.tokens) ? parsed.tokens : [] };
  } catch {
    cache = { tokens: [] };
  }
  return cache;
}

async function writeStore(store: TokenStore): Promise<void> {
  cache = store;
  await fs.mkdir(path.dirname(TOKENS_FILE), { recursive: true });
  await fs.writeFile(TOKENS_FILE, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
}

function maskToken(token: string): string {
  if (!token || token.length < 8) return "qa_…";
  return `${token.slice(0, 3)}_…${token.slice(-4)}`;
}

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

// ── Token CRUD ──────────────────────────────────────────────────────────

export async function listTokens(): Promise<ApiTokenSummary[]> {
  const store = await readStore();
  return store.tokens.map((t) => ({
    id: t.id,
    tokenMask: maskToken(t.token),
    label: t.label,
    scopes: t.scopes,
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    disabled: t.disabled,
  }));
}

export async function createToken(label: string, scopes: string[] = ["read"]): Promise<{ id: string; token: string; label: string; scopes: string[] }> {
  if (!label.trim()) throw new Error("label is required");
  const store = await readStore();
  const id = `tok_${randomBytes(8).toString("hex")}`;
  const token = `qa_${randomBytes(16).toString("hex")}`;
  const record: ApiToken = {
    id,
    token,
    label: label.trim().slice(0, 80),
    scopes: scopes.filter((s) => /^[a-z]+$/.test(s)).slice(0, 6),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    disabled: false,
  };
  await writeStore({ tokens: [...store.tokens, record] });
  return { id, token, label: record.label, scopes: record.scopes };
}

export async function deleteToken(id: string): Promise<boolean> {
  const store = await readStore();
  const next = store.tokens.filter((t) => t.id !== id);
  if (next.length === store.tokens.length) return false;
  await writeStore({ tokens: next });
  return true;
}

export async function setTokenDisabled(id: string, disabled: boolean): Promise<boolean> {
  const store = await readStore();
  const idx = store.tokens.findIndex((t) => t.id === id);
  if (idx < 0) return false;
  store.tokens[idx]!.disabled = disabled;
  await writeStore(store);
  return true;
}

// ── Auth + rate limit (request-level helper) ────────────────────────────

export interface AuthResult {
  ok: true;
  token: ApiToken;
}
export interface AuthError {
  ok: false;
  status: 401 | 429;
  error: string;
}

/** Validates an incoming X-API-Key header (or ?api_key=…). On success
 *  bumps lastUsedAt + the rate-limit counter. */
export async function authenticateApiRequest(headerKey: string | null, queryKey: string | null): Promise<AuthResult | AuthError> {
  const presented = (headerKey || queryKey || "").trim();
  if (!presented || !presented.startsWith("qa_")) {
    return { ok: false, status: 401, error: "missing or malformed X-API-Key (expected `qa_…`)" };
  }
  const store = await readStore();
  const match = store.tokens.find((t) => safeEqualString(t.token, presented));
  if (!match) return { ok: false, status: 401, error: "unknown API key" };
  if (match.disabled) return { ok: false, status: 401, error: "API key disabled" };

  // Rate limit: rolling 60-second window per token.
  const now = Date.now();
  const windowStart = now - 60_000;
  const stamps = requestTimestamps.get(match.id) ?? [];
  const recent = stamps.filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    return { ok: false, status: 429, error: `rate limit exceeded (${RATE_LIMIT_PER_MIN}/min per token). Slow down or contact the operator for a higher quota.` };
  }
  recent.push(now);
  requestTimestamps.set(match.id, recent);

  // Update lastUsedAt — debounced: only writes if >= 5 min since last update.
  if (!match.lastUsedAt || now - new Date(match.lastUsedAt).getTime() > 5 * 60_000) {
    match.lastUsedAt = new Date(now).toISOString();
    await writeStore(store).catch(() => { /* non-fatal */ });
  }
  return { ok: true, token: match };
}
