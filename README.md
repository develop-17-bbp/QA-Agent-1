# QA-Agent

Config-driven browser checks for **many websites**: open a URL, fill predefined forms, assert success, save screenshots and a run report, optionally **email** the product team.

## Prerequisites

- **Node.js 20+** (includes `npm` and `npx`). If you see `command not found: npm`, install Node:
  - [nodejs.org](https://nodejs.org/) LTS installer, or
  - Homebrew: `brew install node`, or
  - [nvm](https://github.com/nvm-sh/nvm): `nvm install 20`
- Run the shell commands below **one at a time**; lines starting with `#` are comments—do not paste them as commands.

## Layout

| Path | Purpose |
|------|--------|
| `config/sites.example.json` | Copy to `config/sites.json` (or similar) and define your sites |
| `src/config/` | Zod schema + JSON loader |
| `src/runner/` | Playwright: navigate, fill, submit, assert |
| `src/orchestrate.ts` | Parallel runs with a concurrency limit |
| `src/report/` | Text + HTML summaries |
| `src/notify/email.ts` | Writes reports under `artifacts/<runId>/`; sends via SMTP when configured |
| `src/index.ts` | CLI (`qa-agent run`) |
| `artifacts/` | Run output (gitignored except `.gitkeep`) |
| `fixture-site/` | **Local fake marketing site** + form (no CAPTCHA); submissions saved and viewable |
| `config/sites.fixture.json` | QA-Agent config pointing at the fixture on `127.0.0.1:3333` |

## Local fixture site (no production spam)

Run a **local** long homepage with a bottom contact form—same idea as a live agency site, but submissions stay on your machine.

```bash
cd fixture-site && npm install && npm start
```

- App: [http://127.0.0.1:3333/](http://127.0.0.1:3333/) (change port with `FIXTURE_PORT=3456 npm start`)
- **What the agent filled:** [http://127.0.0.1:3333/submissions](http://127.0.0.1:3333/submissions) (HTML table) or `/api/submissions` (JSON)
- Data file: `fixture-site/data/submissions.json` (gitignored)

In a **second** terminal, from the repo root:

```bash
npm run build
npm run run -- --config config/sites.fixture.json --skip-email
```

Use `--headed` while debugging selectors.

## Quick start

```bash
npm install
npx playwright install chromium
cp config/sites.example.json config/sites.json
# Edit config/sites.json: set enabled: true, real URLs/selectors
npm run build
npm run run -- --config config/sites.json
```

Develop without a separate build:

```bash
npm run dev -- --config config/sites.json --headed
```

## CLI

```text
qa-agent run --config <path> [--concurrency 3] [--artifacts artifacts] [--headed] [--skip-email]
```

- **`--concurrency`** — max parallel browsers (default `3`).
- **`--artifacts`** — root folder for each run: `artifacts/<runId>/` with per-site screenshots + `report.html` / `report.txt`.
- **`--skip-email`** — write reports but do not send SMTP (useful in CI without secrets).

## Configuration

- **`defaultNotify.emails`** — default recipients (unless overridden).
- **`QA_AGENT_NOTIFY_EMAILS`** — comma-separated; overrides config when set (see `.env.example`).
- **`enabled: false`** — site is listed as **skipped** in the report (not executed).

### Forms on the homepage (not a `/contact` URL)

The **`url`** field is simply *the page where the form exists*. It does **not** have to be a dedicated contact path. Examples:

- Homepage with a footer CTA: `"url": "https://example.com/"` or `"https://example.com/index.html"`
- Long landing page: same — one URL, form further down the page

Playwright will scroll targets into view when filling and clicking. What matters is:

1. **`forms[].selector`** — Prefer a **parent scope** for the real form (section, `#id`, or `form` in the main content) so you do **not** hit a chat widget, newsletter popup, or cookie banner that also has “Name” / “Email” fields.
2. **Field `selector`s** — Use stable attributes from DevTools (`name`, `aria-label`, `id`, or `data-*`). If the site is a page builder, ask devs for `data-testid` on the main contact block.
3. **`success`** — If submit does **not** change the URL (AJAX / same page), avoid `url_contains`; use `text_visible` or `selector_visible` for a “Thank you” message or confirmation state.

**reCAPTCHA / bot checks:** Fully automated runs usually **cannot** complete forms protected by CAPTCHA. Options: test against a **staging** build with CAPTCHA off, use **Google test keys** in non-prod, or treat that site as manual / monitored only.

**`example.com`:** That domain is only placeholder text—there is **no contact form** at `https://example.com/contact` (you get “Example Domain”). Use your real site URL and selectors from DevTools, or keep the bundled **Heroku “the-internet” login demo** in `config/sites.json` to verify the runner works end-to-end.

**[realdrseattle.com](https://realdrseattle.com/)** (homepage): The consultation block uses Webflow `form#email-form` (fields `name-2`, `[id="name-company.com"]` for email, `textarea#field`). Success is detected when Webflow shows the sibling **`.w-form-done`** block: use `selector_visible` with `.w-form:has(#email-form) .w-form-done` (not raw `getByText` on the thank-you string—that text sits in the DOM hidden until submit succeeds, which confuses “visible” checks). The live form loads **Google reCAPTCHA**; if the server requires a solved challenge, the run will still **fail** until you use **staging** without CAPTCHA, **test keys**, or another approved path.

### Success checks

- `url_contains` — current URL includes substring after submit.
- `text_visible` — visible text on page (optional `timeoutMs`).
- `selector_visible` — element visible (optional `timeoutMs`).

## Email (optional)

Set `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, and if required `SMTP_USER` / `SMTP_PASS`. Without these, reports are still written to disk.

## Scaling later

- Run the same CLI on a schedule (cron, GitHub Actions, Kubernetes CronJob).
- Increase concurrency on a larger worker; add a queue (Redis, SQS) in front if many sites need isolation or retries across machines.

## License

See repository `LICENSE`.
