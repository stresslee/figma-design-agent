/**
 * Electron Main Process Entry Point
 *
 * Wires up all components:
 * - BrowserWindow with React renderer
 * - WebSocket server for Figma plugin
 * - Tool Bridge Server for MCP ↔ Electron communication
 * - Agent Orchestrator with Claude Agent SDK or API key fallback
 * - IPC handlers for renderer communication
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { execFile } from 'child_process';
import { FigmaWSServer } from './figma-ws-server';
import { buildToolRegistry } from './figma-mcp-embedded';
import { registerDSLookupTools } from './ds-lookup-tools';
import { AgentOrchestrator } from './agent-orchestrator';
import { ToolBridgeServer } from './tool-bridge-server';
import { ImageGenerator } from './image-generator';
import { getGeminiApiKey, setGeminiApiKey, getAnthropicApiKey, setAnthropicApiKey } from './settings-store';
import { setProjectRoot, getDesignTokens } from '../shared/ds-data';
import { IPC_CHANNELS } from '../shared/types';
import type { FigmaConnectionState, ClaudeCodeStatus } from '../shared/types';

// ============================================================
// Global error handlers — prevent EPIPE crashes from subprocess pipes
// ============================================================

process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
    console.error('[Main] EPIPE error (subprocess pipe closed):', err.message);
    return; // Don't crash the app
  }
  console.error('[Main] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

// ============================================================
// Configuration
// ============================================================

const WS_PORT = 8767;
// Project root: out/main/ → ../../ → project root
const PROJECT_ROOT = join(__dirname, '..', '..');
const ASSETS_DIR = join(PROJECT_ROOT, 'assets', 'generated');

// ============================================================
// Global instances
// ============================================================

let mainWindow: BrowserWindow | null = null;
let figmaWS: FigmaWSServer;
let orchestrator: AgentOrchestrator | null = null;
let toolBridge: ToolBridgeServer;
let imageGenerator: ImageGenerator;

// Cached Claude Code status
let claudeCodeStatusCache: ClaudeCodeStatus | null = null;

// ============================================================
// Claude Code Detection
// ============================================================

/** Check if Claude Code CLI is installed and authenticated */
async function checkClaudeCodeStatus(): Promise<ClaudeCodeStatus> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], (error) => {
      if (error) {
        resolve({ installed: false, authenticated: false });
        return;
      }

      // Claude Code is installed, check auth
      execFile('claude', ['auth', 'status'], (authError, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');
        if (authError || output.includes('not logged in') || output.includes('Not authenticated')) {
          resolve({ installed: true, authenticated: false });
          return;
        }

        // Extract plan info if available
        const planMatch = output.match(/plan[:\s]+([\w\s]+)/i);
        resolve({
          installed: true,
          authenticated: true,
          plan: planMatch?.[1]?.trim(),
        });
      });
    });
  });
}

// ============================================================
// App lifecycle
// ============================================================

app.whenReady().then(async () => {
  // Set DS data project root
  setProjectRoot(PROJECT_ROOT);

  // Start WebSocket server
  figmaWS = new FigmaWSServer(WS_PORT);
  await figmaWS.start();

  // Build tool registry
  const tools = buildToolRegistry(figmaWS);
  registerDSLookupTools(tools);

  // Initialize image generator with saved API key
  imageGenerator = new ImageGenerator(ASSETS_DIR, getGeminiApiKey());

  // Register generate_image tool (Gemini API → base64 → set_image_fill)
  tools.set('generate_image', {
    name: 'generate_image',
    description: 'Generate an image using Gemini AI and apply it as fill to a Figma node. Use for logos, illustrations, icons, hero images.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image description (e.g. "minimal app logo, letter M, purple gradient")' },
        nodeId: { type: 'string', description: 'Figma node ID to apply the image fill to' },
        width: { type: 'number', description: 'Target width in Figma pixels (default: 120)' },
        height: { type: 'number', description: 'Target height in Figma pixels (default: 120)' },
        style: { type: 'string', description: 'Optional style override' },
      },
      required: ['prompt', 'nodeId'],
    },
    handler: async (params) => {
      const prompt = params.prompt as string;
      const nodeId = params.nodeId as string;
      const width = (params.width as number) || 120;
      const height = (params.height as number) || 120;
      const style = params.style as string | undefined;

      // Generate image via Gemini
      const result = await imageGenerator.generate({
        prompt,
        figmaWidth: width,
        figmaHeight: height,
        style,
        outputName: `gen_${Date.now()}`,
      });

      // Apply as image fill to the Figma node
      await figmaWS.sendCommand('set_image_fill', {
        nodeId,
        imageData: result.base64,
        scaleMode: 'FILL',
      });

      return { success: true, nodeId, width: result.width, height: result.height };
    },
  });

  console.log(`[Main] Registered ${tools.size} tools`);

  // Start Tool Bridge Server (for MCP server communication)
  toolBridge = new ToolBridgeServer(tools);
  await toolBridge.start();

  // Check Claude Code status
  claudeCodeStatusCache = await checkClaudeCodeStatus();
  console.log(`[Main] Claude Code: installed=${claudeCodeStatusCache.installed}, authenticated=${claudeCodeStatusCache.authenticated}`);

  // Create window
  createWindow();

  // Set up IPC handlers
  setupIPC(tools);

  // Forward Figma connection events
  figmaWS.on('connection-change', (state: FigmaConnectionState) => {
    mainWindow?.webContents.send(IPC_CHANNELS.FIGMA_STATUS, state);
  });
});

