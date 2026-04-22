import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * Shared filterable/sortable/paginated table. Drop into any page that shows
 * thousands of rows and needs stackable filters + sort + search + pagination.
 *
 * One active filter per column at a time (AND-combined across columns). Click
 * a column header to sort (asc → desc → none). Filter types supported:
 *   text    — contains-text input
 *   number  — min / max range
 *   select  — multi-value dropdown auto-populated from distinct row values
 *
 * The component is generic in T (row type). Columns describe how to extract
 * raw values for filtering/sorting AND how to render the cell.
 */

export type FilterType = "text" | "number" | "select" | "none";

export interface FilterableColumn<T> {
  /** Stable key used in URLs / filter state. */
  key: string;
  /** Column header label. */
  label: string;
  /** Extracts the raw value used for filtering/sorting. */
  accessor: (row: T) => string | number | null | undefined;
  /** Optional custom cell renderer. Falls back to stringified accessor. */
  render?: (row: T) => ReactNode;
  /** What filter UI to show. Defaults to "text". Set "none" for non-filterable columns. */
  filterType?: FilterType;
  /** For select filters, override the auto-extracted option list. */
  selectOptions?: string[];
  /** Hide this column from the sort UI. Defaults to false (sortable). */
  unsortable?: boolean;
  /** Inline style for the <th>. */
  headerStyle?: CSSProperties;
  /** Inline style for every <td>. */
  cellStyle?: CSSProperties;
  /** Width hint for the <th>. */
  width?: number | string;
}

type TextFilter = { type: "text"; value: string };
type NumberFilter = { type: "number"; min?: number; max?: number };
type SelectFilter = { type: "select"; values: string[] };
type ActiveFilter = TextFilter | NumberFilter | SelectFilter;

type FilterMap = Record<string, ActiveFilter | undefined>;

type SortState = { key: string; dir: "asc" | "desc" } | null;

export interface FilterableTableProps<T> {
  rows: T[];
  columns: FilterableColumn<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  /** Called whenever the currently-visible slice changes — use this to batch
   *  operations (AI fixes, exports) against what the user actually sees. */
  onVisibleRowsChange?: (rows: T[]) => void;
  /** Called whenever the full filtered set changes (all pages). */
  onFilteredRowsChange?: (rows: T[]) => void;
  /** Noun for counter (e.g. "broken link", "keyword"). Auto-pluralized. */
  itemLabel?: string;
  /** Optional content rendered on the right of the filter bar (e.g. action button). */
  headerExtras?: ReactNode;
  /** Shown when rows is empty after filtering. */
  emptyMessage?: ReactNode;
  /** When true, shows an "Export CSV" button that downloads the filtered rows. */
  exportCsv?: boolean;
  /** Base filename (without extension) for the CSV download. */
  exportFilename?: string;
}

