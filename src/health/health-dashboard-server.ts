import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import type { HealthRunMeta } from "./orchestrate-health.js";
import type { HealthProgressEvent } from "./progress-events.js";
import { parseUrlsFromText } from "./load-urls.js";
import { orchestrateHealthCheck } from "./orchestrate-health.js";

function isPathInsideRoot(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const f = path.resolve(candidate);
  return f === r || f.startsWith(r + path.sep);
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const m: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
  };
  return m[ext] ?? "application/octet-stream";
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/** Run folder names from orchestrate (timestamp + short id). */
function isSafeRunIdSegment(name: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(name) && !name.includes("..");
}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface HealthHistoryDay {
  date: string;
  runs: HealthRunMeta[];
}

async function listHealthHistory(outRoot: string): Promise<{ days: HealthHistoryDay[] }> {
  let entries;
  try {
    entries = await readdir(outRoot, { withFileTypes: true });
  } catch {
    return { days: [] };
  }

  const metas: HealthRunMeta[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (!isSafeRunIdSegment(ent.name)) continue;
    const metaPath = path.join(outRoot, ent.name, "run-meta.json");
    try {
      const raw = await readFile(metaPath, "utf8");
      metas.push(JSON.parse(raw) as HealthRunMeta);
    } catch {
      /* older run without run-meta.json — skip or minimal entry */
    }
  }

  const byDay = new Map<string, HealthRunMeta[]>();
  for (const m of metas) {
    const day = m.generatedAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(m);
    byDay.set(day, list);
  }

  const days: HealthHistoryDay[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, runs]) => ({
      date,
      runs: runs.sort((x, y) => (x.generatedAt < y.generatedAt ? 1 : -1)),
    }));

  return { days };
}

