/**
 * DS Data Loader — Reused from existing MCP server
 *
 * Loads and caches design system data from local files.
 * No Figma connection needed.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────

export interface VariantEntry {
  name: string;
  setKey: string;
  variants: Record<string, string>;
}

export interface DesignToken {
  token: string;
  value: string;
  type?: string;
}

export interface TextStyleEntry {
  name: string;
  key: string;
  styleId: string;
}

export interface DesignTokens {
  colors: DesignToken[];
  spacing: DesignToken[];
  radius: DesignToken[];
  typography: DesignToken[];
  textStyles: TextStyleEntry[];
  effectStyles: TextStyleEntry[];
  layout: DesignToken[];
  width: DesignToken[];
}

// ─── Caches ──────────────────────────────────────────────────────────

let iconsCache: Record<string, string> | null = null;
let variantsCache: VariantEntry[] | null = null;
let tokensCache: DesignTokens | null = null;
let projectRoot: string | null = null;

/** Set the project root for file resolution */
export function setProjectRoot(root: string): void {
  projectRoot = root;
}

function getRoot(): string {
  if (!projectRoot) {
    // Default: project root is two levels up from out/main/ or src/shared/
    projectRoot = path.resolve(__dirname, '..', '..');
  }
  return projectRoot;
}

/** Resolve the ds/ directory within the project root */
function getDsDir(): string {
  return path.join(getRoot(), 'ds');
}

// ─── Icons ───────────────────────────────────────────────────────────

export function getIcons(): Record<string, string> {
  if (iconsCache) return iconsCache;

  const filePath = path.join(getDsDir(), 'ds-1-icons.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Icons file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  iconsCache = JSON.parse(raw) as Record<string, string>;
  return iconsCache;
}

// ─── Variants ────────────────────────────────────────────────────────

export function getVariants(): VariantEntry[] {
  if (variantsCache) return variantsCache;

  const filePath = path.join(getDsDir(), 'ds-1-variants.jsonl');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Variants file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  variantsCache = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as VariantEntry);
  return variantsCache;
}

// ─── Design Tokens ───────────────────────────────────────────────────

function parseTokenTable(lines: string[], startIdx: number): { tokens: DesignToken[]; endIdx: number } {
  const tokens: DesignToken[] = [];
  let i = startIdx;

  while (i < lines.length && !lines[i].startsWith('|')) i++;
  if (i >= lines.length) return { tokens, endIdx: i };

  i += 2; // Skip header + separator

  while (i < lines.length && lines[i].startsWith('|')) {
    const cols = lines[i].split('|').map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 2) {
      tokens.push({ token: cols[0], value: cols[1], type: cols[2] || undefined });
    }
    i++;
  }

  return { tokens, endIdx: i };
}

function parseStyleTable(lines: string[], startIdx: number): { styles: TextStyleEntry[]; endIdx: number } {
  const styles: TextStyleEntry[] = [];
  let i = startIdx;

  while (i < lines.length && !lines[i].startsWith('|')) i++;
  if (i >= lines.length) return { styles, endIdx: i };

  i += 2;

  while (i < lines.length && lines[i].startsWith('|')) {
    const cols = lines[i].split('|').map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 3) {
      styles.push({
        name: cols[0],
        key: cols[1].replace(/`/g, ''),
        styleId: cols[2].replace(/`/g, ''),
      });
    }
    i++;
  }

  return { styles, endIdx: i };
}

export function getDesignTokens(): DesignTokens {
  if (tokensCache) return tokensCache;

  const filePath = path.join(getDsDir(), 'DESIGN_TOKENS.md');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Design tokens file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  const result: DesignTokens = {
    colors: [], spacing: [], radius: [], typography: [],
    textStyles: [], effectStyles: [], layout: [], width: [],
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('## Colors')) {
      i++;
      while (i < lines.length && !lines[i].startsWith('## ')) {
        if (lines[i].startsWith('|') && !lines[i].startsWith('|--') && !lines[i].startsWith('| Token')) {
          const cols = lines[i].split('|').map((c) => c.trim()).filter(Boolean);
          if (cols.length >= 2) {
            result.colors.push({ token: cols[0], value: cols[1], type: cols[2] || undefined });
          }
        }
        i++;
      }
    } else if (line.startsWith('## Spacing')) {
      const p = parseTokenTable(lines, i + 1);
      result.spacing = p.tokens; i = p.endIdx;
    } else if (line.startsWith('## Radius')) {
      const p = parseTokenTable(lines, i + 1);
      result.radius = p.tokens; i = p.endIdx;
    } else if (line.startsWith('## Typography')) {
      const p = parseTokenTable(lines, i + 1);
      result.typography = p.tokens; i = p.endIdx;
    } else if (line.startsWith('## Text Styles')) {
      const p = parseStyleTable(lines, i + 1);
      result.textStyles = p.styles; i = p.endIdx;
    } else if (line.startsWith('## Effect Styles')) {
      const p = parseStyleTable(lines, i + 1);
      result.effectStyles = p.styles; i = p.endIdx;
    } else if (line.startsWith('## Layout')) {
      const p = parseTokenTable(lines, i + 1);
      result.layout = p.tokens; i = p.endIdx;
    } else if (line.startsWith('## Width')) {
      const p = parseTokenTable(lines, i + 1);
      result.width = p.tokens; i = p.endIdx;
    } else {
      i++;
    }
  }

  tokensCache = result;
  return tokensCache;
}
