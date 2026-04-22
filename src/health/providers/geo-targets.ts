/**
 * Shared geo-target catalog for region-aware features (keyword volumes,
 * SERP queries, top pages, etc.). Countries are keyed by ISO-3166-1 alpha-2
 * codes with Google Ads `geoTargetConstants` numeric IDs attached, so the
 * same list powers both the UI dropdown and backend API calls.
 */

export interface GeoTarget {
  /** ISO-3166-1 alpha-2 (e.g. "US") — canonical key across backend + UI. */
  iso: string;
  /** Human-readable name ("United States"). */
  name: string;
  /** Google Ads `geoTargetConstants` numeric ID (for Keyword Planner). */
  googleAdsId: number;
  /** ISO 639-1 language code used when sending SERP / locale-scoped queries. */
  defaultLang: string;
  /** DuckDuckGo region code ("us-en", "uk-en", etc.) — used by SERP scraper. */
  ddgRegion: string;
}

export const GEO_TARGETS: GeoTarget[] = [
  // "WW" = Worldwide / Global — mapped to DDG's worldwide code and a
  // googleAdsId that callers can treat as "no geo constraint" (the
  // keyword-research module already falls through to a global volume
  // query when the region isn't found in country-specific mappings).
  { iso: "WW", name: "Global (Worldwide)", googleAdsId: 2840, defaultLang: "en", ddgRegion: "wt-wt" },
  { iso: "US", name: "United States",      googleAdsId: 2840, defaultLang: "en", ddgRegion: "us-en" },
  { iso: "GB", name: "United Kingdom",     googleAdsId: 2826, defaultLang: "en", ddgRegion: "uk-en" },
  { iso: "CA", name: "Canada",             googleAdsId: 2124, defaultLang: "en", ddgRegion: "ca-en" },
  { iso: "AU", name: "Australia",          googleAdsId: 2036, defaultLang: "en", ddgRegion: "au-en" },
  { iso: "IN", name: "India",              googleAdsId: 2356, defaultLang: "en", ddgRegion: "in-en" },
  { iso: "SG", name: "Singapore",          googleAdsId: 2702, defaultLang: "en", ddgRegion: "sg-en" },
  { iso: "NZ", name: "New Zealand",        googleAdsId: 2554, defaultLang: "en", ddgRegion: "nz-en" },
  { iso: "ZA", name: "South Africa",       googleAdsId: 2710, defaultLang: "en", ddgRegion: "za-en" },
  { iso: "AE", name: "United Arab Emirates", googleAdsId: 2784, defaultLang: "en", ddgRegion: "xa-en" },
  { iso: "PH", name: "Philippines",        googleAdsId: 2608, defaultLang: "en", ddgRegion: "ph-en" },
  { iso: "NG", name: "Nigeria",            googleAdsId: 2566, defaultLang: "en", ddgRegion: "ng-en" },
  { iso: "IE", name: "Ireland",            googleAdsId: 2372, defaultLang: "en", ddgRegion: "ie-en" },
  { iso: "DE", name: "Germany",            googleAdsId: 2276, defaultLang: "de", ddgRegion: "de-de" },
  { iso: "FR", name: "France",             googleAdsId: 2250, defaultLang: "fr", ddgRegion: "fr-fr" },
  { iso: "ES", name: "Spain",              googleAdsId: 2724, defaultLang: "es", ddgRegion: "es-es" },
  { iso: "IT", name: "Italy",              googleAdsId: 2380, defaultLang: "it", ddgRegion: "it-it" },
  { iso: "NL", name: "Netherlands",        googleAdsId: 2528, defaultLang: "nl", ddgRegion: "nl-nl" },
  { iso: "BE", name: "Belgium",            googleAdsId: 2056, defaultLang: "nl", ddgRegion: "be-nl" },
  { iso: "SE", name: "Sweden",             googleAdsId: 2752, defaultLang: "sv", ddgRegion: "se-sv" },
  { iso: "NO", name: "Norway",             googleAdsId: 2578, defaultLang: "no", ddgRegion: "no-no" },
  { iso: "DK", name: "Denmark",            googleAdsId: 2208, defaultLang: "da", ddgRegion: "dk-da" },
  { iso: "FI", name: "Finland",            googleAdsId: 2246, defaultLang: "fi", ddgRegion: "fi-fi" },
  { iso: "PL", name: "Poland",             googleAdsId: 2616, defaultLang: "pl", ddgRegion: "pl-pl" },
  { iso: "PT", name: "Portugal",           googleAdsId: 2620, defaultLang: "pt", ddgRegion: "pt-pt" },
  { iso: "AT", name: "Austria",            googleAdsId: 2040, defaultLang: "de", ddgRegion: "at-de" },
  { iso: "CH", name: "Switzerland",        googleAdsId: 2756, defaultLang: "de", ddgRegion: "ch-de" },
  { iso: "CZ", name: "Czechia",            googleAdsId: 2203, defaultLang: "cs", ddgRegion: "cz-cs" },
  { iso: "GR", name: "Greece",             googleAdsId: 2300, defaultLang: "el", ddgRegion: "gr-el" },
  { iso: "TR", name: "Türkiye",            googleAdsId: 2792, defaultLang: "tr", ddgRegion: "tr-tr" },
  { iso: "IL", name: "Israel",             googleAdsId: 2376, defaultLang: "he", ddgRegion: "il-he" },
  { iso: "BR", name: "Brazil",             googleAdsId: 2076, defaultLang: "pt", ddgRegion: "br-pt" },
  { iso: "MX", name: "Mexico",             googleAdsId: 2484, defaultLang: "es", ddgRegion: "mx-es" },
  { iso: "AR", name: "Argentina",          googleAdsId: 2032, defaultLang: "es", ddgRegion: "ar-es" },
  { iso: "CL", name: "Chile",              googleAdsId: 2152, defaultLang: "es", ddgRegion: "cl-es" },
  { iso: "CO", name: "Colombia",           googleAdsId: 2170, defaultLang: "es", ddgRegion: "co-es" },
  { iso: "PE", name: "Peru",               googleAdsId: 2604, defaultLang: "es", ddgRegion: "pe-es" },
  { iso: "JP", name: "Japan",              googleAdsId: 2392, defaultLang: "ja", ddgRegion: "jp-jp" },
  { iso: "KR", name: "South Korea",        googleAdsId: 2410, defaultLang: "ko", ddgRegion: "kr-kr" },
  { iso: "CN", name: "China",              googleAdsId: 2156, defaultLang: "zh", ddgRegion: "cn-zh" },
  { iso: "HK", name: "Hong Kong",          googleAdsId: 2344, defaultLang: "en", ddgRegion: "hk-tzh" },
  { iso: "TW", name: "Taiwan",             googleAdsId: 2158, defaultLang: "zh", ddgRegion: "tw-tzh" },
  { iso: "TH", name: "Thailand",           googleAdsId: 2764, defaultLang: "th", ddgRegion: "th-th" },
  { iso: "VN", name: "Vietnam",            googleAdsId: 2704, defaultLang: "vi", ddgRegion: "vn-vi" },
  { iso: "ID", name: "Indonesia",          googleAdsId: 2360, defaultLang: "id", ddgRegion: "id-en" },
  { iso: "MY", name: "Malaysia",           googleAdsId: 2458, defaultLang: "en", ddgRegion: "my-en" },
  { iso: "PK", name: "Pakistan",           googleAdsId: 2586, defaultLang: "en", ddgRegion: "pk-en" },
  { iso: "BD", name: "Bangladesh",         googleAdsId: 2050, defaultLang: "en", ddgRegion: "bd-en" },
  { iso: "EG", name: "Egypt",              googleAdsId: 2818, defaultLang: "ar", ddgRegion: "eg-ar" },
  { iso: "SA", name: "Saudi Arabia",       googleAdsId: 2682, defaultLang: "ar", ddgRegion: "xa-ar" },
  { iso: "RU", name: "Russia",             googleAdsId: 2643, defaultLang: "ru", ddgRegion: "ru-ru" },
  { iso: "UA", name: "Ukraine",            googleAdsId: 2804, defaultLang: "uk", ddgRegion: "ua-uk" },
];

const BY_ISO = new Map(GEO_TARGETS.map((g) => [g.iso, g] as const));

export function findGeoTarget(iso: string): GeoTarget | undefined {
  return BY_ISO.get(iso.trim().toUpperCase());
}

export function googleAdsGeoId(iso: string): number {
  return findGeoTarget(iso)?.googleAdsId ?? 2840;
}

export function ddgRegionCode(iso: string): string {
  return findGeoTarget(iso)?.ddgRegion ?? "us-en";
}
