/**
 * Agent Orchestrator — Claude Agent SDK Edition
 *
 * Uses @anthropic-ai/claude-agent-sdk query() for agent execution.
 * Claude Code subprocess handles tool calls via MCP server.
 * Supports dual mode: Agent SDK (Claude Code auth) or direct API key fallback.
 *
 * Performance optimizations:
 * - Uses Claude Code preset prompt + short design append (not full system prompt)
 * - Keeps Claude Code process alive via AsyncIterable prompt for multi-turn
 * - Deduplicates assistant messages (stream vs result)
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { buildSystemPrompt, buildDesignContext, type PromptContext } from './system-prompt-builder';
import { getMcpServersConfig } from './mcp-server-config';
import type { AgentState, AgentEvent, ChatMessage, ToolDefinition } from '../shared/types';

const MAX_TURNS = 50;

export interface OrchestratorConfig {
  tools: Map<string, ToolDefinition>;
  projectRoot: string;
  /** If true, use Agent SDK (Claude Code auth). If false, use direct API key. */
  useAgentSdk: boolean;
  /** API key for direct mode fallback */
  apiKey?: string;
}

export class AgentOrchestrator extends EventEmitter {
  private tools: Map<string, ToolDefinition>;
  private projectRoot: string;
  private useAgentSdk: boolean;
  private apiKey?: string;
  private systemPrompt: string = '';
  private designContext: string = '';
  private abortController: AbortController | null = null;
  private agents = new Map<string, AgentState>();

  // Agent SDK session
  private sdkSessionId: string | null = null;

  // Direct API mode client (lazy loaded)
  private directClient: import('@anthropic-ai/sdk').default | null = null;
  private conversationHistory: import('@anthropic-ai/sdk').MessageParam[] = [];

  constructor(config: OrchestratorConfig) {
    super();
    this.tools = config.tools;
    this.projectRoot = config.projectRoot;
    this.useAgentSdk = config.useAgentSdk;
    this.apiKey = config.apiKey;
  }

  /** Initialize system prompt with current context */
  async initialize(context: Partial<PromptContext> = {}): Promise<void> {
    // Full system prompt for direct API mode
    this.systemPrompt = await buildSystemPrompt(
      { tools: this.tools, ...context },
      this.projectRoot
    );
    // Short design context for Agent SDK mode (appended to Claude Code preset)
    this.designContext = await buildDesignContext(this.projectRoot, context);
    this.conversationHistory = [];
  }

