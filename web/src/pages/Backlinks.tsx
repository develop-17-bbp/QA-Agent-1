import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchBacklinks, fetchExternalBacklinks, uploadGscLinksCsv } from "../api";

import { LoadingPanel, ErrorBanner } from "../components/UI";
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

  const handleGscCsvUpload = async (file: File) => {
    const dom = extDomain.trim();
    if (!dom) { setExtError("Enter a domain above first, then upload the CSV."); return; }
    setExtError("");
    try {
      const csv = await file.text();
      const result = await uploadGscLinksCsv(dom, csv);
      // After upload, re-fetch the external backlink report so the new bundle surfaces.
      const refreshed = await fetchExternalBacklinks(dom);
      setExtData(refreshed);
      alert(`Imported ${result.rowCount} rows from ${result.reportType}. GSC Links data is now available in this report.`);
    } catch (e: any) {
      setExtError(e.message);
    }
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

      {loading && <LoadingPanel message="Analyzing backlinks…" />}
      {error && <ErrorBanner error={error} />}

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

        <div style={{ marginTop: 10, padding: 10, border: "1px dashed var(--border)", borderRadius: 6, fontSize: 12 }}>
          <strong>Import Google Search Console Links (CSV)</strong>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
            Google deprecated the Links API. Download the CSV from Search Console → Links → "Top linking sites" / "Top linked pages" / "Top linking text" (one file per report).
            Enter the domain above, then upload — the parsed bundle is persisted and enriches this report below.
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleGscCsvUpload(f);
              if (e.target) e.target.value = "";
            }}
            style={{ fontSize: 12 }}
          />
        </div>

        {extLoading && <LoadingPanel message="Querying OpenPageRank, Common Crawl, URLScan, Wayback, Bing Webmaster Tools…" />}
        {extError && <ErrorBanner error={extError} />}

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

            {(extData.bingBacklinks ?? []).length > 0 && (
              <div className="qa-panel" style={{ marginTop: 12, padding: 14 }}>
                <div className="qa-panel-title">
                  Bing Webmaster Tools — Inbound Links ({extData.bingTotalLinks ?? extData.bingBacklinks.length})
                </div>
                <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
                  Real inbound links from Bing's live link graph. Only returns data when the site is verified in Bing Webmaster Tools under <code>BING_WEBMASTER_API_KEY</code>.
                </p>
                <table className="qa-table">
                  <thead><tr>{["Source URL", "Anchor Text", "Target on your site"].map(h => <th key={h} style={{ textAlign: "left" }}>{h}</th>)}</tr></thead>
                  <tbody>{extData.bingBacklinks.slice(0, 30).map((b: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.sourceUrl}>
                        <a href={b.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>{b.sourceUrl}</a>
                      </td>
                      <td style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>{b.anchorText ? `"${b.anchorText}"` : <span style={{ color: "var(--muted)", fontWeight: 400 }}>—</span>}</td>
                      <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.targetUrl}>{b.targetUrl}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            {extData.gscLinks && (
              <div className="qa-panel" style={{ marginTop: 12, padding: 14 }}>
                <div className="qa-panel-title">
                  GSC Links (imported from CSV)
                </div>
                <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
                  Real first-party data from Google Search Console. Imported on {new Date(extData.gscLinks.importedAt).toLocaleString()}.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                  {extData.gscLinks.topLinkingSites?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Top linking sites</div>
                      <table className="qa-table">
                        <thead><tr><th>Source</th><th>Links</th></tr></thead>
                        <tbody>{extData.gscLinks.topLinkingSites.slice(0, 10).map((r: any, i: number) => (
                          <tr key={i}><td style={{ fontSize: 11 }}>{r.source}</td><td style={{ fontSize: 11, fontWeight: 600 }}>{r.links}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {extData.gscLinks.topLinkedPages?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Top linked pages</div>
                      <table className="qa-table">
                        <thead><tr><th>Target</th><th>Links</th></tr></thead>
                        <tbody>{extData.gscLinks.topLinkedPages.slice(0, 10).map((r: any, i: number) => (
                          <tr key={i}><td style={{ fontSize: 11 }}>{r.target}</td><td style={{ fontSize: 11, fontWeight: 600 }}>{r.links}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {extData.gscLinks.topLinkingText?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Top anchor text</div>
                      <table className="qa-table">
                        <thead><tr><th>Anchor</th><th>Links</th></tr></thead>
                        <tbody>{extData.gscLinks.topLinkingText.slice(0, 10).map((r: any, i: number) => (
                          <tr key={i}><td style={{ fontSize: 11, fontWeight: 600 }}>"{r.anchor}"</td><td style={{ fontSize: 11 }}>{r.links}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(extData.anchorSamples ?? []).length > 0 && (
              <div className="qa-panel" style={{ marginTop: 12, padding: 14 }}>
                <div className="qa-panel-title">
                  Anchor-Text Samples from Common Crawl ({extData.anchorSamples.length})
                </div>
                <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
                  Real `&lt;a&gt;` tags extracted from Common Crawl WARC records — the actual anchor text the open web uses to link to this domain.
                </p>
                <table className="qa-table">
                  <thead><tr>{["Source page", "Anchor text", "Context"].map(h => <th key={h} style={{ textAlign: "left" }}>{h}</th>)}</tr></thead>
                  <tbody>{extData.anchorSamples.slice(0, 30).map((a: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 10px", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.sourceUrl}>
                        <a href={a.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>{a.sourceUrl}</a>
                      </td>
                      <td style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>"{a.anchorText || "—"}"</td>
                      <td style={{ padding: "4px 10px", fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>{a.context ?? ""}</td>
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
