/**
 * Untitled UI Icons — Local SVG extraction from @untitledui/icons package.
 *
 * Extracts SVG path data from the installed npm package and builds
 * complete SVG strings for use with Figma's createNodeFromSvg().
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// DS-1 icon names use kebab-case (e.g. "check-circle", "home-01")
// @untitledui/icons uses PascalCase (e.g. "CheckCircle", "Home01")

let iconIndex: Map<string, string> | null = null; // kebab-name → PascalCase filename
let projectRoot: string = join(__dirname, '..', '..');

export function setIconProjectRoot(root: string) {
  projectRoot = root;
}

function getIconDir(): string {
  return join(projectRoot, 'node_modules', '@untitledui', 'icons', 'dist');
}

/** Convert PascalCase to kebab-case: "CheckCircle" → "check-circle", "Home01" → "home-01" */
function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/(\D)(\d)/g, '$1-$2')
    .toLowerCase();
}

/** Build the icon index: maps kebab-case names to PascalCase filenames */
function buildIndex(): Map<string, string> {
  if (iconIndex) return iconIndex;
  iconIndex = new Map();

  const dir = getIconDir();
  if (!existsSync(dir)) {
    console.warn('[untitled-icons] @untitledui/icons not installed at', dir);
    return iconIndex;
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const pascal = f.replace('.js', '');
    const kebab = pascalToKebab(pascal);
    iconIndex.set(kebab, pascal);
    // Also index without number suffix: "home-01" → also indexed as "home01"
    iconIndex.set(pascal.toLowerCase(), pascal);
  }

  console.log(`[untitled-icons] Indexed ${iconIndex.size} icon variants from ${files.length} files`);
  return iconIndex;
}

/** Extract SVG path data from an icon JS file */
function extractPaths(source: string): string[] {
  const paths: string[] = [];
  const regex = /d:"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/**
 * Resolve an icon name to its PascalCase filename.
 * Accepts: "check-circle", "CheckCircle", "checkcircle", "home-01", "Home01"
 */
export function resolveIconFile(name: string): string | null {
  const index = buildIndex();

  // 1. Direct kebab match
  const kebab = name.toLowerCase().replace(/[_ ]/g, '-');
  if (index.has(kebab)) return index.get(kebab)!;

  // 2. Direct lowercase match (PascalCase → lowercase)
  const lower = name.toLowerCase().replace(/[-_ ]/g, '');
  if (index.has(lower)) return index.get(lower)!;

  // 3. Try adding common suffixes
  for (const suffix of ['01', '02', '03', '04']) {
    if (index.has(kebab + '-' + suffix)) return index.get(kebab + '-' + suffix)!;
    if (index.has(lower + suffix)) return index.get(lower + suffix)!;
  }

  // 4. Prefix/contains match
  for (const [key, pascal] of index) {
    if (key.startsWith(kebab) || key.includes(kebab)) return pascal;
  }

  return null;
}

/**
 * Generate a complete SVG string for a given icon name.
 * Returns null if icon not found.
 */
export function getIconSvg(
  iconName: string,
  size: number = 24,
  color: string = 'currentColor',
  strokeWidth: number = 2
): string | null {
  const pascal = resolveIconFile(iconName);
  if (!pascal) return null;

  const filePath = join(getIconDir(), pascal + '.js');
  if (!existsSync(filePath)) return null;

  const source = readFileSync(filePath, 'utf8');
  const paths = extractPaths(source);
  if (paths.length === 0) return null;

  const pathElements = paths
    .map(d => `<path d="${d}"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round">${pathElements}</svg>`;
}

/**
 * List all available icon names (kebab-case).
 */
export function listIcons(): string[] {
  const index = buildIndex();
  // Return only kebab-case entries (skip lowercase duplicates)
  return Array.from(index.keys()).filter(k => k.includes('-'));
}
