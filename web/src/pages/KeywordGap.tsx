import { useState } from "react";
import { motion } from "framer-motion";
import RunSelector from "../components/RunSelector";
import { fetchKeywordGap } from "../api";
import { PageHero } from "../components/PageHero";

type SortField = "keyword" | "score";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  field,
  active,
  dir,
  onSort,
}: {
  label: string;
  field: SortField;
  active: boolean;
  dir: SortDir;
  onSort: (f: SortField) => void;
}) {
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        padding: "8px 12px",
        textAlign: field === "keyword" ? "left" : "right",
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

function sortItems<T extends { keyword: string; score: number }>(
  items: T[],
  field: SortField,
  dir: SortDir,
): T[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (field === "keyword") {
      return dir === "asc"
        ? a.keyword.localeCompare(b.keyword)
        : b.keyword.localeCompare(a.keyword);
    }
    return dir === "asc" ? a.score - b.score : b.score - a.score;
  });
  return sorted;
}

export default function KeywordGap() {
  const [runIdA, setRunIdA] = useState("");
  const [runIdB, setRunIdB] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortFieldA, setSortFieldA] = useState<SortField>("score");
  const [sortDirA, setSortDirA] = useState<SortDir>("desc");
  const [sortFieldShared, setSortFieldShared] = useState<SortField>("score");
  const [sortDirShared, setSortDirShared] = useState<SortDir>("desc");
  const [sortFieldB, setSortFieldB] = useState<SortField>("score");
  const [sortDirB, setSortDirB] = useState<SortDir>("desc");

  const analyze = async () => {
    if (!runIdA || !runIdB) return;
    setLoading(true);
    setError("");
    try {
      setData(await fetchKeywordGap(runIdA, runIdB));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (
    current: SortField,
    currentDir: SortDir,
    setField: (f: SortField) => void,
    setDir: (d: SortDir) => void,
  ) => {
    return (f: SortField) => {
      if (f === current) setDir(currentDir === "asc" ? "desc" : "asc");
      else {
        setField(f);
        setDir("desc");
      }
    };
  };

  const onlyA = data ? sortItems(data.onlyA ?? [], sortFieldA, sortDirA) : [];
  const shared = data
    ? sortItems(data.shared ?? [], sortFieldShared, sortDirShared)
    : [];
  const onlyB = data ? sortItems(data.onlyB ?? [], sortFieldB, sortDirB) : [];

  return (
    <motion.div
      className="qa-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ padding: 32 }}
    >
      <PageHero
        icon="target"
        category="competitive"
        eyebrow="Keyword Gap"
        title="Find content gaps"
        subtitle="Compare title-derived keywords between two runs to find content gaps and opportunities."
        accent
      />

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
          className="qa-btn"
          onClick={analyze}
          disabled={loading || !runIdA || !runIdB || runIdA === runIdB}
          style={{ padding: "8px 24px" }}
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
        <div className="qa-panel" style={{ marginTop: 20 }}>
          <div className="qa-loading-panel">Analyzing keyword gap...</div>
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
                label: "Keywords in A",
                val: data.summary?.totalA ?? 0,
                color: "#111111",
              },
              {
                label: "Shared Keywords",
                val: data.summary?.overlap ?? 0,
                color: "#38a169",
              },
              {
                label: "Keywords in B",
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
              <div className="qa-panel-title" style={{ marginBottom: 8, color: "#111111" }}>
                Only in Run A ({onlyA.length})
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <SortHeader
                      label="Keyword"
                      field="keyword"
                      active={sortFieldA === "keyword"}
                      dir={sortDirA}
                      onSort={toggleSort(
                        sortFieldA,
                        sortDirA,
                        setSortFieldA,
                        setSortDirA,
                      )}
                    />
                    <SortHeader
                      label="Pages"
                      field="score"
                      active={sortFieldA === "score"}
                      dir={sortDirA}
                      onSort={toggleSort(
                        sortFieldA,
                        sortDirA,
                        setSortFieldA,
                        setSortDirA,
                      )}
                    />
                  </tr>
                </thead>
                <tbody>
                  {onlyA.map((kw: any) => (
                    <tr key={kw.keyword}>
                      <td style={{ fontWeight: 500 }}>
                        {kw.keyword}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                        {kw.score}
                      </td>
                    </tr>
                  ))}
                  {onlyA.length === 0 && (
                    <tr>
                      <td colSpan={2} className="qa-empty">
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
              <div className="qa-panel-title" style={{ marginBottom: 8, color: "#38a169" }}>
                Shared ({shared.length})
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <SortHeader
                      label="Keyword"
                      field="keyword"
                      active={sortFieldShared === "keyword"}
                      dir={sortDirShared}
                      onSort={toggleSort(
                        sortFieldShared,
                        sortDirShared,
                        setSortFieldShared,
                        setSortDirShared,
                      )}
                    />
                    <SortHeader
                      label="Total"
                      field="score"
                      active={sortFieldShared === "score"}
                      dir={sortDirShared}
                      onSort={toggleSort(
                        sortFieldShared,
                        sortDirShared,
                        setSortFieldShared,
                        setSortDirShared,
                      )}
                    />
                  </tr>
                </thead>
                <tbody>
                  {shared.map((kw: any) => (
                    <tr key={kw.keyword}>
                      <td style={{ fontWeight: 500 }}>
                        {kw.keyword}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                        {kw.score}
                      </td>
                    </tr>
                  ))}
                  {shared.length === 0 && (
                    <tr>
                      <td colSpan={2} className="qa-empty">
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
              <div className="qa-panel-title" style={{ marginBottom: 8, color: "#e53e3e" }}>
                Only in Run B ({onlyB.length})
              </div>
              <table className="qa-table">
                <thead>
                  <tr>
                    <SortHeader
                      label="Keyword"
                      field="keyword"
                      active={sortFieldB === "keyword"}
                      dir={sortDirB}
                      onSort={toggleSort(
                        sortFieldB,
                        sortDirB,
                        setSortFieldB,
                        setSortDirB,
                      )}
                    />
                    <SortHeader
                      label="Pages"
                      field="score"
                      active={sortFieldB === "score"}
                      dir={sortDirB}
                      onSort={toggleSort(
                        sortFieldB,
                        sortDirB,
                        setSortFieldB,
                        setSortDirB,
                      )}
                    />
                  </tr>
                </thead>
                <tbody>
                  {onlyB.map((kw: any) => (
                    <tr key={kw.keyword}>
                      <td style={{ fontWeight: 500 }}>
                        {kw.keyword}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                        {kw.score}
                      </td>
                    </tr>
                  ))}
                  {onlyB.length === 0 && (
                    <tr>
                      <td colSpan={2} className="qa-empty">
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
