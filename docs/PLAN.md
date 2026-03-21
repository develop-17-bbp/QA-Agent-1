# Plan of action (POA)

**Companion to:** [PRD](./PRD.md)  
**Purpose:** How we **introduce**, **pilot**, and **operate** QA-Agent internally—phases, deliverables, and ownership placeholders.

**Primary product:** `qa-agent health` — URL list (`.txt`), crawl, link checks, optional PageSpeed, artifacts under `artifacts/health/<runId>/`, optional **`--serve`** live dashboard.  
**Legacy:** `qa-agent run` — Playwright form tests from JSON.

---

## Phase 0 — Alignment

**Objective:** Agree on **what** we monitor, **where** URLs live, and **how** we share results.

| Task | Deliverable | Owner (assign) |
|------|-------------|----------------|
| Confirm **staging vs production** roots policy | Short written policy | PM / Eng lead |
| Agree **who edits** `urls.txt` and change control | Team convention | Eng lead |
| Agree **report distribution** (zip, email, wiki) | Decision | Product |
| Point stakeholders at [Non-technical guide](./NON_TECHNICAL_GUIDE.md) | Link shared | PM |

**Exit criteria:** PRD non-goals and open decisions reviewed; no blocking ambiguity on **permission to hit customer sites**.

---

## Phase 1 — Baseline competency

**Objective:** Any operator can run **`health`** from a clean machine and read **`artifacts/health/<runId>/index.html`**.

| Task | Deliverable | Owner |
|------|-------------|--------|
| Node 20+, `npm install`, `npm run build` | Verified on ≥2 machines | Eng |
| Create `config/urls.txt` from example; run `npm run health -- --urls config/urls.txt` | Successful run + artifacts | Eng |
| Optional: `GOOGLE_PAGESPEED_API_KEY` in `.env`; confirm scores or intentional `--skip-pagespeed` | Notes | Eng / DevOps |
| Optional: run with **`--serve`** and walk through live dashboard + `/reports/` | Team demo | Eng |
| Document VM-oriented **defaults** (`--concurrency`, `--max-pages`) | One-pager or README pointer | Eng / DevOps |

**Exit criteria:** Repeatable green run; team knows where **`index.html`** and per-site **`report.html`** live.

---

## Phase 2 — Pilot on real roots

**Objective:** Validate value on a **small, approved** set of production or staging URLs.

| Task | Deliverable | Owner |
|------|-------------|--------|
| Add **5–15** real roots with ownership notes | `urls.txt` in repo or private path on VM | QA / Eng |
| Track **false positives** and **timeouts** | Simple log or spreadsheet | QA |
| Watch **PageSpeed quota** if enabled | Alerts or calendar reminder | DevOps |

**Exit criteria:** We trust the signal; triage process exists for red sites.

---

## Phase 3 — Scale and operations

**Objective:** **20–30+** roots on a **single VM** (or equivalent) with clear ownership.

| Task | Deliverable | Owner |
|------|-------------|--------|
| **Schedule** `node dist/index.js health --urls …` (cron / systemd) | Job + env file for secrets | DevOps |
| Tune **`--concurrency`** from observed duration | Documented choice | Eng |
| **Prune** old `artifacts/health/` | Cron or runbook | DevOps |
| **Triage runbook** — who acts on exit code 1 | One page | QA lead |

**Exit criteria:** Daily (or agreed) runs; non-zero exit understood; disk not growing without bound.

---

## Phase 4 — Backlog (prioritize as needed)

- Email or zip of `artifacts/health/<runId>/` after each run.  
- **robots.txt** or crawl-delay if contracts require it.  
- Slack / Teams notification on failure.  
- Richer coverage for **JS-heavy** SPAs (e.g. optional Playwright crawl).  
- Maintain legacy **`run`** only if still required.

---

## RACI (template — fill names before external use)

| Activity | Responsible | Accountable |
|----------|-------------|-------------|
| `urls.txt` content | QA / Eng | Eng lead |
| PageSpeed API key & VM env | DevOps | Eng lead |
| Client consent for automated requests | AM / PM | Manager |

---

## Milestones

1. **M1:** Any engineer runs `health` locally and explains one report.  
2. **M2:** Pilot on ≥5 real roots with two weeks of triage notes.  
3. **M3:** Scheduled VM runs + retention policy.  
4. **M4:** Optional report distribution automation.

---

*Aligned with repository **README** and **PRD** v1.0.*
