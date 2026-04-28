#!/usr/bin/env node
/**
 * smoke-routes.mjs — verify every dashboard route returns the SPA shell.
 *
 * The dashboard is a React SPA — every non-/api/* request returns the same
 * index.html (the client router takes over from there). So a route smoke
 * just confirms (a) the server is up, (b) every path returns 200, and
 * (c) the body contains the expected SPA bootstrap markers (a <script>
 * tag pointing at /assets/index*.js and a <div id="root">).
 *
 * If any route returns 404 / 500 / non-HTML, the route table or static-
 * file routing is broken.
 *
 * Usage: npm run health -- --serve --no-browser & sleep 5 && npm run smoke
 */

const PORT = process.env.QA_AGENT_PORT || 3847;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 8_000;

// All static routes registered in web/src/App.tsx (keep alphabetical).
const ROUTES = [
  "/",
  "/aeo",
  "/agentic-crawl",
  "/ai-search-visibility",
  "/alerts",
  "/api-tokens",
  "/backlink-audit",
  "/backlink-gap",
  "/backlinks",
  "/brand-monitoring",
  "/bulk-keywords",
  "/cannibalization",
  "/compare-domains",
  "/competitive-estimator",
  "/competitor-rank-tracker",
  "/content-audit",
  "/council",
  "/cwv-history",
  "/domain-overview",
  "/forecast",
  "/form-tests",
  "/google-connections",
  "/history",
  "/integrations",
  "/intent-fingerprint",
  "/keyword-gap",
  "/keyword-impact",
  "/keyword-magic-tool",
  "/keyword-manager",
  "/keyword-overview",
  "/keyword-strategy",
  "/link-equity",
  "/link-fix-advisor",
  "/link-prospector",
  "/local-seo",
  "/log-file-analyzer",
  "/narrative-diff",
  "/onpage-seo-checker",
  "/organic-rankings",
  "/position-tracking",
  "/post-tracking",
  "/query-lab",
  "/referring-domains",
  "/reports",
  "/schedules",
  "/seo-content-template",
  "/seo-tools",
  "/seo-writing-assistant",
  "/serp-analyzer",
  "/site-audit",
  "/term-intel",
  "/topic-research",
  "/topical-authority",
  "/top-pages",
  "/traffic-analytics",
  "/upload",
  "/url-report",
  "/voice-of-serp",
];

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

async function probeRoute(path) {
  const url = `${BASE}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const ok = res.status === 200;
    const ct = res.headers.get("content-type") || "";
    const isHtml = /text\/html/i.test(ct);
    let body = "";
    try { body = await res.text(); } catch { /* skip */ }
    const hasRoot = body.includes('id="root"');
    const hasIndexScript = /\/assets\/index-[^"']+\.js/.test(body);
    const looksLikeSpaShell = isHtml && hasRoot && hasIndexScript;
    return {
      path,
      status: res.status,
      ok: ok && looksLikeSpaShell,
      detail: ok
        ? (looksLikeSpaShell ? "spa-shell" : `200 but body missing root/script (ct=${ct})`)
        : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { path, status: 0, ok: false, detail: e.name === "AbortError" ? "timeout" : (e.message || "fetch failed") };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\n${DIM}smoke-routes — ${BASE}${RESET}\n`);
  const results = [];
  // Sequential for clean console output; the server is local so latency is negligible.
  for (const r of ROUTES) {
    const result = await probeRoute(r);
    results.push(result);
    const tag = result.ok ? `${GREEN}✓${RESET}` : `${RED}✕${RESET}`;
    const detail = result.ok ? `${DIM}${result.detail}${RESET}` : `${RED}${result.detail}${RESET}`;
    console.log(`  ${tag}  ${result.path.padEnd(30)} ${detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`${GREEN}all ${results.length} routes returned the SPA shell${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${failed.length} of ${results.length} routes failed:${RESET}`);
    for (const f of failed) console.log(`  ${RED}${f.path}${RESET} — ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`${RED}smoke-routes crashed:${RESET}`, e); process.exit(2); });
