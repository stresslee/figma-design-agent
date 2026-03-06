/**
 * Pencil (.pen) → Figma Blueprint 변환기
 *
 * PenNode 트리를 Figma batch_build_screen이 이해하는 Blueprint JSON으로
 * 100% 결정적 변환. LLM 개입 없음.
 */

// ============================================================
// Types
// ============================================================

export interface PenNode {
  id?: string;
  type: string; // frame, text, icon_font, rectangle, ellipse, ref, path, image, ...
  name?: string;
  layout?: 'v' | 'h';
  gap?: number;
  padding?: string | number | number[];
  justifyContent?: string;
  alignItems?: string;
  width?: number | string;   // number | "fill_container" | "fit_content"
  height?: number | string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  fill?: string;              // hex like "#FF6B6B" or gradient
  color?: string;             // text color hex
  content?: string;           // text content
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  textAlign?: string;
  textDecoration?: string;
  textTransform?: string;
  icon?: string;              // icon_font icon name
  iconSize?: number;
  cornerRadius?: number | string; // number or "12 12 0 0"
  opacity?: number;
  overflow?: string;
  stroke?: string;
  strokeWidth?: number;
  effects?: PenEffect[];
  backgroundImage?: string;   // image URL
  children?: PenNode[];
  // ref-specific
  refId?: string;
  // path-specific
  pathData?: string;
  viewBox?: string;
  [key: string]: unknown;     // catch-all for unknown properties
}

export interface PenEffect {
  type: string;        // "drop-shadow", "inner-shadow", "blur"
  color?: string;      // hex
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
}

export interface ConvertOptions {
  preserveFonts?: boolean;   // default: true — 원본 폰트 유지
  targetWidth?: number;      // default: 393
  targetHeight?: number;     // default: 852
}

export interface ConvertResult {
  blueprint: Record<string, unknown>;
  stats: {
    totalNodes: number;
    frames: number;
    texts: number;
    icons: number;
    shapes: number;
    warnings: number;
  };
  warnings: string[];
}

type BlueprintNode = Record<string, unknown>;

// ============================================================
// Lucide → DS-1 icon normalization
// ============================================================

const LUCIDE_TO_DS1: Record<string, string> = {
  'star': 'star-01',
  'home': 'home-01',
  'search': 'search-lg',
  'user': 'user-01',
  'users': 'users-01',
  'heart': 'heart',
  'bell': 'bell-01',
  'settings': 'settings-01',
  'shopping-bag': 'shopping-bag-01',
  'shopping-cart': 'shopping-cart-01',
  'gift': 'gift-01',
  'mail': 'mail-01',
  'phone': 'phone-call-01',
  'camera': 'camera-01',
  'image': 'image-01',
  'calendar': 'calendar',
  'clock': 'clock',
  'lock': 'lock-01',
  'unlock': 'unlock-01',
  'eye': 'eye',
  'eye-off': 'eye-off',
  'check': 'check',
  'check-circle': 'check-circle',
  'x': 'x-close',
  'x-circle': 'x-circle',
  'plus': 'plus',
  'minus': 'minus',
  'arrow-left': 'arrow-left',
  'arrow-right': 'arrow-right',
  'arrow-up': 'arrow-up',
  'arrow-down': 'arrow-down',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  'chevron-up': 'chevron-up',
  'chevron-down': 'chevron-down',
  'more-horizontal': 'dots-horizontal',
  'more-vertical': 'dots-vertical',
  'share': 'share-05',
  'share-2': 'share-05',
  'copy': 'copy-01',
  'trash': 'trash-01',
  'trash-2': 'trash-01',
  'edit': 'edit-01',
  'edit-2': 'edit-01',
  'edit-3': 'edit-01',
  'filter': 'filter-funnel-01',
  'download': 'download-04',
  'upload': 'upload-04',
  'link': 'link-01',
  'globe': 'globe-01',
  'map-pin': 'marker-pin-01',
  'bookmark': 'bookmark',
  'tag': 'tag-01',
  'flag': 'flag-01',
  'info': 'info-circle',
  'help-circle': 'help-circle',
  'alert-circle': 'alert-circle',
  'alert-triangle': 'alert-triangle',
  'credit-card': 'credit-card-01',
  'wallet': 'wallet-01',
  'coins': 'coins-01',
  'receipt': 'receipt',
  'message-circle': 'message-circle-01',
  'message-square': 'message-square-01',
  'send': 'send-01',
  'paperclip': 'paperclip',
  'folder': 'folder',
  'file': 'file-06',
  'file-text': 'file-06',
  'log-out': 'log-out-01',
  'log-in': 'log-in-01',
  'menu': 'menu-01',
  'grid': 'grid-01',
  'list': 'list',
  'layers': 'layers-two-01',
  'refresh-cw': 'refresh-cw-01',
  'rotate-cw': 'refresh-cw-01',
  'zap': 'zap',
  'award': 'award-01',
  'bar-chart': 'bar-chart-01',
  'pie-chart': 'pie-chart-01',
  'trending-up': 'trend-up-01',
  'trending-down': 'trend-down-01',
  'thumbs-up': 'thumbs-up',
  'thumbs-down': 'thumbs-down',
  'smile': 'face-smile',
  'user-plus': 'user-plus-01',
  'user-minus': 'user-minus-01',
  'shield': 'shield-01',
  'wifi': 'wifi',
  'bluetooth': 'bluetooth-on',
  'volume-2': 'volume-max',
  'volume-x': 'volume-x',
  'sun': 'sun',
  'moon': 'moon-01',
  'cloud': 'cloud-01',
  'qr-code': 'qr-code-01',
};

