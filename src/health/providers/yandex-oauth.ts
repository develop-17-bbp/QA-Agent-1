/**
 * Yandex Webmaster OAuth 2.0 — alternative to pasting a static OAuth token +
 * numeric user ID into .env.
 *
 * Yandex's auth flow:
 *   1. Operator creates an OAuth client at https://oauth.yandex.com/client/new
 *      with permissions: "Yandex.Webmaster (use API)" + "Access to email /
 *      username" (webmaster:hosts, login:info, login:email).
 *      Redirect URI: http://localhost:3847/api/auth/yandex/callback
 *      (or whatever the operator runs the dashboard on).
 *   2. Operator sets YANDEX_OAUTH_CLIENT_ID + YANDEX_OAUTH_CLIENT_SECRET in
 *      .env. This is the only env config required — individual users
 *      connect by clicking "Connect Yandex" in the dashboard.
 *   3. User clicks Connect → redirect to oauth.yandex.com/authorize.
 *   4. User consents → Yandex redirects back with ?code=...
 *   5. We exchange code → access_token + refresh_token, persist to
 *      data/yandex-tokens.json, also pull the user's Yandex numeric ID from
 *      login.yandex.ru/info so the Webmaster API calls have the user_id
 *      they need without the operator-user having to go find it manually.
 *
 * Precedence matches the Bing pattern: if YANDEX_WEBMASTER_API_KEY is set in
 * runtime-keys or .env, the static token path wins (simpler + more reliable).
 * OAuth is the fallback for users who prefer consent UX.
 *
 * Docs:
 *   OAuth: https://yandex.com/dev/id/doc/en/codes/code-url
 *   User info: https://yandex.com/dev/id/doc/en/user-information
 *   Webmaster: https://yandex.com/dev/webmaster/doc/dg/concepts/about.html
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveKey } from "../modules/runtime-keys.js";

const TOKENS_DIR = path.resolve("data");
const TOKENS_FILE = path.join(TOKENS_DIR, "yandex-tokens.json");

export interface YandexOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  scope?: string;
  connectedAt: string;
  /** Numeric Yandex user id resolved from login.yandex.ru/info — this is
   *  what the Webmaster API wants as the path segment in /user/:id/... */
  userId?: string;
  /** Yandex login / display_name — used by the Connections hub to show
   *  "Connected as <name>". */
  displayName?: string;
}

export async function saveYandexTokens(tokens: YandexOAuthTokens): Promise<void> {
  await fs.mkdir(TOKENS_DIR, { recursive: true });
  await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export async function loadYandexTokens(): Promise<YandexOAuthTokens | null> {
  try {
    const raw = await fs.readFile(TOKENS_FILE, "utf8");
    return JSON.parse(raw) as YandexOAuthTokens;
  } catch {
    return null;
  }
}

export async function clearYandexTokens(): Promise<void> {
  try { await fs.unlink(TOKENS_FILE); } catch { /* already gone */ }
}

export function isYandexOAuthClientConfigured(): boolean {
  return !!(resolveKey("YANDEX_OAUTH_CLIENT_ID") && resolveKey("YANDEX_OAUTH_CLIENT_SECRET"));
}

export function yandexOAuthRedirectUri(port: string | number = "3847"): string {
  return resolveKey("YANDEX_OAUTH_REDIRECT_URI") || `http://localhost:${port}/api/auth/yandex/callback`;
}

/** Authorization URL with the scopes we need: webmaster:hosts + login:info.
 *  The login:info scope lets us fetch the numeric user_id without asking the
 *  user to paste it manually — that was the biggest footgun of the static
 *  token path. */
export function buildYandexOAuthAuthorizeUrl(state: string, port: string | number = "3847"): string {
  const clientId = resolveKey("YANDEX_OAUTH_CLIENT_ID");
  if (!clientId) throw new Error("YANDEX_OAUTH_CLIENT_ID not set");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: yandexOAuthRedirectUri(port),
    scope: "webmaster:hosts login:info",
    state,
    force_confirm: "yes",
  });
  return `https://oauth.yandex.com/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface YandexUserInfo {
  id?: string;
  login?: string;
  display_name?: string;
  real_name?: string;
  default_email?: string;
}

async function fetchYandexUserInfo(accessToken: string): Promise<YandexUserInfo | null> {
  try {
    const res = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as YandexUserInfo;
  } catch {
    return null;
  }
}

/** Exchange auth code for tokens + immediately resolve the numeric user_id
 *  via login.yandex.ru/info so the Webmaster API calls don't need env setup. */
export async function exchangeYandexOAuthCode(code: string, port: string | number = "3847"): Promise<YandexOAuthTokens> {
  const clientId = resolveKey("YANDEX_OAUTH_CLIENT_ID");
  const clientSecret = resolveKey("YANDEX_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Yandex OAuth client not configured");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: yandexOAuthRedirectUri(port),
  });
  const res = await fetch("https://oauth.yandex.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`Yandex OAuth token exchange failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  const info = await fetchYandexUserInfo(data.access_token);
  const tokens: YandexOAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
    scope: data.scope,
    connectedAt: new Date().toISOString(),
    userId: info?.id,
    displayName: info?.display_name || info?.real_name || info?.login,
  };
  await saveYandexTokens(tokens);
  return tokens;
}

/** Refresh when within 60s of expiry. Returns current tokens if still valid. */
export async function refreshYandexTokens(): Promise<YandexOAuthTokens | null> {
  const current = await loadYandexTokens();
  if (!current) return null;
  if (!current.refreshToken) return current;
  if (current.expiresAt - Date.now() > 60_000) return current;

  const clientId = resolveKey("YANDEX_OAUTH_CLIENT_ID");
  const clientSecret = resolveKey("YANDEX_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch("https://oauth.yandex.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) return null;
  const refreshed: YandexOAuthTokens = {
    ...current,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
    scope: data.scope ?? current.scope,
  };
  await saveYandexTokens(refreshed);
  return refreshed;
}

export async function getActiveYandexAccessToken(): Promise<string | null> {
  const tokens = await refreshYandexTokens();
  return tokens?.accessToken ?? null;
}

export async function getActiveYandexUserId(): Promise<string | null> {
  const tokens = await refreshYandexTokens();
  return tokens?.userId ?? null;
}
