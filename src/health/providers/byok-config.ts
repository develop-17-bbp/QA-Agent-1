/**
 * BYOK ("Bring Your Own Key") config reader.
 *
 * When customers have their own subscription to DataForSEO / Ahrefs Site Explorer
 * API / Semrush API / SerpAPI, we let them paste keys into .env instead of
 * forcing them to pay us to proxy data they already own. This is the
 * structural advantage over Semrush/Ahrefs pricing — we charge for the
 * interface + AI + automation, not for the data when the customer has it.
 *
 * Every paid-provider integration in QA-Agent reads through this helper so
 * the "which keys are configured" question has a single source of truth
 * that the /integrations hub can surface.
 *
 * NO integration actually uses these yet — this commit is pure scaffolding
 * so later per-provider commits have a typed reader to plug into.
 */

export interface ByokConfig {
  dataforseo?: { login: string; password: string };
  ahrefs?: { token: string };
  semrush?: { apiKey: string };
  serpapi?: { apiKey: string };
  moz?: { accessId: string; secretKey: string };
}

export type ByokProvider = keyof ByokConfig;

function trim(s: string | undefined): string {
  return (s ?? "").trim();
}

/** Read every BYOK key currently populated in process.env. Values not set
 *  or blank are omitted — callers should `?.` their way through so "not
 *  configured" degrades gracefully. */
export function getByokConfig(): ByokConfig {
  const out: ByokConfig = {};

  const dfsLogin = trim(process.env.DATAFORSEO_LOGIN);
  const dfsPassword = trim(process.env.DATAFORSEO_PASSWORD);
  if (dfsLogin && dfsPassword) {
    out.dataforseo = { login: dfsLogin, password: dfsPassword };
  }

  const ahrefsToken = trim(process.env.AHREFS_API_TOKEN);
  if (ahrefsToken) out.ahrefs = { token: ahrefsToken };

  const semrushKey = trim(process.env.SEMRUSH_API_KEY);
  if (semrushKey) out.semrush = { apiKey: semrushKey };

  const serpapiKey = trim(process.env.SERPAPI_KEY);
  if (serpapiKey) out.serpapi = { apiKey: serpapiKey };

  const mozAccessId = trim(process.env.MOZ_ACCESS_ID);
  const mozSecret = trim(process.env.MOZ_SECRET_KEY);
  if (mozAccessId && mozSecret) {
    out.moz = { accessId: mozAccessId, secretKey: mozSecret };
  }

  return out;
}

/** Quick "is this provider configured?" check for UI status dots. */
export function isByokProviderConfigured(p: ByokProvider): boolean {
  const c = getByokConfig();
  return c[p] !== undefined;
}

/** List of every BYOK provider with its configured-ness + marketing copy
 *  for the Connections hub. */
export interface ByokProviderInfo {
  id: ByokProvider;
  label: string;
  description: string;
  signUpUrl: string;
  pricingHint: string;
  configured: boolean;
  envVars: string[];
}

export function listByokProviders(): ByokProviderInfo[] {
  const cfg = getByokConfig();
  return [
    {
      id: "dataforseo",
      label: "DataForSEO",
      description: "Backlink DB (~10% of Ahrefs coverage), SERP API, Keyword volumes, On-Page API. Cheapest paid tier.",
      signUpUrl: "https://dataforseo.com/apis",
      pricingHint: "Pay-per-request, ~$50/mo typical spend",
      configured: cfg.dataforseo !== undefined,
      envVars: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    },
    {
      id: "ahrefs",
      label: "Ahrefs Site Explorer API",
      description: "Full 35-trillion-link index for any URL lookup. The gold standard for backlink research.",
      signUpUrl: "https://ahrefs.com/api",
      pricingHint: "$500/mo minimum for API access",
      configured: cfg.ahrefs !== undefined,
      envVars: ["AHREFS_API_TOKEN"],
    },
    {
      id: "semrush",
      label: "Semrush API",
      description: "Keyword DB, backlink DB, competitor analysis. Pay-per-unit.",
      signUpUrl: "https://www.semrush.com/api-documentation/",
      pricingHint: "Usage-based, from $200/mo",
      configured: cfg.semrush !== undefined,
      envVars: ["SEMRUSH_API_KEY"],
    },
    {
      id: "serpapi",
      label: "SerpAPI",
      description: "Real Google SERP with proxies and CAPTCHA handling. Better than our DDG / Startpage proxies for scale.",
      signUpUrl: "https://serpapi.com/",
      pricingHint: "$50/mo for 5k searches",
      configured: cfg.serpapi !== undefined,
      envVars: ["SERPAPI_KEY"],
    },
    {
      id: "moz",
      label: "Moz Link Explorer API",
      description: "Moz Domain Authority + Page Authority + link index. Different data than Ahrefs.",
      signUpUrl: "https://moz.com/products/api",
      pricingHint: "Medium tier ~$100/mo",
      configured: cfg.moz !== undefined,
      envVars: ["MOZ_ACCESS_ID", "MOZ_SECRET_KEY"],
    },
  ];
}
