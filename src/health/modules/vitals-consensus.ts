/**
 * Web Vitals Consensus producer — compare lab measurements (PageSpeed /
 * Lighthouse) with field measurements (Chrome UX Report) for each URL,
 * across both mobile and desktop form factors.
 *
 * The product value: lab scores are what developers see in their CI; field
 * scores are what real users experience. When they AGREE, the site is in
 * the shape the dev team thinks it's in. When they DISAGREE — e.g., lab
 * LCP is 2s but CrUX field p75 is 5s — real users are having a worse (or
 * occasionally better) experience than the lab run suggests, and that gap
 * is where most perf regressions hide.
 *
 * Four sources probed per URL in parallel:
 *   - psi-mobile   — lab Lighthouse on a mobile profile
 *   - psi-desktop  — lab Lighthouse on a desktop profile
 *   - crux-phone   — real-user field p75s from Chrome UX Report (PHONE)
 *   - crux-desktop — real-user field p75s (DESKTOP)
 *
 * Agenda items are URLs. Tiering is by how many sources returned data:
 *   tierTop    — 3+ sources (both labs + at least 1 CrUX) = full picture
 *   tierMid    — 2 sources
 *   tierBottom — 1 source — e.g. page too new for CrUX sampling
 *
 * Advisors: performance engineer, mobile lead, CRO analyst, devex.
 */

import { fetchPageSpeedInsights, resolvePageSpeedApiKey } from "../pagespeed-insights.js";
import { fetchCruxRecord, isCruxConfigured } from "../providers/crux.js";
import type { CouncilContext, CouncilAgendaItem, CouncilAdvisor } from "./council-types.js";

const VITALS_ADVISORS: CouncilAdvisor[] = [
  { id: "perfEngineer", name: "Performance Engineer", focus: "What the specific metric gaps tell us about the real bottleneck — LCP element, long tasks, layout thrash" },
  { id: "mobileLead", name: "Mobile Lead", focus: "Mobile-first interpretation — does the mobile-vs-desktop gap match user behavior?" },
  { id: "croAnalyst", name: "CRO Analyst", focus: "Conversion-impact of the measured page — is the visible-to-visitor delay material to revenue?" },
  { id: "devex", name: "DevEx Lead", focus: "Build / deploy / tooling changes needed to close lab-vs-field gaps sustainably" },
];

type UrlBucket = {
  sources: Set<string>;
  // Lab (from PSI Lighthouse)
  labLcpMobile?: number;  // ms
  labLcpDesktop?: number;
  labClsMobile?: number;
  labClsDesktop?: number;
  labPerfMobile?: number; // 0-100
  labPerfDesktop?: number;
  // Field (from CrUX)
  fieldLcpPhone?: number;     // ms
  fieldLcpDesktop?: number;
  fieldClsPhone?: number;
  fieldClsDesktop?: number;
  fieldInpPhone?: number;
  fieldInpDesktop?: number;
};

function normalizeUrl(u: string, domain: string): string {
  const s = u.trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  // Treat "/blog" as "https://<domain>/blog"
  const host = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return `https://${host}${s.startsWith("/") ? s : `/${s}`}`;
}

function gapSeverity(b: UrlBucket): "none" | "small" | "large" {
  // Compare field p75 LCP (phone or desktop) vs corresponding lab LCP.
  const pairs: [number | undefined, number | undefined][] = [
    [b.fieldLcpPhone, b.labLcpMobile],
    [b.fieldLcpDesktop, b.labLcpDesktop],
  ];
  let maxGapMs = 0;
  for (const [field, lab] of pairs) {
    if (typeof field !== "number" || typeof lab !== "number") continue;
    maxGapMs = Math.max(maxGapMs, Math.abs(field - lab));
  }
  if (maxGapMs === 0) return "none";
  if (maxGapMs < 1000) return "small";
  return "large";
}

function score(b: UrlBucket): number {
  const agreement = Math.min(b.sources.size / 4, 1) * 60;
  // Perf-inverted: a page that's consistently FAST across sources ranks
  // high-value; a page in 4 sources that's all slow ranks high-need.
  // Use the best available lab performance score as magnitude (0-100).
  const labPerf = b.labPerfMobile ?? b.labPerfDesktop ?? 50;
  const magnitude = (labPerf / 100) * 40;
  return Math.round(agreement + magnitude);
}

export interface BuildVitalsCouncilInput {
  domain: string;
  /** Optional URL list. If empty, defaults to just the homepage. */
  urls?: string[];
}

