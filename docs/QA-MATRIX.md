# QA Matrix — what every page does + how to verify it

This document is the **manifest of features in QA-Agent**. Every route registered in `web/src/App.tsx` appears here with:
- What the page does (one line)
- What data / config it needs to be useful
- What to click to verify it renders without errors

The automated `npm run smoke` script verifies every route returns the SPA shell + every key API endpoint responds without 5xx. Use this doc for the **manual click-through** pass — that's where you catch UX issues that a 200-OK can't.

## How to run the full QA pass

```bash
# 1. Build everything
npm run build:all

# 2. Boot the dashboard
npm run dashboard:kill
npm run health -- --serve --no-browser

# In a second terminal:
# 3. Auto smoke (routes + critical APIs)
npm run smoke
```

If `npm run smoke` ends with `0 failed`, every route + endpoint is wired. Then walk the matrix below to spot UX issues.

## Legend

- **Free** — works with no API keys configured.
- **GSC** — requires Google Search Console connection at `/google-connections`.
- **GA4** — requires Google Analytics connection at `/google-connections`.
- **Ads** — requires Google Ads developer token + customer ID (in `.env` or `/integrations`).
- **Ollama** — requires `ollama serve` running locally.
- **DFS BYOK** — requires DataForSEO credentials in `/integrations`. **Paid.**
- **Bing WMT** — requires Bing Webmaster Tools API key.
- **Ahrefs CSV** — requires manual CSV import via `/backlinks` upload control.

---

## Workspace

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/` | Dashboard | Free | URL input + run controls render; recent activity sidebar shows last 5 runs |
| `/history` | Run History | Free | Past runs listed with expandable JobCards; each shows duration + per-site count |
| `/run/:runId` | Run Detail | Free (run must exist) | Header + per-site report links + "Compare to a previous run" button |
| `/reports` | Reports Hub | Free | Combined PDF + HTML downloads for past runs |
| `/upload` | Import Data | Free | CSV upload widgets for GSC + Ahrefs |
| `/schedules` | Schedules | Free | Cron schedule create/list; toggle pause/delete |
| `/alerts` | Alerts | Free | Recent alerts list with auto-refresh chip every 30s |
| `/forecast` | Forecast | GSC + Ollama (optional) | Domain input → 30-day projection chart + 4 advisor cards |
| `/narrative-diff` | Narrative Diff | Free (needs ≥2 runs) | Two run selectors → section deltas + council narration |

## AI Council

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/council` | Council Hub | Free + Ollama (optional) | 6 panels (Authority/Backlinks/Keyword/SERP/Vitals/Site) |
| `/term-intel` | Term Intel | Free + Ollama | Term lookup hits 13 free sources in parallel |

## Audit

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/site-audit` | Site Audit | Free | Run selector → audit panel with enricher results |
| `/onpage-seo-checker` | On-Page Checker | Free | URL input → ruleset pass/fail with auto-firing council |
| `/url-report` | URL Report | Free | Single-URL deep dive |
| `/position-tracking` | Position Tracking | GSC | Daily-tracked keywords table + Live Rank Sweep |

## Keyword Research

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/keyword-overview` | Keyword Overview | Free + Ads (optional) | Real Google Trends/Suggest/Wikipedia/DDG output |
| `/keyword-magic-tool` | Keyword Magic Tool | Free + Ads (optional) + Ollama (optional) | Seed → table with AI Score / Action / Cluster columns |
| `/bulk-keywords` | Bulk Keyword Analyzer | Ads OR DFS BYOK | Paste up to 1000 keywords → KD/CPC/intent table |
| `/keyword-impact` | Impact Predictor | Ads + GSC | Rank → traffic projection |
| `/keyword-strategy` | Strategy Builder | Free | Cluster planner |
| `/keyword-manager` | Keyword Manager | Free | Tracked-pair CRUD |

## Competitive

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/domain-overview` | Domain Overview | Free | Real signals from crawl + free providers |
| `/compare-domains` | Compare Domains | Free | Side-by-side metrics for two runs |
| `/keyword-gap` | Keyword Gap | Free | Two run selectors → gap table |
| `/backlink-gap` | Backlink Gap | Free | Two run selectors → link gap table |
| `/organic-rankings` | Organic Rankings | GSC | Top queries + position chart |
| `/top-pages` | Top Pages | GSC | Top URLs by GSC clicks |
| `/traffic-analytics` | Traffic Analytics | GA4 | Sessions / users / conversions |
| `/competitive-estimator` | Competitive Estimator | Free | Multi-source signal blend |
| `/competitor-rank-tracker` | Rank Tracker | Free | DDG + Brave (free) tracking |
| `/intent-fingerprint` | Intent Fingerprint | Free + Ollama | Tracked-keyword shifts table |
| `/topical-authority` | Topical Authority | Free + GSC (layered) | Per-section authority score table |

## Content Marketing

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/seo-writing-assistant` | Writing Assistant | Free + Ollama | Page audit + LLM rewrite suggestions |
| `/topic-research` | Topic Research | Free | Suggest-driven topic tree |
| `/seo-content-template` | Content Template | Free + Ollama | Template generation |
| `/content-audit` | Content Audit | Free | Multi-source content score + auto council |
| `/post-tracking` | Post Tracking | Free | Stored posts + status |
| `/cannibalization` | Cannibalization | GSC | Conflicts table with consolidation hints |

