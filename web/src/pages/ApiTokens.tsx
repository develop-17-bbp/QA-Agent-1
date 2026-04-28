import { useEffect, useState } from "react";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner } from "../components/UI";
import { PageHero } from "../components/PageHero";

interface ApiTokenSummary {
  id: string;
  tokenMask: string;
  label: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  disabled: boolean;
}

export default function ApiTokens() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  /** When set, we just created a token and show its plaintext value once. */
  const [justCreated, setJustCreated] = useState<{ token: string; label: string } | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/tokens");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { tokens: ApiTokenSummary[] };
      setTokens(data.tokens);
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!newLabel.trim()) return;
    setCreating(true); setError("");
    try {
      const res = await fetch("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: newLabel.trim() }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { id: string; token: string; label: string };
      setJustCreated({ token: data.token, label: data.label });
      setNewLabel("");
      void load();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setCreating(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this token? Any external tool using it will stop working.")) return;
    try {
      const res = await fetch(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      void load();
    } catch (e: any) { setError(e?.message ?? String(e)); }
  };

  return (
    <PageShell
      title="Public API Tokens"
      desc="API keys for external tools (Looker Studio, Zapier, agency dashboards) to query QA-Agent without a browser session. Tokens authenticate against /api/v1/* routes."
      purpose="How do I let an external tool pull QA-Agent data without exposing the dashboard publicly?"
      sources={["data/api-tokens.json (mode 0600, never committed)"]}
    >
      <PageHero
        icon="plug"
        eyebrow="Public REST API"
        title={`${tokens.length} active token${tokens.length === 1 ? "" : "s"}`}
        subtitle="Each token: 60 req/min. Routes: /api/v1/forecast, /voice-of-serp, /bulk-keywords, /narrative-diff, /intent-shifts, /cannibalization, /serp-live, /backlinks-live, /ai-search-visibility, /local-map-pack, /citation-audit, /alerts, /runs, /llm-stats. Spec at /api/v1/openapi.json."
        accent
      />

      {justCreated && (
        <div className="qa-panel" style={{ padding: 14, marginBottom: 14, background: "#fef3c7", border: "1px solid #fde68a" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
            ⚠ Save this token NOW — it won't be shown again.
          </div>
          <div style={{ fontSize: 12, color: "#92400e", marginBottom: 8 }}>Label: <strong>{justCreated.label}</strong></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, padding: "8px 10px", borderRadius: 6, background: "#fff", border: "1px solid #fde68a", fontSize: 13, fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
              {justCreated.token}
            </code>
            <button onClick={() => navigator.clipboard?.writeText(justCreated.token)} className="qa-btn-default" style={{ padding: "6px 12px" }}>Copy</button>
            <button onClick={() => setJustCreated(null)} className="qa-btn-default" style={{ padding: "6px 12px" }}>Dismiss</button>
          </div>
          <div style={{ fontSize: 11, color: "#92400e", marginTop: 8 }}>
            Use header: <code>X-API-Key: {justCreated.token.slice(0, 6)}…</code>
          </div>
        </div>
      )}

      <SectionCard title="Create token">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="qa-input"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label — e.g. 'Looker Studio' or 'Zapier — agency dashboard'"
            style={{ flex: 1, minWidth: 260, padding: "8px 12px" }}
            onKeyDown={(e) => e.key === "Enter" && !creating && create()}
          />
          <button onClick={create} className="qa-btn-primary" disabled={creating || !newLabel.trim()} style={{ padding: "8px 18px" }}>
            {creating ? "Creating…" : "Create token"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          Default scope: <code>read</code>. Token format: <code>qa_&lt;32-char hex&gt;</code>. Rate limit: 60 req/min.
        </div>
      </SectionCard>

      {error && <ErrorBanner error={error} />}

      <SectionCard title={`Tokens (${tokens.length})`}>
        {loading && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>}
        {!loading && tokens.length === 0 && (
          <EmptyState title="No API tokens" hint="Create one above to give an external tool read-access to your QA-Agent data." />
        )}
        {!loading && tokens.length > 0 && (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Label</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Token</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Scopes</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Created</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px", fontWeight: 600 }}>{t.label}</td>
                  <td style={{ padding: "8px", fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>{t.tokenMask}</td>
                  <td style={{ padding: "8px" }}>
                    {t.scopes.map((s) => <span key={s} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", marginRight: 4, fontWeight: 600 }}>{s}</span>)}
                  </td>
                  <td style={{ padding: "8px", color: "var(--muted)" }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: "8px", color: "var(--muted)" }}>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never"}</td>
                  <td style={{ padding: "8px" }}>
                    <button onClick={() => remove(t.id)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "none", cursor: "pointer", color: "var(--bad)", fontWeight: 600 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard title="Quickstart">
        <pre style={{ background: "var(--glass2)", padding: 12, borderRadius: 6, fontSize: 12, fontFamily: "ui-monospace, monospace", overflow: "auto" }}>
{`# Curl example
curl -X POST http://127.0.0.1:3847/api/v1/forecast \\
  -H "X-API-Key: qa_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"domain":"example.com","windowDays":30}'

# OpenAPI doc (no auth needed)
curl http://127.0.0.1:3847/api/v1/openapi.json
`}
        </pre>
      </SectionCard>
    </PageShell>
  );
}
