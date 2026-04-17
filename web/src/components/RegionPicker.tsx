import { useEffect, useState } from "react";
import { fetchGeoTargets, type GeoTarget } from "../api";

const STORAGE_KEY = "qa-region";

/** Read the user's selected region from localStorage (defaults to "US"). */
export function getSelectedRegion(): string {
  if (typeof window === "undefined") return "US";
  return window.localStorage.getItem(STORAGE_KEY) || "US";
}

/** React hook — returns current region and updates when it changes anywhere. */
export function useRegion(): [string, (iso: string) => void] {
  const [region, setRegion] = useState<string>(getSelectedRegion);
  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (typeof ce.detail === "string") setRegion(ce.detail);
    };
    window.addEventListener("qa-region-change", onChange);
    return () => window.removeEventListener("qa-region-change", onChange);
  }, []);
  const set = (iso: string) => {
    window.localStorage.setItem(STORAGE_KEY, iso);
    window.dispatchEvent(new CustomEvent<string>("qa-region-change", { detail: iso }));
  };
  return [region, set];
}

type Props = {
  /** Compact mode = inline label + select on one row (for tool headers). */
  compact?: boolean;
  /** Override the label shown next to the dropdown. */
  label?: string;
};

export default function RegionPicker({ compact = false, label = "Region" }: Props) {
  const [region, setRegion] = useRegion();
  const [targets, setTargets] = useState<GeoTarget[]>([]);

  useEffect(() => {
    fetchGeoTargets().then((r) => setTargets(r.targets)).catch(() => {});
  }, []);

  if (targets.length === 0) {
    // Minimal fallback so the picker still renders before the API answers.
    return null;
  }

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--muted)",
        ...(compact ? {} : { padding: "4px 0" }),
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{label}:</span>
      <select
        className="qa-input"
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        style={{ padding: "6px 10px", minWidth: 170, fontSize: 13 }}
        title="Data for keyword volumes, SERP, and regional metrics are fetched for this location."
      >
        {targets.map((t) => (
          <option key={t.iso} value={t.iso}>
            {t.name} ({t.iso})
          </option>
        ))}
      </select>
    </label>
  );
}
