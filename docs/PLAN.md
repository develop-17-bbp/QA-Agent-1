# Rollout plan (simple steps)

This is a **suggested order** for bringing QA-Agent into regular use at a team. Assign names and dates to your own situation.

**Companion docs:** [PRD](./PRD.md) · [ARCHITECTURE](./ARCHITECTURE.md)

---

## Phase 0 — Agree on the basics

**Goal:** Everyone knows **what** we check, **which URLs** are allowed, and **how** we share results.

| Task | Output |
|------|--------|
| Decide staging vs production rules | Short written note |
| Decide who edits **`config/urls.txt`** (created from `urls.example.txt`, not committed) | One owner or rotation |
| Decide how reports are shared (email, drive, wiki) | One channel |
| Confirm we’re **allowed** to hit customer sites on a schedule | Yes/No per client or policy |

**Done when:** No confusion about permission to crawl.

---

## Phase 1 — Learn the tool

**Goal:** Two or more people can run **`health`** on a clean machine and open **`artifacts/health/<runId>/index.html`**.

| Task | Output |
|------|--------|
| Install Node 20+, `npm install`, `npm run build` | Works on ≥2 machines |
| `cp config/urls.example.txt config/urls.txt`, edit, run `npm run health -- --urls config/urls.txt` | Reports appear |
| Understand **defaults:** crawl is **uncapped** (`--max-pages 0`, `--max-link-checks 0`) — large sites need time or explicit caps | No surprise long runs |
| Optional: try `--serve` once | Team has seen the live dashboard |

**Done when:** Anyone trained can find the HTML reports without help.

---

## Phase 2 — Try it on real sites

**Goal:** Run against a **small** set of real URLs (e.g. 5–15) and see if the results are useful.

| Task | Output |
|------|--------|
| Add real roots with clear owners | Updated **`config/urls.txt`** (local file) |
| Note false alarms and slow sites | Simple log |

**Done when:** The team trusts red/green enough to act on it.

---

## Phase 3 — Run it on a schedule

**Goal:** One **server** (VM) runs checks **daily** or **weekly**, keeps **secrets** safe, and **deletes old** report folders so the disk doesn’t fill up.

| Task | Output |
|------|--------|
| Cron or systemd timer | Job runs on time |
| Secrets in env file, not in git | Documented location |
| Retention policy (e.g. delete runs older than 30 days) | Script or calendar reminder |
| Alerting on non-zero exit | Optional hook to email/Slack |

**Done when:** Failures get noticed without manual babysitting.

---

## Phase 4 — Keep improving

**Goal:** Operational settings match reality: **`--max-pages` / `--max-link-checks`** when full crawls are too heavy, **`--timeout-ms`** for slow hosts, **`--concurrency`** for many roots — and docs stay updated when the team changes process.

---

*See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for laptop vs server details.*
