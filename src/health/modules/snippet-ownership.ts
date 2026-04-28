/**
 * Featured Snippet Ownership — for a list of tracked keywords, queries
 * DataForSEO live SERP and reports which featured-snippet ("position
 * zero") boxes the operator's domain owns vs which a competitor owns.
 *
 * Position zero is worth ~3x the click-through of position 1 — owning
 * one is enormously valuable. SEMrush charges separately for snippet
 * tracking; QA-Agent ships it as a thin wrapper over DFS live SERP.
 */

import { fetchDfsLiveSerp, isDfsConfigured } from "../providers/dataforseo.js";

export interface SnippetRow {
  keyword: string;
  /** Featured snippet present at all? */
  hasSnippet: boolean;
  /** Domain that owns the snippet (null when no snippet). */
  ownerDomain: string | null;
  /** True when ownerDomain matches operator's domain. */
  operatorOwns: boolean;
  /** Operator's organic position when not owning the snippet. 0 = not in top 30. */
  operatorPosition: number;
  /** Snippet preview text (truncated). */
  preview: string | null;
  /** Snippet URL. */
  ownerUrl: string | null;
}

export interface SnippetOwnershipResult {
  operatorDomain: string;
  region: string;
  device: "desktop" | "mobile";
  rows: SnippetRow[];
  summary: {
    totalKeywords: number;
    snippetsAvailable: number;
    operatorOwned: number;
    competitorOwned: number;
    /** Count of snippets currently owned by competitors where operator ranks in top 5 — high-leverage steal targets. */
    stealOpportunities: number;
  };
  generatedAt: string;
}

export interface SnippetOwnershipInput {
  operatorDomain: string;
  keywords: string[];
  region?: string;
  device?: "desktop" | "mobile";
}

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export async function trackSnippetOwnership(input: SnippetOwnershipInput): Promise<SnippetOwnershipResult> {
  if (!isDfsConfigured()) throw new Error("DataForSEO not configured — set credentials in /integrations");
  const operator = normalizeDomain(input.operatorDomain);
  const keywords = input.keywords.filter((k) => typeof k === "string" && k.trim()).slice(0, 50);
  if (keywords.length === 0) throw new Error("at least one keyword required");
  const region = input.region ?? "United States";
  const device = input.device ?? "desktop";

  const rows: SnippetRow[] = [];
  // Bounded concurrency 4 — respect DFS rate limits.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, keywords.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= keywords.length) return;
        const kw = keywords[i]!;
        try {
          const serp = await fetchDfsLiveSerp(kw, { locationName: region, device, depth: 30 });
          const featured = serp.items.find((it) => it.isFeaturedSnippet || it.itemType === "featured_snippet");
          const operatorOrganic = serp.items.find((it) => {
            try { return normalizeDomain(it.domain) === operator; } catch { return false; }
          });
          const ownerDomain = featured ? normalizeDomain(featured.domain) : null;
          rows.push({
            keyword: kw,
            hasSnippet: !!featured,
            ownerDomain,
            operatorOwns: !!ownerDomain && ownerDomain === operator,
            operatorPosition: operatorOrganic?.rank ?? 0,
            preview: featured?.description?.slice(0, 240) ?? null,
            ownerUrl: featured?.url ?? null,
          });
        } catch {
          rows.push({ keyword: kw, hasSnippet: false, ownerDomain: null, operatorOwns: false, operatorPosition: 0, preview: null, ownerUrl: null });
        }
      }
    }),
  );
  rows.sort((a, b) => a.keyword.localeCompare(b.keyword));

  const operatorOwned = rows.filter((r) => r.operatorOwns).length;
  const snippetsAvailable = rows.filter((r) => r.hasSnippet).length;
  const competitorOwned = snippetsAvailable - operatorOwned;
  const stealOpportunities = rows.filter((r) => r.hasSnippet && !r.operatorOwns && r.operatorPosition > 0 && r.operatorPosition <= 5).length;

  return {
    operatorDomain: operator,
    region,
    device,
    rows,
    summary: {
      totalKeywords: rows.length,
      snippetsAvailable,
      operatorOwned,
      competitorOwned,
      stealOpportunities,
    },
    generatedAt: new Date().toISOString(),
  };
}
