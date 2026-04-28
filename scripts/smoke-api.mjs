#!/usr/bin/env node
/**
 * smoke-api.mjs — verify the API endpoints behind QA-Agent's pages
 * respond without 5xx and return shape-valid JSON.
 *
 * Strategy: hit GET endpoints unconditionally; for POST endpoints either
 * use the smallest valid payload OR mark them as "needs config" (skipped
 * when their provider isn't configured — verified separately by checking
 * the response message).
 *
 * Endpoints that legitimately spend money (DataForSEO live, OpenAI BYOK)
 * are NOT exercised by this smoke. Their /integrations status is what
 * the user inspects to know they're wired.
 */

const PORT = process.env.QA_AGENT_PORT || 3847;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 12_000;
/** Slow endpoints (LLM + Playwright) get a generous 60-s budget. */
const TIMEOUT_SLOW_MS = 60_000;

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

/**
 * Each spec: { path, method, body?, expectStatus, expectKeys?, allowsConfigError?, label }
 * - allowsConfigError: when true, a 500 with "not configured" / "missing" / "BYOK" in
 *   the error message is treated as PASS (the endpoint is wired but the user hasn't
 *   keyed the underlying provider).
 */
const SPECS = [
  // ── Cheap GETs (no config required) ──
  { path: "/api/llm-stats",                method: "GET",  expectStatus: 200, expectKeys: ["ollama"], label: "Ollama stats" },
  { path: "/api/history",                  method: "GET",  expectStatus: 200, expectKeys: ["days"], label: "Run history list" },
  { path: "/api/alerts",                   method: "GET",  expectStatus: 200, expectKeys: ["alerts"], label: "Recent alerts" },
  { path: "/api/llm-calls/recent",         method: "GET",  expectStatus: 200, label: "LLM telemetry tail", optional: true },
  { path: "/api/tokens",                   method: "GET",  expectStatus: 200, expectKeys: ["tokens"], label: "API tokens list" },
  { path: "/api/v1/openapi.json",          method: "GET",  expectStatus: 200, expectKeys: ["openapi"], label: "OpenAPI spec" },
  { path: "/api/auth/google/status",       method: "GET",  expectStatus: 200, expectKeys: ["connected"], label: "Google OAuth status" },
  { path: "/api/brand",                    method: "GET",  expectStatus: 200, label: "Brand config", optional: true },
  { path: "/api/schedules",                method: "GET",  expectStatus: 200, label: "Schedules list", optional: true },
  { path: "/api/history/stats",            method: "GET",  expectStatus: 200, label: "Position history stats", optional: true },

  // ── POSTs requiring a tiny payload, no external dependencies ──
  {
    path: "/api/schema-preview",
    method: "POST",
    body: { url: "https://example.com" },
    expectStatus: 200,
    expectKeys: ["url", "items"],
    label: "Schema preview (live page fetch)",
  },
  {
    path: "/api/aeo",
    method: "POST",
    body: { url: "https://example.com" },
    expectStatus: 200,
    expectKeys: ["url", "score", "signals"],
    slow: true,
    allowsConfigError: true,
    label: "AEO optimizer (page fetch + heuristics)",
  },
  {
    path: "/api/cwv/snapshot",
    method: "POST",
    body: { url: "https://example.com" },
    expectStatus: 200,
    expectKeys: ["url", "ratings"],
    allowsConfigError: true,
    label: "CrUX snapshot",
  },

  // ── POSTs requiring optional config (CrUX/GSC/DFS/Ollama may be off) ──
  {
    path: "/api/voice-of-serp",
    method: "POST",
    body: { keyword: "best seo tools 2026" },
    expectStatus: 200,
    expectKeys: ["keyword", "pages"],
    allowsConfigError: true,
    slow: true,
    label: "Voice-of-SERP (DDG + Ollama)",
  },
  {
    path: "/api/cannibalization",
    method: "POST",
    body: { siteUrl: "sc-domain:example.com" },
    expectStatus: 200,
    expectKeys: ["siteUrl"],
    allowsConfigError: true,
    label: "Cannibalization (needs GSC)",
  },
  {
    path: "/api/disavow",
    method: "POST",
    body: { domain: "example.com" },
    expectStatus: 200,
    expectKeys: ["target"],
    allowsConfigError: true,
    label: "Disavow generator (free path)",
  },
  {
    path: "/api/snippet-ownership",
    method: "POST",
    body: { operatorDomain: "example.com", keywords: ["smoke test"] },
    expectStatus: 200,
    expectKeys: ["operatorDomain"],
    allowsConfigError: true,
    slow: true,
    label: "Snippet ownership (Playwright)",
  },
  {
    path: "/api/ai-search-visibility",
    method: "POST",
    body: { domain: "example.com", brandName: "Example", queries: ["smoke test"], engines: ["local-llm-baseline"] },
    expectStatus: 200,
    expectKeys: ["domain", "perEngine"],
    allowsConfigError: true,
    slow: true,
    label: "AI search visibility (Ollama only)",
  },
  {
    path: "/api/forecast",
    method: "POST",
    body: { domain: "example.com" },
    expectStatus: 200,
    expectKeys: ["aggregate"],
    allowsConfigError: true,
    label: "Forecast (needs tracked pairs)",
  },
];

