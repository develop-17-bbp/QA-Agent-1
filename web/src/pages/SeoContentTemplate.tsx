import { useState } from "react";
import { motion } from "framer-motion";
import { fetchSeoContentTemplate } from "../api";

export default function SeoContentTemplate() {
  const [keyword, setKeyword] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    try { setData(await fetchSeoContentTemplate(keyword.trim())); } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">SEO Content Template</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Generate a complete content template with optimized headings, keywords, outline, and SEO checklist.</p>

      <div className="qa-panel" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="qa-input" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && generate()} placeholder="Enter target keyword..." style={{ flex: 1, minWidth: 200, padding: "8px 12px" }} />
        <button className="qa-btn" onClick={generate} disabled={loading || !keyword.trim()} style={{ padding: "8px 24px" }}>{loading ? "Generating..." : "Generate Template"}</button>
      </div>

      {error && <div className="qa-panel" style={{ marginTop: 16, color: "#e53e3e", padding: 16 }}>{error}</div>}
      {loading && <div className="qa-panel" style={{ marginTop: 20, textAlign: "center", padding: 40 }}>Generating content template...</div>}

      {data && !loading && (
        <>
          <div className="qa-panel" style={{ marginTop: 24, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Title & Meta</div>
            <div style={{ padding: "8px 12px", background: "var(--bg-card, rgba(90,103,216,0.04))", borderRadius: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Title</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1a0dab" }}>{data.title}</div>
            </div>
            <div style={{ padding: "8px 12px", background: "var(--bg-card, rgba(90,103,216,0.04))", borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Meta Description</div>
              <div style={{ fontSize: 13, color: "#545454" }}>{data.metaDescription}</div>
            </div>
          </div>

          {(data.headings ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Heading Structure</div>
              {data.headings.map((h: any, i: number) => (
                <div key={i} style={{ padding: "4px 0", paddingLeft: h.level === "h1" ? 0 : h.level === "h2" ? 16 : 32 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#5a67d8", marginRight: 8, textTransform: "uppercase" }}>{h.level}</span>
                  <span style={{ fontSize: 13 }}>{h.text}</span>
                </div>
              ))}
            </div>
          )}

          {data.keywords && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Keywords</div>
              {["primary", "secondary", "lsi"].map(type => (data.keywords[type] ?? []).length > 0 && (
                <div key={type} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "capitalize", marginBottom: 4 }}>{type}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {data.keywords[type].map((kw: string) => <span key={kw} style={{ padding: "3px 10px", borderRadius: 12, background: type === "primary" ? "#5a67d820" : type === "secondary" ? "#38a16920" : "#dd6b2020", color: type === "primary" ? "#5a67d8" : type === "secondary" ? "#38a169" : "#dd6b20", fontSize: 12 }}>{kw}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(data.outline ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Content Outline</div>
              {data.outline.map((s: any, i: number) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{s.section}</span>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{s.wordCount} words</span>
                  </div>
                  {(s.keyPoints ?? []).length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{s.keyPoints.map((p: string, j: number) => <li key={j} style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{p}</li>)}</ul>}
                </div>
              ))}
            </div>
          )}

          {(data.seoChecklist ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>SEO Checklist</div>
              {data.seoChecklist.map((item: string, i: number) => (
                <div key={i} style={{ padding: "6px 0", fontSize: 13, display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>{i + 1}.</span> {item}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
