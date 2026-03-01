/**
 * Electron Main Process Entry Point
 *
 * Wires up all components:
 * - BrowserWindow with React renderer
 * - WebSocket server for Figma plugin
 * - Agent Orchestrator with embedded MCP tools
 * - IPC handlers for renderer communication
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { FigmaWSServer } from './figma-ws-server';
import { buildToolRegistry } from './figma-mcp-embedded';
import { registerDSLookupTools } from './ds-lookup-tools';
import { AgentOrchestrator } from './agent-orchestrator';
import { ImageGenerator } from './image-generator';
import { setProjectRoot, getDesignTokens } from '../shared/ds-data';
import { IPC_CHANNELS } from '../shared/types';
import type { FigmaConnectionState } from '../shared/types';

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
let imageGenerator: ImageGenerator;

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

  console.log(`[Main] Registered ${tools.size} tools`);

  // Initialize image generator
  imageGenerator = new ImageGenerator(ASSETS_DIR);

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
    // Get API key from environment
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      mainWindow?.webContents.send(IPC_CHANNELS.APP_ERROR, 'ANTHROPIC_API_KEY not set');
      return;
    }

    // Create orchestrator if needed
    if (!orchestrator) {
      orchestrator = new AgentOrchestrator({
        apiKey,
        tools,
        projectRoot: PROJECT_ROOT,
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
}
