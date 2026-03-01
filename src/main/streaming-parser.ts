/**
 * Streaming Parser for batch_build_screen
 *
 * Intercepts streaming JSON from Claude's tool call input and parses
 * completed nodes as they arrive. Uses jsonrepair to fix incomplete JSON,
 * then extracts fully-formed nodes to send to Figma immediately.
 *
 * This eliminates waiting for the full tool call to complete before
 * rendering in Figma — nodes appear as the LLM generates them.
 */

import { jsonrepair } from 'jsonrepair';
import { EventEmitter } from 'events';

export interface StreamingParserEvents {
  /** A complete node was extracted and is ready to render */
  'node-ready': (node: BlueprintNode, path: string) => void;
  /** The full batch is complete */
  'batch-complete': (blueprint: Record<string, unknown>) => void;
  /** A parse error occurred (non-fatal, parser continues) */
  'parse-error': (error: string) => void;
}

export interface BlueprintNode {
  type?: string;
  name?: string;
  children?: BlueprintNode[];
  [key: string]: unknown;
}

export class StreamingParser extends EventEmitter {
  private buffer = '';
  private emittedNodes = new Set<string>();
  private toolName: string | null = null;

  /** Reset parser state for a new tool call */
  reset(toolName?: string): void {
    this.buffer = '';
    this.emittedNodes.clear();
    this.toolName = toolName || null;
  }

  /** Feed a new chunk of streaming JSON delta */
  feed(delta: string): void {
    this.buffer += delta;

    // Only parse batch_build_screen or build_screen_full
    if (this.toolName && !this.toolName.includes('build_screen') && !this.toolName.includes('batch_build')) {
      return;
    }

    this.tryParse();
  }

  /** Attempt to parse and extract completed nodes */
  private tryParse(): void {
    if (this.buffer.length < 20) return; // Too short to contain meaningful JSON

    try {
      // Try to repair incomplete JSON
      const repaired = jsonrepair(this.buffer);
      const parsed = JSON.parse(repaired);

      // Extract the blueprint (might be nested in different ways)
      const blueprint = parsed.blueprint || parsed;
      if (!blueprint || typeof blueprint !== 'object') return;

      // Walk the tree and emit any new complete nodes
      this.walkAndEmit(blueprint, 'root');
    } catch {
      // jsonrepair couldn't fix it yet — that's normal for partial JSON
      // Try a more aggressive approach: look for complete objects
      this.tryExtractPartialNodes();
    }
  }

  /** Walk the blueprint tree and emit nodes not yet emitted */
  private walkAndEmit(node: BlueprintNode, path: string): void {
    if (!node || typeof node !== 'object') return;

    // A node is "complete" if it has a type and either dimensions or children
    const isComplete = node.type && (
      (node.width !== undefined && node.height !== undefined) ||
      node.children !== undefined
    );

    if (isComplete && !this.emittedNodes.has(path)) {
      // Check if this node's children are also complete (or it's a leaf)
      const children = node.children;
      if (!children || (Array.isArray(children) && children.length > 0)) {
        // Emit a shallow copy without children for immediate rendering
        const shallowNode = { ...node };
        delete shallowNode.children;
        this.emittedNodes.add(path);
        this.emit('node-ready', shallowNode, path);
      }
    }

    // Recurse into children
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) {
        this.walkAndEmit(node.children[i], `${path}.children[${i}]`);
      }
    }
  }

  /** Try to extract partial nodes from incomplete JSON using heuristics */
  private tryExtractPartialNodes(): void {
    // Look for complete "type": "..." patterns followed by closing braces
    // This is a heuristic fallback when jsonrepair fails
    const nodePattern = /\{[^{}]*"type"\s*:\s*"(FRAME|TEXT|RECTANGLE|INSTANCE)"[^{}]*\}/g;
    let match;

    while ((match = nodePattern.exec(this.buffer)) !== null) {
      const nodeStr = match[0];
      const pos = match.index;
      const key = `partial_${pos}`;

      if (!this.emittedNodes.has(key)) {
        try {
          const node = JSON.parse(jsonrepair(nodeStr));
          if (node.type) {
            this.emittedNodes.add(key);
            this.emit('node-ready', node, key);
          }
        } catch {
          // Still can't parse, skip
        }
      }
    }
  }

  /** Signal that the tool call is complete and parse the final result */
  finalize(fullInput: string): void {
    try {
      const parsed = JSON.parse(fullInput);
      const blueprint = parsed.blueprint || parsed;
      this.emit('batch-complete', blueprint);
    } catch (error) {
      this.emit('parse-error', `Failed to parse final input: ${error}`);
    }
  }
}
