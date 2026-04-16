/**
 * URL Report — unified "give a URL, get everything" intelligence page.
 *
 * Enter any URL → we extract domain → find latest crawl run → fire all
 * analysis APIs in parallel → display a single scrollable report.
 *
 * Data sections:
 *   1. Site Health (audit score, issues, page count)
 *   2. On-Page SEO (per-check results for the specific URL)
 *   3. Domain Authority (OpenPageRank)
 *   4. Keyword Suggestions (Google Suggest + estimated volumes)
 *   5. Backlinks (external link profile)
 *   6. GSC Snapshot (live clicks / impressions if connected)
 */

import { useRef, useState } from "react";
import {
  fetchHistory,
  fetchSiteAudit,
  fetchOnPageSeoChecker,
  fetchDomainAuthority,
  fetchExternalBacklinks,
  fetchKeywordSuggestions,
  fetchKeywordVolume,
} from "../api";

// ─── helpers ────────────────────────────────────────────────────────────────

function extractDomain(raw: string): string | null {
  try {
    const u = raw.trim().startsWith("http") ? new URL(raw.trim()) : new URL("https://" + raw.trim());
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeUrl(raw: string): string {
  try {
    const u = raw.trim().startsWith("http") ? new URL(raw.trim()) : new URL("https://" + raw.trim());
    return u.href;
  } catch {
    return raw.trim();
  }
}

function val(dp: any): any {
  if (dp && typeof dp === "object" && "value" in dp) return dp.value;
  return dp;
}

function badge(dp: any) {
  if (!dp || typeof dp !== "object" || !("source" in dp)) return null;
  const conf: string = dp.confidence ?? "medium";
  const color = conf === "high" ? "#22c55e" : conf === "medium" ? "#eab308" : "#6b7280";
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color, marginLeft: 5, verticalAlign: "middle",
      background: color + "18", borderRadius: 4, padding: "1px 5px",
    }}>
      {dp.source}
    </span>
  );
}

// ─── section card ────────────────────────────────────────────────────────────

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--glass)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "22px 26px",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ─── score ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score, label }: { score: number; label: string }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={74} height={74} viewBox="0 0 74 74">
        <circle cx={37} cy={37} r={r} fill="none" stroke="var(--border)" strokeWidth={6} />
        <circle
          cx={37} cy={37} r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 37 37)"
        />
        <text x={37} y={41} textAnchor="middle" fontSize={15} fontWeight={700} fill={color}>{pct}</text>
      </svg>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
    </div>
  );
}

// ─── issue severity chip ──────────────────────────────────────────────────────

function SevChip({ sev }: { sev: string }) {
  const s = (sev ?? "").toLowerCase();
  const bg = s === "critical" ? "#fef2f2" : s === "warning" ? "#fffbeb" : "#f0fdf4";
  const col = s === "critical" ? "#dc2626" : s === "warning" ? "#d97706" : "#16a34a";
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: col, background: bg, border: `1px solid ${col}33`, borderRadius: 4, padding: "1px 6px" }}>
      {sev?.toUpperCase() ?? "INFO"}
    </span>
  );
}

// ─── check row ───────────────────────────────────────────────────────────────

