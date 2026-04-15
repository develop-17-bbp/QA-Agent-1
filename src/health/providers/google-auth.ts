/**
 * Google OAuth 2.0 token store for GSC + GA4 integration.
 *
 * Runs as a local dashboard, so we use the standard "installed app" flow
 * with a localhost redirect URI. The flow is:
 *
 *   1. User clicks "Connect with Google" on the Google Connections page.
 *   2. Frontend calls GET /api/auth/google/start which returns an authorize
 *      URL. Browser navigates to Google, user consents, Google redirects
 *      back to GET /api/auth/google/callback?code=... on our dashboard.
 *   3. Callback handler exchanges the code for access + refresh tokens and
 *      persists them to `data/google-tokens.json` (gitignored).
 *   4. All subsequent GSC / GA4 calls go through `getAccessToken()` which
 *      refreshes using the stored refresh_token when the access_token
 *      expires. Refresh tokens never rotate on Google, so one consent
 *      is good until the user disconnects.
 *
 * Required environment variables (set in .env):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *
 * The OAuth Client in Google Cloud Console must have its redirect URI set
 * to http://localhost:3847/api/auth/google/callback (or whatever port
 * QA_AGENT_PORT is set to).
 *
 * No third-party SDK — we call Google's token endpoint directly via fetch,
 * matching the pattern of every other provider in this folder.
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const TOKEN_FILE = path.join(process.cwd(), "data", "google-tokens.json");

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const USERINFO_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
export const DEFAULT_SCOPES = [GSC_SCOPE, GA4_SCOPE, USERINFO_SCOPE];

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  scope: string;
  email?: string;
  connectedAt: string;
}

let memoryCache: StoredTokens | null = null;

function getCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isOauthConfigured(): boolean {
  return getCreds() !== null;
}

export function getRedirectUri(req?: { headers: { host?: string | string[] }; socket?: unknown }): string {
  // If request context is available use its host header so the redirect URI
  // matches regardless of which port the server actually bound to.
  // Socket typed as `unknown` because Node's IncomingMessage.socket is a
  // union of Socket | TLSSocket; we read `encrypted` defensively at runtime.
  if (req && typeof req.headers?.host === "string" && req.headers.host.length > 0) {
    const encrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
    const proto = encrypted ? "https" : "http";
    return `${proto}://${req.headers.host}/api/auth/google/callback`;
  }
  const envPort = (process.env.QA_AGENT_PORT ?? "3847").trim() || "3847";
  return `http://localhost:${envPort}/api/auth/google/callback`;
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const creds = getCreds();
  if (!creds) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env",
    );
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force refresh_token every time so reconnects work
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens and persist
 * them. Returns the stored token record (minus the raw access token, which
 * stays in memory for the server's lifetime).
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<StoredTokens> {
  const creds = getCreds();
  if (!creds) throw new Error("Google OAuth is not configured");

  const body = new URLSearchParams({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Disconnect and reconnect to force a fresh consent.",
    );
  }

  let email: string | undefined;
  try {
    const uRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (uRes.ok) {
      const u = (await uRes.json()) as { email?: string };
      email = u.email;
    }
  } catch {
    // non-fatal — email is just a nicety for the UI
  }

  const tokens: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    email,
    connectedAt: new Date().toISOString(),
  };
  await saveTokens(tokens);
  return tokens;
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  memoryCache = tokens;
  await mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
}

export async function loadTokens(): Promise<StoredTokens | null> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredTokens;
    if (!parsed.refreshToken) return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  memoryCache = null;
  try {
    await unlink(TOKEN_FILE);
  } catch {
    // already gone — fine
  }
}

/**
 * Refresh the access token using the stored refresh token. Updates the
 * persisted record and memory cache.
 */
async function refreshAccessToken(tokens: StoredTokens): Promise<StoredTokens> {
  const creds = getCreds();
  if (!creds) throw new Error("Google OAuth is not configured");

  const body = new URLSearchParams({
    refresh_token: tokens.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };
  const next: StoredTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? tokens.scope,
  };
  await saveTokens(next);
  return next;
}

/**
 * Return a valid access token, refreshing if needed. Returns null if the
 * user has not connected yet (callers should throw a user-friendly error).
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  // Refresh 60s before expiry to avoid races.
  if (Date.now() + 60_000 >= tokens.expiresAt) {
    const refreshed = await refreshAccessToken(tokens);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

export interface ConnectionStatus {
  connected: boolean;
  configured: boolean;
  email?: string;
  scopes: string[];
  connectedAt?: string;
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const configured = isOauthConfigured();
  const tokens = await loadTokens();
  if (!tokens) return { connected: false, configured, scopes: [] };
  return {
    connected: true,
    configured,
    email: tokens.email,
    scopes: tokens.scope.split(/\s+/).filter(Boolean),
    connectedAt: tokens.connectedAt,
  };
}

/**
 * Thin authenticated fetch for Google REST APIs. Returns the parsed JSON
 * body on 2xx or throws with the error body on failure.
 */
export async function googleApiFetch<T>(
  url: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not connected to Google. Visit the Google Connections page to authorize.");
  }
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google API ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}
