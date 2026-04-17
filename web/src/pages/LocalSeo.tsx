import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchLocalSeo } from "../api";

import { LoadingPanel, ErrorBanner } from "../components/UI";
const CATEGORY_ORDER = ["NAP & Contact", "Schema Markup", "Localization", "Discoverability"];

const STATUS_COLOR: Record<string, string> = {
  pass: "#38a169",
  fail: "#e53e3e",
  na: "#9ca3af",
};
const STATUS_ICON: Record<string, string> = { pass: "\u2713", fail: "\u2715", na: "\u2014" };

export default function LocalSeo() {
  const [businessName, setBusinessName] = useState("");
  const [location, setLocation] = useState("");
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openSuggestion, setOpenSuggestion] = useState<string | null>(null);

  const analyze = async () => {
    if (!businessName.trim() || !location.trim() || !runId) return;
    setLoading(true); setError(""); setOpenSuggestion(null);
    try { setData(await fetchLocalSeo(businessName.trim(), location.trim(), runId)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const dq = data?.dataQuality ?? { providersHit: [], providersFailed: [], missingFields: [] };
  const checks: any[] = data?.checks ?? [];
  const summary = data?.summary ?? { total: 0, passed: 0, failed: 0, na: 0 };

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: checks.filter((c) => c.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Local SEO Checklist</h1>
      <p className="qa-page-desc">
        Deterministic pass/fail checklist against real crawl fields plus a single HTTP re-fetch of your
        start URL for JSON-LD schema, tel: links, address patterns, hreflang, geo meta tags, and map
        embeds. The LLM is restricted to plain-text fix suggestions for failed checks — it never
        invents keyword volumes, rankings, or citation priorities.
      </p>

      <div style={{ marginBottom: 12 }}><RunSelector value={runId} onChange={setRunId} label="Website run" /></div>
      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business name..." style={{ flex: 1, minWidth: 150, padding: "8px 12px" }} />
        <input className="qa-input" value={location} onChange={e => setLocation(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Location (city, state)..." style={{ flex: 1, minWidth: 150, padding: "8px 12px" }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !businessName.trim() || !location.trim() || !runId}>{loading ? "Analyzing..." : "Run Checklist"}</button>
      </div>

      {error && <ErrorBanner error={error} />}
      {loading && <LoadingPanel message="Running local SEO checks against crawl + live HTML…" />}

      {data && !loading && (
        <>
          {(dq.providersHit?.length > 0 || dq.providersFailed?.length > 0 || dq.missingFields?.length > 0) && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="qa-kicker" style={{ fontSize: 11 }}>Data sources:</span>
              {(dq.providersHit ?? []).map((p: string) => (
                <span key={`hit-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(56,161,105,0.15)", color: "#38a169", fontWeight: 600, border: "1px solid rgba(56,161,105,0.3)" }} title="Real provider hit">
                  ● {p}
                </span>
              ))}
              {(dq.providersFailed ?? []).map((p: string) => (
                <span key={`fail-${p}`} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "rgba(229,62,62,0.1)", color: "#e53e3e", fontWeight: 600, border: "1px solid rgba(229,62,62,0.3)" }} title="Provider failed">
                  ✕ {p}
                </span>
              ))}
              {(dq.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Unavailable: ${dq.missingFields.join(", ")}`}>
                  Missing: {dq.missingFields.join(", ")}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
              <div className="qa-kicker">Total checks</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{summary.total}</div>
            </div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
              <div className="qa-kicker">Passed</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#38a169" }}>{summary.passed}</div>
            </div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
              <div className="qa-kicker">Failed</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#e53e3e" }}>{summary.failed}</div>
            </div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
              <div className="qa-kicker">N/A</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#9ca3af" }}>{summary.na}</div>
            </div>
          </div>

          {!data.meta?.htmlFetched && (
            <div className="qa-alert" style={{ marginTop: 16, padding: 12, background: "rgba(221,107,32,0.1)", border: "1px solid rgba(221,107,32,0.3)", color: "#dd6b20", fontSize: 12, borderRadius: 6 }}>
              Warning: the start URL HTML could not be re-fetched. Schema/tel/address checks fall back to N/A.
              {data.meta?.htmlFetchError && <> Error: <code>{data.meta.htmlFetchError}</code></>}
            </div>
          )}

          {grouped.map((g) => (
            <div key={g.category} className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title">{g.category}</div>
              {g.items.map((c: any) => {
                const isOpen = openSuggestion === c.id;
                return (
                  <div key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: STATUS_COLOR[c.status], minWidth: 22, textAlign: "center" }}>
                        {STATUS_ICON[c.status]}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                        {c.evidence && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{c.evidence}</div>}
                      </div>
                      {c.status === "fail" && c.fixSuggestion && (
                        <button
                          onClick={() => setOpenSuggestion(isOpen ? null : c.id)}
                          style={{ fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", color: "var(--text-secondary)", whiteSpace: "nowrap" }}
                        >
                          {isOpen ? "Hide fix" : "AI fix"}
                        </button>
                      )}
                    </div>
                    {isOpen && c.fixSuggestion && (
                      <div style={{ marginTop: 8, marginLeft: 34, padding: "8px 12px", background: "rgba(90,103,216,0.08)", borderRadius: 6, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        <strong style={{ color: "#111111" }}>AI suggestion — verify before applying:</strong> {c.fixSuggestion}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </motion.div>
  );
}
