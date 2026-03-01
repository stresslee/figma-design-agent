/**
 * MCP Server Configuration for Agent SDK
 *
 * Generates the mcpServers config that tells Claude Code
 * how to spawn our figma-mcp-server process.
 */

import { join } from 'path';

/**
 * Get the absolute path to the built figma-mcp-server.js
 * At runtime: out/main/index.js → __dirname = out/main/
 * MCP server: out/main/figma-mcp-server.js
 */
export function getMcpServerPath(): string {
  return join(__dirname, 'figma-mcp-server.js');
}

/**
 * Build the mcpServers config for Agent SDK's query() options
 */
export function getMcpServersConfig(): Record<string, { command: string; args: string[] }> {
  return {
    'figma-tools': {
      command: 'node',
      args: [getMcpServerPath()],
    },
  };
}
