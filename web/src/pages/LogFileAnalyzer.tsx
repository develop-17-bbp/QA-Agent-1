import { useState } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { fetchLogAnalysis } from "../api";

import { LoadingPanel, ErrorBanner } from "../components/UI";
const CONFIDENCE_COLORS: Record<string, string> = { high: "#38a169", medium: "#dd6b20", low: "#9ca3af" };
const CONFIDENCE_LABELS: Record<string, string> = { high: "real", medium: "derived", low: "estimated" };

function ConfidenceDot({ confidence, source, note }: { confidence?: string; source?: string; note?: string }) {
  const c = confidence ?? "low";
  const label = CONFIDENCE_LABELS[c] ?? c;
  const title = `${label} · ${source ?? "unknown"}${note ? ` · ${note}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: CONFIDENCE_COLORS[c] ?? "#9ca3af",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function unwrap(dp: any): any {
  return dp && typeof dp === "object" && "value" in dp ? dp.value : dp;
}

export default function LogFileAnalyzer() {
  const [logContent, setLogContent] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (!logContent.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchLogAnalysis(logContent)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setLogContent(text);
  };

  const dq = data?.dataQuality ?? { realDataFields: [], providersHit: [], providersFailed: [], missingFields: [] };

  const statusData = data?.statusDistribution
    ? Object.entries(data.statusDistribution).map(([code, meta]) => {
        const c = parseInt(code);
        const color = c < 300 ? "#38a169" : c < 400 ? "#d69e2e" : c < 500 ? "#dd6b20" : "#e53e3e";
        return { name: code, value: unwrap(meta) as number, color };
      }).filter(d => d.value > 0)
    : [];

  const botData = data?.botTraffic
    ? Object.entries(data.botTraffic)
        .map(([bot, meta]) => ({ bot, hits: unwrap(meta) as number }))
        .sort((a, b) => b.hits - a.hits)
    : [];

  const totalRequestsMeta = data?.totalRequests;
  const totalRequests = unwrap(totalRequestsMeta) ?? 0;
  const parsedLinesMeta = data?.parsedLines;
  const parsedLines = unwrap(parsedLinesMeta) ?? 0;
  const uniqueUrlsMeta = data?.summary?.uniqueUrls;
  const uniqueUrls = unwrap(uniqueUrlsMeta) ?? 0;
  const errorRateMeta = data?.summary?.errorRate;
  const errorRate = unwrap(errorRateMeta) ?? 0;
  const botPercentMeta = data?.summary?.botPercent;
  const botPercent = unwrap(botPercentMeta) ?? 0;

  const noLogParsed = data && parsedLines === 0;

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Log File Analyzer</h1>
      <p className="qa-page-desc">
        Every numeric cell is <strong>parsed directly from the uploaded log file</strong> — status codes,
        URL hit counts, bot UA matches, error rate, bot percentage. No LLM guesses a crawl number.
        The LLM is restricted to a single ≤3-sentence qualitative summary over the real parsed findings.
      </p>

      <div className="qa-panel" style={{ padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Upload log file: <input type="file" accept=".log,.txt,.gz" onChange={handleFile} style={{ marginLeft: 8 }} />
          </label>
        </div>
        <textarea className="qa-textarea" value={logContent} onChange={e => setLogContent(e.target.value)} placeholder="Or paste log content here (Apache/Nginx combined format)..." style={{ width: "100%", padding: "8px 12px", minHeight: 120, resize: "vertical", fontFamily: "monospace", fontSize: 11 }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !logContent.trim()} style={{ marginTop: 8 }}>{loading ? "Analyzing..." : "Analyze Logs"}</button>
      </div>

      {error && <ErrorBanner error={error} />}
      {loading && <LoadingPanel message="Parsing log file…" />}

      {!data && !loading && (
        <div className="qa-panel" style={{ marginTop: 16, padding: 20, textAlign: "center", color: "var(--text-secondary)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No log file uploaded yet</div>
          <div style={{ fontSize: 12 }}>Upload or paste an Apache/Nginx combined-format access log. Every cell will show the exact parsed count with a "real · log-file" provenance dot.</div>
        </div>
      )}

      {data && !loading && (
        <>
          {(dq.realDataFields?.length > 0 || dq.providersHit?.length > 0 || dq.providersFailed?.length > 0) && (
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
              {(dq.realDataFields ?? []).length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={`Parsed fields: ${dq.realDataFields.join(", ")}`}>
                  {dq.realDataFields.length} fields parsed from log
                </span>
              )}
              {parsedLinesMeta && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }} title={parsedLinesMeta?.note}>
                  {parsedLines} / {totalRequests} lines matched
                </span>
              )}
            </div>
          )}

          {noLogParsed && (
            <div className="qa-alert qa-alert--error" style={{ marginTop: 16 }}>
              No lines matched Apache or Nginx combined log format. Check the file format and try again.
            </div>
          )}

          {!noLogParsed && (
            <>
              <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
                {[
                  { label: "Total Requests", val: totalRequests, meta: totalRequestsMeta },
                  { label: "Unique URLs", val: uniqueUrls, meta: uniqueUrlsMeta },
                  { label: "Error Rate", val: `${errorRate}%`, meta: errorRateMeta, color: errorRate > 5 ? "#e53e3e" : "#38a169" },
                  { label: "Bot Traffic", val: `${botPercent}%`, meta: botPercentMeta },
                ].map((s: any) => (
                  <div key={s.label} className="qa-panel" style={{ flex: 1, minWidth: 120, padding: 16, textAlign: "center" }}>
                    <div className="qa-kicker">{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color ?? "var(--text-primary)" }}>
                      {s.val}
                      <ConfidenceDot confidence={s.meta?.confidence} source={s.meta?.source} note={s.meta?.note} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
                {statusData.length > 0 && (
                  <div className="qa-panel" style={{ padding: 16, width: 260 }}>
                    <div className="qa-panel-title">Status Codes</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>parsed from log file</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart><Pie data={statusData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                        {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {botData.length > 0 && (
                  <div className="qa-panel" style={{ padding: 16, flex: 1 }}>
                    <div className="qa-panel-title">Bot Traffic</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>parsed from log file · UA string matched against known bots</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={botData.slice(0, 8)} layout="vertical"><XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="bot" width={120} fontSize={11} /><Tooltip /><Bar dataKey="hits" fill="#111111" radius={[0,4,4,0]} /></BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {(data.urlHits ?? []).length > 0 && (
                <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
                  <div className="qa-panel-title">Top URLs</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>parsed from log file · top 20 by hit count</div>
                  <table className="qa-table">
                    <thead><tr>{["URL", "Hits"].map(h => <th key={h} style={{ textAlign: h === "URL" ? "left" : "center" }}>{h}</th>)}</tr></thead>
                    <tbody>{data.urlHits.map((u: any, i: number) => {
                      const hitsMeta = u.hits;
                      const hitsVal = unwrap(hitsMeta);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: "monospace" }}>{u.url}</td>
                          <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 13, fontWeight: 600 }} title={hitsMeta?.note}>
                            {hitsVal}
                            <ConfidenceDot confidence={hitsMeta?.confidence} source={hitsMeta?.source} note={hitsMeta?.note} />
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}

              {data.commentary && (
                <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
                  <div className="qa-panel-title">AI Commentary</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
                    ≤3 sentences. Qualitative explanation of the real parsed findings above. No invented URLs or counts — verify before acting.
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>{data.commentary}</div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </motion.div>
  );
}
