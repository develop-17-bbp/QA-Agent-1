import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import RunSelector from "../components/RunSelector";
import { fetchReferringDomains, fetchDomainAuthority } from "../api";
import { FilterableTable, type FilterableColumn } from "../components/FilterableTable";
import { PageShell, SectionCard, StatGrid, EmptyState } from "../components/PageUI";

import { LoadingPanel, ErrorBanner } from "../components/UI";
const AUTH_COLORS = { high: "#38a169", medium: "#dd6b20", low: "#e53e3e" };

export default function ReferringDomains() {
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [daInput, setDaInput] = useState("");
  const [daData, setDaData] = useState<any>(null);
  const [daLoading, setDaLoading] = useState(false);
  const [daError, setDaError] = useState("");

  const lookupDa = async () => {
    const d = daInput.trim();
    if (!d) return;
    setDaLoading(true); setDaError(""); setDaData(null);
    try { setDaData(await fetchDomainAuthority(d)); } catch (e: any) { setDaError(e.message); }
    finally { setDaLoading(false); }
  };

  const load = async (rid: string) => { setRunId(rid); if (!rid) return; setLoading(true); setError(""); try { setData(await fetchReferringDomains(rid)); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };

  const authData = data?.authorityDistribution ? [
    { name: "High (80+)", value: data.authorityDistribution.high, color: AUTH_COLORS.high },
    { name: "Medium (50-79)", value: data.authorityDistribution.medium, color: AUTH_COLORS.medium },
    { name: "Low (<50)", value: data.authorityDistribution.low, color: AUTH_COLORS.low },
  ].filter(d => d.value > 0) : [];

  return (
    <PageShell
      title="Referring Domains"
      desc="Analyze external domains linking to your sites."
      purpose="Which external domains send you the most link juice, and which ones are risky?"
      sources={["Crawl", "OpenPageRank"]}
    >
      <RunSelector value={runId} onChange={load} label="Select run" />

      {loading && <LoadingPanel message="Analyzing domains…" />}
      {error && <ErrorBanner error={error} />}

      <SectionCard
        title="Domain Authority Lookup"
        subtitle="Check any domain's authority score via OpenPageRank (free)."
      >
        <div style={{ display: "flex", gap: 8 }}>
          <input className="qa-input" placeholder="e.g. example.com" value={daInput} onChange={e => setDaInput(e.target.value)} onKeyDown={e => e.key === "Enter" && lookupDa()} style={{ flex: 1, padding: "7px 10px" }} />
          <button className="qa-btn-primary" onClick={lookupDa} disabled={daLoading || !daInput.trim()}>{daLoading ? "Checking…" : "Lookup"}</button>
        </div>
        {daError && <ErrorBanner error={daError} />}
        {daData && !daLoading && (
          daData.configured === false ? (
            <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic", marginTop: 12 }}>{daData.source}</div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <StatGrid
                stats={[
                  {
                    label: "Authority (0–100)",
                    value: daData.authority0to100 ?? "—",
                    valueColor:
                      (daData.authority0to100 ?? 0) >= 60 ? "var(--ok)" :
                      (daData.authority0to100 ?? 0) >= 30 ? "var(--warn)" : "var(--bad)",
                  },
                  { label: "Page Rank (0–10)", value: daData.pageRankDecimal ?? "—" },
                  ...(daData.globalRank != null ? [{ label: "Global Rank", value: `#${daData.globalRank.toLocaleString()}` }] : []),
                ]}
              />
              <div style={{ fontSize: 11, color: "var(--muted)" }}>source: {daData.source}</div>
            </div>
          )
        )}
      </SectionCard>

      {data && !loading && (
        <>
          <StatGrid
            stats={[
              { label: "Total Domains", value: data.totalDomains },
              {
                label: "Avg Trust Score",
                value: data.summary?.avgTrustScore ?? 0,
                valueColor: (data.summary?.avgTrustScore ?? 0) >= 70 ? "var(--ok)" : "var(--warn)",
              },
            ]}
          />

          {authData.length > 0 && (
            <SectionCard title="Authority Distribution">
              <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ width: 240, height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={authData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                      {authData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie><Tooltip /></PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {authData.map(d => <span key={d.name} style={{ fontSize: 12, color: d.color, fontWeight: 600 }}>● {d.name}: {d.value}</span>)}
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard title={`Referring Domains (${(data.sections ?? []).length})`}>
            {(data.sections ?? []).length === 0 ? (
              <EmptyState
                title="No referring domains yet"
                hint="Run a crawl to discover external backlinks, or upload a GSC Links CSV from the Backlinks page."
              />
            ) : (
              <ReferringDomainsTable sections={data.sections ?? []} />
            )}
          </SectionCard>
        </>
      )}
    </PageShell>
  );
}

interface Section {
  domain: string;
  totalLinks: number;
  healthyLinks: number;
  brokenLinks: number;
  trustScore: number;
}

function ReferringDomainsTable({ sections }: { sections: Section[] }) {
  const columns: FilterableColumn<Section>[] = useMemo(() => [
    {
      key: "domain",
      label: "Domain",
      accessor: (s) => s.domain,
      filterType: "text",
      render: (s) => <span style={{ fontWeight: 500 }}>{s.domain}</span>,
    },
    {
      key: "totalLinks",
      label: "Total Links",
      accessor: (s) => s.totalLinks,
      filterType: "number",
      width: 110,
      headerStyle: { textAlign: "center" },
      cellStyle: { textAlign: "center", fontSize: 13 },
    },
    {
      key: "healthyLinks",
      label: "Healthy",
      accessor: (s) => s.healthyLinks,
      filterType: "number",
      width: 90,
      headerStyle: { textAlign: "center" },
      cellStyle: { textAlign: "center", fontSize: 13, color: "#38a169" },
    },
    {
      key: "brokenLinks",
      label: "Broken",
      accessor: (s) => s.brokenLinks,
      filterType: "number",
      width: 90,
      headerStyle: { textAlign: "center" },
      cellStyle: { textAlign: "center", fontSize: 13, color: "#e53e3e" },
    },
    {
      key: "trustScore",
      label: "Trust Score",
      accessor: (s) => s.trustScore,
      filterType: "number",
      width: 110,
      headerStyle: { textAlign: "center" },
      render: (s) => (
        <span
          style={{
            display: "inline-block",
            fontWeight: 700,
            color: s.trustScore >= 80 ? "#38a169" : s.trustScore >= 50 ? "#dd6b20" : "#e53e3e",
          }}
        >
          {s.trustScore}%
        </span>
      ),
      cellStyle: { textAlign: "center" },
    },
  ], []);

  return (
    <FilterableTable<Section>
      rows={sections}
      columns={columns}
      rowKey={(s) => s.domain}
      pageSize={50}
      itemLabel="domain"
      emptyMessage="No referring domains match the current filters."
    />
  );
}
