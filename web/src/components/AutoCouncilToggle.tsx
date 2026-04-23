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
import { AUTO_COUNCIL_KEY, readAutoCouncilPreference, writeAutoCouncilPreference } from "./CouncilSidecar";

export default function AutoCouncilToggle() {
  const [on, setOn] = useState<boolean>(readAutoCouncilPreference);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === AUTO_COUNCIL_KEY) setOn(readAutoCouncilPreference());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const toggle = () => {
    const next = !on;
    writeAutoCouncilPreference(next);
    setOn(next);
    // Trigger a storage event in the current window too so any other
    // components listening update immediately.
    window.dispatchEvent(new StorageEvent("storage", { key: AUTO_COUNCIL_KEY, newValue: next ? "1" : "0" }));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={on
        ? "Auto-Council is ON — feature pages automatically query every source and run AI advisors on the primary entity. Click to turn off."
        : "Auto-Council is OFF — click to enable automatic Council lookups on feature pages. (Pages still have a manual 'Ask the Council' button either way.)"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: on ? "var(--accent-light)" : "var(--glass2)",
        color: on ? "var(--accent)" : "var(--muted)",
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
        background: on ? "#22c55e" : "#94a3b8",
      }} />
      Auto-Council · {on ? "ON" : "OFF"}
    </button>
  );
}