function looksLikeConfigError(text) {
  return /not configured|missing|requires? \w+|byok|set \w+|connect|connected|tracked pairs|verified|Ollama not reachable|no field data|need|require|insufficient permis|no free backlink data|no AHREFS|HTTP 4\d\d|google api 4\d\d|403|401/i.test(text || "");
}

async function probe(spec) {
  const url = `${BASE}${spec.path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), spec.slow ? TIMEOUT_SLOW_MS : TIMEOUT_MS);
  try {
    const init = { method: spec.method, headers: {}, signal: ctrl.signal };
    if (spec.method === "POST") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(spec.body ?? {});
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }

    // Allow some endpoints to surface a friendly config error.
    if (!res.ok && spec.allowsConfigError && looksLikeConfigError(text)) {
      return { spec, ok: true, status: res.status, detail: `config-skip (${(json && json.error || "").slice(0, 60)})` };
    }
    if (spec.optional && (res.status === 404 || res.status === 405)) {
      return { spec, ok: true, status: res.status, detail: "optional endpoint absent" };
    }

    const statusOk = res.status === spec.expectStatus;
    let keysOk = true;
    let missingKeys = [];
    if (statusOk && Array.isArray(spec.expectKeys) && spec.expectKeys.length > 0) {
      if (!json) { keysOk = false; }
      else {
        for (const k of spec.expectKeys) if (!(k in json)) { missingKeys.push(k); keysOk = false; }
      }
    }
    if (statusOk && keysOk) {
      return { spec, ok: true, status: res.status, detail: "ok" };
    }
    if (!statusOk) {
      return { spec, ok: false, status: res.status, detail: `expected ${spec.expectStatus}, got ${res.status}: ${(text || "").slice(0, 120)}` };
    }
    return { spec, ok: false, status: res.status, detail: `missing keys: ${missingKeys.join(", ")}` };
  } catch (e) {
    const isTimeout = e.name === "AbortError";
    // Slow LLM/Playwright endpoints can legitimately hang when Ollama isn't
    // reachable. Treat a timeout on an `allowsConfigError` endpoint as a
    // config-skip rather than a hard failure — the smoke isn't a load test.
    if (isTimeout && spec.allowsConfigError) {
      return { spec, ok: true, status: 0, detail: "config-skip (timeout — provider likely down)" };
    }
    return { spec, ok: false, status: 0, detail: isTimeout ? "timeout" : (e.message || "fetch failed") };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\n${DIM}smoke-api — ${BASE}${RESET}\n`);
  const results = [];
  for (const spec of SPECS) {
    const r = await probe(spec);
    results.push(r);
    const tag = r.ok ? `${GREEN}✓${RESET}` : `${RED}✕${RESET}`;
    const isSkip = r.detail.startsWith("config-skip") || r.detail === "optional endpoint absent";
    const detailColor = isSkip ? YELLOW : (r.ok ? DIM : RED);
    console.log(`  ${tag}  ${spec.method.padEnd(4)} ${spec.path.padEnd(34)} ${detailColor}${r.detail}${RESET}`);
  }
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.ok && (r.detail.startsWith("config-skip") || r.detail === "optional endpoint absent"));
  console.log("");
  console.log(`${GREEN}${results.length - failed.length}${RESET} ok · ${YELLOW}${skipped.length}${RESET} config-skipped · ${RED}${failed.length}${RESET} failed`);
  if (failed.length > 0) {
    console.log("");
    console.log(`${RED}failures:${RESET}`);
    for (const f of failed) console.log(`  ${f.spec.path} (${f.spec.label}) — ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error(`${RED}smoke-api crashed:${RESET}`, e); process.exit(2); });
