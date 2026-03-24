# Documentation map

Everything here explains **QA-Agent** in **plain language** (written so a young teen can follow the ideas). The **[main README](../README.md)** is still the place to go for **copy-paste commands** and flags.

---

## Pick what to read

| You want to… | Read this |
|--------------|-----------|
| Install and run the tool | [README](../README.md) |
| Understand the big picture (goals, what we skip) | [PRD.md](./PRD.md) |
| See how the parts connect (CLI, dashboard, reports, triage) | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Roll it out step by step at work | [PLAN.md](./PLAN.md) |
| Run it on a laptop or a server | [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) |
| Explain it to someone who never uses the terminal | [NON_TECHNICAL_GUIDE.md](./NON_TECHNICAL_GUIDE.md) |

---

## One-sentence summary

**QA-Agent** reads a text file of website addresses, **walks each site** by following **internal links**, and **writes HTML/JSON reports** about broken links and bad pages — all without opening a browser for the main mode (`health`). **By default** the crawl has **no page cap** (full same-origin reachability); you can set **`--max-pages`** / **`--max-link-checks`** when you need a shorter or bounded run.

The optional **`--serve`** mode adds a **local dashboard** (`/` on localhost) that serves **`/reports/<runId>/…`**, streams progress, and keeps **HTML reports** tied together with a **sticky navigation bar** (run index, combined report, dashboard). **Triage** (Open / OK / Working / Resolved) on issue rows can be stored in the browser and, when using the dashboard, synced to **`issue-overrides.json`** in the run folder.

The older **`run`** command is different: it uses a **browser** to test **forms**.

## Config files in git

| File in repo (tracked) | Your local file (not committed) |
|------------------------|-----------------------------------|
| `config/urls.example.txt` | `config/urls.txt` — copy and edit for **`health`** |
| `config/sites.example.json` | `config/sites.json` — copy and edit for **`run`** |

This keeps **your URLs and site definitions** out of version control. See the **[main README](../README.md)** for `cp` commands.

---

## App version

Aligned with **0.2.x** in `package.json`.
