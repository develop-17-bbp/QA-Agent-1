import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageFetchRecord, PageSpeedInsightRecord, SiteHealthReport } from "./types.js";

/** Shared styles for single-site and combined health HTML. */
const HEALTH_REPORT_CSS = `
    :root {
      --bg: #f0f4f8;
      --surface: #ffffff;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --ok: #059669;
      --ok-bg: #ecfdf5;
      --err: #dc2626;
      --err-bg: #fef2f2;
      --warn: #d97706;
      --radius: 12px;
      --shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04);
      --font: "DM Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.5;
      color: var(--text);
      background: linear-gradient(165deg, #e8eef5 0%, var(--bg) 40%, #f8fafc 100%);
      -webkit-font-smoothing: antialiased;
    }
    .report-shell {
      max-width: 1120px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    .report-header {
      background: var(--surface);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 28px 28px 24px;
      margin-bottom: 24px;
      border: 1px solid var(--border);
    }
    .report-kicker {
      margin: 0 0 8px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .report-header h1 {
      margin: 0 0 16px;
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.25;
      color: var(--text);
    }
    .report-header .lead {
      margin: 0 0 20px;
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    .report-header .lead a { color: var(--accent); font-weight: 500; text-decoration: none; }
    .report-header .lead a:hover { text-decoration: underline; }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
    }
    .stat {
      background: var(--accent-soft);
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      padding: 14px 16px;
    }
    .stat-label {
      display: block;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 1.15rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }
    .stat-value small { font-size: 0.8rem; font-weight: 500; color: var(--text-muted); }
    .report-section {
      background: var(--surface);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 24px 26px 26px;
      margin-bottom: 20px;
    }
    .report-section h2 {
      margin: 0 0 6px;
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text);
      padding-bottom: 10px;
      border-bottom: 2px solid var(--accent);
      display: inline-block;
      width: 100%;
    }
    .section-desc {
      margin: 10px 0 16px;
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .section-desc a { color: var(--accent); }
    .table-wrap {
      overflow-x: auto;
      margin: 0 -4px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    table.data-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.875rem;
    }
    .data-table thead th {
      text-align: left;
      padding: 12px 14px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      background: #f8fafc;
      border-bottom: 2px solid var(--border);
      white-space: nowrap;
    }
    .data-table tbody td {
      padding: 11px 14px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
      word-break: break-word;
    }
    .data-table tbody tr:nth-child(even) td { background: #fafbfc; }
    .data-table tbody tr:hover td { background: #f1f5f9; }
    .data-table tbody tr.row-ok td { background: rgba(16, 185, 129, 0.07) !important; }
    .data-table tbody tr.row-err td { background: rgba(239, 68, 68, 0.07) !important; }
    .data-table tbody tr.row-ok:hover td { background: rgba(16, 185, 129, 0.12) !important; }
    .data-table tbody tr.row-err:hover td { background: rgba(239, 68, 68, 0.12) !important; }
    .data-table tbody tr:last-child td { border-bottom: none; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .data-table a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
    }
    .data-table a:hover { text-decoration: underline; }
    .cell-ok { color: var(--ok); font-weight: 600; }
    .cell-err { color: var(--err); font-weight: 500; }
    .empty-state {
      padding: 20px;
      text-align: center;
      color: var(--ok);
      font-weight: 500;
      background: var(--ok-bg);
      border-radius: 8px;
    }
    .ok { color: var(--ok); }
    .err { color: var(--err); }
    .meta { color: var(--text-muted); font-size: 0.85rem; }
    .score-bad { background: #fef2f2; color: #991b1b; border-color: #fecaca !important; }
    .score-warn { background: #fffbeb; color: #92400e; border-color: #fde68a !important; }
    .score-good { background: #ecfdf5; color: #065f46; border-color: #a7f3d0 !important; }
    .report-footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--text-muted);
      text-align: center;
    }
    /* PageSpeed cards */
    .psi-grid { display: flex; flex-direction: column; gap: 22px; margin-top: 8px; }
    .psi-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 22px 24px;
      background: linear-gradient(180deg, #fafbfc 0%, #fff 32%);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
    }
    .psi-card-err { border-color: #fecaca; background: #fffafa; }
    .psi-card-err .err { margin: 0; font-size: 0.9rem; line-height: 1.45; }
    .psi-card-top { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
    .psi-gauge-box { flex: 0 0 auto; text-align: center; width: 148px; }
    .psi-gauge { width: 120px; height: 120px; display: block; margin: 0 auto; filter: drop-shadow(0 2px 4px rgba(0,0,0,.06)); }
    .psi-gauge-bg { stroke: #e2e8f0; }
    .psi-gauge-score { font-size: 28px; font-weight: 700; fill: var(--text); font-family: var(--font); }
    .psi-gauge-cap { margin: 6px 0 0; font-size: 0.7rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
    .psi-card-head { flex: 1; min-width: 220px; }
    .psi-url { margin: 0 0 14px; font-size: 0.9rem; word-break: break-all; line-height: 1.45; }
    .psi-url a { color: var(--accent); font-weight: 500; }
    .psi-cats { display: flex; flex-wrap: wrap; gap: 8px; }
    .psi-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 700;
      border: 1px solid var(--border); background: #f8fafc;
    }
    .psi-pill-k { font-weight: 600; color: var(--text-muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: .06em; }
    .psi-foot { margin: 14px 0 0; font-size: 0.8rem; }
    .psi-metrics-h { font-size: 1.05rem; margin: 22px 0 0; font-weight: 700; color: var(--text); }
    .psi-metrics-legend { margin: 6px 0 14px; }
    .psi-metrics { list-style: none; margin: 0; padding: 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
    .psi-metric {
      display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: center;
      padding: 12px 14px; border-bottom: 1px solid #f1f5f9; font-size: 0.88rem;
      background: #fff;
    }
    .psi-metric:last-child { border-bottom: none; }
    .psi-metric:nth-child(even) { background: #fafbfc; }
    .psi-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
    .psi-dot--good { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.2); }
    .psi-dot--warn { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.2); }
    .psi-dot--bad { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.2); }
    .psi-dot--na { background: #94a3b8; }
    .psi-metric-label { color: var(--text); font-weight: 500; }
    .psi-metric-val { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
    .psi-opps { margin-top: 20px; padding: 16px 18px; border-radius: 8px; background: #f8fafc; border: 1px solid var(--border); }
    .psi-opps-title { font-size: 0.9rem; margin: 0 0 12px; font-weight: 700; color: var(--text); }
    .psi-opps-list { margin: 0; padding-left: 1.15rem; color: var(--text); font-size: 0.86rem; line-height: 1.55; }
    .psi-opps-list li { margin-bottom: 8px; }
    .psi-opp-title { display: inline; margin-right: 8px; }
    .psi-opp-save { font-weight: 700; color: var(--accent); }
    .master-site-heading {
      margin: 28px 0 12px;
      padding-bottom: 10px;
      border-bottom: 2px solid #bfdbfe;
      color: var(--accent);
      font-size: 1.15rem;
      font-weight: 700;
    }
    /* Table filters (client-side) */
    .table-filters {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 10px 14px;
      margin-bottom: 14px;
      padding: 14px 16px;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .table-filters__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .table-filters__label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .table-filters input[type="search"],
    .table-filters input[type="number"],
    .table-filters select {
      font: inherit;
      font-size: 0.88rem;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      min-width: 0;
    }
    .table-filters__search { flex: 1 1 200px; min-width: 160px; }
    .table-filters__search input { width: 100%; }
    .table-filters__reset {
      font: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      align-self: flex-end;
    }
    .table-filters__reset:hover { background: #f1f5f9; }
    .table-filters__count {
      font-size: 0.82rem;
      color: var(--text-muted);
      align-self: center;
      margin-left: auto;
      white-space: nowrap;
    }
    .data-table tbody tr.filter-hidden { display: none !important; }
`;