  /** Send a user message and run the agent loop */
  async sendMessage(userMessage: string): Promise<void> {
    this.abortController = new AbortController();

    // Emit user message
    this.emitChatMessage({
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    if (this.useAgentSdk) {
      await this.sendAgentSdkMessage(userMessage);
    } else {
      await this.runDirectApiLoop(userMessage);
    }
  }

  // ============================================================
  // Agent SDK Mode — Persistent Session
  // ============================================================

  /**
   * Send a message via Agent SDK.
   * Each call creates a new query() but uses `resume` to continue the session.
   */
  private async sendAgentSdkMessage(userMessage: string): Promise<void> {
    const agentId = 'orchestrator';
    this.updateAgentState(agentId, { status: 'streaming', currentAction: 'Thinking...' });

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const mcpServers = getMcpServersConfig();

      // Clean env: remove CLAUDECODE to avoid nested session detection
      const cleanEnv: Record<string, string | undefined> = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      const options: Record<string, unknown> = {
        model: 'claude-sonnet-4-20250514',
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: this.designContext,
        },
        mcpServers,
        maxTurns: MAX_TURNS,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        allowedTools: ['mcp__figma-tools__*'],
        disallowedTools: [
          // Block Claude Code built-in tools (this is a design-only agent)
          'Edit', 'Write', 'Bash', 'Read', 'Glob', 'Grep', 'Agent',
          // Block individual creation tools — MUST use batch_build_screen instead
          'mcp__figma-tools__create_frame',
          'mcp__figma-tools__create_text',
          'mcp__figma-tools__create_rectangle',
          'mcp__figma-tools__create_shape',
          'mcp__figma-tools__create_component_from_node',
          'mcp__figma-tools__create_component_set',
        ],
        includePartialMessages: true,
        abortController: this.abortController,
        cwd: this.projectRoot,
        env: cleanEnv,
        stderr: (data: string) => {
          if (!data.includes('Compiling') && !data.includes('Watching')) {
            console.log('[Claude Code]', data.trim());
          }
        },
      };

      // Resume previous session if available
      if (this.sdkSessionId) {
        options.resume = this.sdkSessionId;
        console.log('[Agent SDK] Resuming session:', this.sdkSessionId);
      } else {
        console.log('[Agent SDK] Starting new session');
      }

      const q = query({ prompt: userMessage, options: options as never });
      await this.processSdkMessages(q, agentId);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Agent SDK] Error:', errorMsg);
      this.updateAgentState(agentId, { status: 'error' });
      this.emitEvent(agentId, 'error', { error: errorMsg });
    }
  }

  private async processSdkMessages(q: AsyncIterable<unknown>, agentId: string): Promise<void> {
    let assistantText = '';
    let lastEmittedText = '';

    try {
      for await (const message of q as AsyncIterable<{ type: string; [key: string]: unknown }>) {
        if (this.abortController?.signal.aborted) break;

        switch (message.type) {
          case 'system': {
            const sysMsg = message as { session_id?: string };
            if (sysMsg.session_id) {
              this.sdkSessionId = sysMsg.session_id;
              console.log('[Agent SDK] Session:', this.sdkSessionId);
            }
            break;
          }

          case 'stream_event': {
            const streamMsg = message as { event?: { type: string; delta?: { type: string; text?: string }; content_block?: { type: string; name?: string } } };
            const event = streamMsg.event;
            if (!event) break;

            if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              const toolName = event.content_block.name || '';
              if (toolName) {
                // Strip MCP prefix for display
                const displayName = toolName.replace('mcp__figma-tools__', '');
                this.updateAgentState(agentId, {
                  status: 'running',
                  currentAction: `Calling ${displayName}...`,
                });
                this.emitEvent(agentId, 'tool-call', { name: displayName });
              }
            } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              assistantText += event.delta.text;
              this.emitEvent(agentId, 'streaming', { text: assistantText });
            } else if (event.type === 'content_block_stop') {
              // Nothing needed
            }
            break;
          }

          case 'assistant': {
            const assistMsg = message as { message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } };
            const content = assistMsg.message?.content;
            if (!content) break;

            const textParts: string[] = [];
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                textParts.push(block.text);
              } else if (block.type === 'tool_use') {
                const displayName = (block.name || '').replace('mcp__figma-tools__', '');
                this.emitEvent(agentId, 'tool-call', { name: displayName, input: block.input });
              }
            }

            const fullText = textParts.join('');
            if (fullText && fullText !== lastEmittedText) {
              lastEmittedText = fullText;
              assistantText = ''; // Reset streaming buffer
              this.emitChatMessage({
                id: uuidv4(),
                role: 'assistant',
                content: fullText,
                timestamp: Date.now(),
                agentId,
              });
            }
            break;
          }

          case 'result': {
            const resultMsg = message as { subtype?: string; result?: string; errors?: string[] };
            if (resultMsg.subtype === 'success') {
              // Only emit if different from what we already sent
              if (resultMsg.result && resultMsg.result !== lastEmittedText) {
                this.emitChatMessage({
                  id: uuidv4(),
                  role: 'assistant',
                  content: resultMsg.result,
                  timestamp: Date.now(),
                  agentId,
                });
                lastEmittedText = resultMsg.result;
              }
              this.updateAgentState(agentId, { status: 'done', progress: 100 });
              this.emitEvent(agentId, 'done', { text: resultMsg.result });
              // Reset for next turn
              assistantText = '';
              lastEmittedText = '';
            } else {
              const errorText = resultMsg.errors?.join(', ') || 'Unknown error';
              this.updateAgentState(agentId, { status: 'error' });
              this.emitEvent(agentId, 'error', { error: errorText });
              assistantText = '';
              lastEmittedText = '';
            }
            break;
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('aborted')) {
        console.error('[Agent SDK] Processing loop error:', errorMsg);
        this.updateAgentState(agentId, { status: 'error' });
        this.emitEvent(agentId, 'error', { error: errorMsg });
      }
    }
  }

  // ============================================================
  // Direct API Mode (API key fallback)
  // ============================================================

  private async runDirectApiLoop(userMessage: string): Promise<void> {
    const agentId = 'orchestrator';

    // Lazy-init client
    if (!this.directClient) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      this.directClient = new Anthropic({ apiKey: this.apiKey });
    }

    // Add user message to history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    let turns = 0;
    while (turns < MAX_TURNS) {
      turns++;

      if (this.abortController?.signal.aborted) {
        this.emitEvent(agentId, 'done', { reason: 'cancelled' });
        return;
      }

      this.updateAgentState(agentId, { status: 'streaming', currentAction: 'Thinking...' });

      try {
        type Tool = import('@anthropic-ai/sdk').Tool;
        type ToolUseBlock = import('@anthropic-ai/sdk').ToolUseBlock;
        type ToolResultBlockParam = import('@anthropic-ai/sdk').ToolResultBlockParam;

        // Block individual creation tools — MUST use batch_build_screen instead
        const blockedTools = new Set([
          'create_frame', 'create_text', 'create_rectangle', 'create_shape',
          'create_component_from_node', 'create_component_set',
        ]);
        const anthropicTools: Tool[] = Array.from(this.tools.values())
          .filter((t) => !blockedTools.has(t.name))
          .map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Tool['input_schema'],
          }));

        const stream = this.directClient.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16384,
          system: this.systemPrompt,
          messages: this.conversationHistory,
          tools: anthropicTools,
        });

        let assistantText = '';

        stream.on('text', (text: string) => {
          assistantText += text;
          this.emitEvent(agentId, 'streaming', { text: assistantText });
        });

        const response = await stream.finalMessage();
        const toolUseBlocks: ToolUseBlock[] = [];
        const textParts: string[] = [];

        for (const block of response.content) {
          if (block.type === 'text') textParts.push(block.text);
          else if (block.type === 'tool_use') toolUseBlocks.push(block);
        }

        const fullText = textParts.join('');
        if (fullText) {
          this.emitChatMessage({
            id: uuidv4(),
            role: 'assistant',
            content: fullText,
            timestamp: Date.now(),
            agentId,
          });
        }

        this.conversationHistory.push({ role: 'assistant', content: response.content });

        if (toolUseBlocks.length === 0) {
          this.updateAgentState(agentId, { status: 'done', progress: 100 });
          this.emitEvent(agentId, 'done', { text: fullText });
          return;
        }

        // Execute tool calls
        const toolResults: ToolResultBlockParam[] = [];
        for (const toolUse of toolUseBlocks) {
          this.updateAgentState(agentId, { status: 'running', currentAction: `Calling ${toolUse.name}...` });
          this.emitEvent(agentId, 'tool-call', { name: toolUse.name, input: toolUse.input });

          try {
            const tool = this.tools.get(toolUse.name);
            if (!tool) throw new Error(`Unknown tool: ${toolUse.name}`);
            const result = await tool.handler(toolUse.input as Record<string, unknown>);
            this.emitEvent(agentId, 'tool-result', { name: toolUse.name, result });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.emitEvent(agentId, 'error', { tool: toolUse.name, error: errorMsg });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: ${errorMsg}`,
              is_error: true,
            });
          }
        }

        this.conversationHistory.push({ role: 'user', content: toolResults });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Agent] Direct API error:', errorMsg);
        this.updateAgentState(agentId, { status: 'error' });
        this.emitEvent(agentId, 'error', { error: errorMsg });
        return;
      }
    }

    this.updateAgentState(agentId, { status: 'done' });
    this.emitEvent(agentId, 'done', { reason: 'max_turns_reached' });
  }

  // ============================================================
  // Public API
  // ============================================================

  cancel(): void {
    this.abortController?.abort();
  }

  clearHistory(): void {
    this.conversationHistory = [];
    this.sdkSessionId = null;
  }

  // ============================================================
  // Event helpers
  // ============================================================

  private updateAgentState(agentId: string, partial: Partial<AgentState>): void {
    const current = this.agents.get(agentId) || {
      id: agentId,
      role: 'orchestrator' as const,
      status: 'idle' as const,
      progress: 0,
    };
    const updated = { ...current, ...partial };
    this.agents.set(agentId, updated);
    this.emit('agent-state', updated);
  }

  private emitEvent(agentId: string, type: AgentEvent['type'], data: unknown): void {
    this.emit('agent-event', { type, agentId, data } satisfies AgentEvent);
  }

  private emitChatMessage(message: ChatMessage): void {
    this.emit('chat-message', message);
  }
}
