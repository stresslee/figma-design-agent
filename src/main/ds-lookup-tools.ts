/**
 * DS Lookup Tools — Local file-based design system lookups
 *
 * These tools don't need Figma plugin connection.
 * They read from local DS files directly.
 */

import { getIcons, getVariants, getDesignTokens } from '../shared/ds-data';
import type { ToolDefinition } from '../shared/types';

/**
 * Register DS Lookup tools into the tool registry
 */
export function registerDSLookupTools(tools: Map<string, ToolDefinition>): void {
  // lookup_icon
  tools.set('lookup_icon', {
    name: 'lookup_icon',
    description: 'Look up icon name → componentId from DS icon library. Returns up to 20 matching icons.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Icon name to search (e.g. "arrow", "check", "close")' }
      },
      required: ['query']
    },
    handler: async (params) => {
      const query = (params.query as string).toLowerCase();
      const icons = getIcons();
      const matches: Array<{ name: string; componentId: string }> = [];

      for (const [name, componentId] of Object.entries(icons)) {
        if (name.toLowerCase().includes(query)) {
          matches.push({ name, componentId });
          if (matches.length >= 20) break;
        }
      }

      return { count: matches.length, icons: matches };
    }
  });

  // lookup_variant
  tools.set('lookup_variant', {
    name: 'lookup_variant',
    description: 'Look up component variants from DS (ds-1-variants.jsonl). Returns setKey and variant key mappings. Use the returned componentKey values in batch_build_screen instance nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Component name to search (e.g. "Button", "Input field", "Checkbox", "Social button")' },
        variantFilter: { type: 'string', description: 'Optional filter within variant keys (e.g. "Size=md" to only show medium variants, "Hierarchy=Primary" for primary buttons)' }
      },
      required: ['query']
    },
    handler: async (params) => {
      const query = (params.query as string).toLowerCase();
      const variantFilter = params.variantFilter as string | undefined;
      const variants = getVariants();
      const matches = variants
        .filter((v) => v.name.toLowerCase().includes(query))
        .slice(0, 5);

      const results = matches.map((m) => {
        let filteredVariants = m.variants;
        if (variantFilter) {
          const filterLower = variantFilter.toLowerCase();
          const filtered: Record<string, string> = {};
          for (const [key, val] of Object.entries(m.variants)) {
            if (key.toLowerCase().includes(filterLower)) {
              filtered[key] = val;
            }
          }
          filteredVariants = filtered;
        }
        return {
          name: m.name,
          setKey: m.setKey,
          variantCount: Object.keys(filteredVariants).length,
          variants: filteredVariants,
        };
      });

      return { count: results.length, components: results };
    }
  });

  // lookup_design_token
  tools.set('lookup_design_token', {
    name: 'lookup_design_token',
    description: 'Look up design token name → value. Searches colors, spacing, radius, typography.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Token name to search (e.g. "bg-primary", "spacing-4")' },
        category: {
          type: 'string',
          enum: ['colors', 'spacing', 'radius', 'typography', 'layout', 'width'],
          description: 'Optional: limit search to specific category'
        }
      },
      required: ['query']
    },
    handler: async (params) => {
      const query = (params.query as string).toLowerCase();
      const category = params.category as string | undefined;
      const tokens = getDesignTokens();

      const results: Array<{ token: string; value: string; category: string }> = [];

      const categories = category
        ? { [category]: tokens[category as keyof typeof tokens] }
        : tokens;

      for (const [cat, items] of Object.entries(categories)) {
        if (cat === 'textStyles' || cat === 'effectStyles') continue;
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          if ('token' in item && (item as { token: string }).token.toLowerCase().includes(query)) {
            results.push({
              token: (item as { token: string }).token,
              value: (item as { value: string }).value,
              category: cat,
            });
            if (results.length >= 50) break;
          }
        }
        if (results.length >= 50) break;
      }

      return { count: results.length, tokens: results };
    }
  });

  // lookup_text_style
  tools.set('lookup_text_style', {
    name: 'lookup_text_style',
    description: 'Look up text style name → Style ID for set_text_style_id binding.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text style name to search (e.g. "Text sm", "Heading")' }
      },
      required: ['query']
    },
    handler: async (params) => {
      const query = (params.query as string).toLowerCase();
      const tokens = getDesignTokens();

      const textMatches = tokens.textStyles.filter((s) =>
        s.name.toLowerCase().includes(query)
      );
      const effectMatches = tokens.effectStyles.filter((s) =>
        s.name.toLowerCase().includes(query)
      );

      return {
        textStyles: textMatches,
        effectStyles: effectMatches,
      };
    }
  });
}