const HEALTH_REPORT_HEAD = `
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet"/>
`;

const INDEX_PAGE_CSS = `
    :root {
      --bg: #f0f4f8;
      --surface: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #2563eb;
      --border: #e2e8f0;
      --font: "DM Sans", ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--font);
      color: var(--text);
      background: linear-gradient(165deg, #e8eef5 0%, var(--bg) 50%, #f8fafc 100%);
      -webkit-font-smoothing: antialiased;
      padding: 32px 20px 48px;
    }
    .idx-wrap { max-width: 920px; margin: 0 auto; }
    .idx-hero {
      background: var(--surface);
      border-radius: 14px;
      padding: 28px 30px;
      margin-bottom: 22px;
      border: 1px solid var(--border);
      box-shadow: 0 2px 12px rgba(15,23,42,.06);
    }
    .idx-hero h1 { margin: 0 0 8px; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
    .idx-kicker { margin: 0 0 16px; font-size: 0.75rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
    .idx-meta { margin: 0 0 8px; font-size: 0.9rem; color: var(--muted); }
    .idx-meta strong { color: var(--text); }
    .idx-combined {
      margin-top: 14px;
      padding: 14px 16px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      font-size: 0.92rem;
    }
    .idx-combined a { color: var(--accent); font-weight: 600; text-decoration: none; }
    .idx-combined a:hover { text-decoration: underline; }
    .idx-table-wrap {
      background: var(--surface);
      border-radius: 12px;
      border: 1px solid var(--border);
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(15,23,42,.05);
    }
    table.idx-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .idx-table th {
      text-align: left;
      padding: 14px 16px;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--muted);
      background: #f8fafc;
      border-bottom: 2px solid var(--border);
    }
    .idx-table td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .idx-table tr:last-child td { border-bottom: none; }
    .idx-table tr:hover td { background: #f8fafc; }
    .idx-table a { color: var(--accent); font-weight: 600; text-decoration: none; font-size: 0.85rem; }
    .idx-table a:hover { text-decoration: underline; }
    .idx-foot { margin-top: 20px; font-size: 0.82rem; color: var(--muted); line-height: 1.5; }
`;

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Human-readable outcome for the “Pages fetched” table. */
function pageFetchResult(p: PageFetchRecord): string {
  if (p.ok) return "OK";
  const err = (p.error ?? "").toLowerCase();
  if (err.includes("timeout") || err.includes("timed out") || err.includes("aborted")) {
    return "Timeout";
  }
  if (p.status === 0) {
    return "Network error";
  }
  if (p.status >= 400) {
    return `HTTP error (${p.status})`;
  }
  return "Failed";
}

