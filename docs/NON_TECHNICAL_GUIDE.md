# QA-Agent for people who don’t use the terminal

**Who this is for:** Anyone who needs to **understand what the tool does** and **what a report means** — without typing commands.  
**Technical details:** [README](../README.md) · [docs index](./README.md)

---

## What is QA-Agent in one breath?

It’s a **program our team runs on a computer we control**. It reads a **short list of website addresses**, visits those sites, **follows links inside each site**, and writes **reports** so we can see **broken links** and **pages that don’t load properly**. It does **not** use Google or other scoring services for the main check — just **normal visits** to the pages you list.

---

## Why use it?

We look after **many websites**. Opening every page by hand does not scale. This tool gives a **first automatic pass** and saves **evidence** (HTML files) we can share.

---

## What happens in one “run”?

1. Someone starts the job (or a **scheduled server** starts it).
2. The program reads a **text file** with one **starting web address** per line.
3. For each address, it loads pages and follows **internal links** (links that stay on the **same website**). **By default** it keeps going until it has covered the **whole reachable** part of the site (unless the technical team sets a **limit** for very large sites).
4. It **writes down problems**: broken links, errors, timeouts.
5. It saves a **folder of reports** we can open in a browser.
6. The job **ends** — it is **not** a 24/7 always-on service.

**We do not install software on our customers’ websites.** The tool only makes **outbound** requests over the internet, like a visitor.

---

## Optional: watching it live

Sometimes the technical team runs it with a **small local webpage** that shows **progress** while it runs. That’s **optional** and meant for **our operators**, not a public website.

The same page can **open the finished reports** from your computer. The reports have a **menu bar at the top** so you can jump between the **list of sites** for that run, the **single combined report** for all sites, and **back to the live dashboard**. If you use the reports, you may also see **triage** options on problem rows (for example “resolved” or “OK”) so teams can track what was fixed — that stays on your machine unless you use the server mode that saves a small file with the run.

---

## Where things live (conceptually)

| Thing | Plain description |
|-------|-------------------|
| **The list of sites** | A **text file** on our machines (`config/urls.txt`), created from a **sample file** in the repo. The real list is **not** checked into git — so customer URLs stay private. |
| **Form-test settings** | If we use the older **`run`** mode, another **local file** (`config/sites.json`) holds which forms to try — also **not** committed; copied from an example. |
| **The computer that runs checks** | Often a **VM** on a schedule, sometimes a laptop for a test. |
| **The reports** | Saved under **`artifacts/health/`** — each run gets its **own folder**. |
| **Secrets** | Things like SMTP passwords for the **older** `run` mode stay in **private env files**, **not** in chat or public repos. |

---

## If you’re not technical, what might you do?

| Situation | Suggested action |
|-----------|------------------|
| You get a **report** or **summary** | If it says **pass**, relax. If **fail**, note **which site** and tell **engineering / QA**. |
| You want a **new site** checked | Ask the **technical owner** to add its **root URL** to the list — and confirm we’re **allowed** to check it. |
| You want checks **paused** for a site | Ask the owner to **remove** or **comment out** that line until we resume. |

---

## Words we use

| Word | Meaning |
|------|---------|
| **Run** | One full check over all listed starting addresses. |
| **Root URL** | The starting address we give the tool for each site. |
| **Internal link** | A link to another page **on the same website**. |
| **Broken link** | A link that leads to an error or a page that doesn’t load. |
| **Legacy form testing** | A **different** older mode that uses a **browser** to try **forms** — not the default health workflow. |

---

## Frequently asked questions

**Does it run 24/7?**  
No. It runs on a **schedule** or when someone **starts** it, then it finishes and stops.

**Why would a site “fail” if I can open the homepage fine?**  
Another page or a **footer link** might be broken, or a request might **time out**. The report shows **where** to look.

**Does it fill out contact forms?**  
**Not** in the default `health` mode. Form testing is the separate **`run`** mode.

---

## Who to ask

If you’re unsure what a report means, ask **engineering or QA** — bring the **site name** and **date/time** of the run.
