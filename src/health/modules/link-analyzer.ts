import type { SiteHealthReport } from "../types.js";

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

export function analyzeBacklinks(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const linkChecks = reports.flatMap(r => r.crawl.linkChecks ?? []);
  const brokenLinks = reports.flatMap(r => r.crawl.brokenLinks);
  const hostnames = new Set(reports.map(r => r.hostname));

  const inboundCount = new Map<string, number>();
  for (const check of linkChecks) {
    inboundCount.set(check.target, (inboundCount.get(check.target) ?? 0) + 1);
  }

  const topLinked = [...inboundCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([url, count]) => ({ url, inboundLinks: count }));

  const linkedUrls = new Set(inboundCount.keys());
  const orphanPages = allPages.filter(p => p.ok && !linkedUrls.has(p.url)).map(p => ({ url: p.url, title: p.documentTitle ?? "" })).slice(0, 30);

  const internalCount = linkChecks.filter(l => hostnames.has(safeHostname(l.target))).length;
  const externalCount = linkChecks.filter(l => !hostnames.has(safeHostname(l.target))).length;
  const healthy = linkChecks.filter(l => l.ok).length;
  const redirected = linkChecks.filter(l => l.status >= 300 && l.status < 400).length;

  return {
    totalLinks: linkChecks.length + brokenLinks.length,
    internalLinks: internalCount,
    externalLinks: externalCount,
    topLinked,
    orphanPages,
    healthDistribution: { healthy, broken: brokenLinks.length, redirected },
    brokenLinks: brokenLinks.slice(0, 30).map(bl => ({ source: bl.foundOn, target: bl.target, status: bl.status ?? 0, error: bl.error ?? "" })),
    summary: { totalPages: allPages.length, pagesWithInboundLinks: linkedUrls.size, orphanPageCount: orphanPages.length, avgLinksPerPage: allPages.length > 0 ? +(linkChecks.length / allPages.length).toFixed(1) : 0 },
  };
}

export function analyzeReferringDomains(reports: SiteHealthReport[]) {
  const linkChecks = reports.flatMap(r => r.crawl.linkChecks ?? []);
  const hostnames = new Set(reports.map(r => r.hostname));

  const domainMap = new Map<string, { urls: string[]; ok: number; broken: number }>();
  for (const check of linkChecks) {
    const host = safeHostname(check.target);
    if (hostnames.has(host)) continue;
    const entry = domainMap.get(host) ?? { urls: [], ok: 0, broken: 0 };
    if (entry.urls.length < 10) entry.urls.push(check.target);
    if (check.ok) entry.ok++; else entry.broken++;
    domainMap.set(host, entry);
  }

  const sections = [...domainMap.entries()]
    .sort((a, b) => (b[1].ok + b[1].broken) - (a[1].ok + a[1].broken))
    .slice(0, 30)
    .map(([domain, data]) => ({
      domain,
      totalLinks: data.ok + data.broken,
      healthyLinks: data.ok,
      brokenLinks: data.broken,
      trustScore: +(data.ok / Math.max(1, data.ok + data.broken) * 100).toFixed(1),
      sampleUrls: data.urls.slice(0, 5),
    }));

  return {
    sections,
    totalDomains: domainMap.size,
    authorityDistribution: { high: sections.filter(s => s.trustScore >= 80).length, medium: sections.filter(s => s.trustScore >= 50 && s.trustScore < 80).length, low: sections.filter(s => s.trustScore < 50).length },
    summary: { totalExternalDomains: domainMap.size, avgTrustScore: sections.length > 0 ? +(sections.reduce((a, s) => a + s.trustScore, 0) / sections.length).toFixed(1) : 0 },
  };
}

export function auditBacklinks(reports: SiteHealthReport[]) {
  const linkChecks = reports.flatMap(r => r.crawl.linkChecks ?? []);
  const brokenLinks = reports.flatMap(r => r.crawl.brokenLinks);

  const healthy = linkChecks.filter(l => l.ok).length;
  const broken = brokenLinks.length;
  const redirected = linkChecks.filter(l => l.status >= 300 && l.status < 400).length;
  const serverErrors = linkChecks.filter(l => l.status >= 500).length;
  const clientErrors = linkChecks.filter(l => l.status >= 400 && l.status < 500).length;
  const totalChecked = linkChecks.length + brokenLinks.length;
  const toxicPercent = totalChecked > 0 ? +((broken + serverErrors) / totalChecked * 100).toFixed(1) : 0;

  const links = [
    ...brokenLinks.map(bl => ({ url: bl.target, source: bl.foundOn, status: bl.status ?? 0, health: "broken" as const, reason: bl.error ?? `HTTP ${bl.status}` })),
    ...linkChecks.filter(l => !l.ok || l.status >= 300).slice(0, 50).map(l => ({ url: l.target, source: "", status: l.status, health: (l.status >= 500 ? "server-error" : l.status >= 400 ? "client-error" : "redirect") as string, reason: `HTTP ${l.status}` })),
  ].slice(0, 50);

  return {
    healthy, broken, redirected, serverErrors, clientErrors, links, toxicPercent,
    overallScore: totalChecked > 0 ? Math.max(0, Math.round(100 - toxicPercent * 2)) : 100,
    statusDistribution: { "2xx": linkChecks.filter(l => l.status >= 200 && l.status < 300).length, "3xx": redirected, "4xx": clientErrors, "5xx": serverErrors },
    summary: { totalChecked, healthyPercent: totalChecked > 0 ? +((healthy / totalChecked) * 100).toFixed(1) : 100, actionRequired: broken + serverErrors },
  };
}
