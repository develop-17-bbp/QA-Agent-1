import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import {
  disconnectGoogleAuth,
  fetchGa4Properties,
  fetchGoogleAuthStatus,
  fetchGscSites,
  startGoogleAuth,
  type Ga4Property,
  type GoogleConnectionStatus,
  type GscSite,
} from "../api";

/**
 * Google Search Console + GA4 integration page.
 *
 * This is the single page where the user authorizes QA-Agent to read their
 * own GSC / GA4 data so the rest of the app can overlay real impressions,
 * clicks, positions, and page traffic on top of the scraped estimates.
 *
 * Flow:
 *   1. GET /api/auth/google/status to check connection state.
 *   2. If not connected: "Connect with Google" button → navigates to
 *      /api/auth/google/start which 302s to Google consent.
 *   3. After consent Google redirects back to /api/auth/google/callback which
 *      stores tokens and redirects here with ?connected=1.
 *   4. Connected state lists every verified GSC site and every GA4 property
 *      so the user can verify the connection works.
 */
export default function GoogleConnections() {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [sites, setSites] = useState<GscSite[]>([]);
  const [properties, setProperties] = useState<Ga4Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [sitesError, setSitesError] = useState("");
  const [propertiesError, setPropertiesError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  const loadAll = async () => {
    setLoading(true);
    try {
      const s = await fetchGoogleAuthStatus();
      setStatus(s);
      if (s.connected) {
        await Promise.allSettled([
          fetchGscSites()
            .then((rows) => setSites(rows))
            .catch((e: Error) => setSitesError(e.message)),
          fetchGa4Properties()
            .then((rows) => setProperties(rows))
            .catch((e: Error) => setPropertiesError(e.message)),
        ]);
      } else {
        setSites([]);
        setProperties([]);
      }
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  // Parse ?connected=1 or ?err=… query params coming back from the OAuth redirect.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("connected") === "1") {
      setBanner({ kind: "ok", text: "Connected to Google. Real GSC and GA4 data is now available." });
      navigate("/google-connections", { replace: true });
    } else if (params.get("err")) {
      setBanner({ kind: "err", text: `OAuth failed: ${params.get("err")}` });
      navigate("/google-connections", { replace: true });
    }
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = () => {
    if (!status?.configured) {
      setBanner({
        kind: "err",
        text:
          "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in your .env and restart the server.",
      });
      return;
    }
    startGoogleAuth();
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectGoogleAuth();
      setBanner({ kind: "ok", text: "Disconnected from Google. Tokens cleared." });
      await loadAll();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Google Connections</h1>
      <p className="qa-page-desc">
        Connect your Google account to unlock <strong>real</strong> Search Console impressions, clicks, queries, and
        positions for your own verified properties — and real Analytics 4 sessions, users, and page traffic. Every
        number fetched here carries a <em>first-party</em> provenance badge across the rest of the app.
      </p>

      {banner && (
        <div className={`qa-alert ${banner.kind === "ok" ? "qa-alert--success" : "qa-alert--error"}`} style={{ marginTop: 8 }}>
          {banner.text}
        </div>
      )}

      {loading && (
        <div className="qa-loading-panel" style={{ marginTop: 20 }}>
          <div className="qa-spinner" />
          Checking connection...
        </div>
      )}

      {!loading && status && (
        <>
          <div className="qa-panel" style={{ marginTop: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: status.connected ? "#22c55e" : "#9ca3af",
                  boxShadow: "0 0 0 3px rgba(34, 197, 94, 0.12)",
                }}
              />
              <div style={{ flex: "1 1 auto" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {status.connected ? "Connected" : status.configured ? "Not connected" : "OAuth not configured"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {status.connected && status.email ? (
                    <>
                      Signed in as <strong>{status.email}</strong>
                      {status.connectedAt && <> · since {new Date(status.connectedAt).toLocaleString()}</>}
                    </>
                  ) : status.configured ? (
                    "OAuth credentials detected. Click below to authorize."
                  ) : (
                    "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env to enable."
                  )}
                </div>
              </div>
              {status.connected ? (
                <button
                  className="qa-btn"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  style={{ padding: "8px 16px" }}
                >
                  {disconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              ) : (
                <button
                  className="qa-btn-primary"
                  onClick={handleConnect}
                  disabled={!status.configured}
                  style={{ padding: "8px 20px" }}
                >
                  Connect with Google
                </button>
              )}
            </div>

            {status.connected && status.scopes.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                <div className="qa-kicker" style={{ marginBottom: 6 }}>Granted scopes</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {status.scopes.map((scope) => (
                    <span
                      key={scope}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        borderRadius: 12,
                        background: "rgba(56,161,105,0.12)",
                        color: "#38a169",
                        border: "1px solid rgba(56,161,105,0.25)",
                        fontFamily: "monospace",
                      }}
                      title={scope}
                    >
                      {scope.replace(/^https:\/\/www\.googleapis\.com\/auth\//, "")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!status.configured && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 20 }}>
              <div className="qa-panel-title">Setup instructions</div>
              <ol style={{ fontSize: 13, lineHeight: 1.7, marginTop: 10, paddingLeft: 20, color: "var(--text-secondary)" }}>
                <li>
                  In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>,
                  create an OAuth 2.0 Client ID of type <strong>Web application</strong>.
                </li>
                <li>
                  Add <code>http://localhost:3847/api/auth/google/callback</code> as an <strong>Authorized redirect URI</strong>.
                </li>
                <li>
                  Enable the <strong>Google Search Console API</strong> and <strong>Google Analytics Data API</strong> for the project.
                </li>
                <li>
                  Copy the client ID and secret into <code>.env</code> as
                  <code> GOOGLE_OAUTH_CLIENT_ID</code> and <code> GOOGLE_OAUTH_CLIENT_SECRET</code>, then restart the server.
                </li>
              </ol>
            </div>
          )}

          {status.connected && (
            <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
              <div className="qa-panel" style={{ padding: 20, flex: "1 1 420px" }}>
                <div className="qa-panel-title">Search Console properties</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
                  Verified sites from <code>webmasters/v3/sites</code>. Any property listed here can return real clicks,
                  impressions, CTR, and position for its own queries and pages.
                </div>
                {sitesError && <div className="qa-alert qa-alert--error">{sitesError}</div>}
                {!sitesError && sites.length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", padding: "12px 0" }}>
                    No verified GSC properties found for this account.
                  </div>
                )}
                {sites.length > 0 && (
                  <table className="qa-table" style={{ width: "100%", marginTop: 4 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Site URL</th>
                        <th style={{ textAlign: "right" }}>Permission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sites.map((s) => (
                        <tr key={s.siteUrl} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: "monospace", wordBreak: "break-all" }}>
                            {s.siteUrl}
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: "var(--text-secondary)" }}>
                            {s.permissionLevel.replace(/^site/, "")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="qa-panel" style={{ padding: 20, flex: "1 1 420px" }}>
                <div className="qa-panel-title">Analytics 4 properties</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
                  Properties from <code>analyticsadmin/v1beta/accountSummaries</code>. Each property can return real
                  sessions, users, engagement, and per-page views via the Data API.
                </div>
                {propertiesError && <div className="qa-alert qa-alert--error">{propertiesError}</div>}
                {!propertiesError && properties.length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", padding: "12px 0" }}>
                    No GA4 properties found for this account.
                  </div>
                )}
                {properties.length > 0 && (
                  <table className="qa-table" style={{ width: "100%", marginTop: 4 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Property</th>
                        <th style={{ textAlign: "left" }}>Account</th>
                        <th style={{ textAlign: "right" }}>ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {properties.map((p) => (
                        <tr key={p.propertyId} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "6px 10px", fontSize: 12, fontWeight: 500 }}>{p.displayName}</td>
                          <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-secondary)" }}>
                            {p.parentAccount}
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)" }}>
                            {p.propertyId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {status.connected && (sites.length > 0 || properties.length > 0) && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">What you unlocked</div>
              <ul style={{ fontSize: 13, lineHeight: 1.7, marginTop: 8, paddingLeft: 20, color: "var(--text-secondary)" }}>
                <li>
                  <strong>Position Tracking</strong> — real average SERP position per keyword from GSC, labeled
                  first-party instead of scraped.
                </li>
                <li>
                  <strong>Content Audit</strong> — real sessions, active users, and page views from GA4 overlaid on
                  top of the deterministic quality score.
                </li>
                <li>
                  <strong>Top Pages / Traffic Analytics</strong> — real click and impression counts from GSC for any
                  verified site.
                </li>
                <li>
                  <strong>Keyword Overview</strong> — real clicks and impressions from GSC when the keyword already
                  ranks on a verified site.
                </li>
              </ul>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