app.on('window-all-closed', () => {
  toolBridge?.stop();
  figmaWS?.stop();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ============================================================
// Window creation
// ============================================================

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================
// IPC Handlers
// ============================================================

function setupIPC(tools: Map<string, import('../shared/types').ToolDefinition>): void {
  // --- Agent ---

  ipcMain.on(IPC_CHANNELS.AGENT_SEND_MESSAGE, async (event, message: string) => {
    // Determine mode: Agent SDK (Claude Code) or Direct API
    const useAgentSdk = claudeCodeStatusCache?.installed && claudeCodeStatusCache?.authenticated;
    const apiKey = getAnthropicApiKey();

    if (!useAgentSdk && !apiKey) {
      mainWindow?.webContents.send(IPC_CHANNELS.APP_ERROR,
        'Claude Code가 설치되어 있지 않거나 인증되지 않았습니다. Settings에서 로그인하거나 API 키를 설정해주세요.'
      );
      return;
    }

    console.log(`[Main] Mode: ${useAgentSdk ? 'Agent SDK (subscription)' : 'Direct API (key)'}`);

    // Create orchestrator if needed, or if mode changed
    if (!orchestrator) {
      orchestrator = new AgentOrchestrator({
        tools,
        projectRoot: PROJECT_ROOT,
        useAgentSdk: !!useAgentSdk,
        apiKey: useAgentSdk ? undefined : apiKey,
      });

      // Forward events to renderer
      orchestrator.on('agent-event', (agentEvent) => {
        mainWindow?.webContents.send(IPC_CHANNELS.AGENT_EVENT, agentEvent);
      });

      orchestrator.on('chat-message', (chatMessage) => {
        mainWindow?.webContents.send(IPC_CHANNELS.AGENT_CHAT_UPDATE, chatMessage);
      });

      // Initialize with Figma context if connected
      const initContext: Record<string, unknown> = {};

      if (figmaWS.isConnected && figmaWS.channel) {
        try {
          const docInfo = await figmaWS.sendCommand('get_document_info');
          initContext.figmaDocInfo = docInfo;
          const selection = await figmaWS.sendCommand('get_selection');
          initContext.figmaSelection = selection;
        } catch {
          // Not critical if this fails
        }
      }

      await orchestrator.initialize(initContext);
    }

    try {
      await orchestrator.sendMessage(message);
    } catch (error) {
      mainWindow?.webContents.send(IPC_CHANNELS.APP_ERROR,
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  ipcMain.on(IPC_CHANNELS.AGENT_CANCEL, () => {
    orchestrator?.cancel();
  });

  // --- Figma ---

  ipcMain.handle(IPC_CHANNELS.FIGMA_JOIN_CHANNEL, async (_event, channel: string) => {
    try {
      await figmaWS.joinChannel(channel);
      return { success: true, channel };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FIGMA_GET_STATUS, async () => {
    return {
      status: figmaWS.isConnected ? 'connected' : 'disconnected',
      channel: figmaWS.channel,
    } satisfies FigmaConnectionState;
  });

  // --- DS ---

  ipcMain.handle(IPC_CHANNELS.DS_GET_TOKENS, async () => {
    try {
      return getDesignTokens();
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- Claude Code ---

  ipcMain.handle(IPC_CHANNELS.CLAUDE_CODE_STATUS, async () => {
    // Refresh status
    claudeCodeStatusCache = await checkClaudeCodeStatus();
    return claudeCodeStatusCache;
  });

  ipcMain.handle(IPC_CHANNELS.CLAUDE_CODE_LOGIN, async () => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      execFile('claude', ['login'], (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: error.message });
          return;
        }
        // Refresh status after login
        checkClaudeCodeStatus().then((status) => {
          claudeCodeStatusCache = status;
          // Reset orchestrator to pick up new auth
          orchestrator = null;
          resolve({ success: status.authenticated });
        });
      });
    });
  });

  // --- Claude API (legacy fallback) ---

  ipcMain.handle(IPC_CHANNELS.CLAUDE_API_STATUS, async () => {
    const key = getAnthropicApiKey();
    return {
      hasKey: !!key,
      maskedKey: key ? key.slice(0, 8) + '...' + key.slice(-4) : '',
    };
  });

  ipcMain.handle(IPC_CHANNELS.CLAUDE_API_SET_KEY, async (_event, key: string) => {
    try {
      setAnthropicApiKey(key);
      // Reset orchestrator so it picks up new key
      orchestrator = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CLAUDE_API_VALIDATE, async (_event, key: string) => {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: key });
      await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { valid: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('401') || msg.includes('authentication') || msg.includes('invalid')) {
        return { valid: false, error: 'Invalid API key' };
      }
      return { valid: true };
    }
  });

  // Open external URL
  ipcMain.on('shell:open-external', (_event, url: string) => {
    shell.openExternal(url);
  });

  // --- Settings ---

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_GEMINI_KEY, async () => {
    const key = getGeminiApiKey();
    if (!key) return { hasKey: false, maskedKey: '' };
    const masked = key.slice(0, 4) + '...' + key.slice(-4);
    return { hasKey: true, maskedKey: masked };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_GEMINI_KEY, async (_event, key: string) => {
    try {
      setGeminiApiKey(key);
      imageGenerator.setApiKey(key);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