/** Filter token for Pages fetched rows (must match filter dropdown values). */
function pageFetchFilterKey(p: PageFetchRecord): string {
  if (p.ok) return "ok";
  const err = (p.error ?? "").toLowerCase();
  if (err.includes("timeout") || err.includes("timed out") || err.includes("aborted")) {
    return "timeout";
  }
  if (p.status === 0) return "network";
  if (p.status >= 400) return "http-error";
  return "failed";
}

function brokenHttpKind(status: number | undefined): string {
  if (status == null || status === 0) return "no-status";
  if (status >= 400 && status < 500) return "http-4xx";
  if (status >= 500) return "http-5xx";
  return "other";
}

const FILTER_STATUS_PAGES: { value: string; label: string }[] = [
  { value: "", label: "All results" },
  { value: "ok", label: "OK" },
  { value: "timeout", label: "Timeout" },
  { value: "network", label: "Network error" },
  { value: "http-error", label: "HTTP error (4xx/5xx)" },
  { value: "failed", label: "Failed (other)" },
];

const FILTER_STATUS_LINKS: { value: string; label: string }[] = [
  { value: "", label: "All results" },
  { value: "ok", label: "OK" },
  { value: "failed", label: "Failed" },
];

const FILTER_STATUS_BROKEN: { value: string; label: string }[] = [
  { value: "", label: "All HTTP" },
  { value: "http-4xx", label: "4xx" },
  { value: "http-5xx", label: "5xx" },
  { value: "no-status", label: "No / 0 status" },
  { value: "other", label: "Other (2xx/3xx)" },
];

function buildTableFiltersHtml(
  tableId: string,
  statusOptions: { value: string; label: string }[],
  statusLabel = "Result",
): string {
  const opts = statusOptions.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
  return `<div class="table-filters" data-table-filters-for="${esc(tableId)}">
  <label class="table-filters__field table-filters__search">
    <span class="table-filters__label">Search</span>
    <input type="search" placeholder="URL or text…" autocomplete="off" data-filter-field="search" />
  </label>
  <label class="table-filters__field">
    <span class="table-filters__label">Min ms</span>
    <input type="number" inputmode="numeric" min="0" step="1" data-filter-field="min-ms" placeholder="—" />
  </label>
  <label class="table-filters__field">
    <span class="table-filters__label">Max ms</span>
    <input type="number" inputmode="numeric" min="0" step="1" data-filter-field="max-ms" placeholder="—" />
  </label>
  <label class="table-filters__field">
    <span class="table-filters__label">${esc(statusLabel)}</span>
    <select data-filter-field="status">${opts}</select>
  </label>
  <button type="button" class="table-filters__reset" data-filter-reset>Clear</button>
  <span class="table-filters__count" data-filter-count aria-live="polite"></span>
</div>`;
}

/** Inline script: show/hide rows by data-filter-* on each tr. */
const HEALTH_TABLE_FILTERS_SCRIPT = `<script>
(function(){
  function parseNum(v){ var n=parseFloat(v); return isNaN(n)?NaN:n; }
  function apply(container){
    var id=container.getAttribute("data-table-filters-for");
    if(!id)return;
    var table=document.getElementById(id);
    if(!table)return;
    var searchEl=container.querySelector("[data-filter-field=search]");
    var search=((searchEl&&searchEl.value)||"").trim().toLowerCase();
    var minV=parseNum((container.querySelector("[data-filter-field=min-ms]")||{}).value||"");
    var maxV=parseNum((container.querySelector("[data-filter-field=max-ms]")||{}).value||"");
    var status=(container.querySelector("[data-filter-field=status]")||{}).value||"";
    var rows=table.querySelectorAll("tbody tr");
    var total=0, visible=0;
    rows.forEach(function(tr){
      if(tr.getAttribute("data-filter-skip")==="1")return;
      total++;
      var text=(tr.getAttribute("data-filter-text")||"").toLowerCase();
      var ms=parseFloat(tr.getAttribute("data-filter-ms"));
      if(isNaN(ms))ms=0;
      var res=tr.getAttribute("data-filter-result")||"";
      var ok=true;
      if(search&&text.indexOf(search)===-1)ok=false;
      if(!isNaN(minV)&&ms<minV)ok=false;
      if(!isNaN(maxV)&&ms>maxV)ok=false;
      if(status&&res!==status)ok=false;
      if(ok){ tr.classList.remove("filter-hidden"); visible++; }
      else{ tr.classList.add("filter-hidden"); }
    });
    var c=container.querySelector("[data-filter-count]");
    if(c)c.textContent=visible+(total?(" / "+total):"")+" shown";
  }
  function wire(container){
    var go=function(){ apply(container); };
    var t;
    container.querySelectorAll("input,select").forEach(function(el){
      if(el.getAttribute("data-filter-field")==="search"){
        el.addEventListener("input",function(){
          clearTimeout(t);
          t=setTimeout(go,100);
        });
      } else {
        el.addEventListener("input",go);
        el.addEventListener("change",go);
      }
    });
    var reset=container.querySelector("[data-filter-reset]");
    if(reset)reset.addEventListener("click",function(){
      container.querySelectorAll("input").forEach(function(i){ i.value=""; });
      var s=container.querySelector("[data-filter-field=status]");
      if(s)s.selectedIndex=0;
      go();
    });
    go();
  }
  document.querySelectorAll("[data-table-filters-for]").forEach(wire);
})();
<\/script>`;

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return `${ms}`;
}

