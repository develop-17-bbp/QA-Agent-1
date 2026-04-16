import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { queryNlp, type ChatMessage, type AnswerConfidence } from "../api";

// ── Confidence styling ──────────────────────────────────────────────────────

const CONFIDENCE_COLORS: Record<AnswerConfidence, string> = {
  high: "#38a169",
  medium: "#dd6b20",
  low: "#9ca3af",
};

const CONFIDENCE_LABELS: Record<AnswerConfidence, string> = {
  high: "high · grounded",
  medium: "medium · partial",
  low: "low · ungrounded",
};

function ConfidenceLozenge({ confidence }: { confidence: AnswerConfidence }) {
  const color = CONFIDENCE_COLORS[confidence];
  const label = CONFIDENCE_LABELS[confidence];
  return (
    <span
      title={`Answer confidence: ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 10,
        background: `${color}1a`,
        color,
        border: `1px solid ${color}55`,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", backgroundColor: color }} />
      {label}
    </span>
  );
}

// ── Message shape — assistant messages carry confidence + citedPages ────────

type StoredMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; confidence: AnswerConfidence; citedPages: string[] };

export default function QueryLab() {
  const [runId, setRunId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openCitations, setOpenCitations] = useState<number | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || !runId) return;
    const question = input.trim();
    setInput("");
    const userMsg: StoredMessage = { role: "user", content: question };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true); setError("");

    try {
      // Send plain role/content history to the backend — strip client-only meta.
      const wireHistory: ChatMessage[] = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const res = await queryNlp(question, runId, wireHistory);
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          confidence: res.confidence ?? "low",
          citedPages: res.citedPages ?? [],
        },
      ]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div className="qa-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 32, display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
      <h1 className="qa-page-title">Query Lab</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
        Natural-language questions over your crawl data. Every answer is labeled with a confidence lozenge
        and the crawl URLs that backed it — ungrounded answers are marked so you never confuse them with real data.
      </p>
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
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <div style={{ maxWidth: "75%", padding: "10px 16px", borderRadius: 12, background: "#111111", color: "#ffffff", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {msg.content}
                  </div>
                </div>
              );
            }
            const isOpen = openCitations === i;
            return (
              <div key={i} style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
                <div style={{ maxWidth: "85%", padding: "10px 16px", borderRadius: 12, background: "var(--bg-card, var(--glass2))", color: "var(--text-primary)", fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <ConfidenceLozenge confidence={msg.confidence} />
                    {msg.citedPages.length > 0 && (
                      <button
                        onClick={() => setOpenCitations(isOpen ? null : i)}
                        style={{ fontSize: 10, background: "none", border: "1px solid var(--border)", borderRadius: 10, padding: "2px 8px", cursor: "pointer", color: "var(--text-secondary)" }}
                      >
                        {isOpen ? "Hide citations" : `${msg.citedPages.length} cited page${msg.citedPages.length === 1 ? "" : "s"}`}
                      </button>
                    )}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                  {isOpen && msg.citedPages.length > 0 && (
                    <div style={{ marginTop: 10, padding: 10, background: "var(--glass2)", borderRadius: 6, fontSize: 11 }}>
                      <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
                        Cited crawl pages
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                        {msg.citedPages.map((u, idx) => (
                          <li key={idx}>
                            <a href={u} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)", wordBreak: "break-all" }}>
                              {u}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
              <div style={{ padding: "10px 16px", borderRadius: 12, background: "var(--bg-card, var(--glass2))", fontSize: 13, color: "var(--text-secondary)" }}>Thinking...</div>
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
