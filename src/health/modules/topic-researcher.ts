import type { SiteHealthReport } from "../types.js";
import { generateText } from "../llm.js";
import { fetchSuggestions, fetchQuestionSuggestions } from "../providers/google-suggest.js";
import { fetchBestMatchPageviews } from "../providers/wikipedia-pageviews.js";
import { dp, type DataPoint } from "../providers/types.js";

// ── Unit 4 honesty goal ──────────────────────────────────────────────────────
//
// The OLD version asked the LLM to invent subtopics, search-volume trends,
// questions with "searchPotential", competitive landscape, and a 4-week content
// calendar — all from thin air. None of it would survive cross-checking against
// Semrush.
//
// This rewrite restricts the LLM to plain-text cluster labels and content-
// angle suggestions (≤200 chars each). Every numeric/volume field is replaced
// with a real provider:
//
//   - subtopics              → Google Suggest 2-level cascade
//   - questions              → Google Suggest question-prefix expansion
//   - topic popularity proxy → Wikipedia monthly pageviews
//
// Any subtopic the LLM tries to invent that wasn't in the real discovery set
// is dropped before rendering.
//
// ─────────────────────────────────────────────────────────────────────────────

type DataQuality = {
  realDataFields: string[];
  estimatedFields: string[];
  missingFields: string[];
  providersHit: string[];
  providersFailed: string[];
};

export interface TopicSubtopic {
  name: string;
  source: "google-suggest" | "google-suggest-cascade" | "crawl";
  /** Parent seed keyword that produced this cascade suggestion. */
  parentSeed?: string;
  /** Real monthly pageviews proxy from Wikipedia. DataPoint<number>. */
  pageviewsProxy?: DataPoint<number>;
  /** Cluster label assigned by the LLM (qualitative only). */
  clusterLabel?: string;
}

export interface TopicQuestion {
  question: string;
  source: "google-suggest-question";
}

export interface TopicAngle {
  angle: string;
  contentFormat: string;
}

export interface TopicCalendarEntry {
  week: number;
  topic: string;
  /** Must be drawn from the real subtopic set. */
  source: "real-subtopic";
}

export interface TopicResearchResult {
  topic: string;
  subtopics: TopicSubtopic[];
  questions: TopicQuestion[];
  angles: TopicAngle[];
  contentCalendar: TopicCalendarEntry[];
  meta: {
    topicPopularity?: DataPoint<number>;
    totalSubtopicsDiscovered: number;
    totalQuestionsDiscovered: number;
    crawlHostnames: string[];
  };
  dataQuality: DataQuality;
}

