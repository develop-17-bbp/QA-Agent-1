import type { SiteHealthReport } from "../types.js";
import { generateGeminiText } from "../gemini-report.js";

interface OnPageCheck {
  element: string;
  status: "pass" | "warning" | "fail";
  score: number;
  value: string;
  recommendation: string;
}

export async function checkOnPageSeo(url: string, reports: SiteHealthReport[]) {
  // Find the page
  let page: any = null;
  for (const r of reports) {
    const found = r.crawl.pages.find(p => p.url === url);
    if (found) { page = found; break; }
  }

  if (!page) {
    // If no specific URL, analyze first page
    const firstPage = reports[0]?.crawl.pages.find(p => p.ok);
    if (!firstPage) return { url, overallScore: 0, checks: [], recommendations: "No pages found in crawl data." };
    page = firstPage;
  }

  const checks: OnPageCheck[] = [];

  // Title check
  const title = page.documentTitle || "";
  if (!title) {
    checks.push({ element: "Title Tag", status: "fail", score: 0, value: "Missing", recommendation: "Add a unique, descriptive title tag (30-60 characters)" });
  } else if (title.length < 30) {
    checks.push({ element: "Title Tag", status: "warning", score: 50, value: `${title.length} chars: "${title}"`, recommendation: "Title is too short. Aim for 30-60 characters with primary keyword near the start" });
  } else if (title.length > 60) {
    checks.push({ element: "Title Tag", status: "warning", score: 60, value: `${title.length} chars`, recommendation: "Title may be truncated in SERPs. Keep under 60 characters" });
  } else {
    checks.push({ element: "Title Tag", status: "pass", score: 90, value: `${title.length} chars: "${title}"`, recommendation: "Good title length" });
  }

  // Meta description
  const metaLen = page.metaDescriptionLength ?? 0;
  if (metaLen === 0) {
    checks.push({ element: "Meta Description", status: "fail", score: 0, value: "Missing", recommendation: "Add a compelling meta description (120-160 characters)" });
  } else if (metaLen < 120) {
    checks.push({ element: "Meta Description", status: "warning", score: 50, value: `${metaLen} chars`, recommendation: "Meta description is short. Aim for 120-160 characters" });
  } else if (metaLen > 160) {
    checks.push({ element: "Meta Description", status: "warning", score: 60, value: `${metaLen} chars`, recommendation: "Meta description may be truncated. Keep under 160 characters" });
  } else {
    checks.push({ element: "Meta Description", status: "pass", score: 90, value: `${metaLen} chars`, recommendation: "Good meta description length" });
  }

  // H1 check
  const h1Count = page.h1Count ?? 0;
  if (h1Count === 0) {
    checks.push({ element: "H1 Heading", status: "fail", score: 0, value: "Missing", recommendation: "Add exactly one H1 heading with your primary keyword" });
  } else if (h1Count > 1) {
    checks.push({ element: "H1 Heading", status: "warning", score: 50, value: `${h1Count} H1s`, recommendation: "Use only one H1 per page for optimal SEO" });
  } else {
    checks.push({ element: "H1 Heading", status: "pass", score: 100, value: "1 H1 found", recommendation: "Good -- single H1 tag present" });
  }

  // Canonical
  if (!page.canonicalUrl) {
    checks.push({ element: "Canonical URL", status: "warning", score: 40, value: "Missing", recommendation: "Add a canonical URL to prevent duplicate content issues" });
  } else {
    checks.push({ element: "Canonical URL", status: "pass", score: 100, value: page.canonicalUrl, recommendation: "Canonical URL is set" });
  }

  // Language
  if (!page.documentLang) {
    checks.push({ element: "Language Attribute", status: "warning", score: 50, value: "Missing", recommendation: "Add a lang attribute to the HTML element" });
  } else {
    checks.push({ element: "Language Attribute", status: "pass", score: 100, value: page.documentLang, recommendation: "Language attribute present" });
  }

  // Page speed
  const loadMs = page.durationMs ?? 0;
  if (loadMs > 8000) {
    checks.push({ element: "Page Speed", status: "fail", score: 10, value: `${(loadMs/1000).toFixed(1)}s`, recommendation: "Page is extremely slow. Optimize images, minimize JS/CSS, use CDN" });
  } else if (loadMs > 4000) {
    checks.push({ element: "Page Speed", status: "warning", score: 40, value: `${(loadMs/1000).toFixed(1)}s`, recommendation: "Page is slow. Aim for under 3 seconds load time" });
  } else if (loadMs > 2000) {
    checks.push({ element: "Page Speed", status: "warning", score: 65, value: `${(loadMs/1000).toFixed(1)}s`, recommendation: "Acceptable speed, but could be faster" });
  } else {
    checks.push({ element: "Page Speed", status: "pass", score: 90, value: `${(loadMs/1000).toFixed(1)}s`, recommendation: "Good page speed" });
  }

  // Content depth
  const bytes = page.bodyBytes ?? 0;
  if (bytes < 1000) {
    checks.push({ element: "Content Depth", status: "fail", score: 10, value: `~${Math.round(bytes/5)} words`, recommendation: "Very thin content. Add substantial, valuable content (aim for 300+ words)" });
  } else if (bytes < 3000) {
    checks.push({ element: "Content Depth", status: "warning", score: 50, value: `~${Math.round(bytes/5)} words`, recommendation: "Light content. Consider expanding with more detail" });
  } else {
    checks.push({ element: "Content Depth", status: "pass", score: 85, value: `~${Math.round(bytes/5)} words`, recommendation: "Good content depth" });
  }

  // Status code
  if (page.status === 200) {
    checks.push({ element: "HTTP Status", status: "pass", score: 100, value: "200 OK", recommendation: "Page returns correct status" });
  } else {
    checks.push({ element: "HTTP Status", status: "fail", score: 0, value: `${page.status}`, recommendation: `Page returns ${page.status}. Ensure pages return 200 status code` });
  }

  const overallScore = Math.round(checks.reduce((a, c) => a + c.score, 0) / checks.length);

  // Get Gemini recommendations
  let recommendations = "";
  try {
    const prompt = `You are an SEO expert. Given this page analysis for ${page.url}:
${checks.map(c => `- ${c.element}: ${c.status} (${c.value})`).join("\n")}

Provide 3-5 specific, actionable improvement recommendations in markdown bullet points. Be concise (max 150 words total). Focus on the highest-impact changes.`;
    recommendations = await generateGeminiText(prompt);
  } catch {
    recommendations = checks.filter(c => c.status !== "pass").map(c => `- **${c.element}**: ${c.recommendation}`).join("\n");
  }

  return { url: page.url, overallScore, checks, recommendations };
}
