# QA-Agent — guide for non-technical readers

**Who this is for:** Teammates who need to understand **what the tool does** and **how to interpret outcomes** without using the command line.  
**What the product is:** A **batch checker** for **website health**—it visits sites we list, follows **internal links**, flags **broken links** and bad pages, and can optionally add **speed/quality scores** from Google’s systems. It does **not** submit **contact forms** in the main workflow.

**Technical details:** [README](../README.md) · [Documentation index](./README.md)

---

## 1. Why we use it

We look after **many websites** (ours and our customers’). Manually opening every page and every PageSpeed report does not scale. QA-Agent **automates a first pass**: “Do internal links work, do pages return errors, and roughly how do main URLs score?”

---

## 2. What happens in one “run” (plain language)

1. **Start** — The job runs on **our computer** (usually a **scheduled server** in the cloud, sometimes someone’s laptop for a test).  
2. **Read the list** — It reads a **short text file** with one **starting web address** per line (for example `https://example.com/`).  
3. **Visit each site** — For each address, it loads pages by following **normal links that stay on the same website**, up to limits our team configured.  
4. **Record problems** — Broken links or pages that return errors go into a **report**.  
5. **Optional scores** — If we enabled Google’s optional service, it may add **scores** for the main address (similar idea to Google’s public PageSpeed tools, but through an API our team configures).  
6. **Save reports** — It writes a **folder of HTML files** our team can open in a browser or zip and send around.  
7. **Finish** — The job **stops**; it is **not** running all day in the background.

**We do not install software on our customers’ websites.** The tool only makes **outbound** requests over the internet, like a visitor.

---

## 3. Watching a run live (optional)

Sometimes our technical team runs the tool with a **“live dashboard”** on their machine. That shows **which site is being checked** and **whether it passed or had issues** as the run progresses. This is **optional** and is meant for **operators**, not a public website.

---

## 4. Where things “live”

| Thing | Plain description |
|-------|-------------------|
| **The list of sites** | A text file maintained by our technical owners (one starting URL per line). |
| **The server that runs checks** | Often a **VM** we control, running on a **schedule** (for example once per day). |
| **The reports** | Saved in a folder structure under **`artifacts/health/`** — each run gets its **own dated folder**. |
| **Secrets** | Things like API keys stay in **environment files** on the server, **not** in chat or public repos. |

---

## 5. What you might do (no terminal)

| Situation | Suggested action |
|-----------|------------------|
| You receive a **summary** or **report** | If everything looks **passed**, no urgent action. If something **failed**, note **which site** and pass it to **engineering or QA**. |
| You want a **new site** on the list | Ask the **technical owner** to add its **root URL** to the text file (and confirm we’re allowed to check it). |
| You want to **pause** checks for a site | Ask the **technical owner** to remove or comment out that line until we resume. |

---

## 6. Words we use

| Term | Meaning |
|------|---------|
| **Run** | One full execution over all listed roots. |
| **Root URL** | The starting address we give the tool for each site (we explore **inward** from there). |
| **Internal link** | A link to another page **on the same website**. |
| **Broken link** | A link that leads to an error or a page that does not load successfully. |
| **PageSpeed-style scores** | Optional numbers about speed and quality (when our team enables the Google API). |
| **Legacy form testing** | A **separate** older mode that uses a browser to try **forms**; not part of the default health workflow. |

---

## 7. Frequently asked questions

**Does it run 24/7?**  
No. It runs on a **schedule** or when someone **starts it**, finishes, writes reports, and exits.

**Is it the same as typing URLs into Google’s PageSpeed website?**  
The **idea** of scores is similar when we use Google’s API; our tool does **not** control Google’s public website.

**Why would a site “fail” if I can open it fine?**  
A **different page** or **footer link** might be broken, or a **slow** response might time out. The report is meant to list **where** to look.

**Does the client see that we’re testing?**  
They see **network traffic** like a normal visitor. Policies and contracts about automated access are **our** responsibility.

---

## 8. Related documents

- [PRD](./PRD.md) — formal scope and goals.  
- [Plan of action](./PLAN.md) — rollout phases.  
- [Implementation plan](./IMPLEMENTATION_PLAN.md) — where the job runs (laptop vs VM).  
- [README](../README.md) — full technical usage.

---

*This guide reflects the **site health** product. Legacy **form** automation is documented separately in the PRD.*
