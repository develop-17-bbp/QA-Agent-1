import { useEffect, useState } from "react";
import { fetchHistory, type HealthRunMeta } from "../api";

export default function RunSelector({ value, onChange, disabled, label }: {
  value: string;
  onChange: (runId: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [runs, setRuns] = useState<HealthRunMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { days } = await fetchHistory();
        const all = days.flatMap(d => d.runs).sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
        setRuns(all);
        if (all.length > 0 && !value) onChange(all[0]!.runId);
      } catch { /* no runs */ }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {label && <label className="qa-label-field" style={{ margin: 0 }}>{label}</label>}
      <select className="qa-select" value={value} onChange={e => onChange(e.target.value)} disabled={disabled || loading} style={{ flex: 1, maxWidth: 400 }}>
        {loading && <option>Loading...</option>}
        {!loading && runs.length === 0 && <option value="">No runs found</option>}
        {runs.map(r => (
          <option key={r.runId} value={r.runId}>
            {r.runId} — {r.totalSites} site{r.totalSites !== 1 ? "s" : ""} — {new Date(r.generatedAt).toLocaleDateString()}
          </option>
        ))}
      </select>
    </div>
  );
}