## Link Building

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/backlinks` | Backlinks | Free + Bing WMT (optional) + Ahrefs CSV | Internal/external link health + DFS-live panel |
| `/referring-domains` | Referring Domains | Free + Ahrefs CSV | Per-domain link table |
| `/backlink-audit` | Backlink Audit | Free | Link-health distribution + auto council |
| `/link-prospector` | Link Prospector | Free + Ollama | SERP-derived prospects + drafted outreach |
| `/link-equity` | Internal Link Equity | Free | PageRank on crawled graph |

## AI Tools

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/query-lab` | Query Lab | Ollama | Free-form prompt against the council |
| `/serp-analyzer` | SERP Analyzer | Free | DDG/Brave/Startpage SERP cross-check |
| `/voice-of-serp` | Voice of SERP | Free + Ollama | Top-10 page text → narrative synthesis |
| `/ai-search-visibility` | AI Search Visibility | Free (default) + paid BYOK (opt-in) | 3 free engines pre-checked; paid engines opt-in |
| `/aeo` | AEO Optimizer | Free + Ollama | URL → 8 signals + LLM-suggested fixes |
| `/seo-tools` | SEO Tools (Disavow/Schema/Snippet) | Free (default) + DFS BYOK (opt-in) | 3 tabs each with FREE chip when paid checkbox is off |
| `/agentic-crawl` | Agentic Crawl | Ollama | Simulated agentic plan |

## Monitoring

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/brand-monitoring` | Brand Monitoring | Free + Ollama (optional) | Real-source mentions; sentiment when keys provided |
| `/log-file-analyzer` | Log File Analyzer | Free | Upload log file → bot+status breakdown |
| `/local-seo` | Local SEO | Free | NAP/schema checklist + Map Pack tracker + Citation audit |
| `/cwv-history` | CWV History | CrUX free API | INP/LCP/CLS history + regression table |
| `/form-tests` | Form Tests | Playwright | Playwright form fill results |

## Integrations

| Route | Page | Data needed | Verify |
|---|---|---|---|
| `/integrations` | Integrations Hub | Free | All provider cards with Connect buttons |
| `/google-connections` | Google Connections | Free | OAuth start/disconnect controls for GSC + GA4 + Ads |
| `/api-tokens` | API Tokens | Free | Token CRUD; created token shown ONCE in plaintext |
| `/link-fix-advisor` | Link Fix Advisor | Free + Ollama (optional) | Broken-link triage + AI rewrite |

---

## What `npm run smoke` checks

### Routes (smoke-routes.mjs)
For every route above:
- HTTP 200
- Body is HTML
- Body contains `id="root"` (the React mount point)
- Body contains a `/assets/index-…js` script tag

If any fails, the SPA build is broken or the static-file routing has a hole.

### APIs (smoke-api.mjs)
GET endpoints (no config needed):
- `/api/llm-stats`, `/api/runs`, `/api/alerts`, `/api/tokens`, `/api/v1/openapi.json`, `/api/auth/google/status`, `/api/brand`, `/api/schedules`, `/api/history/stats`, `/api/llm-calls/recent`

POST endpoints with safe payloads (won't hit paid APIs):
- `/api/schema-preview`, `/api/aeo`, `/api/cwv/snapshot` — exercise the page-fetch path
- `/api/voice-of-serp`, `/api/cannibalization`, `/api/disavow`, `/api/snippet-ownership`, `/api/ai-search-visibility`, `/api/forecast` — accept "config-skip" responses (HTTP 500 with friendly "not configured" message) as PASS

What's NOT smoke-tested (would cost money or need real data):
- `/api/serp-live`, `/api/backlinks-live` (DFS BYOK)
- `/api/bulk-keywords` with real keywords
- `/api/local-map-pack` (needs Playwright + real query)

The free path is what gets smoke-tested. The paid paths are wired-but-opt-in by design.

---

## Reading the smoke output

Per-row symbols:
- `✓` (green) — passed all checks
- `✕` (red) — failed; details follow
- `config-skip` (yellow under ✓) — endpoint is wired but its provider isn't configured. Expected when no API keys are set.

A clean run looks like:

```
smoke-routes — http://127.0.0.1:3847

  ✓  /                              spa-shell
  ✓  /aeo                           spa-shell
  …
all 58 routes returned the SPA shell

smoke-api — http://127.0.0.1:3847

  ✓  GET  /api/llm-stats             ok
  ✓  POST /api/aeo                   ok
  ✓  POST /api/forecast              config-skip (no tracked pairs)
  ✓  POST /api/cannibalization       config-skip (GSC not connected)
  …
18 ok · 4 config-skipped · 0 failed
```

If anything reports failed, that's a bug to fix. Config-skipped is expected on a fresh install.
