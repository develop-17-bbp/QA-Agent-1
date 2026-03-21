import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import type { HealthProgressEvent } from "./progress-events.js";
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

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>QA-Agent — health (live)</title>
  <style>
    :root {
      --bg: #0f1419;
      --surface: #1a2332;
      --border: #2d3a4d;
      --text: #e6edf3;
      --muted: #8b9cb3;
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
    h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 6px 0; }
    .sub { font-size: 0.85rem; color: var(--muted); margin: 0; }
    main { padding: 20px 24px 48px; max-width: 1100px; margin: 0 auto; }
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
    #log {
      margin-top: 24px;
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0d1117;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      color: var(--muted);
      max-height: 200px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <header>
    <h1>Site health — live run</h1>
    <p class="sub">Streaming status from QA-Agent. Keep this tab open during the run.</p>
  </header>
  <main>
    <div id="banner" class="banner">Connecting…</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Site</th>
          <th>Status</th>
          <th>Pages</th>
          <th>Broken</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div id="log"></div>
  </main>
  <script>
    const banner = document.getElementById("banner");
    const rowsEl = document.getElementById("rows");
    const logEl = document.getElementById("log");
    const rows = new Map();

    function log(line) {
      logEl.textContent += line + String.fromCharCode(10);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setBanner(html, isErr) {
      banner.className = "banner" + (isErr ? " err" : "");
      banner.innerHTML = html;
    }

    function ensureRow(siteId, index, hostname, startUrl) {
      if (rows.has(siteId)) return rows.get(siteId);
      const tr = document.createElement("tr");
      tr.dataset.siteId = siteId;
      tr.innerHTML =
        '<td class="idx"></td>' +
        '<td><div class="hostname"></div><div class="url"></div></td>' +
        '<td class="status"></td>' +
        '<td class="pages">—</td>' +
        '<td class="broken">—</td>' +
        '<td class="dur">—</td>';
      rowsEl.appendChild(tr);
      const o = { tr, siteId, index, hostname, startUrl };
      rows.set(siteId, o);
      return o;
    }

    function paintRow(o) {
      const tr = o.tr;
      tr.querySelector(".idx").textContent = String(o.index ?? "");
      tr.querySelector(".hostname").textContent = o.hostname;
      tr.querySelector(".url").textContent = o.startUrl;
      const st = o.state || "pending";
      const statusCell = tr.querySelector(".status");
      const labels = {
        pending: ["Pending", "pending"],
        running: ["Checking…", "running"],
        ok: ["OK", "ok"],
        fail: ["Issues", "fail"],
        err: ["Error", "err"],
      };
      const [label, cls] = labels[st] || labels.pending;
      statusCell.innerHTML = '<span class="badge ' + cls + '">' + label + "</span>";
      if (o.pagesVisited != null) tr.querySelector(".pages").textContent = String(o.pagesVisited);
      if (o.brokenLinks != null) tr.querySelector(".broken").textContent = String(o.brokenLinks);
      if (o.durationMs != null) tr.querySelector(".dur").textContent = o.durationMs + " ms";
    }

    const es = new EventSource("/api/stream");
    es.onopen = () => log("Connected to event stream.");

    es.onmessage = (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        log("Bad JSON: " + ev.data);
        return;
      }

      if (data.type === "run_start") {
        setBanner(
          "Run <code>" + escapeHtml(data.runId) + "</code> — " +
          data.totalSites + " site(s). Reports will be available below when finished.",
          false
        );
        log("run_start: " + data.totalSites + " sites");
        data.sites.forEach((s, i) => {
          const o = ensureRow(s.siteId, i + 1, s.hostname, s.startUrl);
          o.state = "pending";
          paintRow(o);
        });
        return;
      }

      if (data.type === "site_start") {
        const o = ensureRow(data.siteId, data.index, data.hostname, data.startUrl);
        o.state = "running";
        paintRow(o);
        log("site_start: " + data.hostname);
        return;
      }

      if (data.type === "site_complete") {
        const o = rows.get(data.siteId);
        if (o) {
          o.state = data.failed ? "fail" : "ok";
          o.pagesVisited = data.pagesVisited;
          o.brokenLinks = data.brokenLinks;
          o.durationMs = data.durationMs;
          paintRow(o);
        }
        log("site_complete: " + data.hostname + " → " + (data.failed ? "issues" : "ok"));
        return;
      }

      if (data.type === "site_error") {
        const o = rows.get(data.siteId);
        if (o) {
          o.state = "err";
          paintRow(o);
        }
        log("site_error: " + data.hostname + " — " + data.message);
        return;
      }

      if (data.type === "run_complete") {
        const base = "/reports/";
        const fail = data.siteFailures > 0;
        setBanner(
          (fail ? "<strong>Finished with issues.</strong> " : "<strong>Finished.</strong> ") +
          data.siteFailures + " site(s) with crawl/link problems. " +
          '<a href="' + base + 'index.html">Open report index</a> · ' +
          "<code>" + escapeHtml(data.runDir) + "</code>",
          fail
        );
        log("run_complete: failures=" + data.siteFailures);
        return;
      }

      if (data.type === "run_error") {
        setBanner("<strong>Run failed.</strong> " + escapeHtml(data.message), true);
        log("run_error: " + data.message);
      }
    };

    es.onerror = () => {
      log("EventSource error (connection may retry).");
    };

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
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
 * Static files for the current run are mounted at `/reports/` after `run_start`.
 */
export async function runHealthDashboard(options: {
  port: number;
  openBrowser: boolean;
  orchestrate: HealthDashboardOrchestrateOptions;
}): Promise<{ runId: string; runDir: string; siteFailures: number }> {
  const buffer: HealthProgressEvent[] = [];
  const clients = new Set<http.ServerResponse>();
  let staticRoot: string | null = null;

  function broadcast(ev: HealthProgressEvent): void {
    buffer.push(ev);
    if (ev.type === "run_start") staticRoot = ev.runDir;
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) {
      try {
        res.write(line);
      } catch {
        /* client gone */
      }
    }
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml());
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

      if (req.method === "GET" && url.pathname.startsWith("/reports")) {
        const relRaw = url.pathname.replace(/^\/reports\/?/, "") || "index.html";
        const rel = path.normalize(decodeURIComponent(relRaw)).replace(/^(\.\.(\/|\\|$))+/, "");
        if (!staticRoot) {
          res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Run not started yet. Refresh after the run begins.");
          return;
        }
        const filePath = path.join(staticRoot, rel);
        if (!isPathInsideRoot(staticRoot, filePath)) {
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

  let result: { runId: string; runDir: string; siteFailures: number };
  try {
    result = await orchestrateHealthCheck({
      ...options.orchestrate,
      onProgress: broadcast,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    broadcast({ type: "run_error", message });
    throw err;
  }

  return result;
}
