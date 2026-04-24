import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner } from "../components/UI";

interface Schedule {
  id: string;
  name: string;
  cron: string;
  sites: string[];
  includePageSpeed?: boolean;
  includeFormTests?: boolean;
  maxPages?: number;
  emailTo?: string[];
  paused?: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: "ok" | "error";
  lastRunError?: string;
  nextRunPreview?: string;
}

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: "Daily @ 05:30 UTC", expr: "30 5 * * *" },
  { label: "Hourly at :00", expr: "0 * * * *" },
  { label: "Weekdays @ 06:00 UTC", expr: "0 6 * * 1-5" }, // note: runner only supports *, literal, */n — 1-5 will fail validation (expected)
  { label: "Every 15 min", expr: "*/15 * * * *" },
  { label: "Every Monday @ 09:00 UTC", expr: "0 9 * * 1" },
];

export default function Schedules() {
  const [list, setList] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Form state
  const [fName, setFName] = useState("");
  const [fCron, setFCron] = useState("30 5 * * *");
  const [fSitesText, setFSitesText] = useState("");
  const [fPageSpeed, setFPageSpeed] = useState(false);
  const [fFormTests, setFFormTests] = useState(false);
  const [fMaxPages, setFMaxPages] = useState<number | "">("");
  const [fEmailText, setFEmailText] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/schedules");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { schedules: Schedule[] };
      setList(data.schedules);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const create = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!fName.trim() || !fCron.trim() || !fSitesText.trim()) { setError("name, cron, and at least one site required"); return; }
    setCreating(true); setError("");
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fName.trim(),
          cron: fCron.trim(),
          sites: fSitesText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          includePageSpeed: fPageSpeed,
          includeFormTests: fFormTests,
          maxPages: typeof fMaxPages === "number" ? fMaxPages : undefined,
          emailTo: fEmailText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setFName(""); setFCron("30 5 * * *"); setFSitesText(""); setFEmailText("");
      setFPageSpeed(false); setFFormTests(false); setFMaxPages("");
      void load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setCreating(false);
    }
  };

  const togglePause = async (sched: Schedule) => {
    try {
      const res = await fetch(`/api/schedules/${sched.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !sched.paused }),
      });
      if (!res.ok) throw new Error(await res.text());
      void load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const remove = async (sched: Schedule) => {
    if (!confirm(`Delete schedule "${sched.name}"?`)) return;
    try {
      const res = await fetch(`/api/schedules/${sched.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      void load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <PageShell
      title="Scheduled Audits"
      desc="Cron-driven audits that fire on your schedule. Each fire runs a crawl + (optionally) PageSpeed + form tests, renders the report HTML, and emails it to your team."
      purpose="I want the same SEO audit that ran manually yesterday to run automatically every weekday at 6am and land in my inbox."
      sources={["n8n", "Cron", "Daily-report endpoint"]}
    >
      {error && <ErrorBanner error={error} />}

      <SectionCard title="New schedule">
        <form onSubmit={create} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 200 }}>
              <div className="qa-kicker">Name</div>
              <input className="qa-input" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Weekly client audit" style={{ width: "100%", padding: "8px 12px", marginTop: 4 }} disabled={creating} />
            </label>
            <label style={{ flex: 1, minWidth: 200 }}>
              <div className="qa-kicker">Cron (min hour dom mo dow — UTC)</div>
              <input className="qa-input" value={fCron} onChange={(e) => setFCron(e.target.value)} placeholder="30 5 * * *" style={{ width: "100%", padding: "8px 12px", marginTop: 4, fontFamily: "ui-monospace, monospace" }} disabled={creating} />
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                {CRON_PRESETS.map((p) => (
                  <button key={p.expr} type="button" onClick={() => setFCron(p.expr)} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--glass2)", cursor: "pointer", color: "var(--text-secondary)" }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </label>
          </div>

          <label>
            <div className="qa-kicker">Sites to audit (one per line or comma-separated)</div>
            <textarea value={fSitesText} onChange={(e) => setFSitesText(e.target.value)} rows={3} placeholder="https://example.com&#10;https://blog.example.com" style={{ width: "100%", padding: "8px 12px", marginTop: 4, border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "ui-monospace, monospace", resize: "vertical" }} disabled={creating} />
          </label>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={fPageSpeed} onChange={(e) => setFPageSpeed(e.target.checked)} disabled={creating} /> PageSpeed Insights
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={fFormTests} onChange={(e) => setFFormTests(e.target.checked)} disabled={creating} /> Form tests
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              Max pages per site
              <input type="number" min={1} max={1000} value={fMaxPages} onChange={(e) => setFMaxPages(e.target.value ? Number(e.target.value) : "")} placeholder="unlimited" style={{ width: 90, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }} disabled={creating} />
            </label>
          </div>

          <label>
            <div className="qa-kicker">Email recipients (optional — comma or newline separated)</div>
            <input value={fEmailText} onChange={(e) => setFEmailText(e.target.value)} placeholder="seo-team@example.com" style={{ width: "100%", padding: "8px 12px", marginTop: 4, border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }} disabled={creating} />
          </label>

          <div>
            <button type="submit" className="qa-btn-primary" disabled={creating || !fName.trim() || !fCron.trim() || !fSitesText.trim()} style={{ padding: "10px 22px", fontWeight: 700 }}>
              {creating ? "Creating…" : "Create schedule"}
            </button>
            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 10 }}>
              In-process ticker runs every minute. Delete or pause anytime.
            </span>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`Schedules (${list.length})`}>
        {loading && <div style={{ padding: 12, color: "var(--muted)" }}>Loading…</div>}
        {!loading && list.length === 0 && (
          <EmptyState title="No schedules yet — create one above." hint="Schedules persist to data/schedules.json and fire on the server's cron ticker." />
        )}
        {list.map((s) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 10, marginBottom: 10, background: s.paused ? "var(--glass2)" : "#fff" }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{s.name}</span>
              <code style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--glass2)", color: "var(--text-secondary)" }}>{s.cron}</code>
              {s.paused && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 8px", borderRadius: 10, background: "#fef3c7", color: "#92400e", textTransform: "uppercase" }}>Paused</span>}
              {s.lastRunStatus === "ok" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#dcfce7", color: "#166534", textTransform: "uppercase", letterSpacing: 0.3 }}>last: ok</span>}
              {s.lastRunStatus === "error" && <span title={s.lastRunError ?? ""} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#fef2f2", color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.3 }}>last: error</span>}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button onClick={() => togglePause(s)} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 4, background: "#fff", cursor: "pointer" }}>
                  {s.paused ? "Resume" : "Pause"}
                </button>
                <button onClick={() => remove(s)} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #fca5a5", borderRadius: 4, background: "#fff", color: "#b91c1c", cursor: "pointer" }}>
                  Delete
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              <strong>{s.sites.length}</strong> site{s.sites.length === 1 ? "" : "s"}: {s.sites.slice(0, 3).join(", ")}{s.sites.length > 3 ? `, +${s.sites.length - 3} more` : ""}
              {s.includePageSpeed && " · PageSpeed"}
              {s.includeFormTests && " · Form tests"}
              {s.maxPages && ` · ${s.maxPages} pages max`}
              {s.emailTo && s.emailTo.length > 0 && ` · → ${s.emailTo.join(", ")}`}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {s.nextRunPreview && <>Next fire: {new Date(s.nextRunPreview).toLocaleString()}</>}
              {s.lastRunAt && <> · Last fire: {new Date(s.lastRunAt).toLocaleString()}</>}
              {s.lastRunError && <span style={{ color: "#b91c1c", marginLeft: 8 }}>— {s.lastRunError.slice(0, 80)}</span>}
            </div>
          </motion.div>
        ))}
      </SectionCard>
    </PageShell>
  );
}
