// ============================================================
// Shared types between Main Process and Renderer
// ============================================================

// --- Agent Types ---

export type AgentRole = 'orchestrator' | 'structure' | 'image' | 'ds-token' | 'icon' | 'qa';

export interface AgentState {
  id: string;
  role: AgentRole;
  status: 'idle' | 'running' | 'streaming' | 'done' | 'error';
  progress: number; // 0-100
  currentAction?: string;
  streamingText?: string;
}

export interface AgentEvent {
  type: 'status' | 'streaming' | 'tool-call' | 'tool-result' | 'error' | 'done';
  agentId: string;
  data: unknown;
}

// --- Chat Types ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  agentId?: string;
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  duration?: number;
}

// --- Figma Connection ---

export type FigmaConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface FigmaConnectionState {
  status: FigmaConnectionStatus;
  channel: string | null;
  pluginVersion?: string;
  documentName?: string;
}

// --- IPC Channel Names ---

export const IPC_CHANNELS = {
  // Agent
  AGENT_SEND_MESSAGE: 'agent:send-message',
  AGENT_CANCEL: 'agent:cancel',
  AGENT_EVENT: 'agent:event',
  AGENT_CHAT_UPDATE: 'agent:chat-update',

  // Figma connection
  FIGMA_STATUS: 'figma:status',
  FIGMA_JOIN_CHANNEL: 'figma:join-channel',
  FIGMA_GET_STATUS: 'figma:get-status',

  // Design system
  DS_GET_TOKENS: 'ds:get-tokens',
  DS_TOKENS_RESULT: 'ds:tokens-result',

  // App
  APP_READY: 'app:ready',
  APP_ERROR: 'app:error',
} as const;

// --- Figma WebSocket Types (from existing MCP server) ---

export type FigmaCommand = string;

export interface FigmaRequest {
  id: string;
  type: 'join' | 'message';
  channel?: string;
  message: {
    id: string;
    command: FigmaCommand;
    params: Record<string, unknown>;
  };
}

export interface FigmaResponse {
  id?: string;
  result?: unknown;
  error?: string;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  lastActivity: number;
}

// --- Tool Definition for Embedded MCP ---

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// --- Streaming Parser Types ---

export interface StreamingNodeEvent {
  type: 'node-ready' | 'batch-complete' | 'parse-error';
  node?: unknown;
  nodes?: unknown[];
  error?: string;
}

// --- Image Generator Types ---

export interface ImageGenerateRequest {
  prompt: string;
  width: number;
  height: number;
  style?: string;
  referenceImagePath?: string;
}

export interface ImageGenerateResult {
  path: string;
  base64: string;
  width: number;
  height: number;
}

// --- System Prompt Builder ---

export interface SystemPromptContext {
  dsTokens?: string;
  dsProfile?: string;
  designRules?: string;
  figmaDocumentState?: string;
  currentSelection?: string;
}
