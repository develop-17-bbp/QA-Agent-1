# QA-Agent (simple guide)

Think of QA-Agent as a **robot that checks websites for you**. You give it a **list of starting addresses** (like `https://example.com/`). It visits those sites, **follows links that stay on the same site**, and writes **reports** so you can see broken links and bad pages.

It runs as a **command in a terminal** (black window where you type commands). You need **Node.js 20 or newer** installed.

---

## The two different tools inside this project

| What | In plain words |
|------|----------------|
| **`qa-agent health`** (the main one) | Visits pages with normal web requests (like `fetch`). **No browser window** opens. Checks links and records HTTP results. |
| **`qa-agent run`** (older / special) | Uses a **real browser** (Playwright) to try **forms**. Only if you set that up in JSON config. |

Most people only need **`health`**.

### Which port is which?

| Port | Command | What it is |
|------|---------|------------|
| **3847** (default) | `npm run health -- ... --serve` | **Dashboard only** on your machine: start health crawls and open reports. Not related to your product’s public URL. |
| **3333** (default) | `npm run fixture` | **Optional** local fake website for testing **`npm run run`** (Playwright forms). You can ignore this entirely if you only use **`health`** with `--serve` on 3847. |
| (none) | `npm run run` | Playwright opens **real sites** from **`config/sites.json`** (e.g. production). No local “product” server unless you put a localhost URL in that JSON. |

**3847 and 3333 do not conflict** — they are different features. **`ENOENT` on `config/sites.json`** means the **`run`** command has no config file; copy from `config/sites.example.json` or keep a local `config/sites.json` (that path is gitignored).

---

## What “health” actually checks

1. **Loads pages** from your list and follows **same-website** links in **breadth-first** order. **By default** there is **no page limit** — it tries to visit **every** reachable same-origin page (see flags below to cap if needed).
2. **Records** whether each page loads OK or fails (wrong code, timeout, etc.).
3. **Finds broken internal links** — links to another page on the same site that does not work.

Everything above uses **only** normal HTTP requests to the sites you list — **no Google APIs** and **no browser** for this mode.

**Default crawl behavior:** `--max-pages` and `--max-link-checks` both default to **`0`** = **no limit** (full crawl + check every extra internal URL the logic needs). Very large sites can take a long time and many requests — use **`--max-pages 100`** (or similar) when you want a shorter sample run.

---

## First-time setup (from the project folder)

```bash
cd /path/to/QA-Agent
npm install
npm run build
```

Copy the example URL file and edit it (one `https://...` per line; lines starting with `#` are comments). **`config/urls.txt` is gitignored** — it is your local list, not shipped in the repo.

```bash
cp config/urls.example.txt config/urls.txt
```

Run the check:

```bash
npm run health -- --urls config/urls.txt
```

**Where to look:** open `artifacts/health/<runId>/index.html` in a browser. That **run index** lists every site and links to the **combined** report. Each site folder has `report.html` and `report.json` (plus a timestamped copy). The run folder also includes **`master.html`**, a stable shortcut that redirects to the versioned combined HTML file (`MASTER-all-sites-…html`).

- Exit code **0** = all sites passed the checks we run.
- Exit code **1** = at least one site had a broken internal link or a bad page status (useful for alarms).

---

## Live dashboard and report navigation (optional)

```bash
npm run health -- --urls config/urls.txt --serve
```

Starts a **local dashboard** on your machine (default **127.0.0.1:3847**). It’s only for **you** — not meant to be exposed to the internet without extra security.

| Piece | What it is |
|-------|------------|
| **`/`** | Dashboard: start a run from the browser, watch live progress (SSE), open **Past runs** (collapsible job cards for every run), download PDFs. |
| **`/reports/<runId>/…`** | Static files for that run: **`index.html`** (run index), **`master.html`** → combined report, per-site **`…/report.html`**, and optional **`issue-overrides.json`** (see below). |

**Sticky bar on HTML reports:** Every health report page (and the run index) includes a **top navigation bar**: **Run index** · **Combined report** · **Live dashboard** (the last appears only when you open the page over HTTP, e.g. via `--serve`, so links work from the file browser).

**Triage on issue rows:** In tables for broken links, failed page fetches, and failed link checks, use the **Triage** column (Open / OK / Working / Resolved). Choices are stored in the browser under **`localStorage`**. When you view reports through the dashboard, they can also **load from** `issue-overrides.json` and **save to** the server via **`POST /api/issue-overrides`** (same run folder).

