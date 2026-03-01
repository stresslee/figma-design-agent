/**
 * Preload Script — Electron context bridge
 *
 * Exposes safe IPC methods to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import type { ClaudeCodeStatus } from '../shared/types';

export interface ElectronAPI {
  // Agent
  sendMessage: (message: string) => void;
  cancelAgent: () => void;
  onAgentEvent: (callback: (event: unknown) => void) => () => void;
  onChatUpdate: (callback: (message: unknown) => void) => () => void;

  // Figma
  joinChannel: (channel: string) => Promise<unknown>;
  getFigmaStatus: () => Promise<unknown>;
  onFigmaStatus: (callback: (status: unknown) => void) => () => void;

  // DS
  getDesignTokens: () => Promise<unknown>;

  // Claude Code (primary)
  getClaudeCodeStatus: () => Promise<ClaudeCodeStatus>;
  claudeCodeLogin: () => Promise<{ success: boolean; error?: string }>;

  // Claude API (legacy fallback)
  getClaudeApiStatus: () => Promise<{ hasKey: boolean; maskedKey: string }>;
  setClaudeApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
  validateClaudeApiKey: (key: string) => Promise<{ valid: boolean; error?: string }>;

  openExternal: (url: string) => void;

  // Settings
  getGeminiKey: () => Promise<{ hasKey: boolean; maskedKey: string }>;
  setGeminiKey: (key: string) => Promise<{ success: boolean; error?: string }>;

  // App
  onError: (callback: (error: string) => void) => () => void;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Agent
  sendMessage: (message: string) => {
    ipcRenderer.send(IPC_CHANNELS.AGENT_SEND_MESSAGE, message);
  },
  cancelAgent: () => {
    ipcRenderer.send(IPC_CHANNELS.AGENT_CANCEL);
  },
  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_: unknown, event: unknown) => callback(event);
    ipcRenderer.on(IPC_CHANNELS.AGENT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_EVENT, handler);
  },
  onChatUpdate: (callback: (message: unknown) => void) => {
    const handler = (_: unknown, message: unknown) => callback(message);
    ipcRenderer.on(IPC_CHANNELS.AGENT_CHAT_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_CHAT_UPDATE, handler);
  },

  // Figma
  joinChannel: (channel: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.FIGMA_JOIN_CHANNEL, channel);
  },
  getFigmaStatus: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.FIGMA_GET_STATUS);
  },
  onFigmaStatus: (callback: (status: unknown) => void) => {
    const handler = (_: unknown, status: unknown) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.FIGMA_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FIGMA_STATUS, handler);
  },

  // DS
  getDesignTokens: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.DS_GET_TOKENS);
  },

  // Claude Code
  getClaudeCodeStatus: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_CODE_STATUS);
  },
  claudeCodeLogin: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_CODE_LOGIN);
  },

  // Claude API (legacy)
  getClaudeApiStatus: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_API_STATUS);
  },
  setClaudeApiKey: (key: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_API_SET_KEY, key);
  },
  validateClaudeApiKey: (key: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_API_VALIDATE, key);
  },
  openExternal: (url: string) => {
    ipcRenderer.send('shell:open-external', url);
  },

  // Settings
  getGeminiKey: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_GEMINI_KEY);
  },
  setGeminiKey: (key: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_GEMINI_KEY, key);
  },

  // App
  onError: (callback: (error: string) => void) => {
    const handler = (_: unknown, error: string) => callback(error);
    ipcRenderer.on(IPC_CHANNELS.APP_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_ERROR, handler);
  },
} satisfies ElectronAPI);
