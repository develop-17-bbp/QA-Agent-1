# QA-Agent ↔ n8n — Daily SEO Report

Automated daily email to the SEO team at **05:30 UTC** containing:
- Broken links per site (count + top samples + HTTP status breakdown)
- PageSpeed Insights (mobile + desktop averages + slowest pages)
- Form & flow test pass/fail (from `config/sites.json`)

---

## Architecture

```
┌─────────────────┐   cron 05:30 UTC   ┌──────────────────────┐   HTTP   ┌────────────────────┐
│  n8n Schedule   ├────────────────────►  HTTP Request        ├──────────►  QA-Agent          │
│  Trigger        │                     │  POST /api/daily-   │          │  /api/daily-report │
│                 │                     │  report             │          │                    │
│                 │                     │  Bearer: <TOKEN>    │          │  1. Fresh crawl    │
│                 │                     │                     │          │  2. Form tests     │
│                 │                     │                     │          │  3. HTML compose   │
└─────────────────┘                     └──────────┬──────────┘          └──────────┬─────────┘
                                                   │                                │
                                                   │                                │
                                           ┌───────▼────────┐                       │
                                           │  Send Email    ◄───────────────────────┘
                                           │  (SMTP/Gmail)  │   { subject, html, text, payload }
                                           └────────────────┘
                                                   │
                                                   ▼
                                             seo@your-org.com
```

**Why n8n calls QA-Agent (pull model):**
- n8n owns scheduling, retries, and email routing — its core strengths.
- QA-Agent owns the data. The endpoint returns a fully-formatted subject + HTML body so n8n does zero transformation.
- Want to add Slack / Teams / CSV export later? Fan out from the same endpoint in n8n.

---

## Setup (takes 10 minutes)

### 1. Configure QA-Agent

Add these to `.env`:

```bash
# Bearer token protecting /api/daily-report (leave blank for local-only)
DAILY_REPORT_TOKEN=<paste a long random string, e.g. `openssl rand -hex 32`>

# Default sites to crawl if you run the CLI script without --sites
DAILY_REPORT_SITES=https://www.realdrseattle.com/,https://www.nwface.com/

# Optional: if you run the CLI standalone instead of n8n
DAILY_REPORT_WEBHOOK=https://n8n.your-company.com/webhook/seo-daily
```

Restart the dashboard so the env change takes effect:

```powershell
npm run dashboard:kill
npm run health -- --serve
```

Sanity check (should return JSON; takes 15-90 s depending on `includePageSpeed`):

```powershell
curl -X POST http://localhost:3847/api/daily-report `
  -H "Authorization: Bearer <DAILY_REPORT_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{"sites":["https://www.example.com/"],"includePageSpeed":false,"includeFormTests":false,"maxPages":5}'
