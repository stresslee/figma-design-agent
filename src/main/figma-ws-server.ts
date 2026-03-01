/**
 * WebSocket Server for Figma Plugin Communication
 *
 * Unlike the MCP server (which is a WS client connecting to an external relay),
 * this is a WS server running inside Electron. The Figma plugin connects directly.
 * No relay server needed.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import type { PendingRequest, FigmaCommand, FigmaConnectionState } from '../shared/types';

export interface FigmaWSServerEvents {
  'connection-change': (state: FigmaConnectionState) => void;
  'plugin-message': (data: unknown) => void;
}

export class FigmaWSServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private pluginSocket: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private currentChannel: string | null = null;
  private port: number;

  constructor(port: number = 8767) {
    super();
    this.port = port;
  }

  /** Start the WebSocket server */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        resolve();
        return;
      }

      this.wss = new WebSocketServer({ port: this.port });

      this.wss.on('listening', () => {
        console.log(`[FigmaWS] Server listening on port ${this.port}`);
        resolve();
      });

      this.wss.on('error', (error) => {
        console.error('[FigmaWS] Server error:', error);
        reject(error);
      });

      this.wss.on('connection', (socket) => {
        console.log('[FigmaWS] Plugin WebSocket connected, waiting for join...');
        this.pluginSocket = socket;
        this.emitConnectionState('connecting');

        socket.on('message', (data) => {
          this.handleMessage(data.toString());
        });

        socket.on('close', (code, reason) => {
          console.log(`[FigmaWS] Plugin disconnected: ${code} ${reason}`);
          this.pluginSocket = null;
          this.currentChannel = null;
          this.emitConnectionState('disconnected');

          // Reject all pending requests
          for (const [id, request] of this.pendingRequests.entries()) {
            clearTimeout(request.timeout);
            request.reject(new Error('Plugin disconnected'));
            this.pendingRequests.delete(id);
          }
        });

        socket.on('error', (error) => {
          console.error('[FigmaWS] Socket error:', error);
        });
      });
    });
  }

  /** Stop the WebSocket server */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pluginSocket) {
        this.pluginSocket.close();
        this.pluginSocket = null;
      }
      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /** Check if plugin is connected */
  get isConnected(): boolean {
    return this.pluginSocket !== null && this.pluginSocket.readyState === WebSocket.OPEN;
  }

  /** Get current channel */
  get channel(): string | null {
    return this.currentChannel;
  }

  /** Join a Figma document channel */
  async joinChannel(channelName: string): Promise<void> {
    await this.sendCommand('join', { channel: channelName });
    this.currentChannel = channelName;
    console.log(`[FigmaWS] Joined channel: ${channelName}`);
  }

  /** Send a command to the Figma plugin and wait for response */
  sendCommand(
    command: FigmaCommand,
    params: Record<string, unknown> = {},
    timeoutMs: number = 120000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.pluginSocket || this.pluginSocket.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Figma plugin'));
        return;
      }

      if (command !== 'join' && !this.currentChannel) {
        reject(new Error('Must join a channel before sending commands'));
        return;
      }

      const id = uuidv4();
      const request = {
        id,
        type: command === 'join' ? 'join' : 'message',
        ...(command === 'join'
          ? { channel: (params as Record<string, unknown>).channel }
          : { channel: this.currentChannel }),
        message: {
          id,
          command,
          params: {
            ...params,
            commandId: id,
          },
        },
      };

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timed out after ${timeoutMs / 1000}s`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
        lastActivity: Date.now(),
      });

      this.pluginSocket.send(JSON.stringify(request));
    });
  }

  /** Handle incoming message from plugin */
  private handleMessage(rawData: string): void {
    try {
      const json = JSON.parse(rawData);

      // Handle ping (heartbeat from plugin)
      if (json.type === 'ping') {
        return;
      }

      // Handle join from plugin (auto-connect flow)
      if (json.type === 'join') {
        const channel = json.channel as string;
        this.currentChannel = channel;
        const documentName = (json.documentName as string) || channel.replace('auto-', '');
        console.log(`[FigmaWS] Plugin joined channel: ${channel} (document: ${documentName})`);

        // Send acknowledgment (format the plugin expects)
        if (this.pluginSocket && this.pluginSocket.readyState === WebSocket.OPEN) {
          this.pluginSocket.send(JSON.stringify({
            type: 'system',
            channel: channel,
            message: { result: true },
          }));
        }

        this.emit('connection-change', {
          status: 'connected',
          channel,
          documentName,
        } satisfies FigmaConnectionState);

        return;
      }

      // Handle progress updates
      if (json.type === 'progress_update') {
        const requestId = json.id || '';
        if (requestId && this.pendingRequests.has(requestId)) {
          const request = this.pendingRequests.get(requestId)!;
          request.lastActivity = Date.now();

          // Reset timeout
          clearTimeout(request.timeout);
          request.timeout = setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              this.pendingRequests.delete(requestId);
              request.reject(new Error('Request timed out after inactivity'));
            }
          }, 120000);
        }
        this.emit('plugin-message', json);
        return;
      }

      // Handle regular responses
      const response = json.message;
      if (
        response?.id &&
        this.pendingRequests.has(response.id) &&
        ('result' in response || 'error' in response)
      ) {
        const request = this.pendingRequests.get(response.id)!;
        clearTimeout(request.timeout);

        if (response.error) {
          request.reject(new Error(response.error));
        } else {
          request.resolve(response.result ?? null);
        }
        this.pendingRequests.delete(response.id);
      } else {
        this.emit('plugin-message', json);
      }
    } catch (error) {
      console.error('[FigmaWS] Parse error:', error);
    }
  }

  private emitConnectionState(status: FigmaConnectionState['status']): void {
    this.emit('connection-change', {
      status,
      channel: this.currentChannel,
    } satisfies FigmaConnectionState);
  }
}
