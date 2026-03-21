# Product Requirements Document (PRD)

**Product:** QA-Agent  
**Primary capability:** **Site health** — crawl, internal link verification, optional PageSpeed Insights API scores, HTML/JSON reports, optional **local live dashboard** (`--serve`).  
**Secondary capability (legacy):** **Form smoke tests** via Playwright (`qa-agent run`).  
**Audience:** Engineering leadership, product, operations, and anyone approving scope.

**Canonical usage doc:** [README](../README.md)

---

## 1. Executive summary

QA-Agent answers: *“Across our company and customer sites, are pages and internal links working, and do we have a rough signal on performance/quality?”*

The **default** path is **`qa-agent health`**: read a **plain-text file** of root URLs, **crawl same-origin HTML** (breadth-first, capped), **validate internal links**, optionally call the **[PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started)** (Lighthouse-class scores, same family as [PageSpeed Insights](https://pagespeed.web.dev/)), and write **per-run** and **per-site** artifacts under **`artifacts/health/<runId>/`**.

Operators may add **`--serve`** to open a **local browser UI** on **127.0.0.1** that streams **live progress** (Server-Sent Events). This is **not** a multi-tenant hosted product; it is an **optional control surface** for the same batch job.

**Legacy:** **`qa-agent run`** uses **Playwright** and JSON config to fill and submit forms. It remains available where we still need that workflow.

We expect **batch runs** (e.g. **daily** on a VM, or **on demand**), not a 24/7 service.

---

## 2. Problem statement

- We must repeatedly verify **many** properties without manually clicking every internal link or opening PageSpeed for each root.
- Regressions (404s, broken nav, slow deploys) should be **caught early** with **auditable artifacts** (HTML/JSON).
- **Form submission automation** is **separate** from site health; mixing them confuses scope and compliance (CAPTCHA, CRM noise).

---

## 3. Goals

| ID | Goal |
|----|------|
| G1 | **Automate** internal crawl + link validation from a **`.txt` URL list** (our roots + customer roots we are allowed to check). |
| G2 | **Optional PageSpeed** scores per root (API key; **one call per root per run** in normal configuration). |
| G3 | Produce **per-site** and **per-run** evidence (HTML + JSON + text summary). |
| G4 | **Non-zero exit code** when any site has health failures (for scripts and monitoring). |
| G5 | Support **optional live visibility** during a run via **`--serve`** (localhost dashboard). |
| G6 | Keep **legacy** form **`run`** available for teams that still rely on it. |

---

## 4. Non-goals (health, current release)

| We do not… | Notes |
|------------|--------|
| Scrape the PageSpeed **website** | We use the **official HTTP API** only. |
| Fill or submit **forms** in `health` | Use **`run`** if needed. |
| Enforce **robots.txt** | Treat as future/compliance-driven; obtain client approval for automated hits. |
| Crawl **third-party** origins from each root | **Same-origin** internal links only. |
| Replace full **E2E**, **visual regression**, or **manual QA** | This is **breadth-first health**, not full product QA. |
| Provide a **public, internet-exposed** dashboard | **`--serve`** binds **localhost**; exposing it requires **our** separate hardening (reverse proxy, auth). |

---

## 5. Users and stakeholders

| Role | Need |
|------|------|
| QA / Engineering | Maintain `urls.txt`, run CLI, interpret reports, tune limits. |
| DevOps | Schedule runs, secrets, disk retention, VM sizing. |
| Product / leadership | High-level pass/fail and trends from artifacts or exports. |
| Account / client-facing | Clear story: we **request pages over HTTPS** like a visitor; **no** on-site install. |

---

## 6. Functional requirements — `health` (primary)

| ID | Requirement | Code (indicative) |
|----|-------------|-------------------|
| FR-H1 | Load roots from a text file; skip blanks and `#` lines. | `src/health/load-urls.ts` |
| FR-H2 | BFS crawl same-origin pages up to **`--max-pages`**. | `src/health/crawl-site.ts` |
| FR-H3 | Check internal URLs (visited + extra up to **`--max-link-checks`**) and record broken links. | `src/health/crawl-site.ts` |
| FR-H4 | Optional PageSpeed for each root; respect **`--skip-pagespeed`** and env key. | `src/health/pagespeed.ts` |
| FR-H5 | Write **`report.html`**, **`report.json`** per site; **`index.html`**, **`summary.txt`** per run. | `src/health/report-site.ts`, `src/health/orchestrate-health.ts` |
| FR-H6 | CLI **`health`** with documented flags (urls, out, concurrency, limits, timeout, PageSpeed strategy). | `src/index.ts` |
| FR-H7 | Optional **`--serve`**: HTTP server on **127.0.0.1**, **SSE** stream of progress, static **`/reports/`** for generated HTML. | `src/health/health-dashboard-server.ts` |

---

## 7. Functional requirements — `run` (legacy)

| ID | Requirement | Code (indicative) |
|----|-------------|-------------------|
| FR-L1 | Load and validate JSON site config. | `src/config/schema.ts`, `src/config/load.ts` |
| FR-L2 | Per enabled site: open browser, scope to forms, fill, submit, assert success. | `src/runner/run-site.ts` |
| FR-L3 | Parallelism, skip disabled, screenshots, **`artifacts/<runId>/`**, optional **email**. | `src/orchestrate.ts`, `src/report/`, `src/notify/` |

---

## 8. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR1 | **Node.js 20+**; TypeScript build via `npm run build`. |
| NFR2 | **Health** uses **fetch** + HTML parsing; **no** Playwright for crawl. **`run`** requires Chromium. |
| NFR3 | Secrets via **environment variables**; never commit API keys or SMTP passwords. |
| NFR4 | **Exit code** reflects health failures (`health`) or failed sites (`run`). |

---

## 9. Configuration

| Mode | Input |
|------|--------|
| **Health** | `--urls <file>` — one `http(s)` root per line. |
| **Legacy run** | `--config <file>` — JSON with `sites[]`, forms, success rules. |

---

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| PageSpeed **quota** / rate limits | `--skip-pagespeed`; schedule less often; one call per root. |
| **Large sites** | Caps **`--max-pages`** / **`--max-link-checks`**; document expectations. |
| **SPAs** / JS-only navigation | Crawler sees static `<a href>`; deep SPA coverage may need future work. |
| **False positives** (timeouts vs real errors) | Tune **`--timeout-ms`**; triage in `report.html`. |
| **Key misuse** | Restrict keys in GCP; never commit keys; prefer IP-bound keys on VM. |

---

## 11. Success metrics

- **Coverage:** share of configured roots that complete per run without tool errors.
- **Time-to-detect:** broken links found faster than ad-hoc manual checks.
- **Signal quality:** actionable failures vs noise (documented triage).

---

## 12. Open decisions

- Policy for **production vs staging** roots in `urls.txt`.
- **Retention** policy for `artifacts/health/`.
- **Distribution** of reports (zip, email, upload) — productization optional.

---

## Related documents

- [Documentation index](./README.md)  
- [Non-technical guide](./NON_TECHNICAL_GUIDE.md)

---

## Document history

| Version | Notes |
|---------|--------|
| 1.0 | Rewritten end-to-end: health-first, `--serve`, legacy `run`, aligned with README. |
