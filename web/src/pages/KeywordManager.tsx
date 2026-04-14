import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { fetchKeywordLists, saveKeywordListApi, deleteKeywordListApi, analyzeKeywordListApi } from "../api";

export default function KeywordManager() {
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedList, setSelectedList] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const loadLists = async () => {
    try { const res = await fetchKeywordLists(); setLists(res.lists ?? []); } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadLists(); }, []);

  const save = async () => {
    if (!newName.trim() || !newKeywords.trim()) return;
    setSaving(true); setError("");
    try {
      const kws = newKeywords.split("\n").map(k => k.trim()).filter(Boolean);
      await saveKeywordListApi(newName.trim(), kws);
      setNewName(""); setNewKeywords("");
      await loadLists();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const del = async (name: string) => {
    try { await deleteKeywordListApi(name); await loadLists(); if (selectedList?.name === name) { setSelectedList(null); setAnalysis(null); } } catch (e: any) { setError(e.message); }
  };

  const analyze = async (kws: string[]) => {
    setAnalyzing(true); setAnalysis(null);
    try { setAnalysis(await analyzeKeywordListApi(kws)); } catch (e: any) { setError(e.message); }
    finally { setAnalyzing(false); }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32 }}>
      <h1 className="qa-page-title">Keyword Manager</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Create, manage, and analyze keyword lists. Lists are saved locally for persistence.</p>

      {error && <div className="qa-panel" style={{ marginBottom: 16, color: "#e53e3e", padding: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Create new list */}
        <div className="qa-panel" style={{ padding: 16, flex: "1 1 320px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Create New List</div>
          <input className="qa-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="List name..." style={{ width: "100%", padding: "8px 12px", marginBottom: 8 }} />
          <textarea className="qa-input" value={newKeywords} onChange={e => setNewKeywords(e.target.value)} placeholder="Keywords (one per line)..." style={{ width: "100%", padding: "8px 12px", minHeight: 120, resize: "vertical" }} />
          <button className="qa-btn" onClick={save} disabled={saving || !newName.trim() || !newKeywords.trim()} style={{ marginTop: 8, padding: "8px 20px" }}>{saving ? "Saving..." : "Save List"}</button>
        </div>

        {/* Existing lists */}
        <div className="qa-panel" style={{ padding: 16, flex: "1 1 320px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Your Lists ({lists.length})</div>
          {loading && <div style={{ color: "var(--text-secondary)" }}>Loading...</div>}
          {!loading && lists.length === 0 && <div style={{ color: "var(--text-secondary)", padding: 20, textAlign: "center" }}>No lists yet. Create one to get started.</div>}
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {lists.map((l: any) => (
              <div key={l.name} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setSelectedList(l)}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{l.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{l.keywordCount} keywords</div>
                </div>
                <button onClick={() => { setSelectedList(l); analyze(l.keywords); }} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 11 }}>Analyze</button>
                <button onClick={() => del(l.name)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e53e3e40", background: "transparent", cursor: "pointer", fontSize: 11, color: "#e53e3e" }}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selected list keywords */}
      {selectedList && (
        <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{selectedList.name} ({selectedList.keywordCount} keywords)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(selectedList.keywords ?? []).map((kw: string) => <span key={kw} style={{ padding: "4px 12px", borderRadius: 16, background: "#5a67d820", color: "#5a67d8", fontSize: 12 }}>{kw}</span>)}
          </div>
        </div>
      )}

      {/* Analysis results */}
      {analyzing && <div className="qa-panel" style={{ marginTop: 16, textAlign: "center", padding: 40 }}>Analyzing keywords with AI...</div>}
      {analysis && !analyzing && (
        <>
          {(analysis.clusters ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Keyword Clusters</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {analysis.clusters.map((c: any, i: number) => (
                  <div key={i} style={{ flex: "1 1 220px", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>Intent: {c.intent} | Vol: {c.totalVolume}</div>
                    <div style={{ fontSize: 11, color: "#5a67d8", marginTop: 4 }}>{(c.keywords ?? []).join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(analysis.priority ?? []).length > 0 && (
            <div className="qa-panel" style={{ marginTop: 16, padding: 16, overflowX: "auto" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Priority Ranking</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Keyword", "Priority", "Difficulty", "Volume", "Intent", "Recommendation"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)" }}>{h}</th>)}</tr></thead>
                <tbody>{analysis.priority.map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 13, fontWeight: 500 }}>{p.keyword}</td>
                    <td style={{ padding: "6px 10px" }}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: p.priority === "High" ? "#e53e3e20" : "#dd6b2020", color: p.priority === "High" ? "#e53e3e" : "#dd6b20", fontWeight: 600 }}>{p.priority}</span></td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{p.difficulty}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{p.volume}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)" }}>{p.intent}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12 }}>{p.recommendation}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