function normalizeLucideIcon(name: string): string {
  const lower = name.toLowerCase().trim();
  // 1. Direct DS-1 name (already has -01/-02 suffix)
  if (lower.match(/-\d{2}$/) || lower === 'heart' || lower === 'bookmark' || lower === 'calendar' || lower === 'clock' || lower === 'check' || lower === 'receipt') {
    return lower;
  }
  // 2. Lucide → DS-1 map
  if (LUCIDE_TO_DS1[lower]) {
    return LUCIDE_TO_DS1[lower];
  }
  // 3. Pass through — resolveIconNodeId() will do fuzzy matching
  return lower;
}

// ============================================================
// Pencil MCP → PenNode normalizer
// ============================================================

/**
 * Pencil MCP batch_get 출력 포맷을 PenNode 포맷으로 정규화.
 * 재귀적으로 children 포함 전체 트리를 변환한다.
 */
function normalizePencilNode(raw: Record<string, unknown>): PenNode {
  const node: Record<string, unknown> = { ...raw };

  // 1. layout: "vertical" | "horizontal" → "v" | "h"
  //    Pencil 프레임은 기본 horizontal — layout 없는 프레임에 children이 있으면 "h" 설정
  if (node.layout === 'vertical') node.layout = 'v';
  else if (node.layout === 'horizontal') node.layout = 'h';
  else if (!node.layout && Array.isArray(node.children) && (node.children as unknown[]).length > 0) {
    const nt = ((node.type as string) || '').toLowerCase();
    if (nt === 'frame' || nt === 'group' || nt === '' || !nt) {
      node.layout = 'h'; // Pencil default: horizontal
    }
  }

  // 2. padding: number[] → string
  if (Array.isArray(node.padding)) {
    node.padding = (node.padding as number[]).join(' ');
  }

  // 3. text 노드에서 fill → color (텍스트 색상)
  const nodeType = ((node.type as string) || '').toLowerCase();
  const isTextLike = ['text', 'label', 'paragraph', 'heading', 'span'].includes(nodeType);
  const isIconFontLike = ['icon_font', 'icon', 'iconbutton'].includes(nodeType);

  if (isTextLike && typeof node.fill === 'string' && !node.color) {
    node.color = node.fill;
    delete node.fill;
  }

  // 4. fill: gradient 객체 → _gradientObj 보존 + 첫 색상 추출
  if (node.fill && typeof node.fill === 'object' && !Array.isArray(node.fill)) {
    const fillObj = node.fill as Record<string, unknown>;
    if (fillObj.type === 'gradient' || fillObj.colors) {
      node._gradientObj = fillObj;
      // 첫 번째 색상 추출 시도
      const colors = fillObj.colors as Array<Record<string, unknown>> | undefined;
      if (colors && colors.length > 0) {
        const first = colors[0];
        const hex = (first.color || first.hex || first.value) as string | undefined;
        if (hex && typeof hex === 'string') {
          node.fill = hex;
        } else {
          delete node.fill;
        }
      } else {
        delete node.fill;
      }
    }
  }

  // 5. stroke: {fill:"#hex", thickness:{top:N}} → stroke:"#hex", strokeWidth:N
  if (node.stroke && typeof node.stroke === 'object' && !Array.isArray(node.stroke)) {
    const strokeObj = node.stroke as Record<string, unknown>;
    const strokeColor = (strokeObj.fill || strokeObj.color) as string | undefined;
    const thickness = strokeObj.thickness as Record<string, unknown> | number | undefined;
    if (strokeColor) {
      node.stroke = strokeColor;
    }
    if (thickness && !node.strokeWidth) {
      if (typeof thickness === 'number') {
        node.strokeWidth = thickness;
      } else if (typeof thickness === 'object') {
        // {top:1, right:1, bottom:1, left:1} → max 값 사용
        const vals = Object.values(thickness).filter(v => typeof v === 'number') as number[];
        if (vals.length > 0) node.strokeWidth = Math.max(...vals);
      }
    }
  }

  // 6. effect (단수) → effects (배열)
  if (node.effect && !node.effects) {
    const eff = node.effect as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...eff };
    // type 정규화: "shadow" → "drop-shadow"
    if (normalized.type === 'shadow') normalized.type = 'drop-shadow';
    node.effects = [normalized];
    delete node.effect;
  }

  // 7. iconFontName → icon
  if (node.iconFontName && !node.icon) {
    node.icon = node.iconFontName;
    delete node.iconFontName;
  }

  // 8. clip: true → overflow: "hidden"
  if (node.clip === true && !node.overflow) {
    node.overflow = 'hidden';
    delete node.clip;
  }

  // 9. justifyContent: "space_between" → "space-between" (underscore → hyphen)
  if (typeof node.justifyContent === 'string') {
    node.justifyContent = (node.justifyContent as string).replace(/_/g, '-');
  }

  // 10. icon_font fill → color (아이콘 색상)
  if (isIconFontLike && typeof node.fill === 'string' && !node.color) {
    node.color = node.fill;
    delete node.fill;
  }

  // 재귀: children 정규화
  if (Array.isArray(node.children)) {
    node.children = (node.children as Record<string, unknown>[]).map(child =>
      normalizePencilNode(child)
    );
  }

  return node as unknown as PenNode;
}