/** Human-readable duration for stat cards. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtScore(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${n}`;
}

/** Background for Lighthouse category scores (0–100). */
function scoreCellClass(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 50) return "score-bad";
  if (n < 90) return "score-warn";
  return "score-good";
}

/** Lighthouse-style lab thresholds (approximate; same spirit as PageSpeed Insights). */
type MetricRating = "good" | "warn" | "bad" | "na";

function rateFcp(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 1800) return "good";
  if (ms <= 3000) return "warn";
  return "bad";
}
function rateLcp(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 2500) return "good";
  if (ms <= 4000) return "warn";
  return "bad";
}
function rateTbt(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 200) return "good";
  if (ms <= 600) return "warn";
  return "bad";
}
function rateCls(v: number | undefined): MetricRating {
  if (v == null) return "na";
  if (v <= 0.1) return "good";
  if (v <= 0.25) return "warn";
  return "bad";
}
function rateSpeedIndex(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 3400) return "good";
  if (ms <= 5800) return "warn";
  return "bad";
}
function rateTti(ms: number | undefined): MetricRating {
  if (ms == null) return "na";
  if (ms <= 3800) return "good";
  if (ms <= 7300) return "warn";
  return "bad";
}

const GAUGE_R = 54;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function perfGaugeColor(score: number | undefined): string {
  if (score == null) return "#9e9e9e";
  if (score < 50) return "#ff4e42";
  if (score < 90) return "#ffa400";
  return "#0cce6b";
}

function buildPsiCardHtml(ins: PageSpeedInsightRecord): string {
  if (ins.error) {
    return `<article class="psi-card psi-card-err">
  <p class="psi-url"><a href="${esc(ins.url)}">${esc(ins.url)}</a></p>
  <p class="err">${esc(ins.error)} <span class="meta">(API ${ins.durationMs}ms)</span></p>
</article>`;
  }

  const s = ins.scores;
  const m = ins.metrics;
  const d = ins.display;
  const perf = s?.performance;
  const dash = perf != null ? (GAUGE_C * perf) / 100 : 0;

  const clsDisplay = d?.cls ?? (m?.cls != null ? String(m.cls) : undefined);

  const metricLine = (label: string, display: string | undefined, rating: MetricRating) => {
    const r = rating === "na" ? "na" : rating;
    return `<li class="psi-metric psi-metric--${r}">
    <span class="psi-dot psi-dot--${r}" title="${r}"></span>
    <span class="psi-metric-label">${esc(label)}</span>
    <span class="psi-metric-val">${esc(display ?? "—")}</span>
  </li>`;
  };

  const opps = ins.opportunities ?? [];
  const oppsHtml =
    opps.length === 0
      ? ""
      : `<div class="psi-opps">
    <h3 class="psi-opps-title">Diagnostics &amp; opportunities</h3>
    <ul class="psi-opps-list">
      ${opps
        .map(
          (o) => `<li><span class="psi-opp-title">${esc(o.title)}</span>
        ${o.displayValue ? `<span class="psi-opp-save">${esc(o.displayValue)}</span>` : ""}</li>`,
        )
        .join("\n")}
    </ul>
  </div>`;

  return `<article class="psi-card">
  <div class="psi-card-top">
    <div class="psi-gauge-box" style="--gauge-color: ${perfGaugeColor(perf)}">
      <svg class="psi-gauge" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="psi-gauge-bg" cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="10" />
        <circle class="psi-gauge-fg" cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="10"
          stroke="${perfGaugeColor(perf)}"
          stroke-dasharray="${dash} ${GAUGE_C}"
          stroke-linecap="round"
          transform="rotate(-90 60 60)" />
        <text class="psi-gauge-score" x="60" y="66" text-anchor="middle">${perf != null ? esc(String(perf)) : "—"}</text>
      </svg>
      <p class="psi-gauge-cap">Performance</p>
    </div>
    <div class="psi-card-head">
      <p class="psi-url"><a href="${esc(ins.url)}">${esc(ins.url)}</a></p>
      <div class="psi-cats" role="group" aria-label="Category scores">
        <span class="psi-pill ${scoreCellClass(s?.performance)}"><span class="psi-pill-k">Perf</span> ${fmtScore(s?.performance)}</span>
        <span class="psi-pill ${scoreCellClass(s?.accessibility)}"><span class="psi-pill-k">A11y</span> ${fmtScore(s?.accessibility)}</span>
        <span class="psi-pill ${scoreCellClass(s?.bestPractices)}"><span class="psi-pill-k">BP</span> ${fmtScore(s?.bestPractices)}</span>
        <span class="psi-pill ${scoreCellClass(s?.seo)}"><span class="psi-pill-k">SEO</span> ${fmtScore(s?.seo)}</span>
      </div>
      <p class="psi-foot meta">Lighthouse lab · ${esc(ins.strategy)} · API ${ins.durationMs}ms</p>
    </div>
  </div>
  <h3 class="psi-metrics-h">Metrics</h3>
  <p class="meta psi-metrics-legend">Green / orange / red follow typical Lighthouse lab thresholds (not field data).</p>
  <ul class="psi-metrics">
    ${metricLine("First Contentful Paint", d?.fcp, rateFcp(m?.fcpMs))}
    ${metricLine("Largest Contentful Paint", d?.lcp, rateLcp(m?.lcpMs))}
    ${metricLine("Total Blocking Time", d?.tbt, rateTbt(m?.tbtMs))}
    ${metricLine("Cumulative Layout Shift", clsDisplay, rateCls(m?.cls))}
    ${metricLine("Speed Index", d?.speedIndex, rateSpeedIndex(m?.speedIndexMs))}
    ${metricLine("Time to Interactive", d?.tti, rateTti(m?.ttiMs))}
  </ul>
  ${oppsHtml}
</article>`;
}

