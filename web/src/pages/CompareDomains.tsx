import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { fetchHistory, fetchCompareDomains, type HealthRunMeta } from "../api";
import AskCouncilButton from "../components/AskCouncilButton";

const COLORS = ["#111111", "#e53e3e", "#38a169", "#dd6b20", "#3182ce", "#d53f8c"];
const METRIC_LABELS: Record<string, string> = {
  seo: "SEO",
  performance: "Performance",
  content: "Content",
  technical: "Technical",
  links: "Links",
};

export default function CompareDomains() {
  const [runs, setRuns] = useState<HealthRunMeta[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const { days } = await fetchHistory();
        const all = days
          .flatMap((d) => d.runs)
          .sort(
            (a, b) =>
              new Date(b.generatedAt).getTime() -
              new Date(a.generatedAt).getTime(),
          );
        setRuns(all);
      } catch {
        /* no runs */
      } finally {
        setLoadingRuns(false);
      }
    })();
  }, []);

  const toggle = (runId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const compare = async () => {
    const ids = [...selected];
    if (ids.length < 2) return;
    setLoading(true);
    setError("");
    try {
      setData(await fetchCompareDomains(ids));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const radarData =
    data?.comparison?.metrics?.map((m: string) => {
      const entry: Record<string, any> = { metric: METRIC_LABELS[m] ?? m };
      for (const d of data.domains ?? []) {
        entry[d.runId] = d.scores?.[m] ?? 0;
      }
      return entry;
    }) ?? [];

  return (
    <motion.div
      className="qa-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ padding: 32 }}
    >
      <h1 className="qa-page-title">Compare Domains</h1>
      <p className="qa-page-desc">
        Select two or more runs to compare domain health scores side by side.
      </p>

      {/* Multi-select panel */}
      <div className="qa-panel" style={{ padding: 16, marginBottom: 16 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Select Runs to Compare
        </div>
        {loadingRuns && (
          <div style={{ color: "var(--text-secondary)", padding: 8 }}>
            Loading runs...
          </div>
        )}
        <div
          style={{
            maxHeight: 260,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          {runs.map((r) => (
            <label
              key={r.runId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                background: selected.has(r.runId)
                  ? "var(--bg-card, rgba(90,103,216,0.06))"
                  : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(r.runId)}
                onChange={() => toggle(r.runId)}
              />
              <span style={{ fontSize: 13, flex: 1 }}>
                <strong>{r.runId}</strong>
                <span style={{ color: "var(--text-secondary)", marginLeft: 8 }}>
                  {r.totalSites} site{r.totalSites !== 1 ? "s" : ""} -{" "}
                  {new Date(r.generatedAt).toLocaleDateString()}
                </span>
              </span>
            </label>
          ))}
          {!loadingRuns && runs.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: 20,
                color: "var(--text-secondary)",
              }}
            >
              No runs found
            </div>
          )}
        </div>

        <button
          className="qa-btn"
          onClick={compare}
          disabled={loading || selected.size < 2}
          style={{ marginTop: 12, padding: "8px 24px" }}
        >
          {loading
            ? "Comparing..."
            : `Compare ${selected.size} Run${selected.size !== 1 ? "s" : ""}`}
        </button>
      </div>

      {error && (
        <div className="qa-panel" style={{ marginTop: 16, color: "#e53e3e" }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Ask the Council per compared domain */}
          {(data.domains ?? []).length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, fontSize: 11.5, color: "var(--muted)", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>Ask the Council:</span>
              {(data.domains ?? [])
                .filter((d: { hostname?: string }) => typeof d.hostname === "string" && d.hostname.length > 0)
                .map((d: { hostname: string }) => (
                  <AskCouncilButton key={d.hostname} term={d.hostname} compact />
                ))}
            </div>
          )}

          {/* Radar Chart */}
          <div className="qa-panel" style={{ padding: 24, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Score Radar
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                  axisLine={false}
                />
                {(data.domains ?? []).map((d: any, i: number) => (
                  <Radar
                    key={d.runId}
                    name={d.hostname || d.runId}
                    dataKey={d.runId}
                    stroke={COLORS[i % COLORS.length]}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.15}
                  />
                ))}
                <Tooltip />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Winner badge */}
          {data.comparison?.winner && (
            <div
              className="qa-panel"
              style={{
                padding: 16,
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "4px 12px",
                  borderRadius: 6,
                  background: "#38a16920",
                  color: "#38a169",
                }}
              >
                WINNER
              </span>
              <span style={{ fontSize: 14 }}>
                {(() => {
                  const w = (data.domains ?? []).find(
                    (d: any) => d.runId === data.comparison.winner,
                  );
                  return w ? `${w.hostname || w.runId}` : data.comparison.winner;
                })()}
              </span>
            </div>
          )}

          {/* Metrics comparison table */}
          <div
            className="qa-panel"
            style={{ padding: 16, overflowX: "auto" }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Detailed Metrics
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      borderBottom: "2px solid var(--border)",
                    }}
                  >
                    Run
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      borderBottom: "2px solid var(--border)",
                    }}
                  >
                    Domain
                  </th>
                  {(data.comparison?.metrics ?? []).map((m: string) => (
                    <th
                      key={m}
                      style={{
                        padding: "8px 12px",
                        textAlign: "center",
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        borderBottom: "2px solid var(--border)",
                      }}
                    >
                      {METRIC_LABELS[m] ?? m}
                    </th>
                  ))}
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "center",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      borderBottom: "2px solid var(--border)",
                    }}
                  >
                    Pages
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "center",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      borderBottom: "2px solid var(--border)",
                    }}
                  >
                    Avg Load
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data.domains ?? []).map((d: any, i: number) => (
                  <tr
                    key={d.runId}
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: COLORS[i % COLORS.length],
                      }}
                    >
                      {d.runId}
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>
                      {d.hostname}
                    </td>
                    {(data.comparison?.metrics ?? []).map((m: string) => {
                      const val = d.scores?.[m] ?? 0;
                      const color =
                        val >= 80
                          ? "#38a169"
                          : val >= 60
                            ? "#dd6b20"
                            : "#e53e3e";
                      return (
                        <td
                          key={m}
                          style={{
                            padding: "8px 12px",
                            textAlign: "center",
                            fontSize: 13,
                            fontWeight: 600,
                            color,
                          }}
                        >
                          {val}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        padding: "8px 12px",
                        textAlign: "center",
                        fontSize: 13,
                      }}
                    >
                      {d.pageCount}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        textAlign: "center",
                        fontSize: 13,
                      }}
                    >
                      {d.avgLoadMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
