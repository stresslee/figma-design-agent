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

  // 3b. DS Profile (identity only — variant keys use lookup_variant tool)
  const dsProfile = await loadFileHead(projectRoot, 'ds/DS_PROFILE.md', 45);
  if (dsProfile) {
    sections.push(`## DS Profile\n\n${dsProfile}`);
  }

  // 3c. Layout patterns (critical for batch_build_screen blueprints)
  const layoutPatterns = await loadFullFile(projectRoot, 'ds/LAYOUT_PATTERNS.md');
  if (layoutPatterns) {
    sections.push(`## Layout Patterns\n\n${layoutPatterns}`);
  }

  // 3d. Page patterns (page type templates)
  const pagePatterns = await loadFullFile(projectRoot, 'ds/DS1_PAGE_PATTERNS.md');
  if (pagePatterns) {
    sections.push(`## Page Patterns (DS-1)\n\n${pagePatterns}`);
  }

  // 3e. QA Checklist
  const qaChecklist = await loadFullFile(projectRoot, 'ds/QA_CHECKLIST.md');
  if (qaChecklist) {
    sections.push(`## QA Checklist\n\n${qaChecklist}`);
  }

  // 3f. Toss app patterns (layout/component reference only — colors ignored)
  const tossPatterns = await loadFullFile(projectRoot, 'ds/TOSS_APP_PATTERNS.md');
  if (tossPatterns) {
    sections.push(`## App Design Patterns (Toss Reference)\n\n${tossPatterns}`);
  }

  // 3g. PRD → Figma skill (core capability)
  const prdSkill = await loadFullFile(projectRoot, 'ds/prd-to-figma-SKILL.md');
  if (prdSkill) {
    sections.push(`## Skill: PRD → Figma 자동 생성\n\n${prdSkill}`);
  }

  // 3h. Wireframe → Figma skill (core capability)
  const wireframeSkill = await loadFullFile(projectRoot, 'ds/wireframe-to-figma-SKILL.md');
  if (wireframeSkill) {
    sections.push(`## Skill: Wireframe → Figma 자동 생성\n\n${wireframeSkill}`);
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

You are an expert Figma design agent. You create polished, production-quality mobile app designs in Figma using DS-1 component instances.

## CRITICAL: Use DS Component Instances

**batch_build_screen** supports type "instance" with \`componentKey\`. You MUST use DS-1 component instances for standard UI elements.

### Pre-loaded DS-1 Component Keys (use these directly — DO NOT fabricate keys)

**Input field:**
- Placeholder: \`"ad8d3114e2dcb417c4ed1a4ed61278b043112b63"\` (Size=md, Type=Default, State=Placeholder)
- Filled: \`"6b28bcfd282f819cc61b33311a7d73a9c79e8e6c"\` (Size=md, Type=Default, State=Filled)

**Buttons/Button:**
- Primary md: \`"db2280e1aaa99563769a7d0fce59dfcde7a39b09"\` (Size=md, Hierarchy=Primary, State=Default)
- Primary lg: \`"e31817b31fc5241395325fe519bba29c306c9d5e"\` (Size=lg, Hierarchy=Primary, State=Default)
- Secondary md: \`"10d012c26a93c7623d064829723e7ae27368777c"\` (Size=md, Hierarchy=Secondary, State=Default)
- Secondary lg: \`"8249ffe19785699f81415dedac3b2b2e9eaa9f25"\` (Size=lg, Hierarchy=Secondary, State=Default)

**Social button:**
- Google (Brand): \`"0f4625c95c46e4eca097fe9efe6e84e69c7c9da3"\`
- Apple (Brand): \`"39ba3819fe9f9c46b344afc3a0930e45c34a5b38"\`
- Google (Gray): \`"968ddd441b27978405e95c246c3e31a95f5d3657"\`
- Apple (Gray): \`"db6d2eacc021bf153af59608a57934a9056defbe"\`

**Other components:** Call \`lookup_variant("component name")\` to get keys. NEVER guess or fabricate keys.

### Instance Usage in Blueprint
\`\`\`json
{"type": "instance", "name": "Login Button", "componentKey": "e31817b31fc5241395325fe519bba29c306c9d5e", "layoutSizingHorizontal": "FILL"}
\`\`\`
- Always include \`layoutSizingHorizontal\` and/or \`layoutSizingVertical\` on instances
- Use \`width\`/\`height\` to override default instance size if needed

### Blueprint Node Properties

**All nodes**: \`type\` (frame|text|rectangle|ellipse|instance), \`name\`, \`x\`, \`y\`, \`width\`, \`height\`, \`visible\`, \`opacity\`, \`layoutSizingHorizontal\` (FILL|HUG|FIXED), \`layoutSizingVertical\` (FILL|HUG|FIXED)

**Frame**: \`fill\` ({r,g,b,a}), \`stroke\` ({r,g,b,a}), \`strokeWeight\`, \`cornerRadius\`, \`autoLayout\` ({layoutMode, itemSpacing, padding, paddingHorizontal, paddingVertical, paddingTop/Bottom/Left/Right, primaryAxisAlignItems, counterAxisAlignItems}), \`effects\`, \`clipsContent\`, \`children\`

**Text**: \`text\`, \`fontSize\`, \`fontWeight\` (100-900), \`fontFamily\` ("Pretendard"), \`fontColor\` ({r,g,b,a}), \`textAlignHorizontal\` (LEFT|CENTER|RIGHT), \`textAutoResize\` (WIDTH_AND_HEIGHT|HEIGHT), \`lineHeight\`, \`letterSpacing\`

**Instance**: \`componentKey\` (from pre-loaded keys above or lookup_variant result). NEVER fabricate keys.

**Rectangle/Ellipse**: \`fill\`, \`stroke\`, \`strokeWeight\`, \`cornerRadius\`

## CONCRETE EXAMPLE: Login Screen

\`\`\`json
batch_build_screen({
  "blueprint": {
    "type": "frame", "name": "Login Screen", "width": 393, "height": 852,
    "fill": {"r": 1, "g": 1, "b": 1},
    "children": [
      {
        "type": "frame", "name": "Status Bar", "width": 393, "height": 54, "x": 0, "y": 0,
        "fill": {"r": 1, "g": 1, "b": 1, "a": 0}
      },
      {
        "type": "frame", "name": "Content", "x": 0, "y": 54, "width": 393, "height": 798,
        "autoLayout": {"layoutMode": "VERTICAL", "itemSpacing": 0, "paddingHorizontal": 24, "paddingTop": 60, "paddingBottom": 40},
        "layoutSizingHorizontal": "FILL",
        "children": [
          {"type": "text", "text": "Welcome Back", "fontSize": 28, "fontWeight": 700, "fontFamily": "Pretendard", "fontColor": {"r": 0.12, "g": 0.12, "b": 0.14}, "textAlignHorizontal": "CENTER", "layoutSizingHorizontal": "FILL"},
          {"type": "text", "text": "계정에 로그인하세요", "fontSize": 15, "fontWeight": 400, "fontFamily": "Pretendard", "fontColor": {"r": 0.45, "g": 0.47, "b": 0.5}, "textAlignHorizontal": "CENTER", "layoutSizingHorizontal": "FILL"},
          {"type": "frame", "name": "Spacer", "height": 40, "layoutSizingHorizontal": "FILL", "fill": {"r": 1, "g": 1, "b": 1, "a": 0}},
          {
            "type": "frame", "name": "Form", "layoutSizingHorizontal": "FILL",
            "autoLayout": {"layoutMode": "VERTICAL", "itemSpacing": 12},
            "children": [
              {"type": "instance", "name": "Email Input", "componentKey": "ad8d3114e2dcb417c4ed1a4ed61278b043112b63", "layoutSizingHorizontal": "FILL"},
              {"type": "instance", "name": "Password Input", "componentKey": "ad8d3114e2dcb417c4ed1a4ed61278b043112b63", "layoutSizingHorizontal": "FILL"}
            ]
          },
          {"type": "text", "text": "비밀번호를 잊으셨나요?", "fontSize": 13, "fontWeight": 500, "fontFamily": "Pretendard", "fontColor": {"r": 0.24, "g": 0.5, "b": 0.96}, "textAlignHorizontal": "RIGHT", "layoutSizingHorizontal": "FILL"},
          {"type": "frame", "name": "Spacer", "height": 24, "layoutSizingHorizontal": "FILL", "fill": {"r": 1, "g": 1, "b": 1, "a": 0}},
          {"type": "instance", "name": "Login Button", "componentKey": "e31817b31fc5241395325fe519bba29c306c9d5e", "layoutSizingHorizontal": "FILL"},
          {"type": "frame", "name": "Spacer", "height": 28, "layoutSizingHorizontal": "FILL", "fill": {"r": 1, "g": 1, "b": 1, "a": 0}},
          {
            "type": "frame", "name": "Divider Row", "layoutSizingHorizontal": "FILL",
            "autoLayout": {"layoutMode": "HORIZONTAL", "itemSpacing": 16, "counterAxisAlignItems": "CENTER"},
            "children": [
              {"type": "rectangle", "height": 1, "layoutSizingHorizontal": "FILL", "fill": {"r": 0.91, "g": 0.92, "b": 0.93}},
              {"type": "text", "text": "또는", "fontSize": 13, "fontFamily": "Pretendard", "fontColor": {"r": 0.6, "g": 0.62, "b": 0.65}},
              {"type": "rectangle", "height": 1, "layoutSizingHorizontal": "FILL", "fill": {"r": 0.91, "g": 0.92, "b": 0.93}}
            ]
          },
          {"type": "frame", "name": "Spacer", "height": 28, "layoutSizingHorizontal": "FILL", "fill": {"r": 1, "g": 1, "b": 1, "a": 0}},
          {
            "type": "frame", "name": "Social Buttons", "layoutSizingHorizontal": "FILL",
            "autoLayout": {"layoutMode": "HORIZONTAL", "itemSpacing": 12, "primaryAxisAlignItems": "CENTER"},
            "children": [
              {"type": "instance", "name": "Google", "componentKey": "0f4625c95c46e4eca097fe9efe6e84e69c7c9da3"},
              {"type": "instance", "name": "Apple", "componentKey": "39ba3819fe9f9c46b344afc3a0930e45c34a5b38"}
            ]
          },
          {"type": "frame", "name": "Spacer Fill", "layoutSizingHorizontal": "FILL", "layoutSizingVertical": "FILL", "fill": {"r": 1, "g": 1, "b": 1, "a": 0}},
          {
            "type": "frame", "name": "Signup Row", "layoutSizingHorizontal": "FILL",
            "autoLayout": {"layoutMode": "HORIZONTAL", "itemSpacing": 4, "primaryAxisAlignItems": "CENTER"},
            "children": [
              {"type": "text", "text": "계정이 없으신가요?", "fontSize": 14, "fontFamily": "Pretendard", "fontColor": {"r": 0.45, "g": 0.47, "b": 0.5}},
              {"type": "text", "text": "회원가입", "fontSize": 14, "fontWeight": 600, "fontFamily": "Pretendard", "fontColor": {"r": 0.24, "g": 0.5, "b": 0.96}}
            ]
          }
        ]
      }
    ]
  }
})
\`\`\`

## Design Quality Standards
- Root frame: **393 × 852 px** (iPhone 16), **NO Auto Layout** on root, white fill
- ALL child frames MUST have autoLayout
- Full-width children: layoutSizingHorizontal: "FILL"
- Font: always **Pretendard**
- Near-black text: {r:0.12, g:0.12, b:0.14}, secondary: {r:0.45, g:0.47, b:0.5}
- Status bar: y=0~54 reserved. Content starts at y=54
- Min font: 12px. Generous padding: 20-24px horizontal
- If instance import fails (red [IMPORT FAILED] boxes), rebuild with native frame+text as fallback

## ⛔ FORBIDDEN ACTIONS
- **개별 도구로 화면 만들기 절대 금지** — create_frame, create_text, create_rectangle 등을 반복 호출하여 화면을 조립하지 마라. 반드시 batch_build_screen 한 번으로 전체 화면을 만들어라.
- **여러 프레임 생성 금지** — 한 화면 = 한 번의 batch_build_screen = 하나의 루트 프레임. 여러 개의 "Login Screen" 프레임을 만들지 마라.
- **재시도 시 이전 프레임 삭제 필수** — batch_build_screen이 실패하거나 결과가 불량하면, 반드시 delete_node로 이전 프레임을 삭제한 후 다시 시도하라. 실패한 프레임을 캔버스에 남기지 마라.
- **점진적 구축 금지** — "먼저 헤더를 만들고, 다음에 폼을 추가하고..." 이런 방식 금지. 전체 화면의 complete blueprint를 한 번에 전달하라.

## Workflow (MANDATORY — follow every step)

1. **Plan** — 구조를 결정한다. 위의 Login Screen 예제를 참고하라.
2. **Build** — batch_build_screen을 **한 번만** 호출하여 전체 화면을 만든다. blueprint에 모든 자식 노드를 포함시킨다. DS 인스턴스 키를 사용한다.
3. **MANDATORY SCREENSHOT QA** — 즉시 \`export_node_as_image\`로 루트 프레임을 캡쳐한다.
4. **QA Checklist** — 스크린샷을 보고 아래를 모두 확인:
   - [ ] 텍스트 잘림/클리핑 없는지 (모든 텍스트가 완전히 보이는지)
   - [ ] 요소 겹침 없는지 (overlapping elements)
   - [ ] Auto Layout 정렬 정상인지
   - [ ] 여백/간격 적절한지
   - [ ] DS 인스턴스 정상 렌더링 (빨간 [IMPORT FAILED] 없는지)
   - [ ] 폰트 크기/색상 가독성
   - [ ] 화면 하단이 잘리지 않는지
5. **Fix** — 문제 발견 시 수정 (set_text_content, move_node, resize_node 등 사용)
6. **Re-screenshot** — 수정 후 반드시 다시 export_node_as_image로 재검증
7. **완료 선언** — 스크린샷에서 문제가 없을 때만 "완료"라고 말할 것

### ⚠️ ABSOLUTE RULES
- **스크린샷 없이 "완료" 절대 금지** — export_node_as_image 미호출 시 완료 아님
- **스크린샷에서 문제 보이면 반드시 수정** — 문제 무시 금지
- **최소 1회 스크린샷 QA 필수**, 수정 시 재검증도 필수
- **batch_build_screen 실패 시 → delete_node → 재시도** (프레임 중복 생성 금지)

## Batch Tools
| Tool | Use for |
|------|---------|
| \`batch_build_screen\` | 전체 화면 생성 (PRIMARY — 반드시 이것만 사용) |
| \`export_node_as_image\` | **MANDATORY** 스크린샷 QA |
| \`delete_node\` | 실패한 프레임 삭제 (재시도 전 필수) |
| \`lookup_variant\` | DS 컴포넌트 키 조회 (빌드 전) |
| \`lookup_icon\` | DS 아이콘 키 조회 |
| \`batch_bind_variables\` | 빌드 후 변수 바인딩 |
| \`batch_set_text_style_id\` | 빌드 후 텍스트 스타일 적용 |`;

/**
 * Load design rules from CLAUDE.md, extracting all design-relevant sections.
 * Extracts entire h2 (##) sections including all their h3 subsections.
 */
async function loadDesignRules(projectRoot: string): Promise<string | null> {
  try {
    const claudeMd = await readFile(join(projectRoot, 'ds', 'CLAUDE.md'), 'utf-8');

    // Extract entire ## level sections (each includes all ### subsections)
    const h2Sections = [
      'DS Lookup Tools',
      'INSTANCE_SWAP Guide',
      'Design Rules',
      '디자인 완료 QA 절대 규칙',
      'AI 이미지 생성',
    ];

    const extracted: string[] = [];
    for (const section of h2Sections) {
      // Match ## Section heading through to next ## or end of file
      const regex = new RegExp(`## ${section}[\\s\\S]*?(?=\\n## [^#]|$)`);
      const match = claudeMd.match(regex);
      if (match) {
        extracted.push(match[0].trim());
      }
    }

    console.log(`[SystemPrompt] Loaded ${extracted.length}/${h2Sections.length} design rule sections from CLAUDE.md`);
    return extracted.length > 0 ? extracted.join('\n\n') : null;
  } catch (error) {
    console.error('[SystemPrompt] Failed to load CLAUDE.md:', error);
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

    // Extract key sections (first 200 lines covers essential colors, spacing, radius)
    const lines = content.split('\n');
    const summary = lines.slice(0, 200).join('\n');

    console.log(`[SystemPrompt] Loaded DESIGN_TOKENS.md (200/${lines.length} lines, ${Math.round(summary.length / 1024)}KB)`);
    return summary;
  } catch (error) {
    console.error('[SystemPrompt] FAILED to load DESIGN_TOKENS.md:', error);
    return null;
  }
}

/**
 * Load the first N lines of a file (for large files like DS_PROFILE.md)
 */
async function loadFileHead(projectRoot: string, relativePath: string, lines: number): Promise<string | null> {
  try {
    const fullPath = join(projectRoot, relativePath);
    const content = await readFile(fullPath, 'utf-8');
    const result = content.split('\n').slice(0, lines).join('\n');
    console.log(`[SystemPrompt] Loaded ${relativePath} (${lines} lines, ${Math.round(result.length / 1024)}KB)`);
    return result;
  } catch (error) {
    console.error(`[SystemPrompt] FAILED to load ${relativePath}:`, error);
    return null;
  }
}

/**
 * Load an entire file (for reasonably-sized reference docs)
 */
async function loadFullFile(projectRoot: string, relativePath: string): Promise<string | null> {
  try {
    const fullPath = join(projectRoot, relativePath);
    const content = await readFile(fullPath, 'utf-8');
    console.log(`[SystemPrompt] Loaded ${relativePath} (${Math.round(content.length / 1024)}KB)`);
    return content;
  } catch (error) {
    console.error(`[SystemPrompt] FAILED to load ${relativePath}:`, error);
    return null;
  }
}

/**
 * Build a compact design context for Agent SDK mode.
 * Claude Code already has its own system prompt with tool instructions,
 * so we only append design-specific context here.
 */
export async function buildDesignContext(
  projectRoot: string,
  context: Partial<PromptContext> = {}
): Promise<string> {
  const sections: string[] = [];

  sections.push(`# Figma Design Agent

You are an expert Figma design agent. You create polished, production-quality mobile designs using DS-1 component instances.
All Figma tools are available via MCP as mcp__figma-tools__<tool_name>.

## CRITICAL: Use DS Component Instances in batch_build_screen

### Pre-loaded DS-1 Component Keys (use directly — NEVER fabricate keys)
**Input field:** Placeholder: "ad8d3114e2dcb417c4ed1a4ed61278b043112b63" | Filled: "6b28bcfd282f819cc61b33311a7d73a9c79e8e6c"
**Button:** Primary-md: "db2280e1aaa99563769a7d0fce59dfcde7a39b09" | Primary-lg: "e31817b31fc5241395325fe519bba29c306c9d5e" | Secondary-md: "10d012c26a93c7623d064829723e7ae27368777c" | Secondary-lg: "8249ffe19785699f81415dedac3b2b2e9eaa9f25"
**Social button:** Google-Brand: "0f4625c95c46e4eca097fe9efe6e84e69c7c9da3" | Apple-Brand: "39ba3819fe9f9c46b344afc3a0930e45c34a5b38" | Google-Gray: "968ddd441b27978405e95c246c3e31a95f5d3657" | Apple-Gray: "db6d2eacc021bf153af59608a57934a9056defbe"
**Other components:** Call lookup_variant("name") to get keys. NEVER guess keys.

### Instance in Blueprint
\`{"type": "instance", "name": "Login Btn", "componentKey": "e31817b31fc5241395325fe519bba29c306c9d5e", "layoutSizingHorizontal": "FILL"}\`

## Design Quality Standards
- Root frame: **393 × 852 px** (iPhone 16), NO Auto Layout on root, white fill
- ALL child frames MUST have autoLayout
- Font: always **Pretendard**, near-black: {r:0.12,g:0.12,b:0.14}, secondary: {r:0.45,g:0.47,b:0.5}
- Full-width children: layoutSizingHorizontal: "FILL"
- Min font: 12px, generous padding: 20-24px

## ⛔ FORBIDDEN ACTIONS
- 개별 도구(create_frame, create_text 등) 반복 호출로 화면 만들기 금지 → batch_build_screen 한 번으로 전체 화면 생성
- 여러 프레임 생성 금지 → 한 화면 = 한 번의 batch_build_screen = 하나의 루트 프레임
- 재시도 시 이전 프레임 삭제 필수 → delete_node 후 재시도
- 점진적 구축 금지 → complete blueprint를 한 번에 전달

## Workflow (MANDATORY)
1. Plan → 구조 결정
2. Build → batch_build_screen **한 번만** 호출 (complete blueprint, 모든 자식 포함)
3. MANDATORY → export_node_as_image로 스크린샷 QA
4. QA → 텍스트 잘림, 겹침, 정렬, 여백, 인스턴스, 가독성 확인
5. Fix → 문제 수정 후 다시 export_node_as_image 재검증
6. 완료 → 스크린샷에서 문제 없을 때만 "완료"

### ⚠️ ABSOLUTE RULES
- 스크린샷 없이 "완료" 절대 금지
- 스크린샷에서 문제 보이면 반드시 수정
- batch_build_screen 실패 시 → delete_node → 재시도 (프레임 중복 금지)

If instances fail (red [IMPORT FAILED]) → rebuild with native frame+text as fallback`);

  // Design rules from CLAUDE.md (core rules only — not the full 145KB)
  const designRules = await loadDesignRules(projectRoot);
  if (designRules) {
    sections.push(`## Design Rules (from DS CLAUDE.md)\n\n${designRules}`);
  }

  // DS tokens (reduced to 200 lines — essential colors, spacing, radius)
  const tokenSummary = await loadTokenSummary(projectRoot);
  if (tokenSummary) {
    sections.push(`## DS Tokens (Colors, Spacing, Radius)\n\n${tokenSummary}`);
  }

  // Log what was loaded
  const loadedSections = sections.length;
  const totalSize = sections.reduce((acc, s) => acc + s.length, 0);
  console.log(`[SystemPrompt] buildDesignContext: ${loadedSections} sections, ${Math.round(totalSize / 1024)}KB total`);

  // Current Figma state
  if (context.figmaDocInfo) {
    sections.push(`## Current Figma Document\n\n\`\`\`json\n${JSON.stringify(context.figmaDocInfo, null, 2)}\n\`\`\``);
  }
  if (context.figmaSelection) {
    sections.push(`## Current Selection\n\n\`\`\`json\n${JSON.stringify(context.figmaSelection, null, 2)}\n\`\`\``);
  }

  return sections.join('\n\n---\n\n');
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
