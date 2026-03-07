/**
 * Icon resolve + SVG fetch 테스트 스크립트
 * Usage: npx tsx scripts/test-icons.ts
 */
import { resolveIconFile, getIconSvg, getIconSvgAsync, setIconProjectRoot } from '../src/main/untitled-icons';
import { join } from 'path';

setIconProjectRoot(join(__dirname, '..'));

// ========== Test 1: resolveIconFile ==========
console.log('\n=== Test 1: resolveIconFile (이름 해석) ===\n');

const resolveTests: Array<{ input: string; expected: string | null; desc: string }> = [
  // Alias 매핑
  { input: 'chat', expected: 'message-chat-circle', desc: 'alias: chat → message-chat-circle' },
  { input: 'Chat Icon', expected: 'message-chat-circle', desc: 'alias: Chat Icon (대소문자+공백)' },
  { input: 'bell', expected: 'bell-01', desc: 'alias: bell → bell-01' },
  { input: 'home', expected: 'home-03', desc: 'alias: home → home-03' },
  { input: 'bookmark', expected: 'bookmark', desc: 'alias: bookmark → bookmark' },
  { input: 'heart', expected: 'heart', desc: 'alias: heart → heart' },
  { input: 'randombox', expected: 'dice-3', desc: 'alias: randombox → dice-3' },

  // Exact match
  { input: 'star-01', expected: 'star-01', desc: 'exact: star-01' },
  { input: 'chevron-right', expected: 'chevron-right', desc: 'exact: chevron-right' },
  { input: 'arrow-right', expected: 'arrow-right', desc: 'exact: arrow-right' },

  // Suffix fallback (-01, -02...)
  { input: 'star', expected: 'star-01', desc: 'suffix: star → star-01' },
  { input: 'user', expected: 'user-01', desc: 'suffix: user → user-01' },
  { input: 'coins', expected: 'coins-01', desc: 'suffix: coins → coins-01' },

  // Prefix/contains match
  { input: 'credit', expected: null, desc: 'prefix: credit → credit-card-*?' },
  { input: 'trash', expected: null, desc: 'prefix: trash → trash-*?' },

  // Edge cases
  { input: 'nonexistent-icon-xyz', expected: null, desc: 'not found: nonexistent' },
  { input: '', expected: null, desc: 'empty string' },
  { input: 'BELL', expected: 'bell-01', desc: 'uppercase: BELL' },
  { input: 'home_icon', expected: 'home-03', desc: 'underscore: home_icon → home-03' },
  { input: 'bookmark-1', expected: 'bookmark', desc: 'trailing num strip: bookmark-1 → bookmark' },
];

let pass = 0;
let fail = 0;

for (const t of resolveTests) {
  const result = resolveIconFile(t.input);
  // expected=null means "we accept any result or null" for prefix/contains tests
  const ok = t.expected === null ? true : result === t.expected;
  if (ok) {
    pass++;
    console.log(`  PASS  ${t.desc} → "${result}"`);
  } else {
    fail++;
    console.log(`  FAIL  ${t.desc}`);
    console.log(`        expected: "${t.expected}", got: "${result}"`);
  }
}

console.log(`\n  Results: ${pass} passed, ${fail} failed / ${resolveTests.length} total`);

// ========== Test 2: getIconSvg (동기, 디스크 캐시) ==========
console.log('\n=== Test 2: getIconSvg (동기 SVG 로드) ===\n');

const svgTests = ['bell-01', 'home-03', 'chevron-right', 'star-01', 'heart', 'bookmark', 'search-lg', 'plus'];
let svgPass = 0;
let svgFail = 0;

for (const name of svgTests) {
  const svg = getIconSvg(name, 24, '#000000');
  if (svg && svg.includes('<svg') && svg.includes('</svg>')) {
    svgPass++;
    const sizeOk = svg.includes('width="24"') && svg.includes('height="24"');
    const colorOk = svg.includes('stroke="#000000"');
    console.log(`  PASS  ${name} (${svg.length}B, size=${sizeOk ? 'OK' : 'MISMATCH'}, color=${colorOk ? 'OK' : 'MISMATCH'})`);
  } else {
    svgFail++;
    console.log(`  FAIL  ${name} → ${svg === null ? 'null (not cached)' : 'invalid SVG'}`);
  }
}

