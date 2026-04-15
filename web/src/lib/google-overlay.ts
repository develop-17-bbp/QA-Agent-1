/**
 * Shared Google Search Console + GA4 overlay helpers.
 *
 * When the user has connected Google via /google-connections, every page
 * that shows keyword, page, or traffic data can overlay real first-party
 * numbers on top of the crawl / DDG / free-provider signals. The helpers
 * in this file:
 *
 *   - normalize user-typed domains and GSC site entries to comparable hosts
 *   - match a domain against the user's verified GSC property list
 *     (handles both `sc-domain:example.com` and `https://www.example.com/`)
 *   - match a domain against GA4 properties by display name (best-effort,
 *     since GA4 has no direct domain mapping)
 *   - expose a `useGoogleOverlay(domain)` React hook that loads the
 *     connection status + sites + properties once and returns the matched
 *     pair synchronously on every render
 *
 * Failures are silent — the overlay is a bonus, never required for the
 * page to work without a connected account.
 */

import { useEffect, useState } from "react";
import {
  fetchGoogleAuthStatus,
  fetchGscSites,
  fetchGa4Properties,
  type GscSite,
  type Ga4Property,
} from "../api";

/** Strip protocol / www. / path so a user-typed domain matches a hostname. */
export function normalizeDomain(urlOrHost: string): string {
  let host = urlOrHost.trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    /* not a URL, treat as-is */
  }
  return host.replace(/^www\./, "").replace(/\/.*$/, "");
}

/**
 * Given the user's verified GSC sites and a target domain, find the entry
 * that matches with subdomain-or-exact rules — so `wikipedia.org` correctly
 * matches `en.wikipedia.org` the same way the DDG host matcher does.
 */
export function findMatchingGscSite(sites: GscSite[], domain: string): GscSite | null {
  const clean = normalizeDomain(domain);
  if (!clean) return null;
  for (const s of sites) {
    const url = s.siteUrl;
    let host = "";
    if (url.startsWith("sc-domain:")) {
      host = url.slice("sc-domain:".length).toLowerCase();
    } else {
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        continue;
      }
    }
    if (host === clean || clean.endsWith("." + host) || host.endsWith("." + clean)) return s;
  }
  return null;
}

/**
 * GA4 properties have no direct domain mapping — users name them whatever
 * they want. We try (a) display-name contains domain, then (b) display-name
 * contains the bare second-level label. Best-effort; users can override by
 * picking a property from a dropdown.
 */
export function findMatchingGa4Property(properties: Ga4Property[], domain: string): Ga4Property | null {
  const clean = normalizeDomain(domain);
  if (!clean || properties.length === 0) return null;
  for (const p of properties) {
    const dn = p.displayName.toLowerCase();
    if (dn === clean || dn.includes(clean)) return p;
  }
  const bare = clean.split(".")[0];
  if (bare && bare.length >= 3) {
    for (const p of properties) {
      if (p.displayName.toLowerCase().includes(bare)) return p;
    }
  }
  return null;
}

/**
 * Convert a full URL to a pathname (defaults to "/"). Used to match rows
 * back against GSC `page` and GA4 `pagePath` dimensions.
 */
export function toPathname(urlOrPath: string): string {
  try {
    return new URL(urlOrPath).pathname || "/";
  } catch {
    if (urlOrPath.startsWith("/")) return urlOrPath;
    return urlOrPath;
  }
}

export interface GoogleOverlayState {
  connected: boolean;
  gscSites: GscSite[];
  ga4Properties: Ga4Property[];
  matchedGscSite: GscSite | null;
  matchedGa4Property: Ga4Property | null;
  loaded: boolean;
}

/**
 * Load Google connection status + GSC sites + GA4 properties on mount,
 * then return both the raw lists and the entry matched against `domain`
 * (if provided). Re-deriving the match on every render is cheap — the
 * lists rarely exceed ~20 entries.
 */
export function useGoogleOverlay(domain?: string): GoogleOverlayState {
  const [state, setState] = useState<{
    connected: boolean;
    gscSites: GscSite[];
    ga4Properties: Ga4Property[];
    loaded: boolean;
  }>({ connected: false, gscSites: [], ga4Properties: [], loaded: false });

  useEffect(() => {
    let cancelled = false;
    fetchGoogleAuthStatus()
      .then(async (status) => {
        if (cancelled) return;
        if (!status.connected) {
          setState({ connected: false, gscSites: [], ga4Properties: [], loaded: true });
          return;
        }
        const [sites, props] = await Promise.all([
          fetchGscSites().catch(() => [] as GscSite[]),
          fetchGa4Properties().catch(() => [] as Ga4Property[]),
        ]);
        if (!cancelled) {
          setState({ connected: true, gscSites: sites, ga4Properties: props, loaded: true });
        }
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loaded: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matchedGscSite = domain ? findMatchingGscSite(state.gscSites, domain) : null;
  const matchedGa4Property = domain ? findMatchingGa4Property(state.ga4Properties, domain) : null;

  return { ...state, matchedGscSite, matchedGa4Property };
}