/**
 * Pencil MCP batch_get 출력인지 자동 감지.
 * 트리 내에서 Pencil MCP 고유 필드가 하나라도 발견되면 true.
 */
function isPencilMcpFormat(node: Record<string, unknown>): boolean {
  // 직접 필드 검사
  if (node.iconFontName) return true;
  if (node.layout === 'vertical' || node.layout === 'horizontal') return true;
  if (Array.isArray(node.padding)) return true;
  if (node.clip === true) return true;
  if (typeof node.justifyContent === 'string' && (node.justifyContent as string).includes('_')) return true;
  if (node.effect && !node.effects) return true;
  if (node.stroke && typeof node.stroke === 'object' && !Array.isArray(node.stroke)) return true;

  // 자식 노드 재귀 검사 (최대 depth 3)
  if (Array.isArray(node.children)) {
    for (const child of (node.children as Record<string, unknown>[])) {
      if (isPencilMcpFormat(child)) return true;
    }
  }
  return false;
}

// ============================================================
// Color utilities
// ============================================================

export function hexToFigmaColor(hex: string): { r: number; g: number; b: number; a: number } {
  let h = hex.replace('#', '');

  // Handle shorthand (#FFF → #FFFFFF)
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }

  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1;

  return {
    r: Math.round(r * 100) / 100,
    g: Math.round(g * 100) / 100,
    b: Math.round(b * 100) / 100,
    a: Math.round(a * 100) / 100,
  };
}

