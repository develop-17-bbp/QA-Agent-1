import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchIntegrationsStatus, saveRuntimeKeys, clearRuntimeKey, type IntegrationsStatus, type IntegrationCard as CardData, type ByokProviderStatus } from "../api";
import { PageShell, SectionCard, EmptyState } from "../components/PageUI";
import { ErrorBanner, LoadingPanel } from "../components/UI";

type CardVisual = {
  id: string;
  name: string;
  tagline: string;
  accentColor: string;
  logoChar: string;
};

// Brand-adjacent colors + single-character "logo" so we don't bundle assets.
const VISUALS: Record<string, CardVisual> = {
  google: { id: "google", name: "Google", tagline: "Search Console · Analytics 4 · Ads · PageSpeed · CrUX", accentColor: "#4285f4", logoChar: "G" },
  bing: { id: "bing", name: "Bing Webmaster Tools", tagline: "Inbound links · anchor text · ~40-60% of Ahrefs coverage", accentColor: "#00a4ef", logoChar: "B" },
  yandex: { id: "yandex", name: "Yandex Webmaster", tagline: "RU / KZ / BY markets · inbound links · indexing", accentColor: "#ff0000", logoChar: "Y" },
  naver: { id: "naver", name: "Naver Search Advisor", tagline: "Korean market · indexing · robots/sitemap validation", accentColor: "#03c75a", logoChar: "N" },
  ahrefsWebmaster: { id: "ahrefsWebmaster", name: "Ahrefs Webmaster Tools", tagline: "95% of paid Ahrefs data for your verified sites (CSV upload)", accentColor: "#ff6a00", logoChar: "Ah" },
  pagespeed: { id: "pagespeed", name: "PageSpeed Insights", tagline: "Lab-based Lighthouse scores for every crawled page", accentColor: "#34a853", logoChar: "PS" },
  openPageRank: { id: "openPageRank", name: "OpenPageRank", tagline: "Free domain authority score 0-100", accentColor: "#8b5cf6", logoChar: "PR" },
  urlscan: { id: "urlscan", name: "URLScan.io", tagline: "Brand monitor + recent scan intelligence", accentColor: "#f97316", logoChar: "US" },
  cloudflareRadar: { id: "cloudflareRadar", name: "Cloudflare Radar", tagline: "Real-world domain traffic rank from the Cloudflare network", accentColor: "#f38020", logoChar: "CF" },
  ollama: { id: "ollama", name: "Ollama (local AI)", tagline: "Runs AI narrative, clustering, commentary locally — no API calls", accentColor: "#111", logoChar: "Ol" },
  dataforseo: { id: "dataforseo", name: "DataForSEO", tagline: "Backlinks + SERP + keywords — cheapest paid alternative to Ahrefs", accentColor: "#2563eb", logoChar: "D4" },
  ahrefs: { id: "ahrefs", name: "Ahrefs Site Explorer API", tagline: "Full 35-trillion-link index for any URL lookup", accentColor: "#ff6a00", logoChar: "Ah" },
  semrush: { id: "semrush", name: "Semrush API", tagline: "Keyword DB + backlink DB + competitor analysis", accentColor: "#ff642d", logoChar: "Sm" },
  serpapi: { id: "serpapi", name: "SerpAPI", tagline: "Real Google SERP with proxies and CAPTCHA handling", accentColor: "#1a73e8", logoChar: "Sp" },
  moz: { id: "moz", name: "Moz Link Explorer", tagline: "Moz DA/PA + Mozscape link index", accentColor: "#0077c8", logoChar: "Mz" },
};

function statusBadge(connected: boolean): { text: string; bg: string; color: string } {
  return connected
    ? { text: "CONNECTED", bg: "#dcfce7", color: "#166534" }
    : { text: "NOT CONNECTED", bg: "#f1f5f9", color: "#64748b" };
}

function priceBadge(price: string, paid: boolean): { text: string; bg: string; color: string } {
  if (paid) return { text: price, bg: "#fef3c7", color: "#92400e" };
  return { text: price, bg: "#dcfce7", color: "#166534" };
}