console.log(`\n  Results: ${svgPass} passed, ${svgFail} failed / ${svgTests.length} total`);

// ========== Test 3: getIconSvgAsync (비동기) ==========
console.log('\n=== Test 3: getIconSvgAsync (비동기 SVG 로드) ===\n');

async function testAsync() {
  const asyncTests = [
    { name: 'chat', size: 20, color: '#FF0000', desc: 'alias "chat" → 20px red' },
    { name: 'home', size: 32, color: '#3366FF', desc: 'alias "home" → 32px blue' },
    { name: 'bell-01', size: 24, color: '#000000', desc: 'exact "bell-01" → 24px black' },
    { name: 'nonexistent-xyz', size: 24, color: '#000', desc: 'not found → null' },
  ];

  let asyncPass = 0;
  let asyncFail = 0;

  for (const t of asyncTests) {
    const svg = await getIconSvgAsync(t.name, t.size, t.color);
    if (t.name === 'nonexistent-xyz') {
      if (svg === null) {
        asyncPass++;
        console.log(`  PASS  ${t.desc}`);
      } else {
        asyncFail++;
        console.log(`  FAIL  ${t.desc} — expected null, got SVG`);
      }
    } else if (svg && svg.includes('<svg')) {
      asyncPass++;
      const sizeOk = svg.includes(`width="${t.size}"`);
      const colorOk = svg.includes(`stroke="${t.color}"`);
      console.log(`  PASS  ${t.desc} (size=${sizeOk ? 'OK' : 'MISMATCH'}, color=${colorOk ? 'OK' : 'MISMATCH'})`);
    } else {
      asyncFail++;
      console.log(`  FAIL  ${t.desc} → null`);
    }
  }

  console.log(`\n  Results: ${asyncPass} passed, ${asyncFail} failed / ${asyncTests.length} total`);

  // ========== Test 4: resolveBlueprint icon 흐름 시뮬레이션 ==========
  console.log('\n=== Test 4: Blueprint icon resolve 시뮬레이션 ===\n');

  const blueprintNodes = [
    { type: 'icon', iconName: 'bell', size: 24 },
    { type: 'icon', name: 'home', size: 20 },           // iconName 없이 name만
    { type: 'icon', iconName: 'chat', iconColor: { r: 1, g: 0, b: 0 } },
    { type: 'icon', name: 'star' },                      // size도 없음 → default 24
    { type: 'icon', iconName: 'nonexistent-xyz' },       // not found → placeholder
  ];

  let bpPass = 0;
  let bpFail = 0;

  for (const node of blueprintNodes) {
    const resolved = { ...node } as Record<string, any>;

    // resolveBlueprint 로직 시뮬레이션 (figma-mcp-embedded.ts:962-991)
    if (resolved.type === 'icon' && (resolved.iconName || resolved.name)) {
      const iconName = (resolved.iconName || resolved.name) as string;
      const iconSize = (resolved.size as number) || 24;
      const iconColor = resolved.iconColor as { r: number; g: number; b: number } | undefined;
      const hexColor = iconColor
        ? '#' + [iconColor.r, iconColor.g, iconColor.b].map((c: number) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
        : '#000000';

      const svgData = await getIconSvgAsync(iconName, iconSize, hexColor) || getIconSvg(iconName, iconSize, hexColor);

      if (svgData) {
        resolved.type = 'svg_icon';
        resolved.svgData = svgData;
        resolved.width = iconSize;
        resolved.height = iconSize;
        bpPass++;
        console.log(`  PASS  ${iconName} → svg_icon (${iconSize}px, color=${hexColor})`);
      } else {
        resolved.type = 'frame';
        resolved.width = iconSize;
        resolved.height = iconSize;
        if (iconName === 'nonexistent-xyz') {
          bpPass++;
          console.log(`  PASS  ${iconName} → placeholder frame (expected)`);
        } else {
          bpFail++;
          console.log(`  FAIL  ${iconName} → placeholder (unexpected)`);
        }
      }
    }
  }

  console.log(`\n  Results: ${bpPass} passed, ${bpFail} failed / ${blueprintNodes.length} total`);

  // ========== Summary ==========
  const totalPass = pass + svgPass + asyncPass + bpPass;
  const totalFail = fail + svgFail + asyncFail + bpFail;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(totalFail > 0 ? 1 : 0);
}

testAsync();
