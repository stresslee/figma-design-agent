#!/usr/bin/env node
/**
 * Figma MCP Server — Stdio transport for Claude Code
 *
 * This runs as a SEPARATE PROCESS spawned by Claude Code.
 * It bridges MCP protocol (stdio) ↔ Tool Bridge (HTTP localhost:8768).
 *
 * Flow:
 *   Claude Code → (stdio MCP) → this process → (HTTP) → ToolBridgeServer → FigmaWSServer → Figma Plugin
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BRIDGE_URL = 'http://127.0.0.1:8768';

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Fetch available tools from the Tool Bridge
async function fetchTools(): Promise<ToolInfo[]> {
  try {
    const res = await fetch(`${BRIDGE_URL}/tools`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { tools: ToolInfo[] };
    return data.tools;
  } catch (error) {
    console.error('[FigmaMCP] Failed to fetch tools from bridge:', error);
    return [];
  }
}

// Call a tool via the Tool Bridge
async function callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BRIDGE_URL}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, params }),
  });

  if (!res.ok) {
    throw new Error(`Bridge HTTP error: ${res.status}`);
  }

  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) {
    throw new Error(data.error);
  }
  return data.result;
}

async function main() {
  // Wait briefly for the Tool Bridge to be ready
  let tools: ToolInfo[] = [];
  for (let i = 0; i < 10; i++) {
    tools = await fetchTools();
    if (tools.length > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (tools.length === 0) {
    console.error('[FigmaMCP] No tools available from bridge after retries');
  }

  console.error(`[FigmaMCP] Loaded ${tools.length} tools from bridge`);

  // Create MCP server
  const server = new Server(
    { name: 'figma-tools', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as { type: 'object'; properties?: Record<string, unknown> },
    })),
  }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.error(`[FigmaMCP] Tool call: ${name}`);

    try {
      const result = await callTool(name, (args || {}) as Record<string, unknown>);
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[FigmaMCP] Tool error (${name}):`, errorMsg);
      return {
        content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[FigmaMCP] Server running on stdio');
}

main().catch((err) => {
  console.error('[FigmaMCP] Fatal error:', err);
  process.exit(1);
});
