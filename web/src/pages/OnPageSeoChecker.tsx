import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchOnPageSeoChecker } from "../api";
import MarkdownBody from "../components/MarkdownBody";

const STATUS_COLORS = { pass: "#38a169", warning: "#dd6b20", fail: "#e53e3e" };
const STATUS_LABELS = { pass: "PASS", warning: "WARN", fail: "FAIL" };

const STATUS_LOZENGE: Record<string, string> = {
  pass: "qa-lozenge qa-lozenge--success",
  warning: "qa-lozenge qa-lozenge--neutral",
  fail: "qa-lozenge qa-lozenge--danger",
};

export default function OnPageSeoChecker() {
  const [runId, setRunId] = useState("");
  const [url, setUrl] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (!runId) return;
    setLoading(true); setError(""); setData(null);
    try { setData(await fetchOnPageSeoChecker(runId, url)); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h1 className="qa-page-title">On-Page SEO Checker</h1>
      <p className="qa-page-desc">Analyze individual page SEO signals and get AI-powered recommendations.</p>
      <RunSelector value={runId} onChange={setRunId} label="Select run" />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input className="qa-input" placeholder="Enter URL to check (or leave empty for first page)" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="qa-btn-primary" onClick={analyze} disabled={loading || !runId}>{loading ? "Analyzing..." : "Check"}</button>
      </div>

      {error && <div className="qa-alert qa-alert--error">{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
            <div className="qa-panel" style={{ textAlign: "center", minWidth: 140 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>Overall Score</div>
              <div style={{ fontSize: 48, fontWeight: 700, color: data.overallScore >= 80 ? "#38a169" : data.overallScore >= 60 ? "#dd6b20" : "#e53e3e" }}>{data.overallScore}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>/100</div>
            </div>
            <div className="qa-panel" style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>URL: <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>{data.url}</span></div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {(data.checks ?? []).filter((c: any) => c.status === "pass").length > 0 && <span style={{ fontSize: 13, color: "#38a169" }}>{(data.checks ?? []).filter((c: any) => c.status === "pass").length} passed</span>}
                {(data.checks ?? []).filter((c: any) => c.status === "warning").length > 0 && <span style={{ fontSize: 13, color: "#dd6b20" }}>{(data.checks ?? []).filter((c: any) => c.status === "warning").length} warnings</span>}
                {(data.checks ?? []).filter((c: any) => c.status === "fail").length > 0 && <span style={{ fontSize: 13, color: "#e53e3e" }}>{(data.checks ?? []).filter((c: any) => c.status === "fail").length} failed</span>}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, marginTop: 16 }}>
            {(data.checks ?? []).map((check: any, i: number) => (
              <div key={i} className="qa-panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{check.element}</span>
                  <span className={STATUS_LOZENGE[check.status] ?? "qa-lozenge qa-lozenge--neutral"}>{STATUS_LABELS[check.status as keyof typeof STATUS_LABELS]}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLORS[check.status as keyof typeof STATUS_COLORS] }}>{check.score}/100</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{check.value}</div>
                <div style={{ fontSize: 12, marginTop: 6, color: "var(--text-primary)", lineHeight: 1.4 }}>{check.recommendation}</div>
              </div>
            ))}
          </div>

          {data.recommendations && (
            <div className="qa-panel" style={{ marginTop: 16 }}>
              <div className="qa-panel-head">
                <div className="qa-panel-title">AI Recommendations</div>
              </div>
              <MarkdownBody markdown={data.recommendations} />
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
