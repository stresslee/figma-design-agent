/**
 * Embedded MCP Tools — Direct function calls, no stdio transport
 *
 * Converts existing 58+ MCP tools into a tool registry that the
 * AgentOrchestrator can call directly. Each tool calls FigmaWSServer.sendCommand()
 * instead of going through MCP protocol.
 */

import { z, ZodObject, ZodRawShape } from 'zod';
import { FigmaWSServer } from './figma-ws-server';
import type { ToolDefinition } from '../shared/types';

// Re-export for convenience
export type { ToolDefinition };

/**
 * Build the complete tool registry from FigmaWSServer
 */
export function buildToolRegistry(figmaWS: FigmaWSServer): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();

  // Helper to register a tool
  function reg(name: string, description: string, schema: Record<string, unknown>, handler: (params: Record<string, unknown>) => Promise<unknown>) {
    tools.set(name, { name, description, inputSchema: schema, handler });
  }

  // Helper: send command to Figma plugin
  async function cmd(command: string, params: Record<string, unknown> = {}, timeoutMs?: number) {
    return figmaWS.sendCommand(command, params, timeoutMs);
  }

  // ============================================================
  // Document Tools
  // ============================================================

  reg('join_channel', 'Join a Figma document channel for communication', {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel name to join' }
    },
    required: ['channel']
  }, async (params) => {
    await figmaWS.joinChannel(params.channel as string);
    return { success: true, channel: params.channel };
  });

  reg('get_document_info', 'Get information about the current Figma document', {
    type: 'object', properties: {}
  }, async () => cmd('get_document_info'));

  reg('get_selection', 'Get the current selection in Figma', {
    type: 'object', properties: {}
  }, async () => cmd('get_selection'));

  reg('get_node_info', 'Get detailed information about a specific node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID to inspect' }
    },
    required: ['nodeId']
  }, async (params) => cmd('get_node_info', params));

  reg('get_nodes_info', 'Get information about multiple nodes', {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Array of node IDs' }
    },
    required: ['nodeIds']
  }, async (params) => cmd('get_nodes_info', params));

  reg('get_styles', 'Get all styles in the document', {
    type: 'object', properties: {}
  }, async () => cmd('get_styles'));

  reg('get_local_components', 'Get all local components', {
    type: 'object', properties: {}
  }, async () => cmd('get_local_components'));

  reg('get_remote_components', 'Get remote/library components', {
    type: 'object', properties: {}
  }, async () => cmd('get_remote_components'));

  reg('get_pages', 'Get all pages in the document', {
    type: 'object', properties: {}
  }, async () => cmd('get_pages'));

  reg('manage_pages', 'Create, rename, or delete pages', {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'rename', 'delete'] },
      name: { type: 'string' },
      newName: { type: 'string' },
      pageId: { type: 'string' }
    },
    required: ['action']
  }, async (params) => cmd('manage_pages', params));

  reg('scan_text_nodes', 'Scan text nodes in a subtree', {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Root node to scan' }
    },
    required: ['nodeId']
  }, async (params) => cmd('scan_text_nodes', params));

  reg('export_node_as_image', 'Export a node as an image', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      format: { type: 'string', enum: ['PNG', 'JPG', 'SVG', 'PDF'] },
      scale: { type: 'number' }
    },
    required: ['nodeId']
  }, async (params) => cmd('export_node_as_image', params));

  // ============================================================
  // Creation Tools
  // ============================================================

  reg('create_rectangle', 'Create a rectangle', {
    type: 'object',
    properties: {
      x: { type: 'number' }, y: { type: 'number' },
      width: { type: 'number' }, height: { type: 'number' },
      name: { type: 'string' }, parentId: { type: 'string' }
    },
    required: ['x', 'y', 'width', 'height']
  }, async (params) => cmd('create_rectangle', params));

  reg('create_frame', 'Create a frame', {
    type: 'object',
    properties: {
      x: { type: 'number' }, y: { type: 'number' },
      width: { type: 'number' }, height: { type: 'number' },
      name: { type: 'string' }, parentId: { type: 'string' }
    },
    required: ['x', 'y', 'width', 'height']
  }, async (params) => cmd('create_frame', params));

  reg('create_text', 'Create a text node', {
    type: 'object',
    properties: {
      x: { type: 'number' }, y: { type: 'number' },
      text: { type: 'string' }, fontSize: { type: 'number' },
      fontWeight: { type: 'number' }, fontColor: { type: 'object' },
      fontName: { type: 'string' }, name: { type: 'string' },
      parentId: { type: 'string' }, width: { type: 'number' },
      textAlignHorizontal: { type: 'string' },
      textAlignVertical: { type: 'string' },
      letterSpacing: { type: 'number' },
      lineHeight: { type: 'number' },
      textAutoResize: { type: 'string' },
      maxLines: { type: 'number' }
    },
    required: ['x', 'y', 'text']
  }, async (params) => {
    // Replace <br> with Unicode Line Separator
    if (typeof params.text === 'string') {
      params = { ...params, text: (params.text as string).replace(/<br>/g, '\u2028') };
    }
    return cmd('create_text', params);
  });

  reg('create_shape', 'Create a polygon or star shape', {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['POLYGON', 'STAR'] },
      x: { type: 'number' }, y: { type: 'number' },
      width: { type: 'number' }, height: { type: 'number' },
      pointCount: { type: 'number' }, name: { type: 'string' },
      parentId: { type: 'string' }
    },
    required: ['type', 'x', 'y', 'width', 'height']
  }, async (params) => cmd('create_shape', params));

  // ============================================================
  // Modification Tools
  // ============================================================

  reg('move_node', 'Move a node to new coordinates', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }
    },
    required: ['nodeId', 'x', 'y']
  }, async (params) => cmd('move_node', params));

  reg('resize_node', 'Resize a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }
    },
    required: ['nodeId', 'width', 'height']
  }, async (params) => cmd('resize_node', params));

  reg('delete_node', 'Delete a node', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('delete_node', params));

  reg('set_fill_color', 'Set fill color of a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      r: { type: 'number' }, g: { type: 'number' },
      b: { type: 'number' }, a: { type: 'number' }
    },
    required: ['nodeId', 'r', 'g', 'b']
  }, async (params) => {
    const { nodeId, r, g, b, a, ...rest } = params as Record<string, number | string>;
    return cmd('set_fill_color', { nodeId, color: { r, g, b, a: a ?? 1 }, ...rest });
  });

  reg('set_stroke_color', 'Set stroke color of a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      r: { type: 'number' }, g: { type: 'number' },
      b: { type: 'number' }, a: { type: 'number' },
      strokeWeight: { type: 'number' }
    },
    required: ['nodeId', 'r', 'g', 'b']
  }, async (params) => {
    const { nodeId, r, g, b, a, strokeWeight, ...rest } = params as Record<string, number | string>;
    return cmd('set_stroke_color', { nodeId, color: { r, g, b, a: a ?? 1 }, strokeWeight: strokeWeight ?? 1, ...rest });
  });

  reg('set_corner_radius', 'Set corner radius', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      radius: { type: 'number' },
      topLeftRadius: { type: 'number' },
      topRightRadius: { type: 'number' },
      bottomLeftRadius: { type: 'number' },
      bottomRightRadius: { type: 'number' }
    },
    required: ['nodeId']
  }, async (params) => cmd('set_corner_radius', params));

  reg('set_auto_layout', 'Set auto layout on a frame', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      layoutMode: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL', 'NONE'] },
      itemSpacing: { type: 'number' },
      paddingTop: { type: 'number' }, paddingBottom: { type: 'number' },
      paddingLeft: { type: 'number' }, paddingRight: { type: 'number' },
      primaryAxisAlignItems: { type: 'string' },
      counterAxisAlignItems: { type: 'string' },
      layoutWrap: { type: 'string' }
    },
    required: ['nodeId', 'layoutMode']
  }, async (params) => cmd('set_auto_layout', params));

  reg('set_effects', 'Set effects (shadow, blur) on a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      effects: { type: 'array' }
    },
    required: ['nodeId', 'effects']
  }, async (params) => cmd('set_effects', params));

  reg('set_effect_style_id', 'Set effect style ID on a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      styleId: { type: 'string' }
    },
    required: ['nodeId', 'styleId']
  }, async (params) => cmd('set_effect_style_id', params));

  reg('set_layout_sizing', 'Set layout sizing mode', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      horizontal: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'] },
      vertical: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'] }
    },
    required: ['nodeId']
  }, async (params) => {
    const normalized = { ...params } as Record<string, unknown>;
    if (params.horizontal) normalized.layoutSizingHorizontal = params.horizontal;
    if (params.vertical) normalized.layoutSizingVertical = params.vertical;
    return cmd('set_layout_sizing', normalized);
  });

  reg('rename_node', 'Rename a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' }, name: { type: 'string' }
    },
    required: ['nodeId', 'name']
  }, async (params) => cmd('rename_node', params));

  reg('set_selection_colors', 'Set colors on selection or node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      fillColor: { type: 'object' },
      strokeColor: { type: 'object' }
    },
    required: ['nodeId']
  }, async (params) => cmd('set_selection_colors', params));

  // ============================================================
  // Text Tools
  // ============================================================

  reg('set_text_content', 'Set text content of a text node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' }, text: { type: 'string' }
    },
    required: ['nodeId', 'text']
  }, async (params) => {
    if (typeof params.text === 'string') {
      params = { ...params, text: (params.text as string).replace(/<br>/g, '\u2028') };
    }
    return cmd('set_text_content', params);
  });

  reg('set_text_properties', 'Set text properties', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      fontSize: { type: 'number' },
      fontWeight: { type: 'number' },
      fontName: { type: 'string' },
      letterSpacing: { type: 'number' },
      lineHeight: { type: 'number' },
      textAlignHorizontal: { type: 'string' },
      textAlignVertical: { type: 'string' },
      textAutoResize: { type: 'string' },
      maxLines: { type: 'number' },
      fontColor: { type: 'object' }
    },
    required: ['nodeId']
  }, async (params) => cmd('set_text_properties', params));

  reg('set_font_size', 'Set font size', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, fontSize: { type: 'number' } },
    required: ['nodeId', 'fontSize']
  }, async (params) => cmd('set_font_size', params));

  reg('set_font_weight', 'Set font weight', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, fontWeight: { type: 'number' } },
    required: ['nodeId', 'fontWeight']
  }, async (params) => cmd('set_font_weight', params));

  reg('set_font_name', 'Set font family', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, fontName: { type: 'string' } },
    required: ['nodeId', 'fontName']
  }, async (params) => cmd('set_font_name', params));

  reg('set_letter_spacing', 'Set letter spacing', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, letterSpacing: { type: 'number' } },
    required: ['nodeId', 'letterSpacing']
  }, async (params) => cmd('set_letter_spacing', params));

  reg('set_line_height', 'Set line height', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, lineHeight: { type: 'number' } },
    required: ['nodeId', 'lineHeight']
  }, async (params) => cmd('set_line_height', params));

  reg('set_paragraph_spacing', 'Set paragraph spacing', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, paragraphSpacing: { type: 'number' } },
    required: ['nodeId', 'paragraphSpacing']
  }, async (params) => cmd('set_paragraph_spacing', params));

  reg('set_text_case', 'Set text case', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, textCase: { type: 'string' } },
    required: ['nodeId', 'textCase']
  }, async (params) => cmd('set_text_case', params));

  reg('set_text_decoration', 'Set text decoration', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, textDecoration: { type: 'string' } },
    required: ['nodeId', 'textDecoration']
  }, async (params) => cmd('set_text_decoration', params));

  reg('set_text_align', 'Set text alignment', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      textAlignHorizontal: { type: 'string' },
      textAlignVertical: { type: 'string' }
    },
    required: ['nodeId']
  }, async (params) => cmd('set_text_align', params));

  reg('set_text_style_id', 'Apply a text style by ID', {
    type: 'object',
    properties: { nodeId: { type: 'string' }, styleId: { type: 'string' } },
    required: ['nodeId', 'styleId']
  }, async (params) => cmd('set_text_style_id', params));

  reg('get_styled_text_segments', 'Get styled text segments', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('get_styled_text_segments', params));

  reg('load_font_async', 'Preload a font for use', {
    type: 'object',
    properties: { family: { type: 'string' }, style: { type: 'string' } },
    required: ['family']
  }, async (params) => cmd('load_font_async', params));

  reg('set_multiple_text_contents', 'Set text content on multiple nodes', {
    type: 'object',
    properties: {
      entries: { type: 'array', items: { type: 'object' } }
    },
    required: ['entries']
  }, async (params) => cmd('set_multiple_text_contents', params));

  // ============================================================
  // Component Tools
  // ============================================================

  reg('clone_node', 'Clone a node', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('clone_node', params));

  reg('group_nodes', 'Group nodes together', {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' } },
      name: { type: 'string' }
    },
    required: ['nodeIds']
  }, async (params) => cmd('group_nodes', params));

  reg('ungroup_nodes', 'Ungroup a group node', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('ungroup_nodes', params));

  reg('flatten_node', 'Flatten a node', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('flatten_node', params));

  reg('insert_child', 'Insert a node as child of another', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' }, parentId: { type: 'string' },
      index: { type: 'number' }
    },
    required: ['nodeId', 'parentId']
  }, async (params) => cmd('insert_child', params));

  reg('create_component_instance', 'Create an instance of a component', {
    type: 'object',
    properties: {
      componentKey: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      parentId: { type: 'string' }
    },
    required: ['componentKey', 'x', 'y']
  }, async (params) => cmd('create_component_instance', params));

  reg('get_instance_properties', 'Get properties of a component instance', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('get_instance_properties', params));

  reg('set_instance_properties', 'Set properties on a component instance', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      properties: { type: 'object' }
    },
    required: ['nodeId', 'properties']
  }, async (params) => cmd('set_instance_properties', params));

  reg('create_component_from_node', 'Convert a node to a component', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('create_component_from_node', params));

  reg('scan_instances_for_swap', 'Scan component instances for swap targets', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('scan_instances_for_swap', params));

  // ============================================================
  // Variable & Binding Tools
  // ============================================================

  reg('get_local_variables', 'Get local variables from document', {
    type: 'object',
    properties: { includeLibrary: { type: 'boolean' } },
  }, async (params) => cmd('get_local_variables', params));

  reg('get_bound_variables', 'Get bound variables on a node', {
    type: 'object',
    properties: { nodeId: { type: 'string' } },
    required: ['nodeId']
  }, async (params) => cmd('get_bound_variables', params));

  reg('set_bound_variables', 'Bind variables to a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      variables: { type: 'object' }
    },
    required: ['nodeId', 'variables']
  }, async (params) => cmd('set_bound_variables', params));

  reg('set_image_fill', 'Set image fill on a node', {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      url: { type: 'string' },
      imageData: { type: 'string' },
      scaleMode: { type: 'string' }
    },
    required: ['nodeId']
  }, async (params) => cmd('set_image_fill', params));

  // ============================================================
  // Batch Tools
  // ============================================================

  reg('batch_execute', 'Execute multiple Figma commands in one call', {
    type: 'object',
    properties: {
      operations: { type: 'array', items: { type: 'object' } }
    },
    required: ['operations']
  }, async (params) => {
    // Same logic as existing batch_execute
    const operations = params.operations as Array<{
      op: string; id?: string; parentRef?: string; params: Record<string, unknown>;
    }>;
    const refMap: Record<string, string> = {};
    const results: unknown[] = [];

    for (const operation of operations) {
      try {
        const resolvedParams = { ...operation.params };

        if (operation.parentRef) {
          const resolved = refMap[operation.parentRef];
          if (!resolved) throw new Error(`Unresolved parentRef: ${operation.parentRef}`);
          resolvedParams.parentId = resolved;
        }

        for (const [key, value] of Object.entries(resolvedParams)) {
          if (typeof value === 'string' && value.startsWith('$') && refMap[value]) {
            resolvedParams[key] = refMap[value];
          }
        }

        const normalized = normalizeParams(operation.op, resolvedParams as Record<string, unknown>);
        const result = await cmd(operation.op, normalized);
        const figmaId = extractId(result);

        if (operation.id && figmaId) {
          refMap[operation.id] = figmaId;
        }

        results.push({ op: operation.op, success: true, id: operation.id, figmaId });
      } catch (error) {
        results.push({
          op: operation.op, success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { results, refMap };
  });

  reg('batch_build_screen', `Build a complete Figma screen from a single JSON tree. Creates all nodes recursively in one call.

Node types and their properties:
- frame: x, y, width, height, name, fill({r,g,b,a}), stroke({r,g,b,a,weight}), cornerRadius, autoLayout({layoutMode,paddingTop,paddingBottom,paddingLeft,paddingRight,paddingHorizontal,paddingVertical,padding,itemSpacing,primaryAxisAlignItems,counterAxisAlignItems,layoutWrap}), layoutSizingHorizontal(FILL|HUG|FIXED), layoutSizingVertical(FILL|HUG|FIXED), effects([{type,color,offset,radius,spread}]), imageFill({url,scaleMode}), clipsContent, children[]
- text: x, y, name, text, fontSize, fontWeight(100-900), fontFamily("Pretendard"), fontColor({r,g,b,a}), textAlignHorizontal(LEFT|CENTER|RIGHT), textAutoResize(WIDTH_AND_HEIGHT|HEIGHT|TRUNCATE), lineHeight, letterSpacing, layoutSizingHorizontal, layoutSizingVertical
- rectangle: x, y, width, height, name, fill, stroke, strokeWeight, cornerRadius, layoutSizingHorizontal, layoutSizingVertical, imageFill
- ellipse: x, y, width, height, name, fill, stroke, layoutSizingHorizontal, layoutSizingVertical
- instance: x, y, name, componentKey (REQUIRED — from lookup_variant or pre-loaded keys), width, height, layoutSizingHorizontal, layoutSizingVertical, textOverrides({suffix: text})
- clone: name, sourceNodeId (REQUIRED), width, height, layoutSizingHorizontal, layoutSizingVertical

textOverrides (instance only): { "suffix": "new text" } — Sets text on instance children using Suffix Map.
imageFill: { url: "https://...", scaleMode?: "FILL"|"FIT" } — Downloads and applies image as fill.
layoutSizingHorizontal/Vertical: FILL to stretch to parent, HUG to fit content, FIXED for explicit size.
Colors: { r: 0-1, g: 0-1, b: 0-1, a?: 0-1 }
Root frame supports: autoLayout, cornerRadius, fill.`, {
    type: 'object',
    properties: {
      blueprint: { type: 'object', description: 'Root node blueprint with children tree. Include name, width, height, fill, and children array.' }
    },
    required: ['blueprint']
  }, async (params) => {
    // Pre-fetch images in the blueprint tree
    const blueprint = params.blueprint as Record<string, unknown>;
    const nodes = blueprint.children ? [blueprint] : [blueprint];
    await prefetchImages(nodes);
    return cmd('batch_build_screen', params, 300000); // 5 min timeout
  });

  reg('batch_bind_variables', 'Bind variables to multiple nodes at once', {
    type: 'object',
    properties: {
      bindings: { type: 'array', items: { type: 'object' } }
    },
    required: ['bindings']
  }, async (params) => cmd('batch_bind_variables', params, 300000));

  reg('batch_set_text_style_id', 'Apply text styles to multiple nodes', {
    type: 'object',
    properties: {
      entries: { type: 'array', items: { type: 'object' } }
    },
    required: ['entries']
  }, async (params) => cmd('batch_set_text_style_id', params, 300000));

  reg('set_layout_sizing_batch', 'Set layout sizing on multiple nodes', {
    type: 'object',
    properties: {
      entries: { type: 'array', items: { type: 'object' } }
    },
    required: ['entries']
  }, async (params) => cmd('set_layout_sizing_batch', params));

  return tools;
}

// ============================================================
// Helper functions (ported from existing batch-tools.ts)
// ============================================================

function extractId(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  return (r?.id || r?.nodeId) as string | undefined;
}

function normalizeParams(op: string, params: Record<string, unknown>): Record<string, unknown> {
  switch (op) {
    case 'set_fill_color': {
      if (params.r !== undefined && !params.color) {
        const { nodeId, r, g, b, a, ...rest } = params;
        return { nodeId, color: { r, g, b, a: a ?? 1 }, ...rest };
      }
      return params;
    }
    case 'set_stroke_color': {
      if (params.r !== undefined && !params.color) {
        const { nodeId, r, g, b, a, strokeWeight, ...rest } = params;
        return { nodeId, color: { r, g, b, a: a ?? 1 }, strokeWeight: strokeWeight ?? 1, ...rest };
      }
      return params;
    }
    case 'set_layout_sizing': {
      const n = { ...params };
      if (params.horizontal && !params.layoutSizingHorizontal) n.layoutSizingHorizontal = params.horizontal;
      if (params.vertical && !params.layoutSizingVertical) n.layoutSizingVertical = params.vertical;
      return n;
    }
    case 'set_text_content': {
      if (typeof params.text === 'string') {
        return { ...params, text: (params.text as string).replace(/<br>/g, '\u2028') };
      }
      return params;
    }
    default:
      return params;
  }
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (error) {
    console.error(`Image fetch failed for ${url}:`, error);
    return null;
  }
}

async function prefetchImages(nodes: unknown[]): Promise<void> {
  const promises: Promise<void>[] = [];

  function collect(node: Record<string, unknown>) {
    const imageFill = node.imageFill as Record<string, unknown> | undefined;
    if (imageFill?.url) {
      promises.push(
        fetchImageAsBase64(imageFill.url as string).then((base64) => {
          if (base64) node.imageData = base64;
        })
      );
    }
    const children = node.children as unknown[] | undefined;
    if (children) {
      for (const child of children) {
        collect(child as Record<string, unknown>);
      }
    }
  }

  for (const node of nodes) {
    collect(node as Record<string, unknown>);
  }
  await Promise.all(promises);
}