const BUFFER_CAP = 2500;

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>QA-Agent — health dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #58a6ff;
      --ok: #3fb950;
      --warn: #d29922;
      --bad: #f85149;
      --run: #a371f7;
    }
    * { box-sizing: border-box; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      margin: 0;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    h1 { font-size: 1.2rem; font-weight: 600; margin: 0 0 6px 0; }
    .sub { font-size: 0.85rem; color: var(--muted); margin: 0; }
    main { padding: 20px 24px 48px; max-width: 1100px; margin: 0 auto; }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0;
    }
    .tab {
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 10px 16px;
      border: none;
      border-radius: 8px 8px 0 0;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .tab:hover { color: var(--text); }
    .tab[aria-selected="true"] {
      background: var(--surface);
      color: var(--accent);
      border: 1px solid var(--border);
      border-bottom-color: var(--surface);
      margin-bottom: -1px;
    }
    .panel { display: none; }
    .panel.active { display: block; }
    label.lbl { display: block; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
    textarea.urls {
      width: 100%;
      min-height: 120px;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0d1117;
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      line-height: 1.45;
      resize: vertical;
    }
    .row-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
    button.primary {
      font: inherit;
      font-weight: 600;
      padding: 10px 18px;
      border-radius: 8px;
      border: 1px solid #388bfd;
      background: #1f6feb;
      color: #fff;
      cursor: pointer;
    }
    button.primary:disabled { opacity: 0.45; cursor: not-allowed; }
    button.ghost {
      font: inherit;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
    }
    .hint { font-size: 0.82rem; color: var(--muted); margin: 10px 0 0 0; }
    .banner {
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      margin-bottom: 20px;
      font-size: 0.9rem;
    }
    .banner a { color: var(--accent); }
    .banner.err { border-color: #f8514966; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
    tr:hover td { background: #ffffff06; }
    .hostname { font-weight: 600; word-break: break-all; }
    .url { font-size: 0.8rem; color: var(--muted); word-break: break-all; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.pending { background: #30363d; color: var(--muted); }
    .badge.running { background: #a371f733; color: var(--run); }
    .badge.ok { background: #23863633; color: var(--ok); }
    .badge.fail { background: #da363333; color: var(--bad); }
    .badge.err { background: #da363333; color: var(--bad); }
    .rep-link { margin-left: 8px; font-size: 0.8rem; font-weight: 600; }
    #log {
      margin-top: 24px;
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #010409;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      color: var(--muted);
      max-height: 180px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .day-block { margin-bottom: 28px; }
    .day-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--text);
      margin: 0 0 12px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .run-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 12px;
      background: var(--surface);
    }
    .run-card h3 { margin: 0 0 8px 0; font-size: 0.88rem; font-weight: 600; color: var(--accent); word-break: break-all; }
    .run-meta { font-size: 0.8rem; color: var(--muted); margin-bottom: 10px; }
    .run-links { font-size: 0.85rem; margin-bottom: 10px; }
    .run-links a { color: var(--accent); font-weight: 600; text-decoration: none; margin-right: 12px; }
    .run-links a:hover { text-decoration: underline; }
    .mini-table { width: 100%; font-size: 0.8rem; margin-top: 8px; }
    .mini-table th { font-size: 0.68rem; }
    .mini-table td { padding: 6px 8px; }
    .status-ok { color: var(--ok); font-weight: 600; }
    .status-bad { color: var(--bad); font-weight: 600; }
    .history-empty { color: var(--muted); font-size: 0.9rem; padding: 16px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Site health dashboard</h1>
    <p class="sub">Start checks from the browser, stream live status, open per-site HTML reports, and browse past runs by day.</p>
  </header>
  <main>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" id="tab-run" aria-selected="true" aria-controls="panel-run">New run</button>
      <button type="button" class="tab" role="tab" id="tab-history" aria-selected="false" aria-controls="panel-history">History by day</button>
    </div>

    <section id="panel-run" class="panel active" role="tabpanel" aria-labelledby="tab-run">
      <label class="lbl" for="urls-input">URLs (one https URL per line; lines starting with # ignored)</label>
      <textarea id="urls-input" class="urls" placeholder="https://www.example.com&#10;https://another.org"></textarea>
      <div class="row-actions">
        <button type="button" class="primary" id="btn-start">Start health check</button>
        <span id="busy-hint" class="hint" style="display:none">A run is in progress…</span>
      </div>
      <p class="hint">Uses the same crawl options as the CLI (timeouts, fetch concurrency, PageSpeed if enabled). If you launched with <code>--urls</code>, the first run may already be in progress or finished below.</p>

      <div id="banner" class="banner">Connecting to live stream…</div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Site</th>
            <th>Status</th>
            <th>Pages</th>
            <th>Broken</th>
            <th>Duration</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="log"></div>
    </section>

    <section id="panel-history" class="panel" role="tabpanel" aria-labelledby="tab-history" hidden>
      <p class="hint" style="margin-top:0">Runs are stored under your artifacts folder. Each card links to the combined report and per-site HTML.</p>
      <div id="history-root"><p class="history-empty">Loading…</p></div>
    </section>
  </main>
  <script>
    const banner = document.getElementById("banner");
    const rowsEl = document.getElementById("rows");
    const logEl = document.getElementById("log");
    const rows = new Map();
    const tabRun = document.getElementById("tab-run");
    const tabHistory = document.getElementById("tab-history");
    const panelRun = document.getElementById("panel-run");
    const panelHistory = document.getElementById("panel-history");
    const historyRoot = document.getElementById("history-root");
    const urlsInput = document.getElementById("urls-input");
    const btnStart = document.getElementById("btn-start");
    const busyHint = document.getElementById("busy-hint");

    let runBusy = false;

    function log(line) {
      logEl.textContent += line + String.fromCharCode(10);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setBanner(html, isErr) {
      banner.className = "banner" + (isErr ? " err" : "");
      banner.innerHTML = html;
    }

    function reportHref(runId, reportHtmlHref) {
      var parts = String(reportHtmlHref).split("/").map(encodeURIComponent).join("/");
      return "/reports/" + encodeURIComponent(runId) + "/" + parts;
    }

    function ensureRow(siteId, index, hostname, startUrl) {
      if (rows.has(siteId)) return rows.get(siteId);
      var tr = document.createElement("tr");
      tr.dataset.siteId = siteId;
      tr.innerHTML =
        '<td class="idx"></td>' +
        '<td><div class="hostname"></div><div class="url"></div></td>' +
        '<td class="status"></td>' +
        '<td class="pages">—</td>' +
        '<td class="broken">—</td>' +
        '<td class="dur">—</td>' +
        '<td class="rep"></td>';
      rowsEl.appendChild(tr);
      var o = { tr: tr, siteId: siteId, index: index, hostname: hostname, startUrl: startUrl };
      rows.set(siteId, o);
      return o;
    }

    function paintRow(o) {
      var tr = o.tr;
      tr.querySelector(".idx").textContent = String(o.index ?? "");
      tr.querySelector(".hostname").textContent = o.hostname;
      tr.querySelector(".url").textContent = o.startUrl;
      var st = o.state || "pending";
      var statusCell = tr.querySelector(".status");
      var repCell = tr.querySelector(".rep");
      var labels = {
        pending: ["Pending", "pending"],
        running: ["Checking…", "running"],
        ok: ["OK", "ok"],
        fail: ["Issues", "fail"],
        err: ["Error", "err"],
      };
      var pair = labels[st] || labels.pending;
      var label = pair[0];
      var cls = pair[1];
      statusCell.innerHTML = '<span class="badge ' + cls + '">' + label + "</span>";
      if (o.pagesVisited != null) tr.querySelector(".pages").textContent = String(o.pagesVisited);
      if (o.brokenLinks != null) tr.querySelector(".broken").textContent = String(o.brokenLinks);
      if (o.durationMs != null) tr.querySelector(".dur").textContent = o.durationMs + " ms";
      if (o.reportHref) {
        repCell.innerHTML = '<a class="rep-link" href="' + escapeAttr(o.reportHref) + '">Open HTML</a>';
      } else {
        repCell.textContent = "—";
      }
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    function escapeAttr(s) {
      return escapeHtml(s);
    }

    function selectTab(which) {
      var run = which === "run";
      tabRun.setAttribute("aria-selected", run ? "true" : "false");
      tabHistory.setAttribute("aria-selected", run ? "false" : "true");
      panelRun.classList.toggle("active", run);
      panelHistory.classList.toggle("active", !run);
      panelRun.hidden = !run;
      panelHistory.hidden = run;
      if (!run) loadHistory();
    }
    tabRun.addEventListener("click", function () { selectTab("run"); });
    tabHistory.addEventListener("click", function () { selectTab("history"); });

    async function loadHistory() {
      historyRoot.innerHTML = '<p class="history-empty">Loading…</p>';
      try {
        var res = await fetch("/api/history");
        var data = await res.json();
        renderHistory(data);
      } catch (e) {
        historyRoot.innerHTML = '<p class="history-empty">Could not load history.</p>';
      }
    }

    function renderHistory(data) {
      if (!data.days || data.days.length === 0) {
        historyRoot.innerHTML = '<p class="history-empty">No runs with run-meta.json yet. Complete a health check to see history here.</p>';
        return;
      }
      var frag = document.createDocumentFragment();
      data.days.forEach(function (day) {
        var section = document.createElement("div");
        section.className = "day-block";
        section.innerHTML = '<h2 class="day-title">' + escapeHtml(day.date) + "</h2>";
        day.runs.forEach(function (run) {
          section.appendChild(runCard(run));
        });
        frag.appendChild(section);
      });
      historyRoot.textContent = "";
      historyRoot.appendChild(frag);
    }

    function runCard(run) {
      var wrap = document.createElement("div");
      wrap.className = "run-card";
      var idx = "/reports/" + encodeURIComponent(run.runId) + "/index.html";
      var mh = run.masterHtmlHref || "";
      if (mh.slice(0, 2) === "./") mh = mh.slice(2);
      var master = "/reports/" + encodeURIComponent(run.runId) + "/" + mh.split("/").map(encodeURIComponent).join("/");
      var sitesRows = (run.sites || []).map(function (s) {
        var href = reportHref(run.runId, s.reportHtmlHref);
        var st = s.failed ? '<span class="status-bad">Issues</span>' : '<span class="status-ok">OK</span>';
        return "<tr><td>" + escapeHtml(s.hostname) + "</td><td>" + st + "</td><td>" + String(s.pagesVisited) + "</td><td>" + String(s.brokenLinks) + "</td><td><a href=\"" + escapeAttr(href) + "\">Report</a></td></tr>";
      }).join("");
      wrap.innerHTML =
        "<h3>" + escapeHtml(run.runId) + "</h3>" +
        '<div class="run-meta">' +
        escapeHtml(run.generatedAt) +
        " · " +
        String(run.totalSites) +
        " site(s) · " +
        String(run.siteFailures) +
        " with issues · " +
        escapeHtml(run.urlsSource) +
        "</div>" +
        '<div class="run-links"><a href="' +
        escapeAttr(idx) +
        '">Run index</a><a href="' +
        escapeAttr(master) +
        '">Combined report</a></div>' +
        (sitesRows
          ? '<table class="mini-table data-table"><thead><tr><th>Site</th><th>Status</th><th>Pages</th><th>Broken</th><th>Report</th></tr></thead><tbody>' +
            sitesRows +
            "</tbody></table>"
          : "");
      return wrap;
    }

    const es = new EventSource("/api/stream");
    es.onopen = function () {
      log("Connected to event stream.");
      setBanner("Listening for runs… Start a check from this page or wait for the CLI-launched run.", false);
    };

    es.onmessage = function (ev) {
      var data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        log("Bad JSON: " + ev.data);
        return;
      }

      if (data.type === "run_start") {
        rows.clear();
        rowsEl.textContent = "";
        btnStart.disabled = true;
        busyHint.style.display = "inline";
        runBusy = true;
        setBanner(
          "Run <code>" +
            escapeHtml(data.runId) +
            "</code> — " +
            data.totalSites +
            ' site(s). <a href="/reports/' +
            encodeURIComponent(data.runId) +
            '/index.html">Open run index</a>',
          false
        );
        log("run_start: " + data.totalSites + " sites");
        data.sites.forEach(function (s, i) {
          var o = ensureRow(s.siteId, i + 1, s.hostname, s.startUrl);
          o.state = "pending";
          paintRow(o);
        });
        return;
      }

      if (data.type === "site_start") {
        var o = ensureRow(data.siteId, data.index, data.hostname, data.startUrl);
        o.state = "running";
        paintRow(o);
        log("site_start: " + data.hostname);
        return;
      }

      if (data.type === "site_complete") {
        var oc = rows.get(data.siteId);
        if (oc) {
          oc.state = data.failed ? "fail" : "ok";
          oc.pagesVisited = data.pagesVisited;
          oc.brokenLinks = data.brokenLinks;
          oc.durationMs = data.durationMs;
          oc.reportHref = reportHref(data.runId, data.reportHtmlHref);
          paintRow(oc);
        }
        log("site_complete: " + data.hostname + " → " + (data.failed ? "issues" : "ok"));
        return;
      }

      if (data.type === "site_error") {
        var oe = rows.get(data.siteId);
        if (oe) {
          oe.state = "err";
          paintRow(oe);
        }
        log("site_error: " + data.hostname + " — " + data.message);
        return;
      }

      if (data.type === "run_complete") {
        var fail = data.siteFailures > 0;
        setBanner(
          (fail ? "<strong>Finished with issues.</strong> " : "<strong>Finished.</strong> ") +
            data.siteFailures +
            " site(s) with crawl/link problems. " +
            '<a href="/reports/' +
            encodeURIComponent(data.runId) +
            '/index.html">Run index</a> · <code>' +
            escapeHtml(data.runDir) +
            "</code>",
          fail
        );
        log("run_complete: failures=" + data.siteFailures);
        runBusy = false;
        btnStart.disabled = false;
        busyHint.style.display = "none";
        loadHistory();
        return;
      }

      if (data.type === "run_error") {
        setBanner("<strong>Run failed.</strong> " + escapeHtml(data.message), true);
        log("run_error: " + data.message);
        runBusy = false;
        btnStart.disabled = false;
        busyHint.style.display = "none";
      }
    };

    es.onerror = function () {
      log("EventSource error (connection may retry).");
    };

    btnStart.addEventListener("click", async function () {
      if (runBusy) return;
      var text = urlsInput.value || "";
      try {
        btnStart.disabled = true;
        var res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urlsText: text }),
        });
        if (res.status === 409) {
          alert("A run is already in progress.");
          btnStart.disabled = false;
          return;
        }
        if (!res.ok) {
          var errText = await res.text();
          alert("Could not start: " + errText);
          btnStart.disabled = false;
          return;
        }
        runBusy = true;
        busyHint.style.display = "inline";
        log("Requested new run from UI.");
      } catch (e) {
        alert(String(e));
        btnStart.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export type HealthDashboardOrchestrateOptions = Omit<
  Parameters<typeof orchestrateHealthCheck>[0],
  "onProgress"
>;

/**
 * Serves a live dashboard on HTTP and streams progress via SSE.
 * Reports are served at `/reports/:runId/...` under the artifacts root.
 */
export async function runHealthDashboard(options: {
  port: number;
  openBrowser: boolean;
  orchestrate: HealthDashboardOrchestrateOptions;
}): Promise<{ runId: string; runDir: string; siteFailures: number }> {
  const buffer: HealthProgressEvent[] = [];
  const clients = new Set<http.ServerResponse>();
  const outRoot = path.resolve(options.orchestrate.outRoot);

  function broadcast(ev: HealthProgressEvent): void {
    buffer.push(ev);
    if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) {
      try {
        res.write(line);
      } catch {
        /* client gone */
      }
    }
  }

  const baseOrchestrate = options.orchestrate;
  let runInFlight = false;
  let lastResult: { runId: string; runDir: string; siteFailures: number } | null = null;

  async function runOrchestrate(
    extra: Partial<HealthDashboardOrchestrateOptions>,
  ): Promise<{ runId: string; runDir: string; siteFailures: number }> {
    return await orchestrateHealthCheck({
      ...baseOrchestrate,
      ...extra,
      onProgress: broadcast,
    });
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        const data = await listHealthHistory(outRoot);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(data));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        if (runInFlight) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("A run is already in progress.");
          return;
        }
        let body: string;
        try {
          body = await readBody(req, 256_000);
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad request");
          return;
        }
        let payload: { urlsText?: string; urls?: string[] };
        try {
          payload = JSON.parse(body) as { urlsText?: string; urls?: string[] };
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }
        let urls: string[];
        if (Array.isArray(payload.urls) && payload.urls.length > 0) {
          urls = payload.urls.map((u) => String(u).trim()).filter(Boolean);
        } else if (typeof payload.urlsText === "string") {
          urls = parseUrlsFromText(payload.urlsText);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Provide urlsText (string) or urls (non-empty array)");
          return;
        }
        if (urls.length === 0) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("No valid http(s) URLs found");
          return;
        }
        runInFlight = true;
        res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: true, urlCount: urls.length }));
        void runOrchestrate({ urls })
          .then((r) => {
            lastResult = r;
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            broadcast({ type: "run_error", message });
          })
          .finally(() => {
            runInFlight = false;
          });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
        const raw = url.pathname.slice("/reports/".length);
        const decoded = decodeURIComponent(raw);
        const norm = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
        const segments = norm.split(/[/\\]/).filter(Boolean);
        if (segments.length === 0) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        const runId = segments[0];
        if (!isSafeRunIdSegment(runId)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad run id");
          return;
        }
        const relPath = segments.slice(1).join(path.sep) || "index.html";
        const runRoot = path.join(outRoot, runId);
        const filePath = path.join(runRoot, relPath);
        if (!isPathInsideRoot(outRoot, runRoot) || !isPathInsideRoot(runRoot, filePath)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }
        try {
          const st = await stat(filePath);
          if (!st.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
          }
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": mimeFor(filePath) });
        createReadStream(filePath).pipe(res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        for (const ev of buffer) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
        clients.add(res);
        req.on("close", () => {
          clients.delete(res);
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    })().catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(err));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${options.port}/`;
  console.log(`[qa-agent] Live dashboard: ${baseUrl}`);
  if (options.openBrowser) {
    setTimeout(() => openBrowser(baseUrl), 400);
  }

  const hasInitialFile = Boolean(baseOrchestrate.urlsFile);
  if (hasInitialFile) {
    runInFlight = true;
    try {
      const result = await runOrchestrate({});
      lastResult = result;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcast({ type: "run_error", message });
      throw err;
    } finally {
      runInFlight = false;
    }
  }

  if (!lastResult) {
    return { runId: "", runDir: "", siteFailures: 0 };
  }
  return lastResult;
}