```

You should get back `{ subject, html, text, summary, sites, formTests }`.

---

### 2. Configure n8n

Import the workflow template:

1. Open your n8n instance → **Workflows** → **Import from File** → pick `integrations/n8n/daily-seo-report.json`
2. The workflow has 3 nodes: **Schedule Trigger** → **HTTP Request** → **Send Email**

Create two credentials in n8n:

#### Credential A — "QA-Agent Bearer Token" (Header Auth)

- **Type:** HTTP Header Auth
- **Name:** `QA-Agent Bearer Token`
- **Header name:** `Authorization`
- **Header value:** `Bearer <DAILY_REPORT_TOKEN from step 1>`

#### Credential B — "SEO Team SMTP" (SMTP)

- **Type:** SMTP
- **Name:** `SEO Team SMTP`
- **Host:** your SMTP host (e.g. `smtp.gmail.com`, `smtp.sendgrid.net`)
- **Port:** `587` (TLS) or `465` (SSL)
- **User / Password:** your SMTP credentials
- For Gmail with an app password: use `smtp.gmail.com:587` + a Google App Password (not your login)

#### Environment variables in n8n

In your n8n instance's `.env` (or Docker env):

```bash
QA_AGENT_BASE_URL=https://qa-agent.your-company.com   # or http://localhost:3847 for local
SEO_TEAM_EMAILS=seo@your-company.com,ppc@your-company.com
SMTP_FROM=qa-agent@your-company.com
SMTP_REPLY_TO=                                         # optional
```

---

### 3. Customize the schedule

The workflow's Schedule Trigger is set to **`30 5 * * *`** (every day at 05:30 UTC). Common alternatives:

| Cron | Runs |
|---|---|
| `30 5 * * *` | Daily 05:30 UTC (11:00 IST) |
| `0 3 * * 1` | Every Monday 03:00 UTC |
| `0 7 * * 1-5` | Weekdays 07:00 UTC |
| `0 */6 * * *` | Every 6 hours |

---

### 4. Customize the payload

Open the **HTTP Request** node and edit its JSON body. Default:

```json
{
  "sites": [
    "https://www.realdrseattle.com/"
  ],
  "includePageSpeed": true,
  "includeFormTests": true,
  "maxPages": 50
}
```

Options:

| Field | Type | Default | Notes |
|---|---|---|---|
| `sites` | string[] | — | Required. URLs to crawl. |
| `includePageSpeed` | boolean | true | PSI runs mobile+desktop for up to 10 pages per site; +30-60 s per site. |
| `includeFormTests` | boolean | true | Runs enabled sites from `config/sites.json`. |
| `formTestSiteIds` | string[] | _all enabled_ | Filter to specific form-test site IDs. |
| `maxPages` | number | 50 | Cap pages per site; smaller = faster, less coverage. |
| `existingRunId` | string | — | Skip the fresh crawl and reuse a specific run (rarely needed). |

---

### 5. Turn on the workflow

In n8n, flip the workflow **Active** toggle. Execute once manually first to confirm email arrives correctly.

---

## Option B — Skip n8n, use Windows Task Scheduler / Linux cron

If you'd rather not host n8n, use the CLI script `scripts/daily-report.ts` directly.

### Windows Task Scheduler

```
Program:  node
Arguments: --import tsx C:\path\to\QA-Agent\scripts\daily-report.ts --webhook=<n8n or Zapier webhook URL>
Trigger:   Daily 05:30 UTC
```

Or write to a file + mail manually:

```powershell
npx tsx scripts/daily-report.ts --out=daily-report.html --include-pagespeed --include-form-tests
```

### Linux cron

```cron
30 5 * * *  cd /opt/qa-agent && /usr/bin/npx tsx scripts/daily-report.ts --webhook=https://hooks.example.com/...
```

---

## Troubleshooting

### "Unauthorized"
Your n8n credential's header value must be exactly `Bearer <token>` (with the word "Bearer" and a space). Token must match `DAILY_REPORT_TOKEN` in QA-Agent's `.env`.

### Email arrives but looks plain-text
Your SMTP provider stripped HTML. Check the n8n Email node's "Email format" is set to `both`, not `text`.

### Report is empty (no broken links, no PageSpeed)
Check `artifacts/llm-calls.jsonl` and the dashboard terminal — probably the crawl failed. Try with a small `maxPages` (e.g. 5) to isolate.

### n8n times out after 5 min
Crawls with PageSpeed on large sites can take > 5 min. Increase the HTTP Request node's **Timeout** (we set 10 min by default). Or set `includePageSpeed=false` for the daily run and do PageSpeed on a weekly schedule instead.

### Form tests are failing but the sites work
Check `artifacts/form-tests/<runId>/screenshot.png`. Common issues: CAPTCHA now present, DOM selectors moved, or cookie banner blocking.

---

## What the email looks like

```
Subject: [QA-Agent] Daily SEO report · 2 sites · 42 broken · 3/4 forms passing · mobile PSI 78/100

┌─────────────────────────────────────────────────────┐
│  QA-Agent · Daily SEO Report                         │
│  Daily SEO report · 2 sites · 42 broken · …         │
│  Generated 2026-04-22 05:30 UTC · Run <abc123>       │
├─────────┬─────────┬─────────┬─────────┬─────────┬────┤
│  Sites  │  Pages  │ Broken  │ Forms   │ Mobile  │ D  │
│    2    │   842   │   42    │  3/4    │ 78/100  │ 92 │
└─────────┴─────────┴─────────┴─────────┴─────────┴────┘

┌─── realdrseattle.com ──────────────────────────┐
│ pages crawled: 420 · in 18.4s                  │
│ Broken: 12 · [4xx (404): 9] [5xx (500): 3]     │
│  /services/legacy  →  /old-page   404          │
│  /blog/archive     →  /blogs/archive   404     │
│  …                                              │
│ PSI mobile: 82 · desktop: 94                    │
│ Slowest: /products/gallery m=45 d=62           │
└────────────────────────────────────────────────┘

Form & flow tests
┌──────────────┬────────┬────────┬──────┐
│ Site         │ URL    │ Status │ Took │
│ Contact form │ /cnt   │ PASSED │ 4.2s │
│ Booking flow │ /bok   │ FAILED │ 6.1s │
│ ↳ ERROR: submit button not found   │      │
└──────────────┴────────┴────────┴──────┘
```

---

## Security notes

- `DAILY_REPORT_TOKEN` should be 32+ random bytes. Don't check it into git.
- The endpoint triggers a crawl — anyone with the token can make your server work. Keep the token in n8n credentials and `.env`, not in frontend code.
- SMTP passwords in n8n are encrypted at rest (n8n handles this). Don't paste them into workflow JSON.