export function buildSiteHealthHtml(report: SiteHealthReport): string {
  const c = report.crawl;
  const brokenSorted = [...c.brokenLinks].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
  const pagesSorted = [...c.pages].sort((a, b) => b.durationMs - a.durationMs);
  const linkChecksSorted = [...(c.linkChecks ?? [])].sort((a, b) => b.durationMs - a.durationMs);

  const psiPages = c.pages
    .filter((p) => p.insights)
    .sort((a, b) => {
      const key = (p: PageFetchRecord) => {
        if (p.insights?.error) return 1000;
        return p.insights?.scores?.performance ?? 999;
      };
      return key(a) - key(b);
    });

  const brokenRows =
    brokenSorted.length === 0
      ? `<tr data-filter-skip="1"><td colspan="5"><div class="empty-state">No broken internal links detected in this run.</div></td></tr>`
      : brokenSorted
          .map((b) => {
            const ms = b.durationMs ?? 0;
            const ft = `${b.foundOn} ${b.target} ${b.error ?? ""}`.toLowerCase();
            return `<tr data-filter-text="${esc(ft)}" data-filter-ms="${String(ms)}" data-filter-result="${brokenHttpKind(b.status)}">
  <td>${esc(b.foundOn)}</td>
  <td><a href="${esc(b.target)}">${esc(b.target)}</a></td>
  <td>${b.status ?? "—"}</td>
  <td class="num">${fmtMs(b.durationMs)}</td>
  <td class="cell-err">${esc(b.error ?? "")}</td>
</tr>`;
          })
          .join("\n");

  const brokenFilters =
    brokenSorted.length === 0 ? "" : buildTableFiltersHtml("health-table-broken", FILTER_STATUS_BROKEN, "HTTP");

  const psiMetaHtml = c.pageSpeedInsightsMeta
    ? `<div class="stat"><span class="stat-label">PageSpeed API</span><span class="stat-value">${esc(c.pageSpeedInsightsMeta.strategy)} <small>· ${c.pageSpeedInsightsMeta.urlsAnalyzed} URLs · ${formatDuration(c.pageSpeedInsightsMeta.totalDurationMs)}</small></span></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${HEALTH_REPORT_HEAD}
  <title>Health — ${esc(c.hostname)}</title>
  <style>${HEALTH_REPORT_CSS}</style>
</head>
<body>
  <div class="report-shell">
  <header class="report-header">
    <p class="report-kicker">QA-Agent · Site health</p>
    <h1>${esc(c.hostname)}</h1>
    <p class="lead">Start URL: <a href="${esc(c.startUrl)}">${esc(c.startUrl)}</a></p>
    <div class="stat-grid">
      <div class="stat"><span class="stat-label">Crawl time</span><span class="stat-value">${formatDuration(c.durationMs)} <small>(${c.durationMs} ms)</small></span></div>
      <div class="stat"><span class="stat-label">Pages crawled</span><span class="stat-value">${c.pagesVisited}</span></div>
      <div class="stat"><span class="stat-label">URLs checked</span><span class="stat-value">${c.uniqueUrlsChecked}</span></div>
      <div class="stat"><span class="stat-label">Broken rows</span><span class="stat-value">${c.brokenLinks.length}</span></div>
      ${psiMetaHtml}
    </div>
    <p class="meta" style="margin:18px 0 0;">Run window: ${esc(report.startedAt)} → ${esc(report.finishedAt)}</p>
  </header>

  <section class="report-section">
    <h2>Broken internal links</h2>
    <p class="section-desc">Wall-clock time for the HTTP call that reported the issue. Sorted slowest first.</p>
    ${brokenFilters}
    <div class="table-wrap">
    <table class="data-table" id="health-table-broken">
      <thead><tr><th>Found on</th><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Detail</th></tr></thead>
      <tbody>${brokenRows}</tbody>
    </table>
    </div>
  </section>

  <section class="report-section">
    <h2>Pages fetched</h2>
    <p class="section-desc">Full page GET (headers + HTML body). Sorted slowest first.</p>
    ${buildTableFiltersHtml("health-table-pages", FILTER_STATUS_PAGES)}
    <div class="table-wrap">
    <table class="data-table" id="health-table-pages">
      <thead><tr><th>URL</th><th>HTTP</th><th class="num">Time (ms)</th><th>Result</th></tr></thead>
      <tbody>
        ${pagesSorted
          .map(
            (p) => `<tr class="${p.ok ? "row-ok" : "row-err"}" data-filter-text="${esc(p.url.toLowerCase())}" data-filter-ms="${String(p.durationMs)}" data-filter-result="${pageFetchFilterKey(p)}">
          <td><a href="${esc(p.url)}">${esc(p.url)}</a></td>
          <td>${p.status}</td>
          <td class="num">${p.durationMs}</td>
          <td class="${p.ok ? "cell-ok" : "cell-err"}">${esc(pageFetchResult(p))}</td>
        </tr>`,
          )
          .join("\n")}
      </tbody>
    </table>
    </div>
  </section>

  ${
    psiPages.length === 0
      ? ""
      : `<section class="report-section">
    <h2>PageSpeed Insights</h2>
    <p class="section-desc">Lighthouse lab metrics (same engine as <a href="https://pagespeed.web.dev/" rel="noopener noreferrer">PageSpeed Insights</a>). Not field / CrUX data. Sorted by lowest performance score first.</p>
    <div class="psi-grid">
      ${psiPages.map((p) => buildPsiCardHtml(p.insights as PageSpeedInsightRecord)).join("\n")}
    </div>
  </section>`
  }

  ${
    linkChecksSorted.length === 0
      ? ""
      : `<section class="report-section">
    <h2>Internal link checks</h2>
    <p class="section-desc">Same-origin URLs not fetched as full pages in BFS; verified with HEAD or tiny GET. Sorted slowest first.</p>
    ${buildTableFiltersHtml("health-table-links", FILTER_STATUS_LINKS)}
    <div class="table-wrap">
    <table class="data-table" id="health-table-links">
      <thead><tr><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Method</th><th>Result</th></tr></thead>
      <tbody>
        ${linkChecksSorted
          .map(
            (l) => `<tr class="${l.ok ? "row-ok" : "row-err"}" data-filter-text="${esc(l.target.toLowerCase())}" data-filter-ms="${String(l.durationMs)}" data-filter-result="${l.ok ? "ok" : "failed"}">
          <td><a href="${esc(l.target)}">${esc(l.target)}</a></td>
          <td>${l.status}</td>
          <td class="num">${l.durationMs}</td>
          <td>${esc(l.method)}</td>
          <td class="${l.ok ? "cell-ok" : "cell-err"}">${l.ok ? "OK" : "Failed"}</td>
        </tr>`,
          )
          .join("\n")}
      </tbody>
    </table>
    </div>
  </section>`
  }

  <footer class="report-footer">Generated by QA-Agent · Site health crawl</footer>
  </div>
  ${HEALTH_TABLE_FILTERS_SCRIPT}
</body>
</html>`;
}

