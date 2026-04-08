# QA-Agent — health dashboard (web UI)

This package is the **Vite + React** front end for the local dashboard when you run **`qa-agent health --serve`** (default API on port **3847**).

## Develop

From the **repo root**:

```bash
npm install
npm run build
npm run health -- --urls config/urls.txt --serve
```

In another terminal, from **`web/`**:

```bash
npm install
npm run dev
```

The dev server proxies **`/api`** and **`/reports`** to the dashboard server.

## Build for production

```bash
npm run build:web
```

The CLI embeds or serves the built files from **`web/dist/`** as configured in the main app.

Full flags, crawl behavior, and report layout: **[`../README.md`](../README.md)**.