interface IntegrationCardProps {
  visual: CardVisual;
  data: CardData;
  onConnect: () => void;
}

function IntegrationCard({ visual, data, onConnect }: IntegrationCardProps) {
  const connected = !!data.connected;
  const sb = statusBadge(connected);
  const pb = priceBadge(data.price, !data.price.toLowerCase().startsWith("free"));

  const kind = data.connectionKind;
  const canClickConnect = !!(data.connectUrl || data.uploadFlowUrl || kind === "api-key" || kind === "api-token" || kind === "api-keys");
  const ctaLabel = connected ? "Reconfigure" : (kind === "csv-upload" ? "Upload CSV" : "Connect");

  return (
    <div
      style={{
        padding: 18,
        border: connected ? "1px solid #86efac" : "1px solid var(--border)",
        borderRadius: 10,
        background: connected ? "#f0fdf4" : "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 200,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 10,
            background: visual.accentColor, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: visual.logoChar.length > 1 ? 14 : 22, fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {visual.logoChar}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>{visual.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>{visual.tagline}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 10, background: sb.bg, color: sb.color }}>
          {sb.text}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 10, background: pb.bg, color: pb.color }}>
          {pb.text}
        </span>
        {data.email && (
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#f1f5f9", color: "var(--muted)" }}>
            {data.email}
          </span>
        )}
      </div>

      {data.covers && data.covers.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, flex: 1 }}>
          {data.covers.slice(0, 3).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: "auto", alignItems: "center", flexWrap: "wrap" }}>
        {canClickConnect ? (
          <button
            onClick={onConnect}
            style={{
              padding: "8px 16px",
              border: `1px solid ${visual.accentColor}`,
              borderRadius: 8,
              background: connected ? "#fff" : visual.accentColor,
              color: connected ? visual.accentColor : "#fff",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {ctaLabel} {visual.name.split(" ")[0]}
          </button>
        ) : (
          <span style={{ fontSize: 11.5, color: "var(--muted)", fontStyle: "italic" }}>
            Already live (local process)
          </span>
        )}
        {data.helpUrl && (
          <a href={data.helpUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Docs ↗
          </a>
        )}
      </div>
    </div>
  );
}

interface KeyModalState {
  visual: CardVisual;
  card: CardData | null;
  byok?: ByokProviderStatus;
}

export default function IntegrationsHub() {
  const [data, setData] = useState<IntegrationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<KeyModalState | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  const refresh = async () => {
    setLoading(true); setError("");
    try {
      setData(await fetchIntegrationsStatus());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onConnect = (visual: CardVisual, card: CardData) => {
    if (card.connectUrl) {
      // OAuth integrations — redirect to consent page
      window.location.href = card.connectUrl;
      return;
    }
    if (card.uploadFlowUrl) {
      // CSV upload integrations — route to the page that handles it
      window.location.href = card.uploadFlowUrl;
      return;
    }
    // Key-paste integrations: open modal with instructions
    setModal({ visual, card });
  };

  const onConnectByok = (byok: ByokProviderStatus) => {
    const v = VISUALS[byok.id] ?? {
      id: byok.id, name: byok.label, tagline: byok.description, accentColor: "#64748b", logoChar: byok.label.slice(0, 2),
    };
    setModal({
      visual: v,
      card: null,
      byok,
    });
  };

  const googleBig = useMemo(() => data?.google, [data]);
  const freeCards = useMemo(() => {
    if (!data) return [];
    return [
      { id: "bing", data: data.bing },
      { id: "ahrefsWebmaster", data: data.ahrefsWebmaster },
      { id: "yandex", data: data.yandex },
      { id: "naver", data: data.naver },
      { id: "openPageRank", data: data.openPageRank },
      { id: "urlscan", data: data.urlscan },
      { id: "cloudflareRadar", data: data.cloudflareRadar },
      { id: "pagespeed", data: data.pagespeed },
      { id: "ollama", data: data.ollama },
    ];
  }, [data]);

  return (
    <PageShell
      title="Connections"
      desc="Connect every webmaster tool + AI source with one click each. Start with Google — it unlocks 5 products in one consent. Add Bing, Ahrefs, Yandex, Naver below for broader market + backlink coverage."
      purpose="Connect once, analyze everywhere — Google + Bing + Ahrefs + Yandex + Naver webmaster tools in one dashboard, with AI layered on top."
      sources={["GSC", "GA4", "Ads", "Bing", "Ahrefs", "Yandex", "Naver", "URLScan", "Cloudflare", "Ollama"]}
    >
      {loading && <LoadingPanel message="Loading connection status…" />}
      {error && <ErrorBanner error={error} />}

      {data && (
        <>
          {/* Hero — primary Google connect card (covers 5 products) */}
          {googleBig && (
            <div style={{
              padding: 24,
              border: googleBig.connected ? "2px solid #86efac" : "2px solid #4285f4",
              borderRadius: 14,
              background: googleBig.connected ? "#f0fdf4" : "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
              marginBottom: 22,
              display: "flex",
              alignItems: "center",
              gap: 20,
              flexWrap: "wrap",
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: "#4285f4", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 32, fontWeight: 700, flexShrink: 0,
              }}>G</div>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "#1d4ed8", marginBottom: 4 }}>
                  START HERE — ONE CONSENT UNLOCKS 5 PRODUCTS
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
                  {googleBig.connected ? `Connected as ${googleBig.email ?? "your Google account"}` : "Connect your Google account"}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                  Covers <strong>Search Console</strong>, <strong>Analytics 4</strong>, <strong>Ads Keyword Planner</strong>, <strong>PageSpeed</strong>, and <strong>CrUX</strong> — no separate API keys to paste.
                </div>
                {googleBig.connected && googleBig.scopes && googleBig.scopes.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                    Scopes: {googleBig.scopes.length}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {googleBig.connected ? (
                  <>
                    <Link to="/google-connections" className="qa-btn-ghost" style={{ padding: "10px 18px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", fontWeight: 600 }}>Manage</Link>
                    <a href="/api/auth/google/start" className="qa-btn-primary" style={{ padding: "10px 18px", borderRadius: 8, background: "#4285f4", color: "#fff", fontWeight: 700, textDecoration: "none" }}>
                      Reconnect
                    </a>
                  </>
                ) : (
                  <a href="/api/auth/google/start" className="qa-btn-primary" style={{ padding: "12px 24px", borderRadius: 10, background: "#4285f4", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none", boxShadow: "0 2px 8px rgba(66,133,244,0.35)" }}>
                      Connect Google →
                    </a>
                )}
              </div>
            </div>
          )}

          {/* Free webmaster tools + data sources */}
          <SectionCard
            title="Free webmaster tools & data sources"
            subtitle="No credit card. Connect as many as you need — more connections = broader coverage."
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
              {freeCards.map(({ id, data: card }) => (
                <IntegrationCard
                  key={id}
                  visual={VISUALS[id]!}
                  data={card}
                  onConnect={() => onConnect(VISUALS[id]!, card)}
                />
              ))}
            </div>
          </SectionCard>

          {/* Paid — bring your own key */}
          <SectionCard
            title="Paid APIs — Bring Your Own Key"
            subtitle="Already paying Ahrefs, Semrush, DataForSEO etc.? Paste the API key and we'll layer the paid data into every relevant page. You're paying for data you already own — not paying us extra for it."
          >
            {data.byok.length === 0 ? (
              <EmptyState title="No paid BYOK slots wired yet" />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
                {data.byok.map((byok) => {
                  const v = VISUALS[byok.id] ?? {
                    id: byok.id, name: byok.label, tagline: byok.description,
                    accentColor: "#64748b", logoChar: byok.label.slice(0, 2),
                  };
                  const asCard: CardData = {
                    connected: byok.configured,
                    connectionKind: "api-key",
                    apiKeyVar: byok.envVars[0],
                    helpUrl: byok.signUpUrl,
                    covers: [byok.description, byok.pricingHint],
                    price: byok.pricingHint,
                  };
                  return (
                    <IntegrationCard
                      key={byok.id}
                      visual={v}
                      data={asCard}
                      onConnect={() => onConnectByok(byok)}
                    />
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {modal && (
        <KeyInstructionModal
          state={modal}
          onClose={() => { setModal(null); void refresh(); }}
        />
      )}
    </PageShell>
  );
}

function KeyInstructionModal({ state, onClose }: { state: KeyModalState; onClose: () => void }) {
  const { visual, card, byok } = state;
  const envVar = card?.apiKeyVar ?? byok?.envVars[0] ?? "";
  const envVars = useMemo(() => byok?.envVars ?? (envVar ? [envVar] : []), [byok, envVar]);
  const helpUrl = card?.helpUrl ?? byok?.signUpUrl;
  const alreadyConfigured = !!(card?.connected || byok?.configured);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of envVars) init[v] = "";
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  const hasAllValues = envVars.every((v) => values[v] && values[v]!.trim().length > 0);

  const onSave = async () => {
    setSaveError("");
    setSaving(true);
    try {
      await saveRuntimeKeys(values);
      setSaved(true);
      // Small grace window so user sees the success state before the modal closes + list refreshes
      setTimeout(onClose, 700);
    } catch (e: any) {
      setSaveError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDisconnect = async () => {
    setSaveError("");
    setSaving(true);
    try {
      for (const v of envVars) await clearRuntimeKey(v);
      setSaved(true);
      setTimeout(onClose, 500);
    } catch (e: any) {
      setSaveError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          maxWidth: 540,
          width: "100%",
          boxShadow: "0 20px 50px rgba(15,23,42,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: visual.accentColor, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: visual.logoChar.length > 1 ? 14 : 22, fontWeight: 700,
          }}>{visual.logoChar}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {alreadyConfigured ? "Reconfigure " : "Connect "}{visual.name}
            </div>
            {byok && <div style={{ fontSize: 12, color: "var(--muted)" }}>{byok.pricingHint}</div>}
          </div>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
          {byok
            ? <>This is a <strong>paid API</strong>. Paste the credential you already own — it's saved server-side to <code>data/runtime-keys.json</code> (mode 0600) and used on the next request. No restart.</>
            : <>{visual.tagline}. Get the key from the provider, paste it here — we save it server-side and use it immediately.</>}
        </div>

        {helpUrl && (
          <div style={{ marginBottom: 12 }}>
            <a href={helpUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: visual.accentColor, fontWeight: 600, textDecoration: "none" }}>
              Open {visual.name} setup page ↗
            </a>
          </div>
        )}

        <div style={{ padding: 14, background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 12 }}>
          {envVars.map((v) => (
            <div key={v} style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)", marginBottom: 4 }}>
                {v}
              </label>
              <input
                type={/(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(v) ? "password" : "text"}
                value={values[v] ?? ""}
                onChange={(e) => setValues((cur) => ({ ...cur, [v]: e.target.value }))}
                placeholder={alreadyConfigured ? "(already set — paste to replace)" : "Paste value…"}
                autoComplete="off"
                spellCheck={false}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                disabled={saving}
              />
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>
            Saved locally on this server only. Never sent to Anthropic, QA-Agent Cloud, or any other third party.
          </div>
        </div>

        {saveError && <div style={{ background: "#fef2f2", color: "#991b1b", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{saveError}</div>}
        {saved && <div style={{ background: "#dcfce7", color: "#166534", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 10 }}>✓ Saved — active on next request</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          {alreadyConfigured ? (
            <button
              onClick={onDisconnect}
              disabled={saving}
              style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", fontWeight: 600, cursor: saving ? "default" : "pointer", fontSize: 12 }}
            >
              Disconnect
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              disabled={saving}
              style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border)", background: "#fff", fontWeight: 600, cursor: saving ? "default" : "pointer" }}
            >Cancel</button>
            <button
              onClick={onSave}
              disabled={saving || !hasAllValues}
              style={{
                padding: "8px 18px", borderRadius: 6, border: "none",
                background: hasAllValues ? visual.accentColor : "#cbd5e1",
                color: "#fff", fontWeight: 700, fontSize: 13,
                cursor: saving || !hasAllValues ? "default" : "pointer",
              }}
            >
              {saving ? "Saving…" : (alreadyConfigured ? "Update" : "Save & connect")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
