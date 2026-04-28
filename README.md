# QA-Agent

**Self-hosted, agentic SEO intelligence platform.** Crawls sites, analyzes them across every free SEO data source, and synthesizes findings through an on-device LLM council of AI advisors. No SaaS, no third-party data tax — every number traces back to a real source you can audit.

> When **Ollama** is reachable, the agent brain drives the crawler, every analytic page gets auto-firing AI synthesis, and `/forecast` produces 30-day predictions grounded in YOUR own tracked history. When Ollama isn't reachable, everything silently degrades to deterministic heuristics — the platform is never blocked on the LLM.

---

## Highlights

| Capability | What it actually does |
|---|---|
| **Agentic crawler** | Real production crawler is LLM-prioritized when Ollama is up: pre-crawl plan picks strategy + priority sections; mid-crawl replan re-orders the queue from observed patterns. Falls back to BFS otherwise. |
| **AI Council** | 4-advisor synthesis (Content / Technical / Competitive / Performance) on every analytic page. Grounded in real numbers, never invents them. |
| **`/forecast`** | Per-keyword 30-day rank projection via linear regression over your own tracked history. R²-banded confidence. Council explains causes + actions. |
| **46 feature pages** | Site Audit, Position Tracking, Keyword Magic Tool, Bulk Keyword Analyzer, Backlink Gap, Domain Overview, Local SEO, Log File Analyzer, SERP Analyzer, Term Intel, and more. |
| **Daily-platform automation** | Cron-driven `/schedules`, threshold-triggered `/alerts` (rank drops, backlink loss/gain) with webhook fan-out, white-label branded PDF reports. |
| **6 OAuth + BYOK integrations** | Google (GSC + GA4 + Ads), Bing WMT (OAuth + key), Yandex Webmaster (OAuth), DataForSEO (BYOK), Ahrefs CSV import, OpenPageRank. Configurable in-UI — no `.env` edit. |
| **Live cross-source consensus** | Authority, backlinks, keyword volume, SERP, web vitals — every metric has a provenance badge so you know whether a number is real, derived, or LLM-estimated. |
| **3D agentic theme** | Ambient gradient mesh, depth-layered glass cards, live-pulse chips. Responsive across mobile / tablet / desktop with a sliding drawer below 900 px. Dark mode rebalanced. |
| **Strict crawl mode (legacy)** | Original feature: visit every same-origin page, find broken links, produce HTML + JSON reports + PDF. Still here, still useful. |

---

## Architecture at a glance

```
┌──────────── Browser (web/) ────────────┐    ┌──────── Backend (src/) ────────┐
│ React 19 + Vite + Recharts             │ ←→ │ Node 20 + TypeScript           │
│ 46 pages, code-split per route         │    │ Express-like dashboard server  │
│ Topbar AgenticModeChip + ThemeToggle   │    │ 44 health/modules/*.ts         │
│ PageHero + Council sidecar pattern     │    │ 30-min response cache          │
└────────────────────────────────────────┘    └────────────────────────────────┘
                                                  │              │
                                              ┌───┴───┐      ┌───┴────┐
                                              │ Ollama│      │ Free   │
                                              │ local │      │ APIs:  │
                                              │ LLM   │      │ GSC,   │
                                              │ (opt) │      │ GA4,   │
                                              └───────┘      │ Ads,   │
                                                             │ Bing,  │
                                                             │ Yandex,│
                                                             │ DFSe,  │
                                                             │ OPR    │
                                                             └────────┘
```

**Runtime model:** every agentic feature checks `checkOllamaAvailable()` (cached 30 s) before invoking the LLM. If Ollama is reachable, the AI path runs and a "🧠 Agentic · live" pill in the topbar confirms it. If not, the deterministic path runs silently. **Nothing blocks on LLM availability.**

---

## Quick start

```bash
# 1. Install (Node 20+ required)
npm install
npm run build:all          # backend tsc + web vite build

# 2. Start the dashboard (default :3847, browser opens automatically)
npm run health -- --serve

# 3. Optional: start Ollama for the agentic features
ollama serve
ollama pull qwen2.5:7b     # or any small instruction-tuned model
```