function isGradient(fill: string): boolean {
  return fill.includes('gradient') || fill.includes('linear') || fill.includes('radial');
}

function extractFirstGradientColor(fill: string): string | null {
  // Extract first hex color from gradient string
  const hexMatch = fill.match(/#[0-9a-fA-F]{3,8}/);
  return hexMatch ? hexMatch[0] : null;
}

// ============================================================
// Padding parser
// ============================================================

export function parsePenPadding(padding: string | number | number[]): {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
} {
  if (typeof padding === 'number') {
    return { paddingTop: padding, paddingRight: padding, paddingBottom: padding, paddingLeft: padding };
  }

  // number[] 지원: [T,R,B,L] / [TB,LR] / [T,LR,B] / [All]
  if (Array.isArray(padding)) {
    const arr = padding as number[];
    switch (arr.length) {
      case 1:
        return { paddingTop: arr[0], paddingRight: arr[0], paddingBottom: arr[0], paddingLeft: arr[0] };
      case 2:
        return { paddingTop: arr[0], paddingRight: arr[1], paddingBottom: arr[0], paddingLeft: arr[1] };
      case 3:
        return { paddingTop: arr[0], paddingRight: arr[1], paddingBottom: arr[2], paddingLeft: arr[1] };
      case 4:
        return { paddingTop: arr[0], paddingRight: arr[1], paddingBottom: arr[2], paddingLeft: arr[3] };
      default:
        return { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };
    }
  }

  const parts = padding.trim().split(/\s+/).map(Number);
  switch (parts.length) {
    case 1:
      return { paddingTop: parts[0], paddingRight: parts[0], paddingBottom: parts[0], paddingLeft: parts[0] };
    case 2:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[0], paddingLeft: parts[1] };
    case 3:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[1] };
    case 4:
      return { paddingTop: parts[0], paddingRight: parts[1], paddingBottom: parts[2], paddingLeft: parts[3] };
    default:
      return { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };
  }
}

// ============================================================
// Size converter
// ============================================================

function convertSize(value: number | string | undefined, axis: 'horizontal' | 'vertical'): Record<string, unknown> {
  if (value === undefined || value === null) return {};

  if (value === 'fill_container' || value === 'fill') {
    return axis === 'horizontal'
      ? { layoutSizingHorizontal: 'FILL' }
      : { layoutSizingVertical: 'FILL' };
  }
  if (value === 'fit_content' || value === 'hug' || value === 'hug_content') {
    return axis === 'horizontal'
      ? { layoutSizingHorizontal: 'HUG' }
      : { layoutSizingVertical: 'HUG' };
  }
  if (typeof value === 'number') {
    return axis === 'horizontal'
      ? { width: value }
      : { height: value };
  }
  // Try parsing numeric string
  const num = parseFloat(value as string);
  if (!isNaN(num)) {
    return axis === 'horizontal'
      ? { width: num }
      : { height: num };
  }
  return {};
}

// ============================================================
// Layout converter
// ============================================================

function convertLayout(pen: PenNode): Record<string, unknown> {
  if (!pen.layout) return {};

  const autoLayout: Record<string, unknown> = {
    layoutMode: pen.layout === 'h' ? 'HORIZONTAL' : 'VERTICAL',
  };

  if (pen.gap !== undefined) {
    autoLayout.itemSpacing = pen.gap;
  }

  if (pen.padding !== undefined) {
    const p = parsePenPadding(pen.padding);
    autoLayout.paddingTop = p.paddingTop;
    autoLayout.paddingRight = p.paddingRight;
    autoLayout.paddingBottom = p.paddingBottom;
    autoLayout.paddingLeft = p.paddingLeft;
  }

  // justifyContent → primaryAxisAlignItems
  if (pen.justifyContent) {
    const map: Record<string, string> = {
      'flex-start': 'MIN',
      'start': 'MIN',
      'center': 'CENTER',
      'flex-end': 'MAX',
      'end': 'MAX',
      'space-between': 'SPACE_BETWEEN',
    };
    const mapped = map[pen.justifyContent.toLowerCase()];
    if (mapped) autoLayout.primaryAxisAlignItems = mapped;
  }

  // alignItems → counterAxisAlignItems
  if (pen.alignItems) {
    const map: Record<string, string> = {
      'flex-start': 'MIN',
      'start': 'MIN',
      'center': 'CENTER',
      'flex-end': 'MAX',
      'end': 'MAX',
      'stretch': 'STRETCH',
      'baseline': 'BASELINE',
    };
    const mapped = map[pen.alignItems.toLowerCase()];
    if (mapped) autoLayout.counterAxisAlignItems = mapped;
  }

  return { autoLayout };
}

