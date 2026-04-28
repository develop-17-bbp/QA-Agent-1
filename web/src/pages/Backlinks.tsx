import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchBacklinks, fetchExternalBacklinks, uploadGscLinksCsv, uploadAwtCsv, fetchBacklinksLive, type AwtSummary, type BacklinksLiveResponse } from "../api";
import { FilterableTable, type FilterableColumn } from "../components/FilterableTable";
import { PageShell } from "../components/PageUI";

import { LoadingPanel, ErrorBanner } from "../components/UI";
import AskCouncilButton from "../components/AskCouncilButton";
import CouncilSidecar from "../components/CouncilSidecar";

interface BrokenLink { source: string; target: string; status: number | null; error?: string }
interface BingLink { sourceUrl: string; anchorText?: string; targetUrl: string }

function brokenStatusCategory(bl: BrokenLink): string {
  if (bl.status && bl.status >= 500) return "5xx server";
  if (bl.status === 404) return "404 not found";
  if (bl.status === 410) return "410 gone";
  if (bl.status && bl.status >= 400) return "4xx client";
  if (bl.status && bl.status >= 300) return "3xx redirect";
  if (bl.error && /timeout|aborted/i.test(bl.error)) return "Timeout";
  if (bl.error) return "Network";
  return "Other";
}

function BrokenLinksTable({ rows }: { rows: BrokenLink[] }) {
  const columns: FilterableColumn<BrokenLink>[] = useMemo(() => [
    {
      key: "source",
      label: "Source",
      accessor: (bl) => bl.source,
      filterType: "text",
      render: (bl) => (
        <a href={bl.source} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--text)", wordBreak: "break-all" }} title={bl.source}>
          {bl.source}
        </a>
      ),
    },
    {
      key: "target",
      label: "Target",
      accessor: (bl) => bl.target,
      filterType: "text",
      render: (bl) => (
        <a href={bl.target} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#dc2626", textDecoration: "underline", wordBreak: "break-all" }} title={bl.target}>
          {bl.target}
        </a>
      ),
    },
    {
      key: "status",
      label: "Status",
      accessor: (bl) => bl.status,
      filterType: "number",
      width: 80,
      headerStyle: { textAlign: "center" },
      cellStyle: { textAlign: "center", fontSize: 12, fontWeight: 600, color: "#e53e3e" },
    },
    {
      key: "category",
      label: "Type",
      accessor: (bl) => brokenStatusCategory(bl),
      filterType: "select",
      width: 120,
      cellStyle: { fontSize: 11, color: "var(--text-secondary)" },
    },
    {
      key: "error",
      label: "Error",
      accessor: (bl) => bl.error ?? "",
      filterType: "text",
      cellStyle: { fontSize: 11, color: "var(--text-secondary)" },
    },
  ], []);
  return (
    <FilterableTable<BrokenLink>
      rows={rows}
      columns={columns}
      rowKey={(bl, i = 0) => `${bl.source}|${bl.target}|${bl.status ?? 0}|${i}`}
      pageSize={50}
      itemLabel="broken link"
      emptyMessage="No broken links match the current filters."
    />
  );
}