Open `http://127.0.0.1:3847/` and you're in. The dashboard is the home base; the legacy CLI link-checker is documented at the bottom of this file.

### Environment variables

None are required. **All API keys can be pasted in the `/integrations` UI** — they persist in `data/runtime-keys.json` (mode 0600) without touching `.env`. Optional `.env` overrides:

| Var | Effect |
|---|---|
| `OLLAMA_HOST` | Custom Ollama URL (default `http://127.0.0.1:11434`) |
| `QA_AGENT_NO_AGENTIC=1` | Force deterministic crawls even when Ollama is up |
| `REUSE_PAGESPEED_KEY_FOR_CRUX=1` | Reuse PageSpeed key for CrUX field-data fetches |
| `ALERT_WEBHOOK_URL` | Slack/Teams/custom URL for alert fan-out |
| `BRAND_NAME`, `BRAND_LOGO_URL`, `BRAND_PRIMARY_HEX` | White-label PDF defaults |

---

## Feature catalog (46 pages)

### Workspace
- **Dashboard** — KPI summary, Run a new audit, recent activity.
- **Run History** / **Run Detail** — browse past crawls; new "🧠 Agentic crawl" strip shows which strategy ran.
- **Reports Hub** — combined PDF + HTML downloads.
- **Import Data** (Upload) — Ahrefs CSV bundles, GSC export.
- **Schedules** — cron-driven daily / weekly / custom audits, pause / delete, next-fire preview.
- **Alerts** — rank-drop + backlink-change detectors with webhook fan-out.
- **Forecast** ⭐ NEW — 30-day rank projection per tracked keyword + council synthesis.

### AI Council
- **Council** — 6 panels (Authority, Backlinks, Keyword, SERP, Web Vitals, Site-Audit) with cross-source consensus + 4 advisor verdicts each.
- **Term Intel** — universal cross-source lookup for any term (keyword OR domain) with AI advisor panel.

### Audit
- **Site Audit** (Googlebot-grade enrichers + Site-Audit Council)
- **On-Page SEO Checker** (auto-firing council on the URL)
- **URL Report** (single-URL deep dive)
- **Position Tracking** (rank history per `(domain, keyword)`)
- **Link Fix Advisor** (broken-link triage with AI rewrites)

### Keyword Research
- **Keyword Overview** (multi-source consensus volume + 4-week velocity sparkline)
- **Keyword Magic Tool** (related/long-tail expansion)
- **Bulk Keyword Analyzer** ⭐ — paste up to 1000 keywords, get volume/KD/CPC/intent in one pass
- **Impact Predictor** (rank → traffic projection)
- **Strategy Builder** (cluster planner)
- **Keyword Manager** (tracked-pair CRUD)

### Competitive
- **Domain Overview** · **Compare Domains** · **Keyword Gap** · **Backlink Gap**
- **Organic Rankings** · **Top Pages** · **Traffic Analytics** (auto-firing council)
- **Competitive Estimator** · **Competitor Rank Tracker**

### Content Marketing
- **SEO Writing Assistant** · **Topic Research** · **SEO Content Template**
- **Content Audit** (auto-firing council) · **Post Tracking**

### Link Building
- **Backlinks** · **Referring Domains** · **Backlink Audit** (auto-firing council)

### AI Tools
- **Query Lab** (free-form prompt against the council)
- **SERP Analyzer** (real-time SERP scrape across DDG / Brave / Startpage / Google CSE)
- **Agentic Crawl** (experimental simulated planner, distinct from the real agentic crawler in `health`)

### Monitoring & Local
- **Brand Monitoring** · **Log File Analyzer** · **Local SEO** · **Form Tests** (Playwright)

### Integrations
- **Integrations Hub** · **Google Connections** (one-click OAuth for GSC + GA4 + Ads)

---

## API surface (`http://127.0.0.1:3847/api/...`)