// ============================================================
// Effects converter
// ============================================================

function convertEffects(effects: PenEffect[], warnings: string[]): Record<string, unknown>[] {
  return effects.map(e => {
    const effect: Record<string, unknown> = {};

    switch (e.type) {
      case 'drop-shadow':
      case 'dropShadow':
        effect.type = 'DROP_SHADOW';
        break;
      case 'inner-shadow':
      case 'innerShadow':
        effect.type = 'INNER_SHADOW';
        break;
      case 'blur':
      case 'layer-blur':
        effect.type = 'LAYER_BLUR';
        break;
      case 'background-blur':
        effect.type = 'BACKGROUND_BLUR';
        break;
      default:
        warnings.push(`Unknown effect type: ${e.type}`);
        effect.type = 'DROP_SHADOW';
    }

    if (e.color) {
      effect.color = hexToFigmaColor(e.color);
    }
    if (e.x !== undefined || e.y !== undefined) {
      effect.offset = { x: e.x || 0, y: e.y || 0 };
    }
    if (e.blur !== undefined) {
      effect.radius = e.blur;
    }
    if (e.spread !== undefined) {
      effect.spread = e.spread;
    }

    return effect;
  });
}

// ============================================================
// Corner radius converter
// ============================================================

function convertCornerRadius(value: number | string): Record<string, unknown> {
  if (typeof value === 'number') {
    return { cornerRadius: value };
  }
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length === 1) {
    return { cornerRadius: parts[0] };
  }
  // 4-value: topLeft topRight bottomRight bottomLeft
  if (parts.length === 4) {
    return {
      topLeftRadius: parts[0],
      topRightRadius: parts[1],
      bottomRightRadius: parts[2],
      bottomLeftRadius: parts[3],
    };
  }
  return { cornerRadius: parts[0] };
}

// ============================================================
// Node converters
// ============================================================

interface ConvertContext {
  warnings: string[];
  stats: ConvertResult['stats'];
  preserveFonts: boolean;
  parentLayout?: 'HORIZONTAL' | 'VERTICAL';
}

function convertCommonProps(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  const node: BlueprintNode = {};

  if (pen.name) node.name = pen.name;
  if (pen.opacity !== undefined && pen.opacity < 1) node.opacity = pen.opacity;

  // Size
  Object.assign(node, convertSize(pen.width, 'horizontal'));
  Object.assign(node, convertSize(pen.height, 'vertical'));

  // Min/max constraints
  if (pen.minWidth !== undefined) node.minWidth = pen.minWidth;
  if (pen.maxWidth !== undefined) node.maxWidth = pen.maxWidth;
  if (pen.minHeight !== undefined) node.minHeight = pen.minHeight;
  if (pen.maxHeight !== undefined) node.maxHeight = pen.maxHeight;

  // Corner radius
  if (pen.cornerRadius !== undefined) {
    Object.assign(node, convertCornerRadius(pen.cornerRadius));
  }

  // Fill
  if (pen.fill) {
    if (typeof pen.fill === 'string') {
      if (isGradient(pen.fill)) {
        const firstColor = extractFirstGradientColor(pen.fill);
        if (firstColor) {
          node.fill = hexToFigmaColor(firstColor);
          ctx.warnings.push(`Gradient simplified to first stop color: ${pen.fill.slice(0, 60)}`);
        }
      } else {
        node.fill = hexToFigmaColor(pen.fill);
      }
    }
  }

  // Gradient 객체 (normalizePencilNode에서 _gradientObj로 보존된 경우)
  if (!node.fill && pen._gradientObj) {
    const grad = pen._gradientObj as Record<string, unknown>;
    const colors = grad.colors as Array<Record<string, unknown>> | undefined;
    if (colors && colors.length > 0) {
      const hex = (colors[0].color || colors[0].hex || colors[0].value) as string | undefined;
      if (hex && typeof hex === 'string') {
        node.fill = hexToFigmaColor(hex);
        ctx.warnings.push(`Gradient object simplified to first color: ${hex}`);
      }
    }
  }

  // Stroke
  if (pen.stroke) {
    node.stroke = hexToFigmaColor(pen.stroke);
    if (pen.strokeWidth) node.strokeWeight = pen.strokeWidth;
  }

  // Effects
  if (pen.effects && pen.effects.length > 0) {
    node.effects = convertEffects(pen.effects, ctx.warnings);
  }

  // Clip
  if (pen.overflow === 'hidden') {
    node.clipsContent = true;
  }

  // Background image
  if (pen.backgroundImage) {
    node.imageFill = { url: pen.backgroundImage, scaleMode: 'FILL' };
  }

  return node;
}

