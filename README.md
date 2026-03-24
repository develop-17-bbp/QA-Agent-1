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

**Where to look:** open `artifacts/health/<runId>/index.html` in a browser. Each site has its own folder with `report.html` and `report.json`.

- Exit code **0** = all sites passed the checks we run.
- Exit code **1** = at least one site had a broken internal link or a bad page status (useful for alarms).

---

## Live progress in a browser (optional)

```bash
npm run health -- --urls config/urls.txt --serve
```

Opens a small page on your computer (default port **3847**). It’s only for **you on your machine** — not meant to be exposed to the whole internet without extra security.

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
| `config/sites.example.json` | **Tracked in git.** Copy to **`config/sites.json`** for **`run`** (`sites.json` is **gitignored**). Includes an optional **disabled** entry for the local **`npm run fixture`** server. |
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

Optional email for `run`: see `.env.example` (SMTP variables).

---

## More reading (same ideas, different docs)

See **[docs/README.md](docs/README.md)** for a map of all docs.

---

## License

See [LICENSE](LICENSE).