| Method | Path | Purpose | Cache |
|---|---|---|---|
| `POST` | `/health` | Run a crawl |  |
| `GET` | `/runs` | Recent runs |  |
| `GET` | `/llm-stats` | Ollama availability + token-usage telemetry | 30 s |
| `POST` | `/council/:feature` | Per-feature council synthesis | 30 min |
| `POST` | `/forecast` | 30-day rank forecast + advisor verdicts | 30 min |
| `POST` | `/bulk-keywords` | Bulk Keyword Analyzer | 30 min |
| `GET` `POST` | `/schedules` | List + create scheduled audits |  |
| `PATCH` `DELETE` | `/schedules/:id` | Edit + remove |  |
| `GET` `POST` | `/alerts` | List + manual run |  |
| `GET` | `/brand` | White-label config |  |
| `POST` | `/pdf` | Branded PDF export of any report |  |
| `POST` | `/issue-overrides` | Persist triage state per run |  |
| `GET` `POST` | `/runtime-keys` | Manage API keys without `.env` |  |
| `GET` `POST` `DELETE` | `/integrations/...` | OAuth state + connection tests |  |

Every LLM call is wrapped in `withLlmTelemetry("<feature>")` — `/api/llm-stats` shows per-feature counts, latencies, and token usage.

---

## Integrations (free-tier first)

| Source | Auth | Purpose |
|---|---|---|
| **Google Search Console** | OAuth | impressions, clicks, queries, page-level performance |
| **Google Analytics 4** | OAuth | sessions, audience, conversions |
| **Google Ads** | OAuth | keyword volumes (definitive when account has ad spend) |
| **Bing Webmaster Tools** | OAuth or API key | impressions + index status |
| **Yandex Webmaster** | OAuth (one-click) | RU-region indexing + queries |
| **DataForSEO** | BYOK | volume + SERP fallback when Google Ads is unavailable |
| **Ahrefs** | CSV import | backlinks + referring domains |
| **OpenPageRank** | API key | domain authority (free tier) |
| **PageSpeed Insights / CrUX** | API key | Core Web Vitals lab + field |
| **Ollama** | localhost | every agentic synthesis |

Connect any of these from `/integrations` — keys live in `data/runtime-keys.json` and are reloaded without restart.

---

## The Council pattern

Every analytic page can summon a 4-advisor synthesis:

```
   ┌──────────── CouncilContext ─────────────┐
   │ feature, target, sources, agenda items, │
   │ metrics, advisor list                   │
   └──────────────────────┬──────────────────┘
                          ▼
              ┌─────── runCouncil() ──────┐
              │ One LLM call. Returns 4   │
              │ advisor verdicts grounded │
              │ in numeric metrics only.  │
              └────────────┬──────────────┘
                           ▼
              ┌─────── CouncilSidecar ─────┐
              │ Auto-fires when Ollama is  │
              │ reachable + Auto-Council   │
              │ pref is unset or ON.       │
              │ Falls back to manual "Ask  │
              │ the Council" button.       │
              └────────────────────────────┘
```

Council coverage: Backlink Audit, Traffic Analytics, Content Audit, On-Page Checker, Keyword Overview, Term Intel, Site Audit, Forecast, Council Hub (6 panels), and per-row `<AskCouncilButton />` on tabular pages.

---

## Schedules + Alerts (daily platform)

**Schedules** (`/schedules`):
- 5-field cron parser (literal, wildcard, step syntax)
- Persistence: `data/schedules.json` (mode 0600)
- Self-`POST`s to `/api/daily-report` so schedules inherit every existing crawl feature (PageSpeed, form tests, enrichers).

**Alerts** (`/alerts`):
- Rank detector — fires on per-pair rank delta thresholds (default ≥3 drop / ≤-5 gain)
- Backlink detector — fires on referring-domains delta vs last snapshot (default 10 loss / 20 gain)
- Severity inferred by magnitude (≥10 critical, ≥5 warn)
- POSTs to `ALERT_WEBHOOK_URL` (Slack, Teams, custom)
- Append-only log at `artifacts/alerts.jsonl`; state dedup at `data/alerts-state.json`
- Background ticker every 15 min on server boot

