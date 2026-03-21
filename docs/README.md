# QA-Agent documentation

This folder describes **what we built**, **for whom**, and **how we operate** it. The **canonical technical entry point** for day-to-day use is the repository **[README](../README.md)**.

---

## Who should read what

| Audience | Start here | Then |
|----------|------------|------|
| **Engineers / QA** who run or change the tool | [README](../README.md) | [Implementation plan](./IMPLEMENTATION_PLAN.md), `qa-agent health --help` |
| **DevOps** (scheduling, VM, secrets) | [Implementation plan](./IMPLEMENTATION_PLAN.md) | [README](../README.md) § deployment & env |
| **Product, AM, leadership** (why & rollout) | [PRD](./PRD.md) | [Plan of action](./PLAN.md) |
| **Non-technical teammates** (what happens each run) | [Non-technical guide](./NON_TECHNICAL_GUIDE.md) | [README](../README.md) § “What gets checked” (plain summary) |

---

## Documents in this folder

| File | Purpose |
|------|---------|
| [PRD.md](./PRD.md) | **Product requirements** — goals, scope, health vs legacy `run`, risks. |
| [PLAN.md](./PLAN.md) | **Plan of action** — phased rollout, ownership placeholders, milestones. |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | **Where and how it runs** — laptop vs VM, cron, secrets, live dashboard (`--serve`). |
| [NON_TECHNICAL_GUIDE.md](./NON_TECHNICAL_GUIDE.md) | **Plain language** — what a “run” is, who edits the URL list, FAQs. |

---

## Product shape (one paragraph)

**QA-Agent** is primarily a **CLI** (`qa-agent health`) that reads a **text file of root URLs**, **crawls each site** (same-origin links), **flags broken internal links** and bad HTTP statuses, and **optionally** calls the **Google PageSpeed Insights API** for Lighthouse-style scores. It writes **HTML + JSON reports** under `artifacts/health/<runId>/`. An optional **`--serve`** mode opens a **local browser dashboard** with **live progress** (Server-Sent Events); it is **not** a hosted SaaS.

The **`qa-agent run`** command remains for **legacy Playwright form smoke tests** (`config/sites.json`) and is **not** the default product path.

---

## Suggested reading order (new to the repo)

1. [README](../README.md) — install, first run, outputs.  
2. [NON_TECHNICAL_GUIDE.md](./NON_TECHNICAL_GUIDE.md) — if you need to explain the tool to others.  
3. [PRD.md](./PRD.md) — if you need scope and formal requirements.  
4. [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — before putting it on a VM.

---

*Last aligned with app version **0.2.x** (health + optional `--serve` dashboard + legacy `run`).*
