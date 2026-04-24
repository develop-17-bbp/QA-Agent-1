/**
 * AutoCouncilToggle — header switch that controls whether CouncilSidecar
 * components with `autoInvoke` actually fire on mount.
 *
 * State is persisted in localStorage under qa-auto-council. When off,
 * pages that wired the sidecar with autoInvoke still render the sidecar
 * collapsed with an "Ask the Council" button — users can still invoke
 * manually, we just don't burn LLM time automatically.
 *
 * Default: OFF. LLM advisor calls take 8-25s on local Ollama; firing on
 * every page-load by default would feel sluggish. Users who explicitly
 * want the "always on" experience flip this to ON.
 */

import { useEffect, useState } from "react";
import { AUTO_COUNCIL_KEY, readAutoCouncilRaw, writeAutoCouncilPreference } from "./CouncilSidecar";

export default function AutoCouncilToggle() {
  const [raw, setRaw] = useState<"on" | "off" | "unset">(readAutoCouncilRaw);
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/llm-stats", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) setOllamaAvailable(!!d?.ollama?.available); })
      .catch(() => { if (!cancelled) setOllamaAvailable(false); });
    const handler = (e: StorageEvent) => {
      if (e.key === AUTO_COUNCIL_KEY) setRaw(readAutoCouncilRaw());
    };
    window.addEventListener("storage", handler);
    return () => { cancelled = true; window.removeEventListener("storage", handler); };
  }, []);

  // Resolved state: user preference wins; when unset, follow Ollama.
  const resolvedOn = raw === "on" ? true
    : raw === "off" ? false
    : ollamaAvailable === true;
  const isSmartDefault = raw === "unset";

  const toggle = () => {
    // Clicking always sets an explicit preference, inverting the resolved state.
    const next = !resolvedOn;
    writeAutoCouncilPreference(next);
    setRaw(next ? "on" : "off");
    window.dispatchEvent(new StorageEvent("storage", { key: AUTO_COUNCIL_KEY, newValue: next ? "1" : "0" }));
  };

  const title = resolvedOn
    ? `Auto-Council is ON${isSmartDefault ? " (smart default — Ollama is reachable)" : ""}. Feature pages auto-fire the AI advisor panel on mount. Click to turn OFF.`
    : `Auto-Council is OFF${isSmartDefault && ollamaAvailable === false ? " (smart default — Ollama unreachable, falling back to deterministic heuristics)" : ""}. Pages still have a manual "Ask the Council" button. Click to turn ON.`;

  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: resolvedOn ? "var(--accent-light)" : "var(--glass2)",
        color: resolvedOn ? "var(--accent)" : "var(--muted)",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
        letterSpacing: 0.2,
      }}
    >
      <span aria-hidden style={{
        display: "inline-block",
        width: 8, height: 8,
        borderRadius: "50%",
        background: resolvedOn ? "#22c55e" : "#94a3b8",
      }} />
      Auto-Council · {resolvedOn ? "ON" : "OFF"}{isSmartDefault && <span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 4 }}>(auto)</span>}
    </button>
  );
}