/** Combined HTML: all sites, all URLs, with Site column where relevant. */
export function buildMasterHealthHtml(
  reports: SiteHealthReport[],
  meta: { runId: string; urlsFile: string; generatedAt: string },
): string {
  const brokenAll = reports.flatMap((r) =>
    r.crawl.brokenLinks.map((b) => ({ ...b, siteHostname: r.hostname })),
  );
  brokenAll.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));

  const brokenRows =
    brokenAll.length === 0
      ? `<tr data-filter-skip="1"><td colspan="6"><div class="empty-state">No broken internal links across all sites.</div></td></tr>`
      : brokenAll
          .map((b) => {
            const ms = b.durationMs ?? 0;
            const ft = `${b.siteHostname} ${b.foundOn} ${b.target} ${b.error ?? ""}`.toLowerCase();
            return `<tr data-filter-text="${esc(ft)}" data-filter-ms="${String(ms)}" data-filter-result="${brokenHttpKind(b.status)}">
  <td>${esc(b.siteHostname)}</td>
  <td>${esc(b.foundOn)}</td>
  <td><a href="${esc(b.target)}">${esc(b.target)}</a></td>
  <td>${b.status ?? "—"}</td>
  <td class="num">${fmtMs(b.durationMs)}</td>
  <td class="cell-err">${esc(b.error ?? "")}</td>
</tr>`;
          })
          .join("\n");

  const masterBrokenFilters =
    brokenAll.length === 0 ? "" : buildTableFiltersHtml("master-table-broken", FILTER_STATUS_BROKEN, "HTTP");

  const pagesAll = reports.flatMap((r) =>
    r.crawl.pages.map((p) => ({ ...p, siteHostname: r.hostname })),
  );
  pagesAll.sort((a, b) => b.durationMs - a.durationMs);

  const pageRows = pagesAll
    .map((p) => {
      const ft = `${p.siteHostname} ${p.url}`.toLowerCase();
      return `<tr class="${p.ok ? "row-ok" : "row-err"}" data-filter-text="${esc(ft)}" data-filter-ms="${String(p.durationMs)}" data-filter-result="${pageFetchFilterKey(p)}">
  <td>${esc(p.siteHostname)}</td>
  <td><a href="${esc(p.url)}">${esc(p.url)}</a></td>
  <td>${p.status}</td>
  <td class="num">${p.durationMs}</td>
  <td class="${p.ok ? "cell-ok" : "cell-err"}">${esc(pageFetchResult(p))}</td>
</tr>`;
    })
    .join("\n");

  const linksAll = reports.flatMap((r) =>
    (r.crawl.linkChecks ?? []).map((l) => ({ ...l, siteHostname: r.hostname })),
  );
  linksAll.sort((a, b) => b.durationMs - a.durationMs);

  const linkChecksSection =
    linksAll.length === 0
      ? ""
      : `<section class="report-section">
    <h2>Internal link checks (not crawled as HTML)</h2>
    <p class="section-desc">HEAD / tiny GET for URLs discovered but not fetched as full pages. Sorted slowest first.</p>
    ${buildTableFiltersHtml("master-table-links", FILTER_STATUS_LINKS)}
    <div class="table-wrap">
    <table class="data-table" id="master-table-links">
      <thead><tr><th>Site</th><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Method</th><th>Result</th></tr></thead>
      <tbody>
        ${linksAll
          .map((l) => {
            const ft = `${l.siteHostname} ${l.target}`.toLowerCase();
            return `<tr class="${l.ok ? "row-ok" : "row-err"}" data-filter-text="${esc(ft)}" data-filter-ms="${String(l.durationMs)}" data-filter-result="${l.ok ? "ok" : "failed"}">
          <td>${esc(l.siteHostname)}</td>
          <td><a href="${esc(l.target)}">${esc(l.target)}</a></td>
          <td>${l.status}</td>
          <td class="num">${l.durationMs}</td>
          <td>${esc(l.method)}</td>
          <td class="${l.ok ? "cell-ok" : "cell-err"}">${l.ok ? "OK" : "Failed"}</td>
        </tr>`;
          })
          .join("\n")}
      </tbody>
    </table>
    </div>
  </section>`;

  const summaryRows = reports
    .map((r) => {
      const failed = r.crawl.brokenLinks.length > 0 || r.crawl.pages.some((p) => !p.ok);
      return `<tr>
  <td>${esc(r.hostname)}</td>
  <td><a href="${esc(r.startUrl)}">${esc(r.startUrl)}</a></td>
  <td class="num">${r.crawl.pagesVisited}</td>
  <td class="num">${r.crawl.brokenLinks.length}</td>
  <td class="${failed ? "cell-err" : "cell-ok"}">${failed ? "Issues" : "OK"}</td>
  <td class="num" style="font-size:0.82rem">${esc(r.finishedAt)}</td>
</tr>`;
    })
    .join("\n");

  const totalPages = reports.reduce((n, r) => n + r.crawl.pagesVisited, 0);
  const totalBroken = reports.reduce((n, r) => n + r.crawl.brokenLinks.length, 0);

  const psiSections = reports
    .map((r) => {
      const psiPages = r.crawl.pages
        .filter((p) => p.insights)
        .sort((a, b) => {
          const key = (p: PageFetchRecord) => {
            if (p.insights?.error) return 1000;
            return p.insights?.scores?.performance ?? 999;
          };
          return key(a) - key(b);
        });
      if (psiPages.length === 0) return "";
      return `<h2 class="master-site-heading">${esc(r.hostname)} — PageSpeed Insights (Lighthouse lab)</h2>
    <p class="section-desc">Per-site lab data; same cards as single-site reports.</p>
    <div class="psi-grid">
      ${psiPages.map((p) => buildPsiCardHtml(p.insights as PageSpeedInsightRecord)).join("\n")}
    </div>`;
    })
    .filter(Boolean)
    .join("\n");

  const psiBlock =
    psiSections.length === 0
      ? ""
      : `<section class="report-section">
    <h2>PageSpeed Insights (all sites)</h2>
    <p class="section-desc">Grouped by hostname. Lab metrics only.</p>
    ${psiSections}
  </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${HEALTH_REPORT_HEAD}
  <title>Combined health — all sites</title>
  <style>${HEALTH_REPORT_CSS}</style>
</head>
<body>
  <div class="report-shell">
  <header class="report-header">
    <p class="report-kicker">QA-Agent · Combined run</p>
    <h1>All sites — combined report</h1>
    <p class="lead">Single view of every site in this run. Open per-site folders for detail-only exports.</p>
    <div class="stat-grid">
      <div class="stat"><span class="stat-label">Sites</span><span class="stat-value">${reports.length}</span></div>
      <div class="stat"><span class="stat-label">Pages (sum)</span><span class="stat-value">${totalPages}</span></div>
      <div class="stat"><span class="stat-label">Broken rows (sum)</span><span class="stat-value">${totalBroken}</span></div>
      <div class="stat"><span class="stat-label">Run ID</span><span class="stat-value" style="font-size:0.95rem;word-break:break-all">${esc(meta.runId)}</span></div>
    </div>
    <p class="meta" style="margin:18px 0 0;"><strong>Generated:</strong> ${esc(meta.generatedAt)} · <strong>URLs file:</strong> ${esc(meta.urlsFile)}</p>
  </header>

  <section class="report-section">
    <h2>Summary by site</h2>
    <p class="section-desc">Per-site crawl totals and status.</p>
    <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>Site</th><th>Start URL</th><th class="num">Pages</th><th class="num">Broken rows</th><th>Status</th><th>Finished at</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
    </div>
  </section>

  <section class="report-section">
    <h2>Broken internal links (all sites)</h2>
    <p class="section-desc">Sorted slowest first. <strong>Site</strong> is the hostname for that crawl line.</p>
    ${masterBrokenFilters}
    <div class="table-wrap">
    <table class="data-table" id="master-table-broken">
      <thead><tr><th>Site</th><th>Found on</th><th>Target</th><th>HTTP</th><th class="num">Time (ms)</th><th>Detail</th></tr></thead>
      <tbody>${brokenRows}</tbody>
    </table>
    </div>
  </section>

  <section class="report-section">
    <h2>Pages fetched (all sites)</h2>
    <p class="section-desc">Sorted slowest first. Search matches site hostname and URL.</p>
    ${buildTableFiltersHtml("master-table-pages", FILTER_STATUS_PAGES)}
    <div class="table-wrap">
    <table class="data-table" id="master-table-pages">
      <thead><tr><th>Site</th><th>URL</th><th>HTTP</th><th class="num">Time (ms)</th><th>Result</th></tr></thead>
      <tbody>${pageRows}</tbody>
    </table>
    </div>
  </section>

  ${linkChecksSection}

  ${psiBlock}

  <footer class="report-footer">Generated by QA-Agent · Combined health report</footer>
  </div>
  ${HEALTH_TABLE_FILTERS_SCRIPT}
</body>
</html>`;
}

