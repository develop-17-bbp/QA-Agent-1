import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { queryNlp, type ChatMessage } from "../api";

export default function QueryLab() {
  const [runId, setRunId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || !runId) return;
    const question = input.trim();
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: question };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true); setError("");

    try {
      const history = [...messages, userMsg];
      const res = await queryNlp(question, runId, history);
      setMessages(prev => [...prev, { role: "assistant", content: res.answer }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32, display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
      <h1 className="qa-page-title">Query Lab</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>Ask natural language questions about your crawl data. Powered by Gemini AI.</p>
      <RunSelector value={runId} onChange={setRunId} label="Select run" />

      <div className="qa-panel" style={{ flex: 1, marginTop: 16, padding: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Start a conversation</div>
              <div style={{ fontSize: 13 }}>Ask about broken links, SEO issues, page performance, content analysis, or anything else about your crawl data.</div>
              <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {["What are the main SEO issues?", "Which pages are slowest?", "How many broken links are there?", "Summarize the crawl results"].map(q => (
                  <button key={q} onClick={() => { setInput(q); }} style={{ padding: "6px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--text-secondary)" }}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
              <div style={{ maxWidth: "75%", padding: "10px 16px", borderRadius: 12, background: msg.role === "user" ? "#5a67d8" : "var(--bg-card, rgba(90,103,216,0.06))", color: msg.role === "user" ? "#fff" : "var(--text-primary)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
              <div style={{ padding: "10px 16px", borderRadius: 12, background: "var(--bg-card, rgba(90,103,216,0.06))", fontSize: 13, color: "var(--text-secondary)" }}>Thinking...</div>
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        {error && <div style={{ color: "#e53e3e", fontSize: 12, marginBottom: 8 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <input className="qa-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={runId ? "Ask about your crawl data..." : "Select a run first..."} disabled={!runId || loading} style={{ flex: 1, padding: "10px 14px" }} />
          <button className="qa-btn" onClick={send} disabled={!runId || !input.trim() || loading} style={{ padding: "10px 20px" }}>Send</button>
        </div>
      </div>
    </motion.div>
  );
}
