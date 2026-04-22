/**
 * Council — generic cross-source consensus + LLM-panel framework.
 *
 * The project integrates 13+ SEO data sources. For almost every feature
 * (keyword intelligence, backlinks, SERP rank tracking, domain authority,
 * web vitals, brand monitoring) we pull from MULTIPLE sources and the most
 * valuable product question is: "which items does every source agree on?"
 *
 * Single-source signals are noise-prone — GSC only shows what you already
 * rank for, any single backlink index has blind spots, any single SERP
 * scraper has regional bias, etc. Cross-source agreement is what turns raw
 * data into product-grade insight.
 *
 * The Council framework standardizes how every multi-source feature
 * produces a tiered consensus view AND gets LLM commentary on it:
 *
 *   Producer:  queries N sources for a feature, normalizes into agenda items
 *              keyed on a canonical identifier (term, domain, url, etc.),
 *              tallies which sources agree, scores 0-100, buckets into
 *              top/mid/bottom tiers, and specifies the advisor personas
 *              that are relevant for THIS feature.
 *
 *   Runner:    takes any CouncilContext, builds a structured LLM prompt
 *              asking the model to role-play the specified advisors, and
 *              returns per-item verdicts + a synthesis. Generic: knows
 *              nothing about whether the items are keywords or backlinks.
 *
 *   Endpoint:  /api/council accepts { feature, ...featureSpecificInput }
 *              and dispatches to the right producer.
 *
 *   UI:        a single /council page with tabs (Keywords, Backlinks, SERP,
 *              ...) — each tab renders the same tiered-agenda + advisor-
 *              verdict layout against a different CouncilContext.
 */

/** Persona that sits on the council for a given feature. Each feature
 *  declares its own — keyword council has "content strategist" etc.,
 *  backlink council has "spam auditor" etc. */
export interface CouncilAdvisor {
  /** Stable id used as the JSON key in the LLM's verdict output. */
  id: string;
  /** Display name shown in the UI chip header. */
  name: string;
  /** One-line focus description used in the LLM persona priming AND
   *  shown to users as a tooltip. */
  focus: string;
}

/** One item the council discusses — could be a keyword, a referring domain,
 *  a (keyword, url) SERP pair, etc. Keyed on `id`. */
export interface CouncilAgendaItem {
  /** Stable identifier (term, domain, URL, or composite like "kw::dom"). */
  id: string;
  /** Human-readable label — what the UI shows. Often equals `id`. */
  label: string;
  /** Secondary line below label — optional context like "rank #3" or
   *  "DR 42, 120 links". */
  sublabel?: string;
  /** Which sources reported this item. Repetition across sources is the
   *  headline consensus signal — the length of this array drives tiering. */
  sources: string[];
  /** Feature-specific metrics. Render as a small key: value grid. */
  metrics: Record<string, number | string | undefined>;
  /** 0-100 — blends source count with per-source magnitude. Higher = more
   *  confident the item matters. */
  score: number;
  /** A few raw text variants we saw (first 3), e.g. anchor text variants
   *  that normalized to the same term. Empty for non-text features. */
  rawVariants?: string[];
}

/** Everything the runner needs to produce an LLM council verdict for this
 *  feature on this target. */
export interface CouncilContext {
  /** Which feature area this council is for (keywords, backlinks, serp, ...). */
  feature: string;
  /** Short display name for the feature — shown at the top of the panel. */
  featureLabel: string;
  /** One-line subtitle describing what "consensus" means for this feature. */
  featureTagline: string;
  /** Target the producer ran against — usually a domain. Shown in the UI
   *  header. */
  target: string;
  /** Sources we got data from. */
  sourcesQueried: string[];
  /** Sources we attempted but couldn't use + human-readable reasons. */
  sourcesFailed: { source: string; reason: string }[];
  /** Items that appear in 3+ sources — strongest consensus. */
  tierTop: CouncilAgendaItem[];
  /** Items in exactly 2 sources — partial agreement. */
  tierMid: CouncilAgendaItem[];
  /** Items in 1 source only — unique signal, not triangulated. */
  tierBottom: CouncilAgendaItem[];
  /** Total after filtering — lets the UI show "showing N of M". */
  totalItems: number;
  collectedAt: string;
  /** Advisor personas for this feature. Each will produce one verdict per
   *  agenda item the council reviews. */
  advisors: CouncilAdvisor[];
}

/** One advisor's verdict on one agenda item. Keyed by advisor.id in the
 *  runner output. */
export type CouncilVerdict = Record<string /* advisor.id */, string /* 1-sentence verdict */>;

/** What the runner returns after the LLM call. */
export interface CouncilResult {
  /** Verdicts keyed by agenda-item id → advisor id → verdict sentence. */
  verdicts: Record<string /* item.id */, CouncilVerdict>;
  /** 2-3 sentence overall synthesis from the panel. */
  synthesis: string;
  /** Items the LLM was asked about (subset of ctx.tierTop+tierMid). */
  reviewedItemIds: string[];
  model: string;
  durationMs: number;
}