function convertFrame(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  ctx.stats.frames++;
  const node: BlueprintNode = { type: 'frame' };

  Object.assign(node, convertCommonProps(pen, ctx));
  Object.assign(node, convertLayout(pen));

  // If no layout specified but has children, default to vertical
  if (!pen.layout && pen.children && pen.children.length > 0 && !node.autoLayout) {
    node.autoLayout = { layoutMode: 'VERTICAL' };
  }

  // Determine this frame's layout direction for children
  const thisLayout = node.autoLayout?.layoutMode as 'HORIZONTAL' | 'VERTICAL' | undefined;

  // Recurse children — pass this frame's layout direction as parentLayout
  if (pen.children && pen.children.length > 0) {
    const prevParent = ctx.parentLayout;
    ctx.parentLayout = thisLayout || 'VERTICAL'; // default to VERTICAL if no auto-layout
    node.children = pen.children
      .map(child => convertNode(child, ctx))
      .filter(Boolean);
    ctx.parentLayout = prevParent; // restore
  }

  return node;
}

function convertText(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  ctx.stats.texts++;
  const node: BlueprintNode = { type: 'text' };

  Object.assign(node, convertCommonProps(pen, ctx));

  // Text content
  if (pen.content) node.text = pen.content;

  // Font
  if (pen.fontFamily) {
    node.fontFamily = ctx.preserveFonts ? pen.fontFamily : 'Pretendard';
  }
  if (pen.fontSize) node.fontSize = pen.fontSize;
  if (pen.fontWeight) node.fontWeight = Number(pen.fontWeight);
  if (pen.lineHeight !== undefined) node.lineHeight = typeof pen.lineHeight === 'string' ? parseFloat(pen.lineHeight) : pen.lineHeight;
  if (pen.letterSpacing !== undefined) node.letterSpacing = typeof pen.letterSpacing === 'string' ? parseFloat(pen.letterSpacing) : pen.letterSpacing;

  // Text color (color 우선, 없으면 text 타입의 fill을 fontColor로 사용)
  const textColor = pen.color || (typeof pen.fill === 'string' ? pen.fill : undefined);
  if (textColor) {
    node.fontColor = hexToFigmaColor(textColor);
  }

  // Text alignment
  if (pen.textAlign) {
    const map: Record<string, string> = {
      'left': 'LEFT',
      'center': 'CENTER',
      'right': 'RIGHT',
      'justify': 'JUSTIFIED',
    };
    const mapped = map[pen.textAlign.toLowerCase()];
    if (mapped) node.textAlignHorizontal = mapped;
  }

  // ★ CRITICAL: 텍스트 layoutSizing은 부모 레이아웃 방향에 따라 결정
  // - VERTICAL 부모: FILL (가로 꽉 채움) + textAutoResize: HEIGHT
  // - HORIZONTAL 부모: HUG (텍스트 크기에 맞춤) + textAutoResize: WIDTH_AND_HEIGHT
  // HORIZONTAL 부모에서 FILL 적용하면 글자가 세로로 1자씩 표시되는 버그 발생!
  if (!node.layoutSizingHorizontal) {
    if (ctx.parentLayout === 'HORIZONTAL') {
      // HORIZONTAL 부모: 텍스트 너비를 콘텐츠에 맞춤 (HUG)
      node.layoutSizingHorizontal = 'HUG';
    } else {
      // VERTICAL 부모 (기본): 가로 꽉 채움
      node.layoutSizingHorizontal = 'FILL';
    }
  }

  // Auto resize — HORIZONTAL 부모에서는 WIDTH_AND_HEIGHT, VERTICAL에서는 HEIGHT
  if (!node.textAutoResize) {
    node.textAutoResize = ctx.parentLayout === 'HORIZONTAL' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
  }

  return node;
}

