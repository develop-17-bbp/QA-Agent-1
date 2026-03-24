# Product requirements (plain language)

**Product name:** QA-Agent  
**Main job:** Help a team **automatically check** many websites: **do pages load?** **do internal links work?**  
**Side note:** An older mode (`run`) tests **forms** with a browser — not the main focus here.

---

## The problem we’re solving

Checking every link by hand on many sites takes forever. This tool does a **first automatic pass** and saves **files you can open** (HTML/JSON) so people can see what broke and where.

---

## Goals (what “success” looks like)

1. **Read a simple list** of website roots from a `.txt` file (operators create **`config/urls.txt`** from **`config/urls.example.txt`**; the real list is **not** committed to git).
2. **Crawl** each site (same website only) **breadth-first**. **Default:** no artificial page cap (`--max-pages 0`) so operators get a **full** reachable crawl unless they set a positive limit for shorter runs.
3. **Record** broken internal links and pages that error or time out.
4. **Save reports** everyone can open — per site and per run.
5. **Return exit code 1** when something fails — so scripts and alarms can notice.
6. **Optional:** live dashboard on **localhost** while a run happens (`--serve`).
7. **Keep** the old **`run`** form tester for teams that still need it.

---

## What we are **not** trying to do (health mode)

| We don’t… | Why |
|-----------|-----|
| Pretend to be a human clicking every button | That’s different QA. |
| Submit forms or solve CAPTCHAs in `health` | Use **`run`** if you need forms. |
| Follow links to **other companies’** sites from your page | We only expand **same-origin** links. |
| Promise we obey **robots.txt** | Not built in; ask before aggressive crawling. |
| Host a public SaaS dashboard | `--serve` is for **local** use unless **you** harden it. |

---

## Who cares about this

- **Builders / testers** — run the tool, read reports, tune limits.
- **People who run servers** — schedule runs, store secrets, clean old report folders.
- **Managers** — want a simple pass/fail story from the artifacts.

---

## Safety / honesty notes

- The tool only **requests pages over the internet** — it doesn’t install anything **on** customer servers.
- **Unlimited default crawl** can mean **many** HTTP requests and long runtimes on huge sites. Teams may use **`--max-pages`**, **`--max-link-checks`**, **`--timeout-ms`**, or schedules to stay within policy and infrastructure.
- **URL lists and `run` JSON configs** should stay **local** (gitignored copies from the `config/*.example.*` files) so customer URLs and notify emails are not pushed to the repo by mistake.

---

*For rollout steps, see [PLAN.md](./PLAN.md). For how to run it, see [README](../README.md).*
