/**
 * CouncilSidecar — embedded "Ask the Council" card that any feature page
 * can drop in at the bottom. Fires /api/term-intel on click, renders the
 * cross-source breakdown + 4 advisor verdicts inline so users don't have
 * to navigate away.
 *
 * Usage:
 *   <CouncilSidecar term={keyword} domain={site} />
 *   <CouncilSidecar term={domain} autoInvoke />
 *
 * Props:
 *   - term:       primary entity (keyword / domain / topic) the page is about
 *   - domain:     optional scope for anchor/GSC sources
 *   - autoInvoke: fire the lookup on mount without user clicking Ask.
 *                 Respects the Auto-Council localStorage preference; if
 *                 the user has turned auto-council off globally, this
 *                 renders the card collapsed with an Ask button instead.
 *   - defaultOpen: force the collapsed/expanded starting state
 */

import { useEffect, useRef, useState } from "react";
import { runTermIntelApi, type TermIntelResponse, type TermIntelSource, type CouncilAdvisor } from "../api";
import { Link } from "react-router-dom";

export const AUTO_COUNCIL_KEY = "qa-auto-council";

export function readAutoCouncilPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_COUNCIL_KEY) === "1";
}

export function writeAutoCouncilPreference(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_COUNCIL_KEY, on ? "1" : "0");
}

export interface CouncilSidecarProps {
  term: string | undefined | null;
  domain?: string | undefined | null;
  autoInvoke?: boolean;
  defaultOpen?: boolean;
}

export default function CouncilSidecar({ term, domain, autoInvoke, defaultOpen = false }: CouncilSidecarProps) {
  const t = (term ?? "").trim();
  const d = (domain ?? "").trim() || undefined;
  const [open, setOpen] = useState(defaultOpen || autoInvoke === true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<TermIntelResponse | null>(null);
  const invokedFor = useRef<string>(""); // prevent double-fire on re-renders

  const run = async () => {
    if (!t || loading) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const resp = await runTermIntelApi(t, { domain: d, includeLlm: true });
      setData(resp);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoInvoke || !t) return;
    // Respect the user's Auto-Council preference. If off, render collapsed
    // with an Ask button (same UX as manual sidecar).
    if (!readAutoCouncilPreference()) { setOpen(false); return; }
    const key = `${t}::${d ?? ""}`;
    if (invokedFor.current === key) return;
    invokedFor.current = key;
    setOpen(true);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, d, autoInvoke]);

  if (!t) return null;

  const council = data?.council && !("error" in (data.council as any))
    ? (data.council as Exclude<typeof data.council, null | { error: string }>)
    : null;
  const councilErr = data?.council && "error" in (data.council as any) ? (data.council as { error: string }).error : null;

  const headerBg = data
    ? (data.intel.sourcesHit.length >= 5 ? "#f0fdf4" : data.intel.sourcesHit.length >= 3 ? "#eff6ff" : "#fefce8")
    : "var(--accent-light)";

  return (
    <div
      className="qa-panel"
      style={{
        marginTop: 24,
        border: "1px solid var(--accent-muted)",
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        background: headerBg,
        borderBottom: open ? "1px solid var(--border)" : "none",
      }}>
        <span aria-hidden style={{ fontSize: 18 }}>🧭</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            Council — cross-source intel on “{t.length > 48 ? t.slice(0, 48) + "…" : t}”
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            Queries every configured source in parallel (Ads, Trends, Suggest, GSC, Bing/Yandex/Ahrefs anchors, RSS, SERPs) and runs 4 AI advisors.
            {d && <> Scoped to <code>{d}</code>.</>}
          </div>
        </div>
        {data && (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 10, background: "#dcfce7", color: "#166534", textTransform: "uppercase" }}>
            {data.intel.sourcesHit.length}/{data.intel.perSource.length} sources
          </span>
        )}
        {!data && !loading && (
          <button
            onClick={() => { setOpen(true); void run(); }}
            className="qa-btn-primary"
            style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 700 }}
          >
            Ask the Council
          </button>
        )}
        {loading && (
          <span className="qa-spinner" aria-hidden style={{ width: 16, height: 16 }} />
        )}
        {data && (
          <Link
            to={`/term-intel?term=${encodeURIComponent(t)}${d ? `&domain=${encodeURIComponent(d)}` : ""}`}
            style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}
            title="Open the full Term Intel page for this term"
          >
            Full view →
          </Link>
        )}
        {(data || error || loading) && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse" : "Expand"}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
          >
            ▾
          </button>
        )}
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: 16 }}>
          {loading && (
            <div style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>
              Querying every configured source… AI advisors run last (~8-25s on local Ollama).
            </div>
          )}
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: 6, background: "#fef2f2", color: "#991b1b", fontSize: 12.5 }}>
              {error}
            </div>
          )}
          {councilErr && (
            <div style={{ padding: "8px 12px", borderRadius: 6, background: "#fef2f2", color: "#991b1b", fontSize: 12, marginBottom: 10 }}>
              AI advisor panel failed: {councilErr}. Raw source data below is still valid.
            </div>
          )}
          {data && (
            <>
              {/* Source chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {data.intel.perSource.map((s) => (
                  <SourceChip key={s.id} source={s} />
                ))}
              </div>

              {/* Council synthesis + 4 advisors */}
              {council && (
                <>
                  <div style={{ padding: "10px 14px", borderRadius: 8, background: "#f0f9ff", border: "1px solid #bae6fd", fontSize: 13, color: "var(--text)", lineHeight: 1.55, marginBottom: 10 }}>
                    <strong style={{ color: "#0369a1", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                      Council synthesis · {council.model}
                    </strong>
                    {council.synthesis}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {data.context.advisors.map((a) => (
                      <AdvisorCard key={a.id} advisor={a} verdict={council.verdicts[t]?.[a.id]} />
                    ))}
                  </div>
                </>
              )}

              {/* Footer */}
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 12 }}>
                Gather {data.elapsed.gatherMs}ms · LLM {data.elapsed.llmMs}ms ·{" "}
                <Link to={`/term-intel?term=${encodeURIComponent(t)}${d ? `&domain=${encodeURIComponent(d)}` : ""}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                  Open full breakdown with dropdowns →
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SourceChip({ source }: { source: TermIntelSource }) {
  const palette: Record<typeof source.status, { bg: string; color: string; icon: string }> = {
    ok:              { bg: "#dcfce7", color: "#166534", icon: "✓" },
    "no-data":       { bg: "#f1f5f9", color: "#64748b", icon: "—" },
    "not-configured":{ bg: "#fef3c7", color: "#92400e", icon: "×" },
    error:           { bg: "#fef2f2", color: "#991b1b", icon: "!" },
  };
  const p = palette[source.status];
  return (
    <span
      title={`${source.name}: ${source.headline}${source.metric ? ` (${source.metric})` : ""}`}
      style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
        padding: "3px 8px", borderRadius: 10,
        background: p.bg, color: p.color, textTransform: "uppercase",
      }}
    >
      {p.icon} {source.id}{source.metric ? ` · ${source.metric}` : ""}
    </span>
  );
}

function AdvisorCard({ advisor, verdict }: { advisor: CouncilAdvisor; verdict: string | undefined }) {
  return (
    <div
      title={advisor.focus}
      style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", flex: 1, minWidth: 200 }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
        {advisor.name}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>
        {verdict ?? <span style={{ color: "var(--muted)", fontStyle: "italic" }}>no verdict</span>}
      </div>
    </div>
  );
}