function convertIconFont(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  ctx.stats.icons++;
  // Try multiple fields for icon name: icon → iconFontName → content → name
  const iconName = pen.icon || (pen.iconFontName as string) || pen.content || pen.name || 'star';
  const size = pen.iconSize || (typeof pen.width === 'number' ? pen.width : undefined)
    || (typeof pen.height === 'number' ? pen.height : undefined) || pen.fontSize || 24;
  const normalized = normalizeLucideIcon(iconName);

  const node: BlueprintNode = {
    type: 'icon',
    name: normalized,
    size,
  };

  // Preserve color if specified (for tinting): color → fill
  const iconColor = pen.color || (typeof pen.fill === 'string' ? pen.fill : undefined);
  if (iconColor) {
    node.color = hexToFigmaColor(iconColor);
  }

  return node;
}

function convertRectangle(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  ctx.stats.shapes++;
  const node: BlueprintNode = { type: 'rectangle' };
  Object.assign(node, convertCommonProps(pen, ctx));
  return node;
}

function convertEllipse(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  ctx.stats.shapes++;
  const node: BlueprintNode = { type: 'ellipse' };
  Object.assign(node, convertCommonProps(pen, ctx));
  return node;
}

function convertImage(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  ctx.stats.shapes++;
  const node: BlueprintNode = { type: 'rectangle' };
  Object.assign(node, convertCommonProps(pen, ctx));

  // Image source → imageFill
  const src = pen.backgroundImage || pen.src as string | undefined;
  if (src) {
    node.imageFill = { url: src, scaleMode: 'FILL' };
  }

  // If no fill at all, add a light gray placeholder
  if (!node.fill && !node.imageFill) {
    node.fill = { r: 0.92, g: 0.92, b: 0.93, a: 1 };
    node.name = node.name || '[Image Placeholder]';
    ctx.warnings.push(`Image node "${pen.name || 'unnamed'}" has no source — added gray placeholder`);
  }

  return node;
}

function convertRef(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  // ref nodes are component instances in Pencil — fallback to frame with children
  ctx.warnings.push(`ref node "${pen.name || pen.refId}" converted to frame (component reference not portable)`);
  ctx.stats.frames++;

  const node: BlueprintNode = { type: 'frame' };
  Object.assign(node, convertCommonProps(pen, ctx));
  Object.assign(node, convertLayout(pen));

  const thisLayout = node.autoLayout?.layoutMode as 'HORIZONTAL' | 'VERTICAL' | undefined;

  if (pen.children && pen.children.length > 0) {
    const prevParent = ctx.parentLayout;
    ctx.parentLayout = thisLayout || 'VERTICAL';
    node.children = pen.children.map(child => convertNode(child, ctx));
    ctx.parentLayout = prevParent;
  }

  return node;
}

function convertPath(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  // path/vector nodes → approximate as rectangle with bounding box
  ctx.warnings.push(`path node "${pen.name || 'unnamed'}" approximated as rectangle`);
  ctx.stats.shapes++;

  const node: BlueprintNode = { type: 'rectangle' };
  Object.assign(node, convertCommonProps(pen, ctx));

  return node;
}