export async function writeSiteHealthReports(options: {
  report: SiteHealthReport;
  outDir: string;
  /** Filename base without extension (e.g. report-www-example-com-2026-03-23T17-03-21-217Z). */
  fileBaseName: string;
}): Promise<{ htmlPath: string; jsonPath: string; canonicalHtmlPath: string; canonicalJsonPath: string }> {
  await mkdir(options.outDir, { recursive: true });
  const html = buildSiteHealthHtml(options.report);
  const json = JSON.stringify(options.report, null, 2);
  const canonicalHtmlPath = path.join(options.outDir, `${options.fileBaseName}.html`);
  const canonicalJsonPath = path.join(options.outDir, `${options.fileBaseName}.json`);
  await writeFile(canonicalHtmlPath, html, "utf8");
  await writeFile(canonicalJsonPath, json, "utf8");
  const htmlPath = path.join(options.outDir, "report.html");
  const jsonPath = path.join(options.outDir, "report.json");
  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, json, "utf8");
  return { htmlPath, jsonPath, canonicalHtmlPath, canonicalJsonPath };
}

export async function writeMasterHealthReports(options: {
  reports: SiteHealthReport[];
  runDir: string;
  fileBaseName: string;
  meta: { runId: string; urlsFile: string; generatedAt: string };
}): Promise<{ htmlPath: string; jsonPath: string }> {
  const htmlPath = path.join(options.runDir, `${options.fileBaseName}.html`);
  const jsonPath = path.join(options.runDir, `${options.fileBaseName}.json`);
  const payload = {
    runId: options.meta.runId,
    urlsFile: options.meta.urlsFile,
    generatedAt: options.meta.generatedAt,
    sites: options.reports,
  };
  await writeFile(htmlPath, buildMasterHealthHtml(options.reports, options.meta), "utf8");
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  return { htmlPath, jsonPath };
}