---

## Theming

**Responsive** — sidebar is a fixed rail above 1024 px, becomes a slide-in drawer with backdrop below 900 px. Topbar widgets shed gracefully (RegionPicker → ThemeToggle → status text → Connect label). Tested at 1024 / 900 / 768 / 640 / 480 px.

**3D Agentic theme** — signature blue → violet → pink gradient (`--grad-agentic`), drifting radial-mesh + dot-grid backdrop, glass cards with depth-layered shadows, ripple-pulse `.qa-live-dot` for the AgenticModeChip when Ollama is live, gradient-shifting buttons with shine-sweep on hover. Dark mode tokens rebalanced. `prefers-reduced-motion` honored.

---

## CLI commands

```bash
# Dashboard (recommended) — everything is here
npm run health -- --serve

# Headless crawl, no dashboard
npm run health -- --urls config/urls.txt

# Build outputs to dist/ (backend) and web/dist/ (frontend)
npm run build:all

# Reload backend on file change
npm run dev -- --serve

# Lint (tsc --noEmit)
npm run lint

# Eval harnesses for prompt regressions
npm run eval:link-fix
npm run eval:run-summary
npm run eval:competitive
npm run eval:brand-monitor
npm run eval:all

# Maintenance
npm run dashboard:kill        # kill anything on :3847
npm run prune-runs            # GC old run folders
npm run diagnose              # check provider connectivity
```

### Crawl flags (`health`)

| Flag | Default | Effect |
|---|---|---|
| `--urls <file>` | required (or in-UI) | one root URL per line |
| `--out <dir>` | `artifacts/health` | report root |
| `--concurrency <n>` | 3 | sites in parallel |
| `--max-pages <n>` | **0 (unlimited)** | per-site page cap |
| `--max-link-checks <n>` | **0 (unlimited)** | extra HEAD checks |
| `--timeout-ms <n>` | 15000 | per-request timeout |
| `--serve` | off | start dashboard |
| `--port <n>` | 3847 | dashboard port |
| `--no-browser` | off | with `--serve`, don't auto-open |

Set `QA_AGENT_NO_AGENTIC=1` in the environment to disable LLM-driven crawl prioritization for a run.

---

## Folder layout

```
QA-Agent/
├─ src/
│  ├─ index.ts                  CLI entry
│  ├─ health/
│  │  ├─ crawl-site.ts          BFS crawler with optional agentic plan/replan
│  │  ├─ orchestrate-health.ts  Per-site pipeline driver
│  │  ├─ health-dashboard-server.ts  All HTTP routes
│  │  ├─ position-db.ts         Tracked-pair history store
│  │  ├─ types.ts               Shared types incl. CrawlAgenticMeta
│  │  ├─ agentic/               Crawl planner, LLM router, telemetry
│  │  └─ modules/               44 feature modules (see list below)
│  └─ run/                      Legacy form-tests pipeline
├─ web/
│  ├─ src/
│  │  ├─ App.tsx                46 routes
│  │  ├─ pages/                 46 pages
│  │  ├─ components/            Shared design system
│  │  │  ├─ PageHero.tsx        Flagship hero w/ KPI strip
│  │  │  ├─ Chart.tsx           Area/Line/Bar with gradient fills
│  │  │  ├─ DataTableCells.tsx  SparklineCell / BarCell / DeltaCell
│  │  │  ├─ Icon.tsx            35+ inline SVG icons
│  │  │  ├─ Skeletons.tsx       HeroSkeleton / ChartSkeleton / TableSkeleton
│  │  │  ├─ AnimatedNumber.tsx  rAF count-up
│  │  │  ├─ AgenticModeChip.tsx Topbar live status
│  │  │  └─ CouncilSidecar.tsx  Auto-firing AI synthesis
│  │  └─ index.css              Tokens, ambient mesh, 3D theme
│  └─ vite.config.ts
├─ scripts/
│  ├─ start.mjs                 Dashboard launcher
│  ├─ kill-port.mjs             Free a port
│  ├─ eval-*.ts                 Prompt-regression harnesses
│  └─ daily-report.ts           Standalone daily report
├─ config/
│  ├─ urls.example.txt          → copy to urls.txt (gitignored)
│  └─ sites.example.json        → copy to sites.json (gitignored, for legacy `run`)
├─ artifacts/
│  ├─ health/<runId>/           Per-run reports
│  ├─ alerts.jsonl              Append-only alert log
│  └─ llm-calls.jsonl           Telemetry feed
├─ data/                        Runtime state (gitignored, mode 0600)
│  ├─ runtime-keys.json
│  ├─ schedules.json
│  ├─ alerts-state.json
│  └─ position-history.json
└─ docs/
```

