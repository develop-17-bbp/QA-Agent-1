import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchOrganicRankings, fetchGscPagesBatch } from "../api";
import { useGoogleOverlay } from "../lib/google-overlay";

function getGsc(gscPages: Map<string, any>, url: string) {
  if (gscPages.has(url)) return gscPages.get(url);
  try {
    const path = new URL(url).pathname;
    for (const [k, v] of gscPages) {
      try { if (new URL(k).pathname === path) return v; } catch {}
    }
  } catch {}
  return null;
}

export default function OrganicRankings() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "title" | "gscPosition">("score");
  const [domain, setDomain] = useState("");
  const overlay = useGoogleOverlay(domain);
  const [gscPages, setGscPages] = useState<Map<string, any>>(new Map());

  const load = async (rid: string) => {
    setRunId(rid);
    if (!rid) return;
    setLoading(true); setError("");
    setGscPages(new Map());
    try { setData(await fetchOrganicRankings(rid)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  // Extract domain from first ranking URL
  useEffect(() => {
    if (!data) return;
    const firstUrl = data.rankings?.[0]?.url ?? "";
    if (firstUrl) {
      try { setDomain(new URL(firstUrl).hostname.replace(/^www\./, "")); } catch {}
    }
  }, [data]);

  // Fetch GSC page-level data when a matching site is found
  useEffect(() => {
    if (!overlay.matchedGscSite) return;
    fetchGscPagesBatch(overlay.matchedGscSite.siteUrl, 28, 500)
      .then((pages: any[]) => {
        const m = new Map<string, any>();
        for (const p of pages) m.set(p.page ?? p.url ?? "", p);
        setGscPages(m);
      })
      .catch(() => {});
  }, [overlay.matchedGscSite?.siteUrl]);

  const rankings = data?.rankings ?? [];
  const sorted = [...rankings].sort((a: any, b: any) => {
    if (sortBy === "score") return b.score - a.score;
    if (sortBy === "title") return (a.title ?? "").localeCompare(b.title ?? "");
    if (sortBy === "gscPosition") {
      const posA = getGsc(gscPages, a.url)?.position?.value ?? Infinity;
      const posB = getGsc(gscPages, b.url)?.position?.value ?? Infinity;
      return posA - posB;
    }
    return 0;
  });
  const dist = data?.distribution ?? {};
  const distData = [
    { name: "Excellent (80+)", value: dist.excellent ?? 0, fill: "#38a169" },
    { name: "Good (60-79)", value: dist.good ?? 0, fill: "#3182ce" },
    { name: "Average (40-59)", value: dist.average ?? 0, fill: "#dd6b20" },
    { name: "Poor (<40)", value: dist.poor ?? 0, fill: "#e53e3e" },
  ];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">Organic Rankings</h1>
      <p className="qa-page-desc">Pages ranked by organic SEO value score based on on-page signals.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />
      {loading && (
        <div className="qa-panel qa-loading-panel" style={{ marginTop: 20 }}>
          <span className="qa-spinner" />
          <span>Analyzing...</span>
        </div>
      )}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}
      {/* Data-source pill — shown when Google is connected and a GSC site matched */}
      {overlay.connected && data && !loading && (
        <div className="qa-panel" style={{ marginTop: 14, padding: 10, fontSize: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          {overlay.matchedGscSite ? (
            <>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
              <span>Real data overlay active for <strong>{domain}</strong> (last 28 days):</span>
              <span className="qa-lozenge" style={{ background: "#ecfdf5", color: "#047857", fontSize: 11 }}>
                GSC · {overlay.matchedGscSite.siteUrl} · {gscPages.size} pages
              </span>
            </>
          ) : (
            <>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fbbf24", flexShrink: 0 }} />
              <span style={{ color: "#92400e" }}>Google connected — no verified GSC property matches this domain</span>
            </>
          )}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="qa-panel" style={{ marginTop: 16 }}>
            <div className="qa-panel-head">
              <div className="qa-panel-title">Score Distribution</div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={distData}><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Bar dataKey="value" radius={[4,4,0,0]}>{distData.map((d, i) => <Bar key={i} dataKey="value" fill={d.fill} />)}</Bar></BarChart>
            </ResponsiveContainer>
          </div>
          <div className="qa-panel" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="qa-panel-title">Rankings ({sorted.length} pages)</div>
              <select className="qa-select" value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={{ width: 160 }}>
                <option value="score">By Score</option>
                <option value="title">By Title</option>
                {gscPages.size > 0 && <option value="gscPosition">By GSC Position</option>}
              </select>
            </div>
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              <table className="qa-table">
                <thead><tr>
                  <th>#</th>
                  <th>URL</th>
                  <th>Title</th>
                  <th style={{ textAlign: "right" }}>Score</th>
                  {gscPages.size > 0 && <th style={{ textAlign: "right", color: "#047857" }}>GSC Pos</th>}
                  {gscPages.size > 0 && <th style={{ textAlign: "right", color: "#047857" }}>Clicks</th>}
                </tr></thead>
                <tbody>{sorted.slice(0, 100).map((r: any, i: number) => {
                  const gsc = gscPages.size > 0 ? getGsc(gscPages, r.url) : null;
                  return (
                    <tr key={i}>
                      <td style={{ color: "var(--text-secondary)" }}>{i + 1}</td>
                      <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.url}</td>
                      <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</td>
                      <td style={{ textAlign: "right" }}><span style={{ fontWeight: 600, color: r.score >= 80 ? "#38a169" : r.score >= 60 ? "#3182ce" : r.score >= 40 ? "#dd6b20" : "#e53e3e" }}>{r.score}</span></td>
                      {gscPages.size > 0 && <td style={{ textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }}>{gsc?.position?.value?.toFixed(1) ?? "—"}</td>}
                      {gscPages.size > 0 && <td style={{ textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }}>{gsc?.clicks?.value ?? "—"}</td>}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
