/**
 * Agent Orchestrator — Core Engine
 *
 * Uses Anthropic SDK for agent execution with streaming.
 * Handles tool calls, multi-turn conversations, and emits events for renderer.
 * Supports multi-agent parallel execution for different screen sections.
 */

import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { StreamingParser } from './streaming-parser';
import { buildSystemPrompt, type PromptContext } from './system-prompt-builder';
import type { ToolDefinition, AgentState, AgentEvent, ChatMessage } from '../shared/types';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 16384;
const MAX_TURNS = 50;

export interface OrchestratorConfig {
  apiKey: string;
  tools: Map<string, ToolDefinition>;
  projectRoot: string;
}

export class AgentOrchestrator extends EventEmitter {
  private client: Anthropic;
  private tools: Map<string, ToolDefinition>;
  private projectRoot: string;
  private streamingParser: StreamingParser;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private systemPrompt: string = '';
  private abortController: AbortController | null = null;
  private agents = new Map<string, AgentState>();

  constructor(config: OrchestratorConfig) {
    super();
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.tools = config.tools;
    this.projectRoot = config.projectRoot;
    this.streamingParser = new StreamingParser();

    // Forward streaming parser events
    this.streamingParser.on('node-ready', (node, path) => {
      this.emitEvent('orchestrator', 'streaming', { type: 'node-ready', node, path });
    });
  }

  /** Initialize system prompt with current context */
  async initialize(context: Partial<PromptContext> = {}): Promise<void> {
    this.systemPrompt = await buildSystemPrompt(
      { tools: this.tools, ...context },
      this.projectRoot
    );
    this.conversationHistory = [];
  }

  /** Get the Anthropic tools array from our tool registry */
  private getAnthropicTools(): Anthropic.Tool[] {
    const anthropicTools: Anthropic.Tool[] = [];
    for (const [name, tool] of this.tools) {
      anthropicTools.push({
        name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
      });
    }
    return anthropicTools;
  }