function CheckRow({ chk }: { chk: any }) {
  const passed = chk.passed === true || chk.status === "pass" || chk.status === "ok";
  const failed = chk.passed === false || chk.status === "fail" || chk.status === "error";
  const icon = passed ? "✓" : failed ? "✗" : "~";
  const color = passed ? "#22c55e" : failed ? "#ef4444" : "#eab308";
  return (
    <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
      <span style={{ fontWeight: 700, color, fontSize: 13, flexShrink: 0, width: 14, textAlign: "center" }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{chk.name ?? chk.check ?? chk.label}</div>
        {chk.detail && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{chk.detail}</div>}
        {chk.value !== undefined && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
            Value: <strong>{typeof chk.value === "object" ? val(chk.value) : String(chk.value)}</strong>
            {typeof chk.value === "object" && badge(chk.value)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

interface ReportData {
  runId: string;
  domain: string;
  url: string;
  audit: any;
  onpage: any;
  da: any;
  backlinks: any;
  suggestions: any;
  volumeMap: Map<string, any>;
}

export default function UrlReport() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runReport() {
    const raw = input.trim();
    if (!raw) return;

    const domain = extractDomain(raw);
    if (!domain) { setError("Could not parse domain from URL."); return; }
    const url = normalizeUrl(raw);

    setLoading(true);
    setError(null);
    setReport(null);
    setProgress(["Finding latest crawl run…"]);

    try {
      // 1. Find the latest run that contains this domain
      const history = await fetchHistory();
      let runId: string | null = null;
      outer:
      for (const day of history.days ?? []) {
        for (const run of day.runs ?? []) {
          const sites: any[] = (run as any).sites ?? [];
          for (const s of sites) {
            if ((s.hostname ?? "").replace(/^www\./, "") === domain) {
              runId = run.runId;
              break outer;
            }
          }
        }
      }

      if (!runId) {
        // No crawl run found — still run free-tier providers
        setProgress((p) => [...p, "No crawl run found for this domain — running free-tier data only…"]);
      } else {
        setProgress((p) => [...p, `Found run ${runId} — fetching all data in parallel…`]);
      }

      // 2. Fire everything in parallel
      const [auditResult, onpageResult, daResult, backlinksResult, suggestResult] = await Promise.allSettled([
        runId ? fetchSiteAudit(runId) : Promise.resolve(null),
        runId ? fetchOnPageSeoChecker(runId, url) : Promise.resolve(null),
        fetchDomainAuthority(domain),
        fetchExternalBacklinks(domain),
        fetchKeywordSuggestions(domain.split(".")[0]),
      ]);

      setProgress((p) => [...p, "Data received — fetching keyword volumes…"]);

      // 3. Get volumes for suggestions
      let volumeMap = new Map<string, any>();
      const suggestData = suggestResult.status === "fulfilled" ? suggestResult.value : null;
      const keywords: string[] = [
        ...(suggestData?.suggestions ?? []).slice(0, 8),
        ...(suggestData?.questions ?? []).slice(0, 4),
      ].filter(Boolean);

      if (keywords.length > 0) {
        try {
          const volData = await fetchKeywordVolume(keywords.slice(0, 12));
          for (const item of volData?.results ?? []) {
            volumeMap.set(item.keyword?.toLowerCase(), item);
          }
        } catch {
          // volume optional
        }
      }

      setProgress((p) => [...p, "Done."]);

      setReport({
        runId: runId ?? "(no crawl)",
        domain,
        url,
        audit: auditResult.status === "fulfilled" ? auditResult.value : null,
        onpage: onpageResult.status === "fulfilled" ? onpageResult.value : null,
        da: daResult.status === "fulfilled" ? daResult.value : null,
        backlinks: backlinksResult.status === "fulfilled" ? backlinksResult.value : null,
        suggestions: suggestData,
        volumeMap,
      });
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>
          URL Report
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
          Enter any URL — we pull crawl data, on-page SEO, domain authority, backlinks, and keyword suggestions all at once.
        </p>
      </div>

      {/* Input bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && runReport()}
          placeholder="https://example.com/page"
          style={{
            flex: 1, padding: "10px 14px", fontSize: 14, borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)", background: "var(--glass)", color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          onClick={runReport}
          disabled={loading || !input.trim()}
          className="qa-btn-primary"
          style={{ padding: "10px 22px", fontSize: 14, fontWeight: 600 }}
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {/* Progress log */}
      {loading && progress.length > 0 && (
        <div style={{
          background: "var(--glass2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
          padding: "12px 16px", marginBottom: 20, fontSize: 12.5, color: "var(--muted)",
        }}>
          {progress.map((p, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              {i === progress.length - 1 && loading ? "⏳ " : "✓ "}{p}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius-sm)",
          padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#dc2626",
        }}>
          {error}
        </div>
      )}

      {/* Report */}
      {report && <ReportView report={report} />}
    </div>
  );
}

// ─── Report rendering ─────────────────────────────────────────────────────────

function ReportView({ report }: { report: ReportData }) {
  const { domain, url, audit, onpage, da, backlinks, suggestions, volumeMap } = report;

  const auditScore = audit?.score ?? audit?.healthScore ?? null;
  const onpageScore = val(onpage?.overallScore) ?? null;
  const daScore = val(da?.authority0to100) ?? null;

  // Issues
  const issues: any[] = audit?.issues ?? audit?.summary?.issues ?? [];
  const critCount = issues.filter((i: any) => (i.severity ?? i.level ?? "").toLowerCase() === "critical").length;
  const warnCount = issues.filter((i: any) => (i.severity ?? i.level ?? "").toLowerCase() === "warning").length;

  // On-page checks
  const checks: any[] = onpage?.checks ?? [];

  // DA fields
  const pageRank = val(da?.pageRankDecimal);
  const globalRank = val(da?.globalRank);

  // Backlinks
  const blCount = backlinks?.totalBacklinks ?? backlinks?.total ?? backlinks?.count ?? null;
  const blRefs = backlinks?.referringDomains ?? backlinks?.refDomains ?? null;
  const blLinks: any[] = backlinks?.backlinks ?? backlinks?.links ?? [];

  // Suggestions
  const suggestionList: string[] = suggestions?.suggestions ?? [];
  const questionList: string[] = suggestions?.questions ?? [];

  return (
    <div>
      {/* Domain header */}
      <div style={{
        background: "var(--glass)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
        padding: "18px 24px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>{domain}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, wordBreak: "break-all" }}>{url}</div>
        </div>
        {/* Score rings */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {auditScore !== null && <ScoreRing score={Number(auditScore)} label="Site Health" />}
          {onpageScore !== null && <ScoreRing score={Number(onpageScore)} label="On-Page SEO" />}
          {daScore !== null && <ScoreRing score={Number(daScore)} label="Domain Auth." />}
        </div>
      </div>

      {/* Grid layout for the cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* ── Site Audit ────────────────────────────────────────── */}
        <Card title="Site Health" icon="⬡">
          {audit ? (
            <>
              <KV label="Health Score" value={auditScore !== null ? `${auditScore}/100` : "—"} />
              <KV label="Pages Crawled" value={audit.summary?.totalPages ?? audit.pageCount ?? "—"} />
              <KV label="Critical Issues" value={<span style={{ color: critCount > 0 ? "#dc2626" : "inherit" }}>{critCount}</span>} />
              <KV label="Warnings" value={<span style={{ color: warnCount > 0 ? "#d97706" : "inherit" }}>{warnCount}</span>} />
              {issues.slice(0, 6).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)", marginBottom: 8 }}>Top Issues</div>
                  {issues.slice(0, 6).map((iss: any, i: number) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                      <SevChip sev={iss.severity ?? iss.level ?? "info"} />
                      <span style={{ fontSize: 12.5 }}>{iss.title ?? iss.message ?? iss.description ?? JSON.stringify(iss)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <NotAvailable reason="No crawl run found for this domain. Run a crawl from the Dashboard first." />
          )}
        </Card>

        {/* ── Domain Authority ──────────────────────────────────── */}
        <Card title="Domain Authority" icon="◈">
          {da && !da.error && da.configured !== false ? (
            <>
              <KV label="Authority (0–100)" value={<>{daScore ?? "—"}{badge(da.authority0to100)}</>} />
              <KV label="PageRank" value={<>{pageRank !== null ? Number(pageRank).toFixed(2) : "—"}{badge(da.pageRankDecimal)}</>} />
              <KV label="Global Rank" value={<>{globalRank !== null ? `#${Number(globalRank).toLocaleString()}` : "—"}{badge(da.globalRank)}</>} />
            </>
          ) : da?.configured === false ? (
            <NotAvailable reason="OpenPageRank not configured. Add OPEN_PAGE_RANK_API_KEY to .env (free at openpagerank.com)." />
          ) : (
            <NotAvailable reason="Domain authority data unavailable." />
          )}
        </Card>

        {/* ── Backlinks ─────────────────────────────────────────── */}
        <Card title="Backlink Profile" icon="⬡">
          {backlinks && !backlinks.error ? (
            <>
              <KV label="Total Backlinks" value={blCount !== null ? Number(blCount).toLocaleString() : "—"} />
              <KV label="Referring Domains" value={blRefs !== null ? Number(blRefs).toLocaleString() : "—"} />
              {blLinks.slice(0, 5).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)", marginBottom: 8 }}>Recent Links</div>
                  {blLinks.slice(0, 5).map((lnk: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--border)", wordBreak: "break-all", color: "var(--muted)" }}>
                      {lnk.sourceUrl ?? lnk.url ?? lnk.source ?? String(lnk)}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <NotAvailable reason="Backlink data unavailable from free-tier providers." />
          )}
        </Card>

        {/* ── Keyword Suggestions ───────────────────────────────── */}
        <Card title="Keyword Suggestions" icon="◎">
          {suggestionList.length > 0 || questionList.length > 0 ? (
            <>
              {suggestionList.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)", marginBottom: 8 }}>Related Keywords</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                    {suggestionList.slice(0, 12).map((kw: string) => {
                      const volItem = volumeMap.get(kw.toLowerCase());
                      const vol = volItem ? val(volItem.avgMonthlySearches) : null;
                      return (
                        <span key={kw} style={{
                          fontSize: 12, padding: "3px 9px", borderRadius: 20,
                          background: "var(--glass2)", border: "1px solid var(--border)",
                          display: "flex", alignItems: "center", gap: 5,
                        }}>
                          {kw}
                          {vol !== null && (
                            <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 700 }}>
                              {Number(vol).toLocaleString()}/mo
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
              {questionList.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)", marginBottom: 8 }}>People Also Ask</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {questionList.slice(0, 6).map((q: string) => (
                      <div key={q} style={{ fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                        ❓ {q}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <NotAvailable reason="No keyword suggestions found." />
          )}
        </Card>
      </div>

      {/* ── On-Page SEO Checks (full width) ────────────────────── */}
      {onpage && checks.length > 0 && (
        <Card title="On-Page SEO Checks" icon="▦">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
            {checks.map((chk: any, i: number) => <CheckRow key={i} chk={chk} />)}
          </div>
        </Card>
      )}

      {!onpage && (
        <Card title="On-Page SEO Checks" icon="▦">
          <NotAvailable reason="On-page SEO check unavailable — no crawl run found for this domain." />
        </Card>
      )}
    </div>
  );
}

function NotAvailable({ reason }: { reason: string }) {
  return (
    <div style={{ padding: "18px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
      <div style={{ fontSize: 22, marginBottom: 8 }}>—</div>
      {reason}
    </div>
  );
}
