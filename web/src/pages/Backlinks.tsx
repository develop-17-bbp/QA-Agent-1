import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchBacklinks, fetchExternalBacklinks } from "../api";

export default function Backlinks() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extDomain, setExtDomain] = useState("");
  const [extData, setExtData] = useState<any>(null);
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState("");

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchBacklinks(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const loadExternal = async () => {
    const dom = extDomain.trim();
    if (!dom) return;
    setExtLoading(true); setExtError(""); setExtData(null);
    try { setExtData(await fetchExternalBacklinks(dom)); }
    catch (e: any) { setExtError(e.message); }
    finally { setExtLoading(false); }
  };

  const healthData = data?.healthDistribution ? [
    { name: "Healthy", value: data.healthDistribution.healthy, color: "#38a169" },
    { name: "Broken", value: data.healthDistribution.broken, color: "#e53e3e" },
    { name: "Redirected", value: data.healthDistribution.redirected, color: "#dd6b20" },
  ].filter(d => d.value > 0) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Backlinks</h1>
      <p className="qa-page-desc">Analyze your internal and external link structure from crawl data.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Analyzing backlinks...</div>}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            {[{ label: "Total Links", val: data.totalLinks }, { label: "Internal", val: data.internalLinks }, { label: "External", val: data.externalLinks }, { label: "Orphan Pages", val: data.summary?.orphanPageCount ?? 0, color: "#e53e3e" }].map(s => (
              <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                <div className="qa-kicker">{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: (s as any).color ?? "var(--text-primary)" }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {healthData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div className="qa-panel-title">Link Health</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={healthData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {healthData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {(data.topLinked ?? []).length > 0 && (
              <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                <div className="qa-panel-title">Most Linked Pages</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={(data.topLinked ?? []).slice(0, 10)} layout="vertical"><XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="url" width={180} fontSize={10} tickFormatter={(v: string) => v.length > 30 ? v.slice(0, 27) + "..." : v} /><Tooltip /><Bar dataKey="inboundLinks" fill="#111111" radius={[0,4,4,0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {(data.orphanPages ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title" style={{ color: "#e53e3e" }}>Orphan Pages ({data.orphanPages.length})</div>
              {data.orphanPages.slice(0, 15).map((p: any) => <div key={p.url} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--border)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || p.url}</div>)}
            </div>
          )}

          {(data.brokenLinks ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div className="qa-panel-title" style={{ color: "#e53e3e" }}>Broken Links ({data.brokenLinks.length})</div>
              <table className="qa-table">
                <thead><tr>{["Source", "Target", "Status", "Error"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{(data.brokenLinks ?? []).slice(0, 20).map((bl: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bl.source}>{bl.source}</td>
                    <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bl.target}>{bl.target}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#e53e3e" }}>{bl.status}</td>
                    <td style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-secondary)" }}>{bl.error}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* External Backlinks Discovery — competitor/any-domain backlink signal from free providers */}
      <div className="qa-panel" style={{ marginTop: 24, padding: 16 }}>
        <div className="qa-panel-title">External Backlink Discovery</div>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, marginBottom: 12 }}>
          Query real free providers (OpenPageRank, Common Crawl, URLScan, Wayback Machine) for any domain — even one you don't own.
          Useful for competitor research. Set <code>OPR_API_KEY</code> for domain authority.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="e.g. example.com"
            value={extDomain}
            onChange={(e) => setExtDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") loadExternal(); }}
            style={{ flex: 1, minWidth: 220, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "var(--panel-bg)", color: "var(--text-primary)" }}
          />
          <button
            onClick={loadExternal}
            disabled={extLoading || !extDomain.trim()}
            className="qa-btn qa-btn--primary"
            style={{ padding: "8px 14px" }}
          >
            {extLoading ? "Querying…" : "Discover"}
          </button>
        </div>

        {extLoading && <div className="qa-loading-panel" style={{ marginTop: 14 }}><div className="qa-spinner" />Querying OpenPageRank, Common Crawl, URLScan and Wayback Machine…</div>}
        {extError && <div className="qa-alert qa-alert--error" style={{ marginTop: 14 }}>{extError}</div>}

        {extData && !extLoading && (
          <div style={{ marginTop: 14 }}>
            <div className="qa-panel" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span className="qa-kicker">Data sources:</span>
              {(extData.providersHit ?? []).map((p: string) => (
                <span key={p} className="qa-lozenge" style={{ background: "#ecfdf5", color: "#047857", fontSize: 11 }}>{p}</span>
              ))}
              {(extData.providersFailed ?? []).map((p: string) => (
                <span key={p} className="qa-lozenge" style={{ background: "#fef3c7", color: "#b45309", fontSize: 11 }}>{p} unavailable</span>
              ))}
              {(extData.dataQuality?.missingFields ?? []).length > 0 && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>• Missing: {extData.dataQuality.missingFields.join(", ")}</span>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div className="qa-panel" style={{ flex: 1, minWidth: 180, padding: 14, textAlign: "center" }}>
                <div className="qa-kicker">Domain Authority</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{extData.domainAuthority?.value ?? "—"}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{extData.domainAuthority?.source ?? "no data"}</div>
              </div>
              <div className="qa-panel" style={{ flex: 1, minWidth: 180, padding: 14, textAlign: "center" }}>
                <div className="qa-kicker">Referring Domains (approx.)</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{extData.referringDomainsApprox?.value ?? "—"}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{extData.referringDomainsApprox?.note ?? ""}</div>
              </div>
              <div className="qa-panel" style={{ flex: 1, minWidth: 180, padding: 14, textAlign: "center" }}>
                <div className="qa-kicker">Historical Snapshots</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{extData.historicalSnapshots?.length ?? 0}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>from wayback machine</div>
              </div>
            </div>

            {(extData.recentMentions ?? []).length > 0 && (
              <div className="qa-panel" style={{ marginTop: 12, padding: 14 }}>
                <div className="qa-panel-title">Recent Mentions ({extData.recentMentions.length})</div>
                <table className="qa-table">
                  <thead><tr>{["Domain", "URL", "Seen"].map(h => <th key={h} style={{ textAlign: "left" }}>{h}</th>)}</tr></thead>
                  <tbody>{extData.recentMentions.slice(0, 20).map((m: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>{m.domain}</td>
                      <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.url}>
                        <a href={m.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent, #111111)" }}>{m.url}</a>
                      </td>
                      <td style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-secondary)" }}>{m.time?.slice(0, 10) ?? ""}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