// ============================================================
// Main node dispatcher
// ============================================================

function convertNode(pen: PenNode, ctx: ConvertContext): BlueprintNode {
  ctx.stats.totalNodes++;

  try {
    // Normalize type: Pencil might use different casing/naming
    const nodeType = (pen.type || 'frame').toLowerCase().trim();

    switch (nodeType) {
      case 'frame':
      case 'group':
      case 'component':
      case 'section':
      case 'container':
      case 'div':
      case 'stack':
      case 'hstack':
      case 'vstack':
      case 'auto_layout':
        return convertFrame(pen, ctx);

      case 'text':
      case 'label':
      case 'paragraph':
      case 'heading':
      case 'span':
        return convertText(pen, ctx);

      case 'icon_font':
      case 'icon':
      case 'iconbutton':
        return convertIconFont(pen, ctx);

      case 'rectangle':
      case 'rect':
      case 'box':
        return convertRectangle(pen, ctx);

      case 'ellipse':
      case 'circle':
      case 'oval':
        return convertEllipse(pen, ctx);

      case 'image':
      case 'img':
      case 'picture':
        return convertImage(pen, ctx);

      case 'ref':
      case 'instance':
      case 'symbol':
        return convertRef(pen, ctx);

      case 'path':
      case 'vector':
      case 'svg':
      case 'line':
      case 'polyline':
      case 'polygon':
        return convertPath(pen, ctx);

      default:
        // Unknown type — check if it has children (treat as frame) or text content
        if (pen.children && pen.children.length > 0) {
          ctx.warnings.push(`Unknown node type "${pen.type}" treated as frame (has children)`);
          return convertFrame(pen, ctx);
        }
        if (pen.content) {
          ctx.warnings.push(`Unknown node type "${pen.type}" treated as text (has content)`);
          return convertText(pen, ctx);
        }
        ctx.warnings.push(`Unknown node type "${pen.type}" treated as frame`);
        return convertFrame(pen, ctx);
    }
  } catch (e) {
    // Individual node conversion failure — don't crash the whole tree
    const errMsg = e instanceof Error ? e.message : String(e);
    ctx.warnings.push(`Failed to convert node "${pen.name || pen.type}": ${errMsg}`);
    // Return a minimal placeholder frame
    return {
      type: 'frame',
      name: `[Error] ${pen.name || pen.type}`,
      width: typeof pen.width === 'number' ? pen.width : 40,
      height: typeof pen.height === 'number' ? pen.height : 40,
    };
  }
}

// ============================================================
// Main entry point
// ============================================================

export function convertPenToFigma(root: PenNode | Record<string, unknown>, options?: ConvertOptions): ConvertResult {
  const opts: Required<ConvertOptions> = {
    preserveFonts: options?.preserveFonts ?? true,
    targetWidth: options?.targetWidth ?? 393,
    targetHeight: options?.targetHeight ?? 852,
  };

  const ctx: ConvertContext = {
    warnings: [],
    stats: {
      totalNodes: 0,
      frames: 0,
      texts: 0,
      icons: 0,
      shapes: 0,
      warnings: 0,
    },
    preserveFonts: opts.preserveFonts,
  };

  // Pencil MCP 포맷 자동 감지 → 정규화
  let normalizedRoot: PenNode;
  const rawRoot = root as Record<string, unknown>;
  if (isPencilMcpFormat(rawRoot)) {
    normalizedRoot = normalizePencilNode(rawRoot);
    console.log('[convert_pen_to_figma] Pencil MCP format detected — normalizing');
  } else {
    normalizedRoot = root as PenNode;
  }

  // Convert the root node
  const blueprint = convertNode(normalizedRoot, ctx);

  // Ensure root is a frame with proper dimensions
  if (!blueprint.width) blueprint.width = opts.targetWidth;
  if (!blueprint.height) blueprint.height = opts.targetHeight;
  if (!blueprint.name) blueprint.name = 'Pen Import';

  ctx.stats.warnings = ctx.warnings.length;

  return {
    blueprint,
    stats: ctx.stats,
    warnings: ctx.warnings,
  };
}