function BingInboundLinksTable({ rows, totalLinks }: { rows: BingLink[]; totalLinks?: number }) {
  const columns: FilterableColumn<BingLink>[] = useMemo(() => [
    {
      key: "sourceUrl",
      label: "Source URL",
      accessor: (b) => b.sourceUrl,
      filterType: "text",
      render: (b) => (
        <a href={b.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--text)", wordBreak: "break-all" }} title={b.sourceUrl}>
          {b.sourceUrl}
        </a>
      ),
    },
    {
      key: "anchorText",
      label: "Anchor Text",
      accessor: (b) => b.anchorText ?? "",
      filterType: "text",
      render: (b) =>
        b.anchorText ? (
          <span style={{ fontSize: 12, fontWeight: 600 }}>"{b.anchorText}"</span>
        ) : (
          <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>—</span>
        ),
    },
    {
      key: "targetUrl",
      label: "Target on your site",
      accessor: (b) => b.targetUrl,
      filterType: "text",
      render: (b) => (
        <span style={{ fontSize: 11, wordBreak: "break-all" }} title={b.targetUrl}>
          {b.targetUrl}
        </span>
      ),
    },
    {
      key: "hasAnchor",
      label: "Has anchor?",
      accessor: (b) => (b.anchorText && b.anchorText.trim() ? "Yes" : "No"),
      filterType: "select",
      width: 110,
      cellStyle: { fontSize: 11 },
    },
  ], []);
  return (
    <>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
        Total Bing-indexed inbound links: <strong>{totalLinks ?? rows.length}</strong>
      </div>
      <FilterableTable<BingLink>
        rows={rows}
        columns={columns}
        rowKey={(b, i = 0) => `${b.sourceUrl}|${b.targetUrl}|${i}`}
        pageSize={50}
        itemLabel="inbound link"
        emptyMessage="No inbound links match the current filters."
      />
    </>
  );
}
export default function Backlinks() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extDomain, setExtDomain] = useState("");
  const [extData, setExtData] = useState<any>(null);
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState("");
  // DataForSEO live backlinks (per-link rows with anchor + DR + first-seen).
  const [dfsLive, setDfsLive] = useState<BacklinksLiveResponse | null>(null);
  const [dfsLoading, setDfsLoading] = useState(false);
  const [dfsError, setDfsError] = useState("");
  const [dfsLimit, setDfsLimit] = useState(200);

  const loadDfsLive = async () => {
    const dom = extDomain.trim();
    if (!dom) { setDfsError("Enter a domain above first."); return; }
    setDfsLoading(true); setDfsError(""); setDfsLive(null);
    try { setDfsLive(await fetchBacklinksLive(dom, dfsLimit)); }
    catch (e: any) { setDfsError(e?.message ?? String(e)); }
    finally { setDfsLoading(false); }
  };

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

  // Ahrefs Webmaster Tools CSV — free for verified sites, ~95% of paid Ahrefs for own-site analysis.
  const [awtSummary, setAwtSummary] = useState<AwtSummary | null>(null);
  const handleAwtCsvUpload = async (file: File) => {
    const dom = extDomain.trim();
    if (!dom) { setExtError("Enter a domain above first, then upload the AWT CSV."); return; }
    setExtError("");
    try {
      const csv = await file.text();
      const result = await uploadAwtCsv(dom, csv);
      setAwtSummary(result.summary);
      alert(`Imported ${result.rowCount} Ahrefs Webmaster Tools backlinks for ${dom}.\n\n${result.summary.totalReferringDomains} referring domains · avg DR ${result.summary.avgDr} · ${result.summary.dofollow} dofollow / ${result.summary.nofollow} nofollow`);
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
    <PageShell
      title="Backlinks"
      desc="Analyze your internal and external link structure from crawl data."
      purpose="What links to my site — real backlink data without paying for Ahrefs?"
      sources={["Crawl", "Bing WMT", "Common Crawl", "URLScan", "Wayback"]}
    >
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
              <div className="qa-panel-title" style={{ color: "#e53e3e", marginBottom: 10 }}>Broken Links ({data.brokenLinks.length})</div>
              <BrokenLinksTable rows={data.brokenLinks as BrokenLink[]} />
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
          {extDomain.trim() && <AskCouncilButton term={extDomain} compact />}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 10, marginTop: 10 }}>
          <div style={{ padding: 10, border: "1px dashed var(--border)", borderRadius: 6, fontSize: 12 }}>
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

          <div style={{ padding: 10, border: "1px dashed var(--ok-border, #16a34a)", background: "var(--ok-bg, #f0fdf4)", borderRadius: 6, fontSize: 12 }}>
            <strong style={{ color: "var(--ok, #16a34a)" }}>Import Ahrefs Webmaster Tools Backlinks (CSV) — 95% Ahrefs parity, free</strong>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginBottom: 8 }}>
              Sign up at <a href="https://ahrefs.com/webmaster-tools" target="_blank" rel="noreferrer">ahrefs.com/webmaster-tools</a> (free), verify your site, then open <em>Backlink profile → Backlinks → Export</em>. Upload the CSV here and we'll surface referring domains, DR, anchor text distribution, and dofollow/nofollow ratios — the same data paid Ahrefs customers see for their own verified properties.
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleAwtCsvUpload(f);
                if (e.target) e.target.value = "";
              }}
              style={{ fontSize: 12 }}
            />
          </div>
        </div>

        {awtSummary && (
          <div className="qa-panel" style={{ marginTop: 12, padding: 14 }}>
            <div className="qa-panel-title" style={{ color: "var(--ok, #16a34a)" }}>
              Ahrefs Webmaster Tools snapshot
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 8 }}>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Total backlinks</div><div style={{ fontSize: 20, fontWeight: 700 }}>{awtSummary.totalBacklinks.toLocaleString()}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Referring domains</div><div style={{ fontSize: 20, fontWeight: 700 }}>{awtSummary.totalReferringDomains.toLocaleString()}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Avg DR</div><div style={{ fontSize: 20, fontWeight: 700 }}>{awtSummary.avgDr}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Dofollow / Nofollow</div><div style={{ fontSize: 14 }}>{awtSummary.dofollow} / {awtSummary.nofollow}</div></div>
            </div>
            {awtSummary.topReferringDomains.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Top 20 referring domains</div>
                <table className="qa-table">
                  <thead><tr><th>Domain</th><th style={{ textAlign: "right" }}>Links</th></tr></thead>
                  <tbody>
                    {awtSummary.topReferringDomains.slice(0, 20).map((r) => (
                      <tr key={r.domain}>
                        <td style={{ fontSize: 12 }}>{r.domain}</td>
                        <td style={{ textAlign: "right", fontSize: 12, fontWeight: 600 }}>{r.links}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {awtSummary.anchorTextFrequency.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Top 20 anchor texts</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {awtSummary.anchorTextFrequency.slice(0, 20).map((a) => (
                    <span key={a.anchor} style={{ fontSize: 11.5, padding: "3px 10px", borderRadius: 12, background: "#f1f5f9", border: "1px solid var(--border)" }}>
                      {a.anchor} <strong style={{ color: "var(--ok)" }}>×{a.count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
                <div className="qa-panel-title">Bing Webmaster Tools — Inbound Links</div>
                <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
                  Real inbound links from Bing's live link graph. Only returns data when the site is verified in Bing Webmaster Tools under <code>BING_WEBMASTER_API_KEY</code>.
                </p>
                <BingInboundLinksTable rows={extData.bingBacklinks as BingLink[]} totalLinks={extData.bingTotalLinks} />
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

      {/* Embedded Council Sidecar — cross-source intel on the entered domain */}
      {extDomain.trim() && <CouncilSidecar term={extDomain.trim()} autoInvoke />}

      {/* ── DataForSEO live backlinks (BYOK) ────────────────────────────── */}
      <div className="qa-panel" style={{ padding: 16, marginTop: 24 }}>
        <div className="qa-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          🔗 DataForSEO live backlinks
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "var(--accent-light)", color: "var(--accent-hover)", fontWeight: 700, letterSpacing: 0.4, border: "1px solid var(--accent-muted)" }}>BYOK</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
          Per-link rows with anchor text, source DR, dofollow flag, and first-seen date — for ANY domain you choose, not just verified properties. Requires DataForSEO credentials in <code>/integrations</code>.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="qa-input" placeholder='Enter "External / 3rd-party Backlinks" domain above first' value={extDomain} onChange={(e) => setExtDomain(e.target.value)} style={{ flex: 1, minWidth: 240, padding: "8px 12px" }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            Limit
            <input className="qa-input" type="number" min={10} max={1000} value={dfsLimit} onChange={(e) => setDfsLimit(Number(e.target.value) || 200)} style={{ width: 90, padding: "6px 10px" }} />
          </label>
          <button className="qa-btn-primary" onClick={loadDfsLive} disabled={dfsLoading || !extDomain.trim()} style={{ padding: "8px 18px" }}>
            {dfsLoading ? "Fetching…" : "Fetch live backlinks"}
          </button>
        </div>
        {dfsError && <div style={{ marginTop: 10 }}><ErrorBanner error={dfsError} /></div>}
        {dfsLive && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 14 }}>
              {[
                { label: "Total backlinks", val: dfsLive.totalCount?.toLocaleString() ?? "—" },
                { label: "Referring domains", val: dfsLive.summary.referringDomains ?? "—" },
                { label: "Avg DR (source)", val: dfsLive.summary.averageDr ?? "—", color: "#2563eb" },
                { label: "Dofollow %", val: dfsLive.summary.dofollowPct != null ? `${dfsLive.summary.dofollowPct}%` : "—", color: "#16a34a" },
              ].map((s) => (
                <div key={s.label} className="qa-panel" style={{ padding: 12, textAlign: "center" }}>
                  <div className="qa-kicker">{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: (s as any).color ?? "var(--text)" }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, overflowX: "auto" }}>
              <table className="qa-table" style={{ minWidth: 760, fontSize: 12 }}>
                <thead><tr><th>DR</th><th>Source page</th><th>Anchor</th><th>Target</th><th>Type</th><th>First seen</th></tr></thead>
                <tbody>
                  {dfsLive.rows.slice(0, 100).map((r, i) => (
                    <tr key={`${r.pageFrom}-${i}`}>
                      <td style={{ fontWeight: 700, color: r.domainRankFrom != null && r.domainRankFrom >= 60 ? "#16a34a" : r.domainRankFrom != null && r.domainRankFrom >= 30 ? "#d97706" : "var(--muted)" }}>
                        {r.domainRankFrom ?? "—"}
                      </td>
                      <td><a href={r.pageFrom} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all", color: "var(--text)" }}>{r.pageFrom}</a></td>
                      <td style={{ fontStyle: r.anchor ? "normal" : "italic", color: r.anchor ? "var(--text)" : "var(--muted)" }}>{r.anchor || "(empty)"}</td>
                      <td><a href={r.pageTo} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all", color: "var(--accent)" }}>{r.pageTo}</a></td>
                      <td>
                        <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: r.dofollow ? "#dcfce7" : "#fef3c7", color: r.dofollow ? "#166534" : "#92400e", fontWeight: 700 }}>
                          {r.dofollow ? "dofollow" : "nofollow"}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--muted)" }}>{r.firstSeen ? r.firstSeen.slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dfsLive.rows.length > 100 && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                  Showing first 100 of {dfsLive.rows.length} fetched (total in DFS index: {dfsLive.totalCount.toLocaleString()}).
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
