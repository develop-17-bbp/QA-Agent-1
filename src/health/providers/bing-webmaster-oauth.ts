/**
 * Bing Webmaster Tools OAuth token store.
 *
 * Some customers prefer OAuth consent over pasting an API key into the .env
 * (security policies, ease of rotation, etc.). Bing WMT supports Azure AD
 * OAuth 2.0 in addition to the classic API-key model.
 *
 * This module is the token-persistence layer + a config flag that the
 * bing-webmaster.ts caller checks alongside the API-key path. The OAuth
 * callback endpoint + consent flow live in health-dashboard-server.ts under
 * /api/auth/bing/*.
 *
 * Precedence: when both paths are configured, the API key wins (it's the
 * simpler and more reliable path). OAuth is the fallback / alternative.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const TOKENS_DIR = path.resolve("data");
const TOKENS_FILE = path.join(TOKENS_DIR, "bing-wmt-tokens.json");

export interface BingWmtTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  scope?: string;
  connectedAt: string;
}

/** Persist tokens after successful OAuth consent. Mode 0o600 so the file
 *  is only readable by the process owner. */
export async function saveBingTokens(tokens: BingWmtTokens): Promise<void> {
  await fs.mkdir(TOKENS_DIR, { recursive: true });
  await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export async function loadBingTokens(): Promise<BingWmtTokens | null> {
  try {
    const raw = await fs.readFile(TOKENS_FILE, "utf8");
    return JSON.parse(raw) as BingWmtTokens;
  } catch {
    return null;
  }
}

export async function clearBingTokens(): Promise<void> {
  try {
    await fs.unlink(TOKENS_FILE);
  } catch {
    /* already gone */
  }
}

/** Config check: is the Azure AD OAuth client registered in .env? Separate
 *  from "has the user consented yet" — use loadBingTokens() for that. */
export function isBingOAuthClientConfigured(): boolean {
  return !!(
    process.env.BING_WMT_OAUTH_CLIENT_ID?.trim() &&
    process.env.BING_WMT_OAUTH_CLIENT_SECRET?.trim()
  );
}

export function bingOAuthRedirectUri(port: string | number = "3847"): string {
  return process.env.BING_WMT_OAUTH_REDIRECT_URI?.trim()
    || `http://localhost:${port}/api/auth/bing/callback`;
}

/** Azure AD authorization URL. Tenant defaults to 'common' so personal + work
 *  Microsoft accounts can both consent. */
export function buildBingOAuthAuthorizeUrl(state: string, port: string | number = "3847"): string {
  const clientId = process.env.BING_WMT_OAUTH_CLIENT_ID?.trim();
  const tenant = process.env.BING_WMT_OAUTH_TENANT?.trim() || "common";
  if (!clientId) throw new Error("BING_WMT_OAUTH_CLIENT_ID not set");
  const scope = encodeURIComponent("https://bing.webmaster.api/.default offline_access");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: bingOAuthRedirectUri(port),
    response_mode: "query",
    state,
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}&scope=${scope}`;
}

interface TokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Exchange an authorization code for tokens. Called from the /callback handler. */
export async function exchangeBingOAuthCode(code: string, port: string | number = "3847"): Promise<BingWmtTokens> {
  const clientId = process.env.BING_WMT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.BING_WMT_OAUTH_CLIENT_SECRET?.trim();
  const tenant = process.env.BING_WMT_OAUTH_TENANT?.trim() || "common";
  if (!clientId || !clientSecret) throw new Error("Bing OAuth client not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: bingOAuthRedirectUri(port),
    grant_type: "authorization_code",
  });

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenExchangeResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`Bing OAuth token exchange failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  const tokens: BingWmtTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope,
    connectedAt: new Date().toISOString(),
  };
  await saveBingTokens(tokens);
  return tokens;
}

/** Refresh tokens when the access token is within 60s of expiry. */
export async function refreshBingOAuthTokens(): Promise<BingWmtTokens | null> {
  const current = await loadBingTokens();
  if (!current?.refreshToken) return null;
  if (current.expiresAt - Date.now() > 60_000) return current; // still valid
  const clientId = process.env.BING_WMT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.BING_WMT_OAUTH_CLIENT_SECRET?.trim();
  const tenant = process.env.BING_WMT_OAUTH_TENANT?.trim() || "common";
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: current.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenExchangeResponse;
  if (!res.ok || !data.access_token) return null;
  const refreshed: BingWmtTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? current.scope,
    connectedAt: current.connectedAt,
  };
  await saveBingTokens(refreshed);
  return refreshed;
}

/** Returns a usable access token — refreshes automatically if near expiry. */
export async function getActiveBingAccessToken(): Promise<string | null> {
  const tokens = await refreshBingOAuthTokens();
  return tokens?.accessToken ?? null;
}
