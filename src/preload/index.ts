/**
 * Preload Script — Electron context bridge
 *
 * Exposes safe IPC methods to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';

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

  // App
  onError: (callback: (error: string) => void) => {
    const handler = (_: unknown, error: string) => callback(error);
    ipcRenderer.on(IPC_CHANNELS.APP_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_ERROR, handler);
  },
} satisfies ElectronAPI);
