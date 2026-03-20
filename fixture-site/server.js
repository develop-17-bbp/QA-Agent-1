import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.FIXTURE_PORT ?? 3333);
const DATA_FILE = path.join(__dirname, "data", "submissions.json");
const publicDir = path.join(__dirname, "public");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]\n", "utf8");
}

function loadSubmissions() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveSubmissions(rows) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf8");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/api/contact", (req, res) => {
  const rows = loadSubmissions();
  const entry = {
    id: rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1,
    receivedAt: new Date().toISOString(),
    userAgent: req.get("user-agent") ?? "",
    fields: {
      name: req.body.name ?? "",
      email: req.body.email ?? "",
      message: req.body.message ?? "",
      company: req.body.company ?? "",
    },
  };
  rows.push(entry);
  saveSubmissions(rows);

  if (req.get("accept")?.includes("application/json")) {
    return res.json({ ok: true, id: entry.id });
  }
  res.redirect(303, "/thanks.html");
});

app.get("/api/submissions", (_req, res) => {
  res.json(loadSubmissions());
});

app.get("/submissions", (_req, res) => {
  const rows = loadSubmissions().slice().reverse();
  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="5" class="empty">No submissions yet. Run QA-Agent against the homepage form.</td></tr>`
      : rows
          .map(
            (r) => `<tr>
  <td>${escapeHtml(String(r.id))}</td>
  <td><code>${escapeHtml(r.receivedAt)}</code></td>
  <td>${escapeHtml(r.fields.name)}</td>
  <td>${escapeHtml(r.fields.email)}</td>
  <td class="msg">${escapeHtml(r.fields.message)}</td>
</tr>`,
          )
          .join("\n");

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Fixture — submissions</title>
  <style>
    :root { font-family: system-ui, sans-serif; }
    body { margin: 0; background: #0f1419; color: #e7e9ea; }
    header { padding: 20px 24px; border-bottom: 1px solid #2f3336; }
    h1 { font-size: 1.15rem; margin: 0; font-weight: 600; }
    p { margin: 8px 0 0; color: #8b98a5; font-size: 0.9rem; }
    main { padding: 24px; }
    a { color: #1d9bf0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { border: 1px solid #2f3336; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #16181c; color: #8b98a5; font-weight: 600; }
    td.msg { white-space: pre-wrap; max-width: 420px; }
    td.empty { text-align: center; color: #8b98a5; padding: 32px; }
    .meta { margin-top: 16px; font-size: 0.85rem; color: #8b98a5; }
  </style>
</head>
<body>
  <header>
    <h1>QA-Agent fixture — received submissions</h1>
    <p>Data is stored in <code>fixture-site/data/submissions.json</code>. <a href="/">Homepage form</a> · <a href="/api/submissions">Raw JSON</a></p>
  </header>
  <main>
    <table>
      <thead><tr><th>ID</th><th>Received (UTC)</th><th>Name</th><th>Email</th><th>Message</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p class="meta">${rows.length} row(s). Refresh after each agent run.</p>
  </main>
</body>
</html>`);
});

app.use(express.static(publicDir));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Fixture site running at http://127.0.0.1:${PORT}/`);
  console.log(`View submissions at http://127.0.0.1:${PORT}/submissions`);
});