### Backend modules (`src/health/modules/`)

44 modules covering every feature: `alerts`, `authority-consensus`, `backlinks-consensus`, `brand-config`, `brand-monitor`, `bulk-keywords`, `competitive-analyzer`, `competitive-estimator`, `competitive-signals`, `competitor-rank`, `content-auditor`, `content-optimizer`, `council-runner`, `council-types`, `daily-report`, `daily-report-types`, `domain-analyzer`, `forecast`, `gap-analyzer`, `gsc-auto-track`, `keyword-analyzer`, `keyword-consensus`, `keyword-difficulty`, `keyword-impact-predictor`, `keyword-manager`, `keyword-research`, `keyword-strategy`, `link-analyzer`, `link-fix-advisor`, `local-seo-analyzer`, `log-analyzer`, `onpage-seo-checker`, `position-tracker`, `post-tracker`, `response-cache`, `runtime-keys`, `scheduler`, `serp-consensus`, `site-audit-analyzer`, `site-audit-consensus`, `term-intel`, `topic-researcher`, `traffic-analyzer`, `usage-meter`, `vitals-consensus`.

---

## Data honesty

Every data point on every page carries a **provenance dot**:

| Color | Meaning |
|---|---|
| 🟢 Real | crawl, SERP scrape, free-tier API |
| 🔵 LLM-safe | AI generates narrative; the numbers themselves are real |
| 🟡 Real + estimated | mix of real + heuristic-/LLM-estimated values; per-field badges show which |

A legend is always visible on the Dashboard, and field-level badges live on every estimated value. The connection-status dots in the topbar are about **service reachability** (Ollama, Google), not data source — they're explicitly distinct.

---

## Testing & validation

```bash
npm run lint                  # tsc --noEmit
npm run build:all             # full TypeScript + Vite build
npm run eval:all              # 4 prompt-regression harnesses
```

---

## Legacy: form tests (`run`)

Original Playwright pipeline for filling and submitting contact forms is still here:

```bash
npx playwright install chromium
cp config/sites.example.json config/sites.json
npm run build
npm run run -- --config config/sites.json
```

Each site lists `forms` with `fields` (fill / select / check / uncheck / **click**), optional **`captcha`**, and `submit`. CAPTCHA strategies: `wait_for_selector` (auto-wait) or `pause_after_fields` (human solves in `--headed`). Live-chat assertion supported via `liveAgent` block (with optional `frameSelector` for embedded chat iframes).

Local fixture for testing this without hitting real sites:

```bash
npm run fixture:kill
npm run fixture                # serves http://127.0.0.1:3333/
```

Use `FIXTURE_PORT=3334 npm run fixture` if 3333 is busy.

---

## Things QA-Agent does **not** do

- Crawl other people's sites from your inbound links — same-origin only.
- Read `robots.txt` automatically — get permission before hammering large sites.
- Auto-solve third-party CAPTCHAs (use `pause_after_fields` + `--headed` for human-in-the-loop).
- Replace human SEO judgment — this is automated **first-look** intelligence.
- Send your data anywhere. Everything is local: Ollama, your keys, your reports.

---

## More docs

See [`docs/README.md`](docs/README.md) for the full doc index, and [`EOD-2026-04-25.md`](EOD-2026-04-25.md) for the most recent engineering session report.

---

## License

See [`LICENSE`](LICENSE).
