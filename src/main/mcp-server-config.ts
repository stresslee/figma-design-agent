/**
 * MCP Server Configuration for Agent SDK
 *
 * Returns HTTP URL config for the embedded Hono MCP server.
 * No subprocess spawn needed — Agent SDK connects via HTTP directly.
 */

const MCP_PORT = 8769;
const PENCIL_MCP_PORT = 8081;
const MCP_ENDPOINT = '/mcp';

/**
 * Build the mcpServers config for Agent SDK's query() options
 */
export function getMcpServersConfig(): Record<string, { type: 'http'; url: string }> {
  return {
    'figma-tools': {
      type: 'http',
      url: `http://127.0.0.1:${MCP_PORT}${MCP_ENDPOINT}`,
    },
    'pencil-mcp': {
      type: 'http',
      url: `http://127.0.0.1:${PENCIL_MCP_PORT}${MCP_ENDPOINT}`,
    },
  };
}

/** Pencil MCP 서버 바이너리 경로 + 인자 (index.ts에서 사용) */
export const PENCIL_MCP_CONFIG = {
  port: PENCIL_MCP_PORT,
  binary: '/Users/julee/.cursor/extensions/highagency.pencildev-0.6.28-universal/out/mcp-server-darwin-arm64',
  args: ['--app', 'cursor', '--http', '--http-port', String(PENCIL_MCP_PORT)],
};