export function buildHealthIndexHtml(options: {
  runId: string;
  generatedAt: string;
  urlsFile: string;
  masterHtmlPath: string;
  masterJsonPath: string;
  items: { hostname: string; htmlHref: string; jsonHref: string; label: string }[];
}): string {
  const rows = options.items
    .map(
      (i) => `<tr>
  <td><strong>${esc(i.hostname)}</strong></td>
  <td><a href="${esc(i.htmlHref)}">${esc(i.label)}</a></td>
  <td><a href="${esc(i.jsonHref)}">Download JSON</a></td>
</tr>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>QA-Agent — health run index</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet"/>
  <style>${INDEX_PAGE_CSS}</style>
</head>
<body>
<div class="idx-wrap">
  <div class="idx-hero">
    <p class="idx-kicker">QA-Agent · Health run</p>
    <h1>Reports index</h1>
    <p class="idx-meta"><strong>Run ID</strong> ${esc(options.runId)}</p>
    <p class="idx-meta"><strong>Generated</strong> ${esc(options.generatedAt)}</p>
    <p class="idx-meta"><strong>URLs file</strong> ${esc(options.urlsFile)}</p>
    <div class="idx-combined">
      <strong>Combined (all sites):</strong>
      <a href="${esc(options.masterHtmlPath)}">${esc(path.basename(options.masterHtmlPath))}</a>
      · <a href="${esc(options.masterJsonPath)}">JSON</a>
    </div>
  </div>
  <div class="idx-table-wrap">
    <table class="idx-table">
      <thead><tr><th>Site</th><th>HTML report</th><th>Data</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="idx-foot">Each per-site filename includes the website name and when that report was generated. The combined report timestamp is when the full run finished.</p>
</div>
</body></html>`;
}
