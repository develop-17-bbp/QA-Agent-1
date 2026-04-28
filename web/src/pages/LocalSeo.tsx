import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchLocalSeo, fetchMapPack, fetchCitationAudit, type MapPackResponse, type CitationAuditResponse } from "../api";

import { LoadingPanel, ErrorBanner } from "../components/UI";
import AskCouncilButton from "../components/AskCouncilButton";
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
  // Map-pack tracker state
  const [mpQuery, setMpQuery] = useState("");
  const [mpDomain, setMpDomain] = useState("");
  const [mpData, setMpData] = useState<MapPackResponse | null>(null);
  const [mpLoading, setMpLoading] = useState(false);
  const [mpError, setMpError] = useState("");
  // Citation audit state
  const [napPhone, setNapPhone] = useState("");
  const [napAddress, setNapAddress] = useState("");
  const [citData, setCitData] = useState<CitationAuditResponse | null>(null);
  const [citLoading, setCitLoading] = useState(false);
  const [citError, setCitError] = useState("");

  const runMapPack = async () => {
    if (!mpQuery.trim() || !businessName.trim()) { setMpError("query + business name required"); return; }
    setMpLoading(true); setMpError(""); setMpData(null);
    try { setMpData(await fetchMapPack({ query: mpQuery.trim(), operatorName: businessName.trim(), location, operatorDomain: mpDomain.trim() || undefined })); }
    catch (e: any) { setMpError(e?.message ?? String(e)); }
    finally { setMpLoading(false); }
  };

  const runCitationAudit = async () => {
    if (!businessName.trim()) { setCitError("business name required"); return; }
    setCitLoading(true); setCitError(""); setCitData(null);
    try { setCitData(await fetchCitationAudit({ businessName: businessName.trim(), canonicalNap: { name: businessName.trim(), phone: napPhone.trim() || undefined, address: napAddress.trim() || undefined } })); }
    catch (e: any) { setCitError(e?.message ?? String(e)); }
    finally { setCitLoading(false); }
  };

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
        {businessName.trim() && <AskCouncilButton term={`${businessName.trim()}${location.trim() ? ` ${location.trim()}` : ""}`} compact />}
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

      {/* ── Map Pack Tracker (NEW) ─────────────────────────────────────── */}
      <div className="qa-panel" style={{ padding: 16, marginTop: 24 }}>
        <div className="qa-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          📍 Google Map Pack Tracker
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", fontWeight: 700, letterSpacing: 0.4, border: "1px solid var(--accent-muted)" }}>NEW</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
          Captures the top-3 local pack box Google shows for "<i>{mpQuery || '<query> near me'}</i>" — tracks operator's position over time. Uses headless Chromium against google.com.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="qa-input" placeholder="Search query (e.g. plastic surgeon seattle)" value={mpQuery} onChange={(e) => setMpQuery(e.target.value)} style={{ flex: 1, minWidth: 240, padding: "8px 12px" }} />
          <input className="qa-input" placeholder="Operator domain (optional, for history)" value={mpDomain} onChange={(e) => setMpDomain(e.target.value)} style={{ width: 240, padding: "8px 12px" }} />
          <button className="qa-btn-primary" onClick={runMapPack} disabled={mpLoading || !mpQuery.trim() || !businessName.trim()} style={{ padding: "8px 18px" }}>
            {mpLoading ? "Tracking…" : "Track map pack"}
          </button>
        </div>
        {mpError && <div style={{ marginTop: 10 }}><ErrorBanner error={mpError} /></div>}
        {mpData && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              Operator match: {mpData.operatorMatch ? <strong style={{ color: "#16a34a" }}>#{mpData.operatorMatch.position} ({mpData.operatorMatch.name})</strong> : <span style={{ color: "var(--bad)", fontWeight: 600 }}>Not in top-3</span>}
            </div>
            {mpData.pack.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>No local pack rendered for this query — Google may not show one for it.</div>
            ) : (
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><th style={{ textAlign: "left", padding: "6px 8px" }}>#</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Business</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Rating</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Reviews</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Category</th></tr></thead>
                <tbody>
                  {mpData.pack.map((e) => {
                    const isMe = mpData.operatorMatch?.position === e.position;
                    return (
                      <tr key={e.position} style={{ background: isMe ? "rgba(22,163,74,0.08)" : undefined, borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 800, color: e.position <= 3 ? "#16a34a" : "var(--muted)" }}>{e.position}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{e.name}{isMe && <span style={{ fontSize: 9, marginLeft: 6, padding: "1px 6px", borderRadius: 8, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>YOU</span>}</td>
                        <td style={{ padding: "6px 8px" }}>{e.rating != null ? `★ ${e.rating}` : "—"}</td>
                        <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{e.reviewCount != null ? e.reviewCount.toLocaleString() : "—"}</td>
                        <td style={{ padding: "6px 8px", fontSize: 11, color: "var(--muted)" }}>{e.category}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Citation Consistency (NEW) ─────────────────────────────────── */}
      <div className="qa-panel" style={{ padding: 16, marginTop: 16 }}>
        <div className="qa-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          🔗 Citation Consistency
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", fontWeight: 700, letterSpacing: 0.4, border: "1px solid var(--accent-muted)" }}>NEW</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
          Checks whether the operator's NAP (name + phone) is listed consistently across Yelp, BBB, Yellow Pages, Manta, Foursquare, MapQuest. Inconsistent NAPs across directories tank local rank.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="qa-input" placeholder="Canonical phone (optional but recommended)" value={napPhone} onChange={(e) => setNapPhone(e.target.value)} style={{ width: 260, padding: "8px 12px" }} />
          <input className="qa-input" placeholder="Canonical address (optional)" value={napAddress} onChange={(e) => setNapAddress(e.target.value)} style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
          <button className="qa-btn-primary" onClick={runCitationAudit} disabled={citLoading || !businessName.trim()} style={{ padding: "8px 18px" }}>
            {citLoading ? "Auditing…" : "Audit citations"}
          </button>
        </div>
        {citError && <div style={{ marginTop: 10 }}><ErrorBanner error={citError} /></div>}
        {citData && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 14, fontSize: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <span><strong>{citData.summary.checked}</strong> directories checked</span>
              <span style={{ color: "#16a34a" }}><strong>{citData.summary.consistent}</strong> consistent</span>
              <span style={{ color: "#dc2626" }}><strong>{citData.summary.inconsistent}</strong> inconsistent</span>
              <span style={{ color: "var(--muted)" }}><strong>{citData.summary.missing}</strong> not listed</span>
            </div>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><th style={{ textAlign: "left", padding: "6px 8px" }}>Directory</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Listed?</th><th style={{ textAlign: "left", padding: "6px 8px" }}>NAP match</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Issues</th></tr></thead>
              <tbody>
                {citData.directories.map((r) => (
                  <tr key={r.directory} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}><a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>{r.directory}</a></td>
                    <td style={{ padding: "6px 8px" }}>{r.found ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ found</span> : <span style={{ color: "var(--bad)", fontWeight: 700 }}>✕ not listed</span>}</td>
                    <td style={{ padding: "6px 8px" }}>{r.napMatch === true ? <span style={{ color: "#16a34a" }}>✓ match</span> : r.napMatch === false ? <span style={{ color: "#dc2626" }}>✕ mismatch</span> : "—"}</td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: "var(--muted)" }}>{r.mismatches.join(", ") || (r.error ? `error: ${r.error}` : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
