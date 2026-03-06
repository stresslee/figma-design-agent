#!/usr/bin/env node
/**
 * Patch @hono/mcp to remove Accept header validation.
 * Claude Code's HTTP MCP client doesn't send Accept: text/event-stream,
 * causing 406 Not Acceptable errors.
 *
 * Run via: npm run postinstall (or node scripts/patch-hono-mcp.js)
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', '@hono', 'mcp', 'dist', 'index.cjs');

if (!fs.existsSync(filePath)) {
  console.log('[patch] @hono/mcp not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf-8');

// Remove the Accept header check in handlePostRequest
const pattern = /const acceptHeader = ctx\.req\.header\("Accept"\);\s*if \(!acceptHeader\?\.includes\("application\/json"\) \|\| !acceptHeader\.includes\("text\/event-stream"\)\) throw new hono_http_exception\.HTTPException\(406,\s*\{[^}]+\{[^}]+\{[^}]+\}[^}]+\}[^}]+\}\s*\)\s*\);/;

if (pattern.test(content)) {
  content = content.replace(pattern, 'const acceptHeader = ctx.req.header("Accept");\n\t\t\t// Accept header check disabled for Claude Code compatibility');
  fs.writeFileSync(filePath, content);
  console.log('[patch] @hono/mcp: Accept header check removed (Claude Code compat)');
} else if (content.includes('Accept header check disabled')) {
  console.log('[patch] @hono/mcp: already patched');
} else {
  console.log('[patch] @hono/mcp: pattern not found, may need manual update');
}
