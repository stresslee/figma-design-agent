/**
 * Tool Bridge Server — HTTP bridge between MCP server process and Electron main process
 *
 * Runs on port 8768 in the Electron main process.
 * The figma-mcp-server (spawned by Claude Code) calls this to execute Figma tools.
 *
 * Endpoints:
 *   GET  /tools  — Returns list of registered tools (name, description, inputSchema)
 *   POST /tool   — Executes a tool: { name, params } → JSON result
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { ToolDefinition } from '../shared/types';

const BRIDGE_PORT = 8768;

export class ToolBridgeServer {
  private server: ReturnType<typeof createServer> | null = null;
  private tools: Map<string, ToolDefinition>;

  constructor(tools: Map<string, ToolDefinition>) {
    this.tools = tools;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        console.error('[ToolBridge] Server error:', err.message);
        reject(err);
      });

      this.server.listen(BRIDGE_PORT, '127.0.0.1', () => {
        console.log(`[ToolBridge] Listening on http://127.0.0.1:${BRIDGE_PORT}`);
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers for local access
    res.setHeader('Content-Type', 'application/json');

    try {
      if (req.method === 'GET' && req.url === '/tools') {
        await this.handleGetTools(res);
      } else if (req.method === 'POST' && req.url === '/tool') {
        await this.handleToolCall(req, res);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('[ToolBridge] Request error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleGetTools(res: ServerResponse): Promise<void> {
    const toolsList = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    res.writeHead(200);
    res.end(JSON.stringify({ tools: toolsList }));
  }

  private async handleToolCall(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const { name, params } = JSON.parse(body);

    if (!name) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing tool name' }));
      return;
    }

    const tool = this.tools.get(name);
    if (!tool) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `Unknown tool: ${name}` }));
      return;
    }

    console.log(`[ToolBridge] Calling tool: ${name}`);

    try {
      const result = await tool.handler(params || {});
      res.writeHead(200);
      res.end(JSON.stringify({ result }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ToolBridge] Tool error (${name}):`, errorMsg);
      res.writeHead(200); // 200 with error in body (tool errors are not HTTP errors)
      res.end(JSON.stringify({ error: errorMsg }));
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
