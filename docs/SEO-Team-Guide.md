# QA-Agent — SEO Team Quick Start

This guide is for people who want to *use* QA-Agent, not modify it.

---

## First-time setup (once per machine)

1. **Ollama** must be running locally: `ollama serve` (check the system tray)
2. **`.env`** must be populated — see `.env.example` for every key the app can use
3. **Connect Google** at `http://localhost:3847/google-connections` (one-time consent; covers GSC + GA4 + Ads)

Start the dashboard:
```powershell
npm run build:all
npm run health -- --serve
```
Open [http://localhost:3847/](http://localhost:3847/).

---

## The one-sentence map — which page for what question?

| You want to answer… | Go to | It reads from |
|---|---|---|
| "Is my site healthy? Crawl + score it" | **Dashboard** → paste URLs → Run | Live HTTP crawl of your own pages |
| "What links to my site?" | **Backlinks** | Crawl + Bing WMT + Common Crawl + URLScan + Wayback |
| "Which domains send me the most link juice?" | **Referring Domains** | Crawl + OpenPageRank |
| "Which of my pages need rewriting?" | **Content Audit** | Crawl + optional GA4 traffic overlay |
| "Which broken links do I have + how to fix each one?" | **Link Fix Advisor** | Crawl + local LLM (llama3.2) per link |
| "Should I target this keyword?" | **Keyword Overview** | Google Ads (volume/CPC) + Suggest + Trends + DDG SERP |
| "What related keywords should I add?" | **Keyword Magic Tool** | Google Suggest cascade + Wikipedia + optional Ads |
| "What's my current ranking for keyword X?" | **Position Tracking** | DuckDuckGo live SERP scrape; saves daily history |
| "How am I ranking vs. my competitors for the same keyword?" | **Competitor Rank Tracker** | DDG SERP across multiple domains |
| "What's my top-performing page, by real GSC impressions?" | **Top Pages** | Crawl + GSC + GA4 |
| "What's my technical audit score?" | **Site Audit** | Crawl rules |
| "What's my page loading time + Core Web Vitals?" | **URL Report** → paste URL | PageSpeed API + CrUX |
| "Does my contact form still work?" | **Form Tests** → paste URL into the Ad-hoc box | Playwright |
| "How is traffic trending for my site overall?" | **Traffic Analytics** | GA4 + Cloudflare Radar |
| "What do people search for about [topic]?" | **Topic Research** | Google Suggest + Wikipedia pageviews |
| "What should I write next?" | **SEO Writing Assistant** / **SEO Content Template** | GSC (past queries) + Suggest |

---

## Every page that shows a "Run" dropdown

Pages like Backlinks, Referring Domains, Content Audit, Link Fix Advisor, Top Pages, etc. need a completed crawl to read from. If the dropdown is empty, **start a crawl from the Dashboard first**. The dropdown labels look like:

> `realdrseattle.com · Apr 21, 7:14 PM · 21 pages`

so you can tell runs apart at a glance.

---

## Running a crawl — what the checkboxes mean

On the **Dashboard** form:

| Option | What it does | Time cost |
|---|---|---|
| `PageSpeed` | Runs Google's Lighthouse on each page (mobile + desktop) | +3–5 s per page |
| `Viewport check` | Screenshots on mobile / tablet / desktop; checks layout | +2–4 s per page |
| `AI summary` | After the crawl, Ollama writes a markdown summary of findings | +30–60 s one-time |
| `SEO audit` | Deep deterministic rules per page (title, h1, schema, etc.) | ~no extra time |
| `Max pages` | Cap how deep to crawl. `0` = unlimited (full sitemap) | Linear in page count |

Leave `Max pages` at `0` for full crawls; set it to `50` or `100` for quick samples.

---

## Stacking filters on the data tables

Link Fix Advisor, Backlinks, Referring Domains, Content Audit, Top Pages, Organic Rankings, Keyword Magic Tool, Keyword Overview, Position Tracking all have **"+ Add filter"** at the top.

Click it to stack filters: e.g. to find "every 404 linked from a blog post with a CTA anchor":

1. Add **HTTP** filter → `min: 404, max: 404`
2. Add **Found on** filter → contains `/blog/`
3. Add **Anchor text** filter → contains `contact`

Counter shows `X of Y rows · 3 filters active`. Click `↓ CSV` to export what you see.

---

## Ad-hoc URL form test (no config needed)

On **Form Tests** page, in the top "Ad-hoc URL test" box:

1. Paste any URL (e.g. `https://yoursite.com/contact`)
2. Tick **Dry run** if you only want to see what the tool would do (no real submit)
3. Click **Test this URL**

The tool auto-detects inputs, fills them with obvious test values (`qa-agent-test@example.com`, `"QA-Agent Test"`, etc.), submits, and tells you pass/fail with a screenshot. **Never point this at a form you don't control unless Dry run is on.**

---

## Pages to *not* rely on (yet)

- **Agentic Crawl (experimental)** — LLM pipeline on simulated data. Keep it for demos; don't base decisions on its output. For real crawl data, use the Dashboard.

---

## Performance + maintenance

### Clear old runs
```powershell
npm run prune-runs         # keeps last 10 (default)
npm run prune-runs 25      # keeps last 25
```
Recommended once a week, or wire to Windows Task Scheduler if you crawl daily.

### Kill a stuck dashboard
```powershell
npm run dashboard:kill
```

### Compare LLM models on the link-fix task
```powershell
$env:OLLAMA_MODEL="llama3.2"
npm run eval:link-fix
```
Reports accuracy + latency across 20 golden examples. Run again with `mistral` / `neural-chat` to compare before swapping models.

### Provider health check
```powershell
npm run diagnose
```
Shows which data sources are live / unconfigured / broken. Run it if the dashboard seems to be showing empty cards.

---

## Known limitations

- **Google Trends** is often throttled from Indian IPs — card shows "throttled" message, data is empty. Use a VPN or ignore that card.
- **Bing Webmaster Tools** requires your site to be verified in Bing *under the same Microsoft account that owns the `BING_WEBMASTER_API_KEY`*. Add the site at [bing.com/webmasters](https://www.bing.com/webmasters/), complete DNS/XML/meta verification, then the Backlinks page fills in.
- **Common Crawl** queries can take 30+ seconds — the provider itself is slow. Show a coffee cup to stakeholders.
- **Ollama on slow hardware**: switch `OLLAMA_MODEL=llama3.2` (default, 2 GB) if larger models time out. Edit `.env`, restart the server.

---

## If something's broken

1. `npm run diagnose` — shows which providers are down.
2. Open browser DevTools → Network tab → reproduce → check which `/api/*` call failed.
3. Tail the server terminal — useful errors print there.
4. `npm run dashboard:kill && npm run build:all && npm run health -- --serve` — clean restart.

For bugs, look at `artifacts/llm-calls.jsonl` (LLM call log) + the screenshot files in `artifacts/form-tests/` + the report JSON under `artifacts/health/<runId>/`.
