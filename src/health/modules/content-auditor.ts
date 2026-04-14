import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";

export async function auditContent(reports: SiteHealthReport[]) {
  const allPages = reports.flatMap(r => r.crawl.pages);
  const okPages = allPages.filter(p => p.ok);

  const pages = okPages.map(p => {
    let qualityScore = 0;
    const issues: string[] = [];

    // Title analysis
    if (p.documentTitle?.trim()) {
      qualityScore += 15;
      if (p.documentTitle.length < 30) { issues.push("Title too short"); qualityScore -= 5; }
      if (p.documentTitle.length > 70) { issues.push("Title too long"); qualityScore -= 3; }
    } else { issues.push("Missing title"); }

    // Meta description
    if (p.metaDescriptionLength && p.metaDescriptionLength > 0) {
      qualityScore += 15;
      if (p.metaDescriptionLength < 120) { issues.push("Meta description too short"); qualityScore -= 3; }
      if (p.metaDescriptionLength > 160) { issues.push("Meta description too long"); qualityScore -= 3; }
    } else { issues.push("Missing meta description"); }

    // Heading structure
    if (p.h1Count === 1) qualityScore += 15;
    else if (p.h1Count === 0) issues.push("Missing H1");
    else { issues.push("Multiple H1 tags"); qualityScore += 5; }

    // Content depth
    if (p.bodyBytes && p.bodyBytes > 5000) qualityScore += 15;
    else if (p.bodyBytes && p.bodyBytes > 1000) { qualityScore += 8; issues.push("Thin content"); }
    else issues.push("Very thin content");

    // Technical
    if (p.canonicalUrl) qualityScore += 10;
    else issues.push("Missing canonical");
    if (p.documentLang) qualityScore += 5;
    if (p.durationMs < 2000) qualityScore += 10;
    else if (p.durationMs < 4000) qualityScore += 5;
    else issues.push("Slow page load");
    if (p.status === 200) qualityScore += 5;

    const classification = qualityScore >= 70 ? "good" : qualityScore >= 50 ? "needs-improvement" : "poor";

    return {
      url: p.url,
      title: p.documentTitle ?? "",
      qualityScore: Math.max(0, Math.min(100, qualityScore)),
      classification,
      bodyBytes: p.bodyBytes ?? 0,
      loadTimeMs: p.durationMs,
      issues,
    };
  });

  pages.sort((a, b) => a.qualityScore - b.qualityScore);

  const good = pages.filter(p => p.classification === "good").length;
  const needsWork = pages.filter(p => p.classification === "needs-improvement").length;
  const poor = pages.filter(p => p.classification === "poor").length;
  const avgScore = pages.length > 0 ? Math.round(pages.reduce((a, p) => a + p.qualityScore, 0) / pages.length) : 0;

  // Gemini recommendations
  let recommendations: string[] = [];
  if (pages.length > 0) {
    const topIssues = pages.flatMap(p => p.issues).reduce((acc, issue) => { acc.set(issue, (acc.get(issue) ?? 0) + 1); return acc; }, new Map<string, number>());
    const sortedIssues = [...topIssues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    try {
      const prompt = `Given a content audit of ${pages.length} pages with average quality score ${avgScore}/100.
Top issues: ${sortedIssues.map(([i, c]) => `${i} (${c} pages)`).join(", ")}
Good: ${good}, Needs improvement: ${needsWork}, Poor: ${poor}

Return ONLY a JSON array of 5-7 specific actionable recommendations as strings. No markdown.`;
      const text = await generateText(prompt);
      recommendations = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
    } catch { recommendations = ["Review pages with missing titles", "Add meta descriptions to all pages", "Improve thin content pages"]; }
  }

  return {
    pages: pages.slice(0, 50),
    summary: { totalPages: pages.length, avgScore, good, needsImprovement: needsWork, poor },
    recommendations,
    issueBreakdown: [...pages.flatMap(p => p.issues).reduce((acc, i) => { acc.set(i, (acc.get(i) ?? 0) + 1); return acc; }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).map(([issue, count]) => ({ issue, count })),
  };
}