---

## Useful options (`health`)

| Flag | Default | What it means |
|------|---------|----------------|
| `--urls <file>` | required | Text file with one root URL per line |
| `--out <dir>` | `artifacts/health` | Where reports go |
| `--concurrency <n>` | `3` | How many sites at once |
| `--max-pages <n>` | **`0` (unlimited)** | Pages to fully load per site. **`0`** = visit every reachable same-origin page (can be slow on huge sites). Use e.g. **`100`** to cap. |
| `--max-link-checks <n>` | **`0` (unlimited)** | Extra internal URLs checked with HEAD if the BFS did not crawl them. **`0`** = check all such URLs. Use a positive number to cap. |
| `--timeout-ms <n>` | `15000` | How long to wait per request (milliseconds) |
| `--serve` | off | Small local dashboard while it runs |
| `--port <n>` | `3847` | Port for `--serve` |
| `--no-browser` | off | With `--serve`, don’t auto-open a browser tab |

Help: `qa-agent health --help`

Develop without building every time: `npm run dev -- --urls config/urls.txt`

---

## What we do **not** do in `health`

- We **don’t** fill out or submit contact forms (use **`run`** for that).
- We **don’t** crawl other people’s websites from your links — only **same site**.
- We **don’t** read `robots.txt` automatically — get permission before hammering a site.
- We **don’t** replace a full human QA pass — this is an **automatic first look**.

---

## Folder cheat sheet

| Path | What |
|------|------|
| `config/urls.example.txt` | **Tracked in git.** Copy to **`config/urls.txt`** for `health` (`urls.txt` is **gitignored**). |
| `config/sites.example.json` | **Tracked in git.** Copy to **`config/sites.json`** for **`run`** (`sites.json` is **gitignored**). The example includes **localhost fixture** blocks for local testing; your own `sites.json` can be **production-only** (no `127.0.0.1` URLs). |
| `src/health/` | Crawl, reports, optional dashboard |
| `artifacts/health/<runId>/` | Reports from each run (under `artifacts/`, mostly gitignored) |

---

## Legacy: form tests (`run`)

Needs Chromium: `npx playwright install chromium`

```bash
cp config/sites.example.json config/sites.json
# Edit config/sites.json — enable sites you want; for the local fixture, run `npm run fixture` in another terminal first.
npm run build
npm run run -- --config config/sites.json
```

**Forms:** each site lists one or more `forms` with `fields` (fill / select / check / uncheck / **click**), optional **`captcha`**, and `submit`. Optional **`delayAfterMs`** on a field waits after that action (async widgets).

**CAPTCHA (production):** we do **not** auto-solve third-party CAPTCHAs. Use one of:

- **`captcha.strategy`: `"wait_for_selector"`** — after fields (e.g. after a **click** field that completes a challenge), wait until `waitSelector` is visible, then submit.
- **`captcha.strategy`: `"pause_after_fields"`** — **`npm run run -- --headed`** (or `qa-agent run --headed`) so a human can solve the challenge in the real browser window; then the run continues and clicks submit. **Headless** runs fail for this strategy (by design).

**Live chat / agent:** optional **`liveAgent`** block — `openChatSelector`, `messageInputSelector`, optional `sendSelector` (otherwise Enter), `visitorMessage`, and **`agentMessageContains`** (substring matched on the agent’s first reply). Use **`runBeforeForms`: `true`** to open chat and assert the agent message **before** filling the form (same page). Optional **`frameSelector`** scopes all of those selectors to a vendor iframe (e.g. embedded chat). Set **`timeoutMs`** high enough for queue + first agent message.

See **`config/sites.example.json`** for `local-fixture-live-chat-only` and `local-fixture-chat-then-form`.

**Local fixture server:** in a second terminal, run **only** this (do not paste extra text from docs onto the same line; some editors use Unicode dashes that confuse `npm`):

```bash
npm run fixture:kill
npm run fixture
```

`fixture:kill` stops whatever is **listening on port 3333** (typical when a previous fixture did not exit). Then open `http://127.0.0.1:3333/`.

If you truly need another port: `FIXTURE_PORT=3334 npm run fixture` and use that port in any **localhost** site URL inside `config/sites.json` (production-only configs skip the fixture entirely).

Optional email for `run`: see `.env.example` (SMTP variables).

---

## More reading (same ideas, different docs)

See **[docs/README.md](docs/README.md)** for a map of all docs.

---

## License

See [LICENSE](LICENSE).
