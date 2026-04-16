import { useState } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchReferringDomains, fetchDomainAuthority } from "../api";

const AUTH_COLORS = { high: "#38a169", medium: "#dd6b20", low: "#e53e3e" };

export default function ReferringDomains() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [daInput, setDaInput] = useState("");
  const [daData, setDaData] = useState<any>(null);
  const [daLoading, setDaLoading] = useState(false);
  const [daError, setDaError] = useState("");

  const lookupDa = async () => {
    const d = daInput.trim();
    if (!d) return;
    setDaLoading(true); setDaError(""); setDaData(null);
    try { setDaData(await fetchDomainAuthority(d)); } catch (e: any) { setDaError(e.message); }
    finally { setDaLoading(false); }
  };

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchReferringDomains(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const authData = data?.authorityDistribution ? [
    { name: "High (80+)", value: data.authorityDistribution.high, color: AUTH_COLORS.high },
    { name: "Medium (50-79)", value: data.authorityDistribution.medium, color: AUTH_COLORS.medium },
    { name: "Low (<50)", value: data.authorityDistribution.low, color: AUTH_COLORS.low },
  ].filter(d => d.value > 0) : [];

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Referring Domains</h1>
      <p className="qa-page-desc">Analyze external domains linking to your sites.</p>
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <div className="qa-loading-panel" style={{ marginTop: 20 }}><div className="qa-spinner" />Analyzing domains...</div>}
      {error && <div className="qa-alert qa-alert--error" style={{ marginTop: 20 }}>{error}</div>}

      {/* Domain Authority Lookup — OpenPageRank free tier */}
      <div className="qa-panel" style={{ marginTop: 20, padding: 16 }}>
        <div className="qa-panel-title" style={{ marginBottom: 8 }}>Domain Authority Lookup</div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>Check any domain's authority score via OpenPageRank (free). Set <code>OPR_API_KEY</code> in .env to enable.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="qa-input" placeholder="e.g. example.com" value={daInput} onChange={e => setDaInput(e.target.value)} onKeyDown={e => e.key === "Enter" && lookupDa()} style={{ flex: 1, padding: "7px 10px" }} />
          <button className="qa-btn-primary" onClick={lookupDa} disabled={daLoading || !daInput.trim()}>{daLoading ? "Checking…" : "Lookup"}</button>
        </div>
        {daError && <div className="qa-alert qa-alert--error" style={{ marginTop: 8 }}>{daError}</div>}
        {daData && !daLoading && (
          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            {daData.configured === false ? (
              <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>{daData.source}</div>
            ) : (
              <>
                <div className="qa-panel" style={{ padding: "10px 16px", textAlign: "center", minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Authority (0–100)</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: (daData.authority0to100 ?? 0) >= 60 ? "#38a169" : (daData.authority0to100 ?? 0) >= 30 ? "#dd6b20" : "#e53e3e" }}>{daData.authority0to100 ?? "—"}</div>
                </div>
                <div className="qa-panel" style={{ padding: "10px 16px", textAlign: "center", minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Page Rank (0–10)</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{daData.pageRankDecimal ?? "—"}</div>
                </div>
                {daData.globalRank != null && (
                  <div className="qa-panel" style={{ padding: "10px 16px", textAlign: "center", minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Global Rank</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>#{daData.globalRank.toLocaleString()}</div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>source: {daData.source}</div>
              </>
            )}
          </div>
        )}
      </div>

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div className="qa-kicker">Total Domains</div><div style={{ fontSize: 24, fontWeight: 700 }}>{data.totalDomains}</div></div>
            <div className="qa-panel" style={{ flex: 1, minWidth: 130, padding: 16, textAlign: "center" }}><div className="qa-kicker">Avg Trust Score</div><div style={{ fontSize: 24, fontWeight: 700, color: (data.summary?.avgTrustScore ?? 0) >= 70 ? "#38a169" : "#dd6b20" }}>{data.summary?.avgTrustScore ?? 0}</div></div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {authData.length > 0 && (
              <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                <div className="qa-panel-title">Authority Distribution</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart><Pie data={authData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {authData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", fontSize: 11 }}>
                  {authData.map(d => <span key={d.name} style={{ color: d.color }}>{d.name}: {d.value}</span>)}
                </div>
              </div>
            )}
          </div>

          <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
            <div className="qa-panel-title">Referring Domains ({(data.sections ?? []).length})</div>
            <table className="qa-table">
              <thead><tr>{["Domain", "Total Links", "Healthy", "Broken", "Trust Score"].map(h => <th key={h} style={{ textAlign: h === "Domain" ? "left" : "center" }}>{h}</th>)}</tr></thead>
              <tbody>{(data.sections ?? []).map((s: any) => (
                <tr key={s.domain} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{s.domain}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13 }}>{s.totalLinks}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, color: "#38a169" }}>{s.healthyLinks}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, color: "#e53e3e" }}>{s.brokenLinks}</td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 700, color: s.trustScore >= 80 ? "#38a169" : s.trustScore >= 50 ? "#dd6b20" : "#e53e3e" }}>{s.trustScore}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </motion.div>
  );
}
