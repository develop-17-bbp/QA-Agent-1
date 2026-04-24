/**
 * AgenticModeChip — topbar indicator that makes the agentic-vs-deterministic
 * state of the product visible at all times.
 *
 * Signal logic:
 *   - Ollama reachable AND (Auto-Council explicitly ON  OR  user hasn't set a
 *     preference yet + Ollama is reachable) → "🧠 Agentic · live" (green dot)
 *   - Ollama reachable AND Auto-Council explicitly OFF → "Agent ready" (amber)
 *   - Ollama unreachable → "Heuristic only" (gray)
 *
 * Polls /api/llm-stats every 30s (the server-side cache TTL is also 30s so
 * we don't hammer it). The chip links to /integrations so users who see
 * "Heuristic only" know where to fix it.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AUTO_COUNCIL_KEY, readAutoCouncilRaw } from "./CouncilSidecar";

const POLL_INTERVAL_MS = 30_000;

type Mode = "agentic-live" | "agent-ready" | "heuristic";

export default function AgenticModeChip() {
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null);
  const [autoRaw, setAutoRaw] = useState(readAutoCouncilRaw);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("/api/llm-stats", { cache: "no-store" });
        if (!cancelled && res.ok) {
          const stats = await res.json() as { ollama?: { available?: boolean } };
          setOllamaUp(!!stats.ollama?.available);
        }
      } catch {
        if (!cancelled) setOllamaUp(false);
      }
    };
    void probe();
    const id = setInterval(probe, POLL_INTERVAL_MS);
    const storageHandler = (e: StorageEvent) => {
      if (e.key === AUTO_COUNCIL_KEY) setAutoRaw(readAutoCouncilRaw());
    };
    window.addEventListener("storage", storageHandler);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener("storage", storageHandler); };
  }, []);

  let mode: Mode = "heuristic";
  if (ollamaUp) {
    // User's explicit OFF wins, otherwise agentic is live whenever Ollama is up.
    if (autoRaw === "off") mode = "agent-ready";
    else mode = "agentic-live";
  }

  const palette = mode === "agentic-live"
    ? { bg: "var(--accent-light)", color: "var(--accent-hover, #1d4ed8)", dot: "#22c55e", label: "🧠 Agentic · live" }
    : mode === "agent-ready"
    ? { bg: "#fef3c7", color: "#92400e", dot: "#eab308", label: "Agent ready · auto off" }
    : { bg: "var(--glass2)", color: "var(--muted)", dot: "#94a3b8", label: "Heuristic only" };

  const title = mode === "agentic-live"
    ? "Agentic mode is LIVE — Ollama is reachable and analytics pages are auto-synthesizing cross-source AI verdicts. Crawls will ship with LLM-driven queue prioritization."
    : mode === "agent-ready"
    ? "Ollama is reachable but Auto-Council is switched OFF — pages still have manual 'Ask the Council' buttons. Flip Auto-Council ON for full agentic mode."
    : "Ollama isn't reachable — the product is running on deterministic heuristics only. Start Ollama locally (or set OLLAMA_HOST) to unlock agentic mode.";

  return (
    <Link
      to="/integrations"
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: palette.bg,
        color: palette.color,
        fontSize: 11.5,
        fontWeight: 600,
        textDecoration: "none",
        letterSpacing: 0.2,
      }}
    >
      <span aria-hidden style={{
        display: "inline-block",
        width: 8, height: 8,
        borderRadius: "50%",
        background: palette.dot,
      }} />
      {palette.label}
    </Link>
  );
}
