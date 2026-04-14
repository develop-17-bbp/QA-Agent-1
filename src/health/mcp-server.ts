/**
 * MCP (Model Context Protocol) Server for QA-Agent
 *
 * Exposes QA-Agent capabilities via JSON-RPC 2.0 over stdio.
 * Tools: list runs, site audit, keyword research, domain overview,
 * natural language query, SERP search, backlinks, content audit.
 *
 * Usage:
 *   node dist/health/mcp-server.js
 *   echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/health/mcp-server.js
 */

import { createInterface } from "node:readline";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type { HealthRunMeta } from "./orchestrate-health.js";
import { loadRawReportsForRun } from "./nlp-query-engine.js";
import { routeQuery } from "./nlp-query-engine.js";
import { analyzeSiteAudit } from "./modules/site-audit-analyzer.js";
import { extractKeywords } from "./modules/keyword-analyzer.js";
import { analyzeDomain } from "./modules/domain-analyzer.js";
import { analyzeBacklinks } from "./modules/link-analyzer.js";
import { auditContent } from "./modules/content-auditor.js";
import { searchSerp } from "./agentic/duckduckgo-serp.js";

// ── Output Root ──────────────────────────────────────────────────────────────

const OUT_ROOT = path.join(process.cwd(), "qa-health-results");

// ── JSON-RPC Types ───────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: string | number | null;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "qa_list_runs",
    description: "List all available QA health crawl runs with their metadata.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "qa_site_audit",
    description: "Run a comprehensive site audit on a previous crawl run. Returns SEO issues, performance problems, and recommendations.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "The run ID to audit" } },
      required: ["runId"],
    },
  },
  {
    name: "qa_keyword_research",
    description: "Extract and analyze keywords from a crawl run's content.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "The run ID to analyze" } },
      required: ["runId"],
    },
  },
  {
    name: "qa_domain_overview",
    description: "Get a comprehensive domain overview from crawl data including traffic estimates, authority signals, and competitive positioning.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "The run ID to analyze" } },
      required: ["runId"],
    },
  },
  {
    name: "qa_query",
    description: "Ask a natural language question about a crawl run. Uses intent classification and RAG retrieval for accurate answers.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run ID to query" },
        query: { type: "string", description: "Natural language question about the crawl data" },
      },
      required: ["runId", "query"],
    },
  },
  {
    name: "qa_serp_search",
    description: "Search DuckDuckGo and return SERP results. Free, no API key required.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "qa_backlinks",
    description: "Analyze backlink profile from crawl data.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "The run ID to analyze" } },
      required: ["runId"],
    },
  },
  {
    name: "qa_content_audit",
    description: "Audit content quality across all pages in a crawl run.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "The run ID to audit" } },
      required: ["runId"],
    },
  },
];

// ── Tool Handlers ────────────────────────────────────────────────────────────

async function listRuns(): Promise<unknown> {
  const runs: HealthRunMeta[] = [];
  try {
    const entries = await readdir(OUT_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const metaPath = path.join(OUT_ROOT, entry.name, "run-meta.json");
        const raw = await readFile(metaPath, "utf8");
        runs.push(JSON.parse(raw) as HealthRunMeta);
      } catch { /* skip runs without meta */ }
    }
  } catch {
    return { runs: [], error: "No runs directory found" };
  }
  runs.sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
  return { runs: runs.slice(0, 50) };
}

async function loadReports(runId: string) {
  const raw = await loadRawReportsForRun(OUT_ROOT, runId);
  if (!raw) throw new Error(`Run '${runId}' not found`);
  return raw;
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "qa_list_runs":
      return listRuns();

    case "qa_site_audit": {
      const { reports } = await loadReports(args.runId as string);
      return analyzeSiteAudit(reports);
    }

    case "qa_keyword_research": {
      const { reports } = await loadReports(args.runId as string);
      return extractKeywords(reports);
    }

    case "qa_domain_overview": {
      const { reports } = await loadReports(args.runId as string);
      return analyzeDomain(reports);
    }

    case "qa_query": {
      const { reports, generatedAt } = await loadReports(args.runId as string);
      const result = await routeQuery(
        args.query as string,
        args.runId as string,
        reports,
        generatedAt,
        [],
      );
      return result;
    }

    case "qa_serp_search": {
      const result = await searchSerp(args.query as string);
      return result;
    }

    case "qa_backlinks": {
      const { reports } = await loadReports(args.runId as string);
      return analyzeBacklinks(reports);
    }

    case "qa_content_audit": {
      const { reports } = await loadReports(args.runId as string);
      return auditContent(reports);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC Router ──────────────────────────────────────────────────────────

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "qa-agent", version: "1.0.0" },
            capabilities: { tools: {} },
          },
        };

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

      case "tools/call": {
        const params = req.params ?? {};
        const toolName = params.name as string;
        const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

        if (!toolName) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } };
        }

        const result = await handleToolCall(toolName, toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        };
      }

      case "notifications/initialized":
        // Client acknowledgement — no response needed for notifications
        return { jsonrpc: "2.0", id, result: {} };

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { jsonrpc: "2.0", id, error: { code: -32000, message: msg } };
  }
}

// ── Stdio Transport ──────────────────────────────────────────────────────────

function send(response: JsonRpcResponse): void {
  // For notifications (id is null and it's not an error), don't send response
  if (response.id === null && !response.error) return;
  process.stdout.write(JSON.stringify(response) + "\n");
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }

    const response = await handleRequest(req);
    send(response);
  }
}

main().catch((e) => {
  process.stderr.write(`MCP server fatal: ${e}\n`);
  process.exit(1);
});
