import type { SiteHealthReport } from "../types.js";

export async function trackPosts(reports: SiteHealthReport[], baseline?: SiteHealthReport[]) {
  const currentPages = reports.flatMap(r => r.crawl.pages);
  const baselinePages = baseline ? baseline.flatMap(r => r.crawl.pages) : [];
  const baselineMap = new Map(baselinePages.map(p => [p.url, p]));

  const posts = currentPages.filter(p => p.ok).map(p => {
    const prev = baselineMap.get(p.url);
    const titleChanged = prev ? prev.documentTitle !== p.documentTitle : false;
    const statusChanged = prev ? prev.status !== p.status : false;
    const sizeChange = prev && prev.bodyBytes && p.bodyBytes ? p.bodyBytes - prev.bodyBytes : 0;
    const speedChange = prev ? p.durationMs - prev.durationMs : 0;

    let performanceScore = 0;
    if (p.documentTitle) performanceScore += 20;
    if ((p.metaDescriptionLength ?? 0) > 0) performanceScore += 20;
    if (p.h1Count === 1) performanceScore += 20;
    if (p.canonicalUrl) performanceScore += 15;
    if (p.durationMs < 2000) performanceScore += 15;
    if (p.status === 200) performanceScore += 10;

    return {
      url: p.url,
      title: p.documentTitle ?? "",
      status: p.status,
      performanceScore: Math.min(100, performanceScore),
      loadTimeMs: p.durationMs,
      bodyBytes: p.bodyBytes ?? 0,
      changes: {
        titleChanged,
        statusChanged,
        sizeChange,
        speedChange,
        isNew: !prev,
        isRemoved: false,
      },
    };
  });

  // Detect removed pages
  const currentUrls = new Set(currentPages.map(p => p.url));
  const removedPosts = baselinePages.filter(p => !currentUrls.has(p.url)).map(p => ({
    url: p.url,
    title: p.documentTitle ?? "",
    status: 0,
    performanceScore: 0,
    loadTimeMs: 0,
    bodyBytes: 0,
    changes: { titleChanged: false, statusChanged: true, sizeChange: 0, speedChange: 0, isNew: false, isRemoved: true },
  }));

  const allPosts = [...posts, ...removedPosts];
  const changes = allPosts.filter(p => p.changes.titleChanged || p.changes.statusChanged || p.changes.isNew || p.changes.isRemoved || Math.abs(p.changes.sizeChange) > 500);

  const trends = {
    newPages: allPosts.filter(p => p.changes.isNew).length,
    removedPages: removedPosts.length,
    modifiedPages: changes.filter(p => !p.changes.isNew && !p.changes.isRemoved).length,
    avgPerformance: posts.length > 0 ? Math.round(posts.reduce((a, p) => a + p.performanceScore, 0) / posts.length) : 0,
    avgLoadTime: posts.length > 0 ? Math.round(posts.reduce((a, p) => a + p.loadTimeMs, 0) / posts.length) : 0,
    hasBaseline: baseline !== undefined && baseline.length > 0,
  };

  return { posts: allPosts.slice(0, 50), changes: changes.slice(0, 30), trends };
}