async function probeUrl(u: string, psiKey: string | undefined): Promise<UrlBucket> {
  const b: UrlBucket = { sources: new Set() };

  await Promise.all([
    (async () => {
      if (!psiKey) return;
      try {
        const r = await fetchPageSpeedInsights(u, { apiKey: psiKey, strategy: "mobile", timeoutMs: 60_000 });
        if (r.metrics?.lcpMs != null) b.labLcpMobile = r.metrics.lcpMs;
        if (r.metrics?.cls != null) b.labClsMobile = r.metrics.cls;
        if (r.scores?.performance != null) b.labPerfMobile = r.scores.performance;
        if (r.metrics?.lcpMs != null || r.scores?.performance != null) b.sources.add("psi-mobile");
      } catch { /* ignore */ }
    })(),
    (async () => {
      if (!psiKey) return;
      try {
        const r = await fetchPageSpeedInsights(u, { apiKey: psiKey, strategy: "desktop", timeoutMs: 60_000 });
        if (r.metrics?.lcpMs != null) b.labLcpDesktop = r.metrics.lcpMs;
        if (r.metrics?.cls != null) b.labClsDesktop = r.metrics.cls;
        if (r.scores?.performance != null) b.labPerfDesktop = r.scores.performance;
        if (r.metrics?.lcpMs != null || r.scores?.performance != null) b.sources.add("psi-desktop");
      } catch { /* ignore */ }
    })(),
    (async () => {
      if (!isCruxConfigured()) return;
      try {
        const r = await fetchCruxRecord(u, "PHONE");
        if (r?.lcp?.value?.p75 != null) b.fieldLcpPhone = r.lcp.value.p75;
        if (r?.cls?.value?.p75 != null) b.fieldClsPhone = r.cls.value.p75;
        if (r?.inp?.value?.p75 != null) b.fieldInpPhone = r.inp.value.p75;
        if (r?.lcp?.value?.p75 != null) b.sources.add("crux-phone");
      } catch { /* ignore */ }
    })(),
    (async () => {
      if (!isCruxConfigured()) return;
      try {
        const r = await fetchCruxRecord(u, "DESKTOP");
        if (r?.lcp?.value?.p75 != null) b.fieldLcpDesktop = r.lcp.value.p75;
        if (r?.cls?.value?.p75 != null) b.fieldClsDesktop = r.cls.value.p75;
        if (r?.inp?.value?.p75 != null) b.fieldInpDesktop = r.inp.value.p75;
        if (r?.lcp?.value?.p75 != null) b.sources.add("crux-desktop");
      } catch { /* ignore */ }
    })(),
  ]);

  return b;
}

export async function buildVitalsCouncilContext(input: BuildVitalsCouncilInput): Promise<CouncilContext> {
  const domain = input.domain.trim();
  const rawUrls = (input.urls ?? []).map((u) => normalizeUrl(u, domain)).filter(Boolean);
  const urls = rawUrls.length > 0 ? rawUrls : [normalizeUrl("/", domain)];
  const capped = urls.slice(0, 6); // each URL costs 4 API calls; cap to keep latency bounded

  const queried = new Set<string>();
  const failed: { source: string; reason: string }[] = [];
  const psiKey = resolvePageSpeedApiKey();
  if (!psiKey) failed.push({ source: "psi", reason: "PAGESPEED_API_KEY not set — lab scores will be empty" });
  if (!isCruxConfigured()) failed.push({ source: "crux", reason: "CRUX_API_KEY (or GOOGLE_API_KEY) not set — field scores will be empty" });

  const probes = await Promise.all(capped.map((u) => probeUrl(u, psiKey).then((b) => ({ u, b }))));
  for (const { b } of probes) for (const s of b.sources) queried.add(s);

  const items: CouncilAgendaItem[] = probes.map(({ u, b }) => {
    const sev = gapSeverity(b);
    return {
      id: u,
      label: u,
      sublabel: b.sources.size === 0
        ? "no data"
        : sev === "large"
        ? `⚠ lab ≠ field gap — ${b.sources.size}/4 sources`
        : `${b.sources.size}/4 sources agree`,
      sources: [...b.sources].sort(),
      metrics: {
        labLcpMobileMs: b.labLcpMobile != null ? Math.round(b.labLcpMobile) : undefined,
        labLcpDesktopMs: b.labLcpDesktop != null ? Math.round(b.labLcpDesktop) : undefined,
        fieldLcpPhoneMs: b.fieldLcpPhone,
        fieldLcpDesktopMs: b.fieldLcpDesktop,
        fieldInpPhoneMs: b.fieldInpPhone,
        fieldClsPhone: b.fieldClsPhone != null ? +b.fieldClsPhone.toFixed(3) : undefined,
        labClsMobile: b.labClsMobile != null ? +b.labClsMobile.toFixed(3) : undefined,
        labPerfMobile: b.labPerfMobile,
        labPerfDesktop: b.labPerfDesktop,
        labFieldGap: sev,
      },
      score: score(b),
    };
  });
  items.sort((a, b) => b.score - a.score);

  return {
    feature: "vitals",
    featureLabel: "Web Vitals Council",
    featureTagline: "Lab (PageSpeed) vs. field (Chrome UX Report) agreement per URL. Big lab-vs-field gaps expose performance regressions developer profiling misses.",
    target: domain,
    sourcesQueried: [...queried].sort(),
    sourcesFailed: failed,
    tierTop: items.filter((i) => i.sources.length >= 3),
    tierMid: items.filter((i) => i.sources.length === 2),
    tierBottom: items.filter((i) => i.sources.length <= 1),
    totalItems: items.length,
    collectedAt: new Date().toISOString(),
    advisors: VITALS_ADVISORS,
  };
}