export async function researchTopic(topic: string, reports?: SiteHealthReport[], region = ""): Promise<TopicResearchResult> {
  const clean = topic.trim();
  const providersHit: string[] = [];
  const providersFailed: string[] = [];
  const realDataFields: string[] = [];
  const estimatedFields: string[] = [];
  const missingFields: string[] = [];

  // ── Step 1: Wikipedia pageviews as a topic popularity proxy ─────────────
  let topicPopularity: DataPoint<number> | undefined;
  try {
    const wiki = await fetchBestMatchPageviews([clean, clean.replace(/\s+/g, "_")]);
    if (wiki && wiki.value > 0) {
      topicPopularity = wiki;
      providersHit.push("wikipedia-pageviews");
      realDataFields.push("topicPopularity");
    } else {
      providersFailed.push("wikipedia-pageviews");
    }
  } catch {
    providersFailed.push("wikipedia-pageviews");
  }

  // ── Step 2: First-level Google Suggest cascade ─────────────────────────
  let firstLevel: string[] = [];
  try {
    const res = await fetchSuggestions(clean, "en", region);
    firstLevel = res.value;
    if (firstLevel.length > 0) {
      providersHit.push("google-suggest");
      realDataFields.push("subtopics");
    }
  } catch {
    providersFailed.push("google-suggest");
  }

  // ── Step 3: Second-level cascade over top 5 first-level hits ───────────
  // This gives us a wider, real-search-behavior grounded topic map.
  const cascadeSeen = new Set<string>([clean.toLowerCase(), ...firstLevel.map((s) => s.toLowerCase())]);
  const secondLevel: { keyword: string; parentSeed: string }[] = [];
  for (const seed of firstLevel.slice(0, 5)) {
    try {
      const res = await fetchSuggestions(seed, "en", region);
      for (const s of res.value) {
        const lc = s.toLowerCase();
        if (!cascadeSeen.has(lc)) {
          cascadeSeen.add(lc);
          secondLevel.push({ keyword: s, parentSeed: seed });
        }
      }
    } catch {
      /* continue with next seed */
    }
  }

  const subtopics: TopicSubtopic[] = [
    ...firstLevel.slice(0, 10).map<TopicSubtopic>((name) => ({ name, source: "google-suggest" })),
    ...secondLevel.slice(0, 10).map<TopicSubtopic>((e) => ({
      name: e.keyword,
      source: "google-suggest-cascade",
      parentSeed: e.parentSeed,
    })),
  ];

  // ── Step 4: Add crawl-derived subtopics if a run context was provided ──
  if (reports && reports.length > 0) {
    const crawlTitles = reports
      .flatMap((r) => r.crawl.pages)
      .filter((p) => p.documentTitle)
      .map((p) => p.documentTitle as string)
      .slice(0, 10);
    for (const t of crawlTitles) {
      if (!cascadeSeen.has(t.toLowerCase())) {
        cascadeSeen.add(t.toLowerCase());
        subtopics.push({ name: t, source: "crawl" });
      }
    }
    if (crawlTitles.length > 0) {
      if (!providersHit.includes("crawl")) providersHit.push("crawl");
      realDataFields.push("subtopics.crawl");
    }
  }

  // ── Step 5: Enrich top 5 subtopics with Wikipedia pageviews ────────────
  for (let i = 0; i < Math.min(5, subtopics.length); i++) {
    try {
      const pv = await fetchBestMatchPageviews([subtopics[i].name, subtopics[i].name.replace(/\s+/g, "_")]);
      if (pv && pv.value > 0) {
        subtopics[i].pageviewsProxy = pv;
      }
    } catch {
      /* skip */
    }
  }

  // ── Step 6: Real question list via Google Suggest question-prefix expansion ──
  let questions: TopicQuestion[] = [];
  try {
    const res = await fetchQuestionSuggestions(clean, "en", region);
    questions = res.value.slice(0, 15).map((q) => ({ question: q, source: "google-suggest-question" }));
    if (questions.length > 0) realDataFields.push("questions");
  } catch {
    /* leave empty */
  }

  // ── Step 7: LLM — cluster labels + content angles ONLY ─────────────────
  // The LLM is NOT allowed to invent subtopics, volumes, or "search potential".
  const subtopicNames = subtopics.map((s) => s.name);
  const realSet = new Set(subtopicNames.map((n) => n.toLowerCase()));

  let angles: TopicAngle[] = [];
  let clusterLabels: Record<string, string> = {};

  if (subtopicNames.length >= 3) {
    const prompt = `You are an SEO content strategist. You are given a list of REAL subtopics discovered via Google autocomplete and a site crawl. Your ONLY two jobs are:
  (A) Assign a short cluster label (≤30 chars) to each subtopic by grouping similar ones.
  (B) Propose 5 content angles based on the real subtopics.

STRICT RULES:
- Do NOT invent subtopics, volumes, difficulty, or "search potential".
- Do NOT produce any numbers or statistics.
- Cluster labels and angles must be qualitative text only.

Real subtopics:
${subtopicNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Return ONLY valid JSON (no markdown, no backticks):
{
  "clusters": { "<subtopic exact text>": "<cluster label>" },
  "angles": [{ "angle": "short content angle", "contentFormat": "Blog Post|Guide|Tutorial|Video|Listicle|Comparison" }]
}

Produce 5 angles, each ≤120 chars.`;

    try {
      const text = await generateText(prompt);
      const clean2 = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(clean2) as {
        clusters?: Record<string, unknown>;
        angles?: { angle?: unknown; contentFormat?: unknown }[];
      };

      if (parsed.clusters && typeof parsed.clusters === "object") {
        // Only honor clusters for keys that exist in the real set.
        for (const [key, label] of Object.entries(parsed.clusters)) {
          if (realSet.has(key.toLowerCase()) && typeof label === "string") {
            clusterLabels[key.toLowerCase()] = label.slice(0, 60);
          }
        }
      }
      if (Array.isArray(parsed.angles)) {
        angles = parsed.angles
          .filter((a): a is { angle: string; contentFormat: string } =>
            typeof a?.angle === "string" && typeof a?.contentFormat === "string",
          )
          .slice(0, 5)
          .map((a) => ({ angle: a.angle.slice(0, 200), contentFormat: a.contentFormat.slice(0, 40) }));
      }
      if (angles.length > 0) estimatedFields.push("angles");
      if (Object.keys(clusterLabels).length > 0) estimatedFields.push("clusterLabels");
    } catch {
      /* LLM failed — leave angles empty, subtopics keep raw source */
    }
  }

  // Attach cluster labels to subtopics (only if from real set).
  for (const st of subtopics) {
    const label = clusterLabels[st.name.toLowerCase()];
    if (label) st.clusterLabel = label;
  }

  // ── Step 8: Deterministic content calendar — weeks × real subtopics ────
  const contentCalendar: TopicCalendarEntry[] = subtopics.slice(0, 4).map((st, i) => ({
    week: i + 1,
    topic: st.name,
    source: "real-subtopic",
  }));

  if (subtopics.length === 0) missingFields.push("subtopics");
  if (questions.length === 0) missingFields.push("questions");
  if (angles.length === 0) missingFields.push("angles");

  return {
    topic: clean,
    subtopics,
    questions,
    angles,
    contentCalendar,
    meta: {
      topicPopularity,
      totalSubtopicsDiscovered: subtopics.length,
      totalQuestionsDiscovered: questions.length,
      crawlHostnames: reports?.map((r) => r.hostname) ?? [],
    },
    dataQuality: {
      realDataFields: Array.from(new Set(realDataFields)),
      estimatedFields: Array.from(new Set(estimatedFields)),
      missingFields,
      providersHit: Array.from(new Set(providersHit)),
      providersFailed: Array.from(new Set(providersFailed)),
    } satisfies DataQuality,
  };
}
