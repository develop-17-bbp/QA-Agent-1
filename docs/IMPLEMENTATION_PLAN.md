# Running QA-Agent (implementation guide)

**Who this is for:** People who will run the tool on a **laptop** or a **server**.  
**Commands:** The **[main README](../README.md)** has the full flag list.

---

## Two common setups

| Where | Typical use |
|-------|-------------|
| **Your laptop** | Try it, debug, demo |
| **A server (VM)** | Same command on a **timer** (cron / systemd) every day or week |

**Important:** `health` does **not** need Playwright or Chromium. Only the legacy **`run`** command needs the browser installed.

---

## What happens in `health` (one line)

```
urls.txt → program → fetch pages + parse HTML → write reports under artifacts/health/<runId>/
```

---

## Default crawl limits (`health`)

| Flag | Default | Meaning |
|------|---------|---------|
| `--max-pages` | **`0`** | **`0`** = no cap — BFS visits every same-origin HTML page reachable from the root until the queue is empty. Any **positive** number stops after that many **full page fetches**. |
| `--max-link-checks` | **`0`** | **`0`** = no cap on extra **HEAD** checks for internal URLs that were not visited as full pages (e.g. when `--max-pages` was capped). |

So **out of the box**, a run tries for **full** site coverage (within same-origin link discovery). For **scheduled** jobs on **very large** sites, consider **`--max-pages 500`** (example), **`--timeout-ms`**, or off-peak windows.

---

## Configuration files (`health` and `run`)

- **`health`** needs a URL list: **`cp config/urls.example.txt config/urls.txt`**, then edit **`config/urls.txt`**. That path is **gitignored** so your roots stay private.
- **`run`** needs JSON: **`cp config/sites.example.json config/sites.json`**, then edit **`config/sites.json`** (also **gitignored**). Enable/disable sites there; for the **local fixture** entry, run **`npm run fixture`** in another terminal first (see main README).

On a **server**, deploy **`urls.txt`** / **`sites.json`** the same way you deploy secrets (config management, secure copy) — they are **not** cloned from git.

---

## Pattern A — Developer laptop

1. Install **Node.js 20+**.
2. In the repo: `npm install && npm run build`.
3. `cp config/urls.example.txt config/urls.txt` and edit.
4. Run:

   ```bash
   npm run health -- --urls config/urls.txt
   ```

5. Open `artifacts/health/<newest folder>/index.html`.

**Faster dev (no `build` every time):**

```bash
npm run dev -- --urls config/urls.txt
```

**Live dashboard:**

```bash
npm run health -- --urls config/urls.txt --serve
```

Default port **3847**. Use `--port` to change. **Do not** expose this to the whole internet without extra security — it’s meant for **localhost** or **SSH tunnel** (`ssh -L 3847:127.0.0.1:3847 user@server`).

Optional `.env` for **`run`** only (SMTP email): see `.env.example`.

---

## Pattern B — Server with a schedule

**Idea:** The machine runs the same command on a schedule; outbound **HTTPS** to the sites you list (and to your SMTP host if you use `run` with email).

Example (paths are examples — change to yours):

```text
cd /opt/qa-agent
git pull && npm ci && npm run build
set -a && source /etc/qa-agent.env && set +a
node dist/index.js health --urls /opt/qa-agent/config/urls.txt --out /opt/qa-agent/artifacts/health
```

- Propagate **non-zero exit** to monitoring if the job fails.
- Keep env files **private** (e.g. mode `600`), not in git.
- **Prune** old runs so disk doesn’t fill up.

**Rough sizing to start:** 2 vCPU, 4–8 GB RAM. **Default unlimited crawl** can stress CPU, network, and **duration** on sites with thousands of pages — add **`--max-pages`** caps or split URL lists if jobs exceed your window.

**Headless VM:** don’t rely on `--serve` unless someone uses SSH port-forward; plain `health` is fine for unattended jobs.

---

## Secrets

| Secret | Purpose |
|--------|---------|
| SMTP / `QA_AGENT_NOTIFY_EMAILS` | Optional — only for legacy **`run`** email (see `.env.example`) |

Never commit secrets. Use `.env` locally or a server env file.

---

## Troubleshooting (quick)

| Symptom | What to try |
|---------|-------------|
| Run takes forever / too many requests | **Expected** with default **unlimited** crawl on big sites. Set **`--max-pages`** (and optionally **`--max-link-checks`**) to a positive cap, or run less often. |
| Timeouts on slow pages | Raise **`--timeout-ms`** a bit; avoid hammering the same host with extreme **`--concurrency`**. |
| Port in use with `--serve` | **`--port <other>`** |

---

*Architecture diagram: [ARCHITECTURE.md](./ARCHITECTURE.md)*
