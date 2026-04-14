import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchBacklinkGap } from "../api";

type SortField = "url" | "count";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  field,
  active,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  field: SortField;
  active: boolean;
  dir: SortDir;
  onSort: (f: SortField) => void;
  align?: "left" | "right";
}) {
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        padding: "8px 12px",
        textAlign: align,
        fontSize: 12,
        color: "var(--text-secondary)",
        borderBottom: "2px solid var(--border)",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label} {active ? (dir === "asc" ? " ^" : " v") : ""}
    </th>
  );
}

function truncateUrl(url: string, max = 50): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 3) + "...";
}

export default function BacklinkGap() {
  const [runIdA, setRunIdA] = useState("");
  const [runIdB, setRunIdB] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortA, setSortA] = useState<{ field: SortField; dir: SortDir }>({
    field: "count",
    dir: "desc",
  });
  const [sortShared, setSortShared] = useState<{
    field: SortField;
    dir: SortDir;
  }>({ field: "count", dir: "desc" });
  const [sortB, setSortB] = useState<{ field: SortField; dir: SortDir }>({
    field: "count",
    dir: "desc",
  });

  const analyze = async () => {
    if (!runIdA || !runIdB) return;
    setLoading(true);
    setError("");
    try {
      setData(await fetchBacklinkGap(runIdA, runIdB));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (
    state: { field: SortField; dir: SortDir },
    setState: (s: { field: SortField; dir: SortDir }) => void,
  ) => {
    return (f: SortField) => {
      if (f === state.field)
        setState({ field: f, dir: state.dir === "asc" ? "desc" : "asc" });
      else setState({ field: f, dir: "desc" });
    };
  };

  function sortOnlyList(
    items: any[],
    state: { field: SortField; dir: SortDir },
  ) {
    const sorted = [...items];
    sorted.sort((a, b) => {
      if (state.field === "url") {
        return state.dir === "asc"
          ? a.url.localeCompare(b.url)
          : b.url.localeCompare(a.url);
      }
      return state.dir === "asc"
        ? a.linkCount - b.linkCount
        : b.linkCount - a.linkCount;
    });
    return sorted;
  }

  function sortSharedList(
    items: any[],
    state: { field: SortField; dir: SortDir },
  ) {
    const sorted = [...items];
    sorted.sort((a, b) => {
      if (state.field === "url") {
        return state.dir === "asc"
          ? a.url.localeCompare(b.url)
          : b.url.localeCompare(a.url);
      }
      const totalA = a.countA + a.countB;
      const totalB = b.countA + b.countB;
      return state.dir === "asc" ? totalA - totalB : totalB - totalA;
    });
    return sorted;
  }

  const onlyA = data ? sortOnlyList(data.onlyA ?? [], sortA) : [];
  const shared = data ? sortSharedList(data.shared ?? [], sortShared) : [];
  const onlyB = data ? sortOnlyList(data.onlyB ?? [], sortB) : [];

  return (
    <motion.div
      className="qa-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ padding: 32 }}
    >
      <h1 className="qa-page-title">Backlink Gap</h1>
      <p className="qa-page-desc">
        Compare link profiles between two runs to discover link-building
        opportunities.
      </p>

      {/* Run selectors */}
      <div
        className="qa-panel"
        style={{
          padding: 16,
          marginBottom: 16,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <RunSelector value={runIdA} onChange={setRunIdA} label="Run A" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <RunSelector value={runIdB} onChange={setRunIdB} label="Run B" />
        </div>
        <button
          className="qa-btn-primary"
          onClick={analyze}
          disabled={loading || !runIdA || !runIdB || runIdA === runIdB}
        >
          {loading ? "Analyzing..." : "Analyze Gap"}
        </button>
      </div>

      {error && (
        <div className="qa-alert qa-alert--error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
      {loading && (
        <div className="qa-loading-panel" style={{ marginTop: 20 }}>
          <div className="qa-spinner" />Analyzing backlink gap...
        </div>
      )}

      {data && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Summary cards */}
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            {[
              {
                label: "Links in A",
                val: data.summary?.totalA ?? 0,
                color: "#5a67d8",
              },
              {
                label: "Shared Links",
                val: data.summary?.overlap ?? 0,
                color: "#38a169",
              },
              {
                label: "Links in B",
                val: data.summary?.totalB ?? 0,
                color: "#e53e3e",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="qa-panel"
                style={{
                  flex: 1,
                  minWidth: 140,
                  padding: 16,
                  textAlign: "center",
                }}
              >
                <div className="qa-kicker">
                  {s.label}
                </div>
                <div
                  style={{ fontSize: 24, fontWeight: 700, color: s.color }}
                >
                  {s.val}
                </div>
              </div>
            ))}
          </div>

          {/* Three-column layout */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 16,
            }}
          >
            {/* Only A */}
            <div
              className="qa-panel"
              style={{ padding: 16, overflowX: "auto" }}
            >
              <div className="qa-panel-title" style={{ color: "#5a67d8" }}>
                Only in Run A ({onlyA.length})
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <SortHeader
                      label="URL"
                      field="url"
                      active={sortA.field === "url"}
                      dir={sortA.dir}
                      onSort={toggleSort(sortA, setSortA)}
                    />
                    <SortHeader
                      label="Count"
                      field="count"
                      active={sortA.field === "count"}
                      dir={sortA.dir}
                      onSort={toggleSort(sortA, setSortA)}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {onlyA.map((lk: any) => (
                    <tr
                      key={lk.url}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={lk.url}
                      >
                        {truncateUrl(lk.url)}
                      </td>
                      <td
                        style={{
                          padding: "6px 12px",
                          fontSize: 13,
                          textAlign: "right",
                          fontWeight: 600,
                        }}
                      >
                        {lk.linkCount}
                      </td>
                    </tr>
                  ))}
                  {onlyA.length === 0 && (
                    <tr>
                      <td
                        colSpan={2}
                        style={{
                          padding: 16,
                          textAlign: "center",
                          color: "var(--text-secondary)",
                        }}
                      >
                        None
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Shared */}
            <div
              className="qa-panel"
              style={{ padding: 16, overflowX: "auto" }}
            >
              <div className="qa-panel-title" style={{ color: "#38a169" }}>
                Shared ({shared.length})
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <SortHeader
                      label="URL"
                      field="url"
                      active={sortShared.field === "url"}
                      dir={sortShared.dir}
                      onSort={toggleSort(sortShared, setSortShared)}
                    />
                    <th
                      style={{
                        padding: "8px 6px",
                        textAlign: "right",
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        borderBottom: "2px solid var(--border)",
                      }}
                    >
                      A
                    </th>
                    <th
                      style={{
                        padding: "8px 6px",
                        textAlign: "right",
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        borderBottom: "2px solid var(--border)",
                      }}
                    >
                      B
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shared.map((lk: any) => (
                    <tr
                      key={lk.url}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          maxWidth: 180,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={lk.url}
                      >
                        {truncateUrl(lk.url, 40)}
                      </td>
                      <td
                        style={{
                          padding: "6px 6px",
                          fontSize: 13,
                          textAlign: "right",
                          color: "#5a67d8",
                          fontWeight: 600,
                        }}
                      >
                        {lk.countA}
                      </td>
                      <td
                        style={{
                          padding: "6px 6px",
                          fontSize: 13,
                          textAlign: "right",
                          color: "#e53e3e",
                          fontWeight: 600,
                        }}
                      >
                        {lk.countB}
                      </td>
                    </tr>
                  ))}
                  {shared.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        style={{
                          padding: 16,
                          textAlign: "center",
                          color: "var(--text-secondary)",
                        }}
                      >
                        None
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Only B */}
            <div
              className="qa-panel"
              style={{ padding: 16, overflowX: "auto" }}
            >
              <div className="qa-panel-title" style={{ color: "#e53e3e" }}>
                Only in Run B ({onlyB.length})
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <SortHeader
                      label="URL"
                      field="url"
                      active={sortB.field === "url"}
                      dir={sortB.dir}
                      onSort={toggleSort(sortB, setSortB)}
                    />
                    <SortHeader
                      label="Count"
                      field="count"
                      active={sortB.field === "count"}
                      dir={sortB.dir}
                      onSort={toggleSort(sortB, setSortB)}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {onlyB.map((lk: any) => (
                    <tr
                      key={lk.url}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={lk.url}
                      >
                        {truncateUrl(lk.url)}
                      </td>
                      <td
                        style={{
                          padding: "6px 12px",
                          fontSize: 13,
                          textAlign: "right",
                          fontWeight: 600,
                        }}
                      >
                        {lk.linkCount}
                      </td>
                    </tr>
                  ))}
                  {onlyB.length === 0 && (
                    <tr>
                      <td
                        colSpan={2}
                        style={{
                          padding: 16,
                          textAlign: "center",
                          color: "var(--text-secondary)",
                        }}
                      >
                        None
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
