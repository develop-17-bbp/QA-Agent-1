# Implementation and deployment

**Audience:** Engineers and **DevOps** who run QA-Agent on laptops or servers.  
**Companion docs:** [PRD](./PRD.md), [POA](./PLAN.md), [README](../README.md).

---

## 1. What runs where

| Environment | Typical use | Health command |
|-------------|-------------|----------------|
| **Developer laptop** | Ad-hoc runs, debugging, demos | `npm run health -- --urls config/urls.txt` |
| **Dedicated VM** | Scheduled daily (or cron) checks | `node dist/index.js health --urls /opt/qa-agent/config/urls.txt` |

**Legacy form runs** (`qa-agent run`) use **Playwright** + Chromium; **health** does **not** need a browser install.

---

## 2. Architecture (health)

```
urls.txt ──► qa-agent health ──► fetch + parse HTML (cheerio)
                    │                    │
                    │                    ├── BFS same-origin crawl (capped)
                    │                    ├── HEAD/GET internal URLs
                    │                    └── optional PageSpeed API (per root)
                    ▼
         artifacts/health/<runId>/
              index.html, summary.txt
              <site-id>/report.html, report.json
```

Optional **`--serve`**: a small **Node HTTP server** on **127.0.0.1** serves:

- **`/`** — live dashboard (reads **Server-Sent Events** from `/api/stream`).  
- **`/api/stream`** — SSE of `run_start`, `site_start`, `site_complete`, `run_complete`, etc.  
- **`/reports/…`** — static files from the **current** run directory (same origin as the dashboard).

**Security note:** **`--serve`** is for **local operators**. Do not expose the port to the internet without TLS, authentication, and network controls. Use **SSH port forwarding** if you need the UI from another machine: `ssh -L 3847:127.0.0.1:3847 user@vm`.

---

## 3. Pattern A — Local development

1. Install **Node 20+**, clone repo.  
2. `npm install && npm run build`  
3. `cp config/urls.example.txt config/urls.txt` and edit.  
4. Optional: `.env` with `GOOGLE_PAGESPEED_API_KEY` (see [README](../README.md)).  
5. Run:

   ```bash
   npm run health -- --urls config/urls.txt
   ```

6. Optional live UI:

   ```bash
   npm run health -- --urls config/urls.txt --serve --port 3847
   ```

**Hot reload dev:** `npm run dev -- --urls config/urls.txt` (tsx; no `build` step).

---

## 4. Pattern B — Dedicated VM (scheduled)

**Stack:** one Linux VM, **cron** or **systemd timer**, outbound **HTTPS** only to target sites + `googleapis.com` (if PageSpeed enabled).

**Example flow:**

```text
cd /opt/qa-agent
git pull && npm ci && npm run build
set -a && source /etc/qa-agent.env && set +a
node dist/index.js health --urls /opt/qa-agent/config/urls.txt --out /opt/qa-agent/artifacts/health
```

- Propagate **non-zero exit** to monitoring if the job fails.  
- **Secrets:** `/etc/qa-agent.env` (mode `600`), not committed.  
- **Config:** `urls.txt` via git or secure copy.  
- **Disk:** prune old runs, e.g. `find /opt/qa-agent/artifacts/health -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \;` (adjust retention).

**VM sizing (starting point):** 2 vCPU, 4–8 GB RAM, 20 GB disk; increase if many roots or high `--max-pages`.

**Do not** schedule **`--serve`** on a headless VM unless someone will port-forward to it; use plain **`health`** for unattended jobs.

---

## 5. Secrets

| Variable | Used by |
|----------|---------|
| `GOOGLE_PAGESPEED_API_KEY` | `health` (PageSpeed) — trim-safe in code; no referrer restriction for CLI (see README). |
| SMTP / `QA_AGENT_*` | Legacy **`run`** email path (see `.env.example`). |

---

## 6. Email and handoff

- **Health:** no built-in SMTP in the reference flow; **zip** `artifacts/health/<runId>/` or attach in a separate step.  
- **Legacy run:** can email via nodemailer when SMTP env vars are set.

---

## 7. Legacy: `qa-agent run`

- `npx playwright install chromium`  
- `node dist/index.js run --config config/sites.json`  
- Artifacts: `artifacts/<runId>/` (not under `health/`).  
- Same VM model applies; see `.env.example` for SMTP.

---

## 8. Compliance and safety

- Obtain **client / internal approval** before automating requests to third-party sites.  
- Treat **`artifacts/`** as potentially sensitive (URLs, errors).  
- **robots.txt** is **not** enforced in v1 — align with legal/policy if required.

---

## 9. Related links

- [README](../README.md) — CLI flags, troubleshooting.  
- [Non-technical guide](./NON_TECHNICAL_GUIDE.md) — plain-language overview.

---

*Document version aligned with QA-Agent **0.2.x** (health + `--serve` + legacy `run`).*
