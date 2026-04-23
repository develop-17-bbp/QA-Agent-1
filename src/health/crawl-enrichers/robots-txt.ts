/**
 * Robots.txt enricher — fetches /robots.txt for the crawled origin, parses
 * it into User-agent groups, and reports (a) the effective rules, (b) any
 * declared sitemap URLs, and (c) which of the URLs we crawled would have
 * been blocked if we had been a compliant Googlebot.
 *
 * Note: the QA-Agent crawler intentionally ignores robots.txt today —
 * this enricher is a COMPLIANCE AUDIT (does the site's robots.txt make
 * sense? are we accidentally exposing pages that should be blocked?), not
 * a behavior change. Upgrading the crawler itself to respect robots.txt
 * is a separate design decision for the operator.
 *
 * Spec references:
 *   - https://www.rfc-editor.org/rfc/rfc9309 (REP, 2022)
 *   - https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
 */

import type { SiteHealthReport, RobotsFindings } from "../types.js";
import { httpGetText } from "../providers/http.js";

interface ParsedGroup {
  userAgents: string[];
  disallow: string[];
  allow: string[];
  crawlDelay?: number;
}

interface ParsedRobots {
  groups: ParsedGroup[];
  sitemaps: string[];
}

/** Parse a robots.txt body into groups + sitemap list. Case-insensitive
 *  directive names, comments stripped, blank lines skipped. */
function parseRobotsTxt(text: string): ParsedRobots {
  const sitemaps: string[] = [];
  const groups: ParsedGroup[] = [];
  let current: ParsedGroup | null = null;
  let currentAgentBatch = false; // multiple consecutive User-agent lines collapse into one group

  for (const rawLine of text.split(/\r?\n/)) {
    const hashIdx = rawLine.indexOf("#");
    const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
    if (!line) { currentAgentBatch = false; continue; }
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (!current || !currentAgentBatch) {
        current = { userAgents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.userAgents.push(value.toLowerCase());
      currentAgentBatch = true;
      continue;
    }
    currentAgentBatch = false;
    if (directive === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (directive === "disallow") {
      if (value) current.disallow.push(value);
    } else if (directive === "allow") {
      if (value) current.allow.push(value);
    } else if (directive === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

/** Find the best matching group for a user agent (per spec, longest agent
 *  token match wins; `*` is the fallback). */
function pickGroupForAgent(groups: ParsedGroup[], ua: string): ParsedGroup | null {
  const lc = ua.toLowerCase();
  let starGroup: ParsedGroup | null = null;
  let bestMatch: { group: ParsedGroup; score: number } | null = null;
  for (const g of groups) {
    for (const agent of g.userAgents) {
      if (agent === "*") { starGroup = g; continue; }
      if (lc.includes(agent) && (!bestMatch || agent.length > bestMatch.score)) {
        bestMatch = { group: g, score: agent.length };
      }
    }
  }
  return bestMatch?.group ?? starGroup;
}

/** Compile a disallow/allow pattern to a regex. Supports `*` wildcard and
 *  `$` end-anchor per Google's extension. */
function patternToRegex(pattern: string): RegExp {
  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") src += ".*";
    else if (c === "$" && i === pattern.length - 1) src += "$";
    else src += c!.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + src);
}

/** Is `path` blocked for the given group? Allow beats Disallow for equal
 *  specificity (per Google); we approximate by longest-pattern-wins. */
function isBlocked(group: ParsedGroup, path: string): { blocked: boolean; matchedRule?: string } {
  let best: { pattern: string; allow: boolean; len: number } | null = null;
  for (const p of group.disallow) {
    if (patternToRegex(p).test(path) && (!best || p.length > best.len)) {
      best = { pattern: p, allow: false, len: p.length };
    }
  }
  for (const p of group.allow) {
    if (patternToRegex(p).test(path) && (!best || p.length >= best.len)) {
      best = { pattern: p, allow: true, len: p.length };
    }
  }
  if (!best || best.allow) return { blocked: false };
  return { blocked: true, matchedRule: best.pattern };
}

export async function enrichRobotsTxt(report: SiteHealthReport): Promise<RobotsFindings> {
  const base = new URL(report.startUrl);
  const robotsUrl = `${base.protocol}//${base.host}/robots.txt`;
  const body = await httpGetText(robotsUrl, { timeoutMs: 10_000 });
  if (body == null) {
    return { fetched: false, url: robotsUrl, declaredSitemaps: [], groups: [], disallowedButCrawled: [], error: "fetch failed or non-200 response" };
  }
  const parsed = parseRobotsTxt(body);
  const groupFor = pickGroupForAgent(parsed.groups, "Googlebot");

  const disallowedButCrawled: RobotsFindings["disallowedButCrawled"] = [];
  if (groupFor) {
    for (const page of report.crawl.pages) {
      try {
        const u = new URL(page.url);
        const path = u.pathname + (u.search || "");
        const check = isBlocked(groupFor, path);
        if (check.blocked && check.matchedRule) {
          disallowedButCrawled.push({ url: page.url, matchedRule: check.matchedRule, userAgent: "Googlebot" });
        }
      } catch { /* malformed url — skip */ }
    }
  }

  return {
    fetched: true,
    url: robotsUrl,
    declaredSitemaps: parsed.sitemaps,
    groups: parsed.groups.map((g) => ({
      userAgent: g.userAgents.join(", ") || "*",
      disallow: g.disallow,
      allow: g.allow,
      crawlDelay: g.crawlDelay,
    })),
    disallowedButCrawled,
  };
}
