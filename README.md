# QA-Agent

**QA-Agent** is a **command-line tool** for our team to **monitor the health of many websites**—ours and our customers’—from a **single text list of root URLs**. It **crawls** each site (same-origin pages), **checks internal links**, records **HTTP failures**, and **optionally** pulls **PageSpeed Insights–class scores** via Google’s **official API** (same Lighthouse family as [PageSpeed Insights](https://pagespeed.web.dev/)).

**Default workflow:** `qa-agent health` — **no browser automation**, no form filling.  
**Legacy:** `qa-agent run` — Playwright-based **form smoke tests** for sites configured in JSON.

---

## Who this is for

| Role | Use QA-Agent to… |
|------|-------------------|
| **Engineering / QA** | Run scheduled or ad-hoc checks; triage `report.html` / `summary.txt`; tune `--max-pages`, `--concurrency`. |
| **DevOps** | Run on a **VM** with cron/systemd; manage `.env` / `GOOGLE_PAGESPEED_API_KEY`; prune `artifacts/`. |
| **Product / leadership** | Review pass/fail and metrics from shared reports or zips (email integration is optional/future). |
| **Non-technical teammates** | Understand outcomes via [docs/NON_TECHNICAL_GUIDE.md](docs/NON_TECHNICAL_GUIDE.md) without using the CLI. |

**Stakeholder docs:** [docs/README.md](docs/README.md) · [PRD](docs/PRD.md) · [Plan of action](docs/PLAN.md) · [Implementation & deployment](docs/IMPLEMENTATION_PLAN.md) · [Non-technical guide](docs/NON_TECHNICAL_GUIDE.md)

---

## What you need installed

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** | Required. |
| **npm** | Comes with Node; used for install/build. |
| **Playwright / Chromium** | **Only** for legacy `qa-agent run` — `npx playwright install chromium`. **Not** required for `health`. |
| **Google API key** | **Optional** for PageSpeed — set `GOOGLE_PAGESPEED_API_KEY` in `.env` (see [PageSpeed](#pagespeed-insights-api-optional)). |

---

## From zero: first health run

Run all commands from the **repository root** (the folder that contains `package.json`), not from `fixture-site/` or other subfolders.

```bash
cd /path/to/QA-Agent
npm install
npm run build
```

1. **URL list** — one HTTPS root per line; `#` starts a comment; blank lines ignored.

   ```bash
   cp config/urls.example.txt config/urls.txt
   # Edit config/urls.txt
   ```

2. **Environment (optional)** — copy and edit:

   ```bash
   cp .env.example .env
   ```

3. **Execute:**

   ```bash
   npm run health -- --urls config/urls.txt
   ```

4. **Read results** — open the newest folder:

   `artifacts/health/<runId>/index.html`

   Each site has a subfolder with `report.html` and `report.json`.

**Exit code:** `0` if every site passes our checks; `1` if any site has broken internal links or a bad page status (suitable for cron alerting).

---

## Live dashboard (optional)

To see **which site is running** and **live status** in a browser while the job executes:

```bash
npm run health -- --urls config/urls.txt --serve
```

- Opens **http://127.0.0.1:3847/** (change with `--port`).
- Streams progress over **Server-Sent Events**; after the run, the same server serves reports at **`/reports/…`** so links work without `file://`.
- **`--no-browser`** — do not auto-open a tab.
- **Ctrl+C** stops the server; files remain under `artifacts/health/<runId>/`.

The dashboard binds to **localhost only** — it is meant for **operators on the same machine** (or SSH port-forward), not as a public internet UI without extra hardening.

---

## CLI reference (`health`)

```text
qa-agent health --urls <file> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--urls <file>` | *required* | Text file: one root URL per line. |
| `--out <dir>` | `artifacts/health` | Root directory for all runs. |
| `--concurrency <n>` | `3` | Max sites processed in parallel. |
| `--max-pages <n>` | `100` | Max HTML pages to fetch per site (BFS, same-origin). |
| `--max-link-checks <n>` | `2000` | Extra same-origin URLs checked if not visited in BFS. |
| `--timeout-ms <n>` | `15000` | Per HTTP request timeout. |
| `--skip-pagespeed` | off | Do not call Google PageSpeed API. |
| `--pagespeed-strategy <s>` | `mobile` | `mobile` or `desktop` (PageSpeed only). |
| `--serve` | off | Local HTTP dashboard + SSE live updates + `/reports/` static files. |
| `--port <n>` | `3847` | Port when using `--serve`. |
| `--no-browser` | off | With `--serve`, do not open a browser. |

Global: `qa-agent --help`, `qa-agent health --help`.

**Development without `build`:** `npm run dev -- --urls config/urls.txt` (same flags as `health`).

---

## PageSpeed Insights API (optional)

Scores use the **[PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started)** — not scraping [pagespeed.web.dev](https://pagespeed.web.dev/).

1. In **Google Cloud**, create or select a project and enable **PageSpeed Insights API**.  
2. Create an **API key** (Credentials).  
3. Set in `.env`:

   ```bash
   GOOGLE_PAGESPEED_API_KEY=your_key_here
   ```

4. **Application restrictions:** this tool runs in **Node**, not a browser tab. If the key is restricted to **HTTP referrers**, Google returns errors like **“API key not valid.”** Use **None** (development) or **IP addresses** (your VM’s outbound IP). Do **not** use HTTP referrer restrictions for the CLI.  
5. **API restrictions:** allow **PageSpeed Insights API** (or unrestricted while testing).

We call PageSpeed **once per root URL per run** (subject to Google’s quotas).

---

## What “health” checks (and what it does not)

| Included | Not included (current version) |
|----------|----------------------------------|
| Same-origin crawl from each root (`<a href>` in HTML) | **Forms** — not filled or submitted in `health` |
| Internal links: failures and HTTP errors | **External** sites (off-origin links are not crawled) |
| Optional PageSpeed category scores per root | **`robots.txt`** — not enforced (obtain approval before aggressive crawling) |
| Per-site and per-run HTML/JSON artifacts | **Accessibility / visual** audits beyond PageSpeed categories |

---

## Repository layout (health-related)

| Path | Role |
|------|------|
| `config/urls.example.txt` | Example URL list; copy to `config/urls.txt`. |
| `config/sites.json` | Legacy **`run`** only — form definitions. |
| `src/health/` | URL loading, crawl, PageSpeed client, reports, optional dashboard server. |
| `src/index.ts` | CLI entry (`health`, `run`). |
| `artifacts/health/<runId>/` | **`index.html`**, **`summary.txt`**, `<site-id>/report.html`, `report.json`. |

---

## Deployment (summary)

- **Developer laptop:** run `npm run health -- --urls config/urls.txt` manually; use `--serve` to watch progress.  
- **Dedicated VM:** same command on a **cron** or **systemd timer**; load secrets from `/etc/…env` or your secret store; **prune** old `artifacts/health/` directories to save disk.

Details: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

---

## Legacy: form smoke tests (`run`)

For **Playwright** end-to-end form checks (separate from health):

```bash
npx playwright install chromium
npm run build
npm run run -- --config config/sites.json
```

See `config/sites.example.json` and SMTP notes in `.env.example`. **`npm run dev:run`** runs `run` via `tsx` without a separate `build`.

---

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| **`cp: config/urls.example.txt: No such file or directory`** | Current directory must be **repo root** (`ls package.json`). |
| **PageSpeed: “API key not valid”** | API enabled on project; key not restricted to **HTTP referrers**; try `.trim()`-safe key in `.env`. See [PageSpeed](#pagespeed-insights-api-optional). |
| **Huge runtime on one site** | Lower `--max-pages` / `--max-link-checks`; large sites hit limits by design. |
| **`--serve` port in use** | Pass `--port <other>`. |

---

## License

See [LICENSE](LICENSE) in the repository root.