export function FilterableTable<T>(props: FilterableTableProps<T>) {
  const {
    rows,
    columns,
    rowKey,
    pageSize = 100,
    onVisibleRowsChange,
    onFilteredRowsChange,
    itemLabel = "row",
    headerExtras,
    emptyMessage,
    exportCsv = true,
    exportFilename,
  } = props;

  const [filters, setFilters] = useState<FilterMap>({});
  const [sort, setSort] = useState<SortState>(null);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const visibleColumns = useMemo(() => columns.filter((c) => !hiddenCols.has(c.key)), [columns, hiddenCols]);
  const toggleCol = (key: string) => {
    setHiddenCols((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Reset pagination when the underlying data changes.
  useEffect(() => setVisibleCount(pageSize), [rows, pageSize]);

  const columnByKey = useMemo(() => {
    const m = new Map<string, FilterableColumn<T>>();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);

  /** Distinct values for every select column, cached against the row set. */
  const selectOptionsByKey = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      if (c.filterType !== "select") continue;
      if (c.selectOptions) {
        out[c.key] = c.selectOptions;
        continue;
      }
      const s = new Set<string>();
      for (const r of rows) {
        const v = c.accessor(r);
        if (v === null || v === undefined) continue;
        s.add(String(v));
      }
      out[c.key] = [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return out;
  }, [columns, rows]);

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, f]) => f);
    if (active.length === 0) return rows;
    return rows.filter((row) => {
      for (const [key, f] of active) {
        if (!f) continue;
        const col = columnByKey.get(key);
        if (!col) continue;
        const rawV = col.accessor(row);
        if (f.type === "text") {
          const q = f.value.trim().toLowerCase();
          if (!q) continue;
          if (String(rawV ?? "").toLowerCase().indexOf(q) === -1) return false;
        } else if (f.type === "number") {
          const n = typeof rawV === "number" ? rawV : Number(rawV);
          if (Number.isNaN(n)) return false;
          if (f.min !== undefined && n < f.min) return false;
          if (f.max !== undefined && n > f.max) return false;
        } else if (f.type === "select") {
          if (f.values.length === 0) continue;
          if (!f.values.includes(String(rawV ?? ""))) return false;
        }
      }
      return true;
    });
  }, [rows, filters, columnByKey]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columnByKey.get(sort.key);
    if (!col) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    // Copy so we don't mutate the filtered array reference upstream.
    return [...filtered].sort((a, b) => {
      const av = col.accessor(a);
      const bv = col.accessor(b);
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [filtered, sort, columnByKey]);

  const visible = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);

  useEffect(() => { onFilteredRowsChange?.(sorted); }, [sorted, onFilteredRowsChange]);
  useEffect(() => { onVisibleRowsChange?.(visible); }, [visible, onVisibleRowsChange]);

  const activeFilterKeys = Object.entries(filters).filter(([, f]) => f).map(([k]) => k);
  const availableToAdd = columns.filter(
    (c) => c.filterType && c.filterType !== "none" && !activeFilterKeys.includes(c.key),
  );

  function setFilter(key: string, f: ActiveFilter | undefined) {
    setFilters((prev) => ({ ...prev, [key]: f }));
  }
  function clearAllFilters() {
    setFilters({});
  }
  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  const hasMore = sorted.length > visibleCount;

  return (
    <div>
      {/* Filter bar */}
      <div
        className="qa-panel"
        style={{
          padding: "10px 12px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ position: "relative" }}>
          <button
            className="qa-btn-ghost"
            onClick={() => setAddFilterOpen((v) => !v)}
            disabled={availableToAdd.length === 0}
            style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
            aria-expanded={addFilterOpen}
          >
            + Add filter
          </button>
          {addFilterOpen && availableToAdd.length > 0 && (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                background: "var(--bg, #fff)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                zIndex: 10,
                minWidth: 200,
              }}
              onMouseLeave={() => setAddFilterOpen(false)}
            >
              {availableToAdd.map((c) => (
                <button
                  key={c.key}
                  role="menuitem"
                  onClick={() => {
                    const init: ActiveFilter =
                      c.filterType === "number"
                        ? { type: "number" }
                        : c.filterType === "select"
                          ? { type: "select", values: [] }
                          : { type: "text", value: "" };
                    setFilter(c.key, init);
                    setAddFilterOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    background: "transparent",
                    border: 0,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active filter chips */}
        {Object.entries(filters).map(([key, f]) => {
          if (!f) return null;
          const col = columnByKey.get(key);
          if (!col) return null;
          return (
            <FilterChip
              key={key}
              label={col.label}
              filter={f}
              selectOptions={selectOptionsByKey[key] ?? []}
              onChange={(next) => setFilter(key, next)}
              onRemove={() => setFilter(key, undefined)}
            />
          );
        })}

        {activeFilterKeys.length > 0 && (
          <button
            className="qa-btn-ghost"
            onClick={clearAllFilters}
            style={{ padding: "6px 10px", fontSize: 11, color: "var(--muted)" }}
          >
            Clear all
          </button>
        )}

        {/* Counter */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{visible.length}</strong> of{" "}
            <strong style={{ color: "var(--text)" }}>{sorted.length.toLocaleString()}</strong>
            {rows.length !== sorted.length && <> <span>({rows.length.toLocaleString()} before filters)</span></>}{" "}
            {itemLabel}
            {sorted.length === 1 ? "" : "s"}
          </span>
          <div style={{ position: "relative" }}>
            <button
              className="qa-btn-ghost"
              onClick={() => setColPickerOpen((v) => !v)}
              title="Toggle column visibility"
              style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
            >
              ⧉ Columns{hiddenCols.size > 0 ? ` (${columns.length - hiddenCols.size}/${columns.length})` : ""}
            </button>
            {colPickerOpen && (
              <div
                onMouseLeave={() => setColPickerOpen(false)}
                style={{
                  position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50,
                  background: "var(--glass)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: 8, minWidth: 220,
                  boxShadow: "0 10px 30px rgba(15,23,42,0.14)",
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", padding: "4px 6px 8px" }}>Show columns</div>
                {columns.map((c) => (
                  <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", fontSize: 12.5, cursor: "pointer", borderRadius: 4 }}>
                    <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                    {c.label}
                  </label>
                ))}
                {hiddenCols.size > 0 && (
                  <button
                    onClick={() => setHiddenCols(new Set())}
                    style={{ marginTop: 6, padding: "4px 10px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--muted)", cursor: "pointer", width: "100%" }}
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>
          {exportCsv && sorted.length > 0 && (
            <button
              className="qa-btn-ghost"
              onClick={() => downloadCsv(sorted, visibleColumns, exportFilename ?? itemLabel)}
              title={`Download ${sorted.length} filtered ${itemLabel}(s) as CSV (visible columns only)`}
              style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
            >
              ↓ CSV
            </button>
          )}
          {headerExtras}
        </div>
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="qa-panel" style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          {emptyMessage ?? "No rows match the current filters."}
        </div>
      ) : (
        <div className="qa-panel qa-filterable-table" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ maxHeight: 640, overflowY: "auto" }}>
            <table className="qa-table">
              <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--glass)" }}>
                <tr>
                  {visibleColumns.map((c) => {
                    const sortable = !c.unsortable;
                    const isSorted = sort?.key === c.key;
                    const arrow = isSorted ? (sort!.dir === "asc" ? " ▲" : " ▼") : "";
                    return (
                      <th
                        key={c.key}
                        style={{
                          width: c.width,
                          cursor: sortable ? "pointer" : undefined,
                          userSelect: "none",
                          background: "var(--glass)",
                          ...c.headerStyle,
                        }}
                        onClick={sortable ? () => toggleSort(c.key) : undefined}
                      >
                        {c.label}{arrow}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={rowKey(row)}>
                    {visibleColumns.map((c) => (
                      <td key={c.key} style={c.cellStyle}>
                        {c.render ? c.render(row) : stringify(c.accessor(row))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasMore && (
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button
            className="qa-btn-ghost"
            onClick={() => setVisibleCount((v) => v + pageSize)}
            style={{ padding: "8px 24px", fontSize: 13 }}
          >
            Load next {pageSize} ({(sorted.length - visibleCount).toLocaleString()} more)
          </button>
        </div>
      )}
    </div>
  );
}

function stringify(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function csvEscape(v: string | number | null | undefined): string {
  const s = stringify(v);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv<T>(rows: T[], columns: FilterableColumn<T>[], baseName: string): void {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => csvEscape(c.accessor(r))).join(","))
    .join("\r\n");
  const csv = "﻿" + header + "\r\n" + body; // BOM so Excel detects UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.download = `${baseName.replace(/\s+/g, "-")}-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface FilterChipProps {
  label: string;
  filter: ActiveFilter;
  selectOptions: string[];
  onChange: (next: ActiveFilter) => void;
  onRemove: () => void;
}

function FilterChip({ label, filter, selectOptions, onChange, onRemove }: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const summary = summariseFilter(filter);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 4px 4px 10px",
        background: "#f1f5f9",
        border: "1px solid var(--border)",
        borderRadius: 14,
        fontSize: 11,
        position: "relative",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", fontSize: 11 }}
      >
        <strong>{label}</strong>
        {summary && <span style={{ color: "var(--muted)", marginLeft: 6 }}>{summary}</span>}
      </button>
      <button
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        style={{
          background: "transparent",
          border: 0,
          padding: "0 4px",
          cursor: "pointer",
          fontSize: 14,
          color: "var(--muted)",
          lineHeight: 1,
        }}
      >
        ×
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 10,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            zIndex: 10,
            minWidth: 220,
          }}
          onMouseLeave={() => setOpen(false)}
        >
          {filter.type === "text" && (
            <input
              className="qa-input"
              autoFocus
              placeholder={`${label} contains…`}
              value={filter.value}
              onChange={(e) => onChange({ type: "text", value: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
            />
          )}
          {filter.type === "number" && (
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="qa-input"
                type="number"
                placeholder="min"
                value={filter.min ?? ""}
                onChange={(e) => onChange({ ...filter, min: e.target.value === "" ? undefined : Number(e.target.value) })}
                style={{ width: "48%", padding: "6px 8px", fontSize: 12 }}
              />
              <input
                className="qa-input"
                type="number"
                placeholder="max"
                value={filter.max ?? ""}
                onChange={(e) => onChange({ ...filter, max: e.target.value === "" ? undefined : Number(e.target.value) })}
                style={{ width: "48%", padding: "6px 8px", fontSize: 12 }}
              />
            </div>
          )}
          {filter.type === "select" && (
            <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {selectOptions.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>(no distinct values)</span>
              )}
              {selectOptions.map((opt) => {
                const checked = filter.values.includes(opt);
                return (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? filter.values.filter((v) => v !== opt)
                          : [...filter.values, opt];
                        onChange({ type: "select", values: next });
                      }}
                    />
                    {opt || "(empty)"}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function summariseFilter(f: ActiveFilter): string {
  if (f.type === "text") return f.value ? `contains "${truncate(f.value, 18)}"` : "";
  if (f.type === "number") {
    if (f.min !== undefined && f.max !== undefined) return `${f.min}–${f.max}`;
    if (f.min !== undefined) return `≥ ${f.min}`;
    if (f.max !== undefined) return `≤ ${f.max}`;
    return "";
  }
  if (f.type === "select") {
    if (f.values.length === 0) return "";
    if (f.values.length === 1) return `= "${truncate(f.values[0]!, 14)}"`;
    return `${f.values.length} selected`;
  }
  return "";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
