/**
 * System Prompt Builder
 *
 * Constructs system prompts with pre-injected context:
 * - DS schema (tokens, variants, icons summary)
 * - Design rules (from CLAUDE.md)
 * - Current Figma document state
 * - Available tools list
 *
 * This eliminates 3-5 exploration turns at the start of each design session.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ToolDefinition } from '../shared/types';

export interface PromptContext {
  /** Available tools for the agent */
  tools: Map<string, ToolDefinition>;
  /** Current Figma document info (if connected) */
  figmaDocInfo?: Record<string, unknown>;
  /** Current selection in Figma */
  figmaSelection?: Record<string, unknown>;
  /** User's custom instructions */
  customInstructions?: string;
}

/**
 * Build the full system prompt with all context pre-injected
 */
export async function buildSystemPrompt(
  context: PromptContext,
  projectRoot: string
): Promise<string> {
  const sections: string[] = [];

  // 1. Role and identity
  sections.push(ROLE_PROMPT);

  // 2. Design rules (from CLAUDE.md, filtered to design-relevant sections)
  const designRules = await loadDesignRules(projectRoot);
  if (designRules) {
    sections.push(`## Design Rules\n\n${designRules}`);
  }

  // 3. DS Token summary
  const tokenSummary = await loadTokenSummary(projectRoot);
  if (tokenSummary) {
    sections.push(`## Design System Tokens (DS-1)\n\n${tokenSummary}`);
  }

  // 4. Available tools
  const toolsList = buildToolsList(context.tools);
  sections.push(`## Available Tools\n\n${toolsList}`);

  // 5. Current Figma state (if available)
  if (context.figmaDocInfo) {
    sections.push(`## Current Figma Document\n\n\`\`\`json\n${JSON.stringify(context.figmaDocInfo, null, 2)}\n\`\`\``);
  }

  if (context.figmaSelection) {
    sections.push(`## Current Selection\n\n\`\`\`json\n${JSON.stringify(context.figmaSelection, null, 2)}\n\`\`\``);
  }

  // 6. Custom instructions
  if (context.customInstructions) {
    sections.push(`## Additional Instructions\n\n${context.customInstructions}`);
  }

  return sections.join('\n\n---\n\n');
}

const ROLE_PROMPT = `# Figma Design Agent

You are an expert Figma design agent that creates high-quality mobile and web designs directly in Figma.
You have direct access to Figma through tool calls — you can create frames, text, shapes, component instances, and apply design system tokens.

## Core Principles
- Use the Design System (DS-1) tokens for ALL colors, typography, and spacing — never use custom hex values
- Apply Auto Layout to all non-root frames
- Use Pretendard as the default font
- Icons must come from the DS icon library (never use text characters for icons)
- Root frames use absolute positioning (no Auto Layout)
- Mobile screens: 393 × 852 px (iPhone 16)

## Workflow
1. Analyze the request and plan the screen structure
2. Create the root frame
3. Build sections top-to-bottom using batch_build_screen for efficiency
4. Apply DS variable bindings (Text Styles → Typography → Radius → Colors)
5. Insert icons from the DS library
6. Take a screenshot to verify, fix any issues

## Efficiency Rules
- Use batch_build_screen to create entire sections in one call
- Use batch_bind_variables for DS variable binding (not individual set_bound_variables calls)
- Use batch_set_text_style_id for text style application
- Minimize round-trips: batch operations wherever possible`;

/**
 * Load design rules from CLAUDE.md, extracting design-relevant sections
 */
async function loadDesignRules(projectRoot: string): Promise<string | null> {
  try {
    const claudeMd = await readFile(join(projectRoot, 'ds', 'CLAUDE.md'), 'utf-8');

    // Extract relevant sections
    const sections = [
      'Design Rules',
      'Root Frame',
      'Auto Layout',
      'Typography',
      'Icons',
      'Colors',
      'Variable Binding',
      'Mobile Detail Screen',
      'Mobile Screen Size',
      'Text',
    ];

    const extracted: string[] = [];
    for (const section of sections) {
      const regex = new RegExp(`### ${section}[\\s\\S]*?(?=### |## |$)`, 'g');
      const match = claudeMd.match(regex);
      if (match) {
        extracted.push(match[0].trim());
      }
    }

    return extracted.length > 0 ? extracted.join('\n\n') : null;
  } catch {
    return null;
  }
}

/**
 * Load token summary from DESIGN_TOKENS.md
 * Includes colors, spacing, radius, and text style IDs
 */
async function loadTokenSummary(projectRoot: string): Promise<string | null> {
  try {
    const tokensPath = join(projectRoot, 'ds', 'DESIGN_TOKENS.md');
    const content = await readFile(tokensPath, 'utf-8');

    // Extract key sections (first 500 lines covers colors, spacing, radius, text styles)
    const lines = content.split('\n');
    const summary = lines.slice(0, 500).join('\n');

    return summary;
  } catch {
    return null;
  }
}

/**
 * Build a concise tools list for the system prompt
 */
function buildToolsList(tools: Map<string, ToolDefinition>): string {
  const categories: Record<string, string[]> = {
    'Document': [],
    'Creation': [],
    'Modification': [],
    'Text': [],
    'Component': [],
    'Batch': [],
    'Variable': [],
    'DS Lookup': [],
  };

  for (const [name] of tools) {
    if (name.startsWith('get_') || name === 'join_channel' || name.includes('scan_') || name.includes('export_') || name.includes('page')) {
      categories['Document'].push(name);
    } else if (name.startsWith('create_')) {
      categories['Creation'].push(name);
    } else if (name.startsWith('set_text') || name.includes('font') || name.includes('text')) {
      categories['Text'].push(name);
    } else if (name.startsWith('batch_') || name.includes('_batch')) {
      categories['Batch'].push(name);
    } else if (name.includes('variable') || name.includes('bound') || name.includes('image_fill')) {
      categories['Variable'].push(name);
    } else if (name.includes('clone') || name.includes('group') || name.includes('instance') || name.includes('component') || name.includes('insert') || name.includes('flatten')) {
      categories['Component'].push(name);
    } else if (name.startsWith('lookup_')) {
      categories['DS Lookup'].push(name);
    } else {
      categories['Modification'].push(name);
    }
  }

  const lines: string[] = [];
  for (const [category, toolNames] of Object.entries(categories)) {
    if (toolNames.length > 0) {
      lines.push(`**${category}**: ${toolNames.join(', ')}`);
    }
  }

  return lines.join('\n');
}