  /** Send a user message and run the agent loop */
  async sendMessage(userMessage: string): Promise<void> {
    this.abortController = new AbortController();

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    // Emit user message
    this.emitChatMessage({
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // Run agent loop
    await this.runAgentLoop('orchestrator');
  }

  /** Run the agent loop: stream response → handle tool calls → repeat */
  private async runAgentLoop(agentId: string): Promise<void> {
    let turns = 0;

    while (turns < MAX_TURNS) {
      turns++;

      if (this.abortController?.signal.aborted) {
        this.emitEvent(agentId, 'done', { reason: 'cancelled' });
        return;
      }

      this.updateAgentState(agentId, { status: 'streaming', currentAction: 'Thinking...' });

      try {
        // Create streaming message
        const stream = this.client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: this.systemPrompt,
          messages: this.conversationHistory,
          tools: this.getAnthropicTools(),
        });

        let assistantText = '';
        const toolUses: Array<{
          id: string;
          name: string;
          input: Record<string, unknown>;
          inputJson: string;
        }> = [];
        let currentToolName: string | null = null;
        let currentToolInputJson = '';

        // Handle streaming events
        stream.on('text', (text) => {
          assistantText += text;
          this.emitEvent(agentId, 'streaming', { text: assistantText });
        });

        stream.on('inputJson', (json, snapshot) => {
          currentToolInputJson = snapshot;

          // Feed to streaming parser for real-time node extraction
          if (currentToolName?.includes('build_screen') || currentToolName?.includes('batch_build')) {
            this.streamingParser.feed(json);
          }
        });

        // Wait for the full response
        const response = await stream.finalMessage();

        // Process the response
        const contentBlocks = response.content;
        const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
        const textParts: string[] = [];

        for (const block of contentBlocks) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolUseBlocks.push(block);
          }
        }

        // Emit assistant text
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

        // Add assistant message to history
        this.conversationHistory.push({
          role: 'assistant',
          content: contentBlocks,
        });

        // If no tool calls, the agent is done
        if (toolUseBlocks.length === 0) {
          this.updateAgentState(agentId, { status: 'done', progress: 100 });
          this.emitEvent(agentId, 'done', { text: fullText });
          return;
        }

        // Execute tool calls
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          this.updateAgentState(agentId, {
            status: 'running',
            currentAction: `Calling ${toolUse.name}...`,
          });

          this.emitEvent(agentId, 'tool-call', {
            name: toolUse.name,
            input: toolUse.input,
          });

          try {
            const tool = this.tools.get(toolUse.name);
            if (!tool) {
              throw new Error(`Unknown tool: ${toolUse.name}`);
            }

            // Reset streaming parser for batch build tools
            if (toolUse.name.includes('build_screen') || toolUse.name.includes('batch_build')) {
              this.streamingParser.reset(toolUse.name);
            }

            const result = await tool.handler(toolUse.input as Record<string, unknown>);

            this.emitEvent(agentId, 'tool-result', {
              name: toolUse.name,
              result,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Agent] Tool error (${toolUse.name}):`, errorMsg);

            this.emitEvent(agentId, 'error', {
              tool: toolUse.name,
              error: errorMsg,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: ${errorMsg}`,
              is_error: true,
            });
          }
        }

        // Add tool results to history
        this.conversationHistory.push({
          role: 'user',
          content: toolResults,
        });

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Agent] Loop error:', errorMsg);
        this.updateAgentState(agentId, { status: 'error' });
        this.emitEvent(agentId, 'error', { error: errorMsg });
        return;
      }
    }

    // Max turns reached
    this.updateAgentState(agentId, { status: 'done' });
    this.emitEvent(agentId, 'done', { reason: 'max_turns_reached' });
  }

  /** Cancel the current agent execution */
  cancel(): void {
    this.abortController?.abort();
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /** Spawn a sub-agent for parallel execution */
  async spawnSubAgent(
    role: string,
    systemPromptOverride: string,
    task: string
  ): Promise<string> {
    const agentId = `${role}_${uuidv4().slice(0, 8)}`;

    this.updateAgentState(agentId, {
      status: 'idle',
      currentAction: `Spawning ${role} agent...`,
    });

    // Create a separate conversation for the sub-agent
    const subHistory: Anthropic.MessageParam[] = [
      { role: 'user', content: task },
    ];

    // Run in parallel (don't await)
    this.runSubAgentLoop(agentId, systemPromptOverride, subHistory).catch((err) => {
      console.error(`[SubAgent ${agentId}] Error:`, err);
      this.updateAgentState(agentId, { status: 'error' });
    });

    return agentId;
  }

  /** Run a sub-agent loop with its own conversation */
  private async runSubAgentLoop(
    agentId: string,
    systemPrompt: string,
    history: Anthropic.MessageParam[]
  ): Promise<void> {
    let turns = 0;

    while (turns < MAX_TURNS) {
      turns++;
      this.updateAgentState(agentId, { status: 'streaming' });

      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: history,
        tools: this.getAnthropicTools(),
      });

      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') toolUseBlocks.push(block);
      }

      history.push({ role: 'assistant', content: response.content });

      if (toolUseBlocks.length === 0) {
        this.updateAgentState(agentId, { status: 'done', progress: 100 });
        this.emitEvent(agentId, 'done', {});
        return;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        this.updateAgentState(agentId, { currentAction: `Calling ${toolUse.name}...` });
        try {
          const tool = this.tools.get(toolUse.name);
          if (!tool) throw new Error(`Unknown tool: ${toolUse.name}`);
          const result = await tool.handler(toolUse.input as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        } catch (error) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error: ${error instanceof Error ? error.message : error}`,
            is_error: true,
          });
        }
      }

      history.push({ role: 'user', content: toolResults });
    }

    this.updateAgentState(agentId, { status: 'done' });
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
