# Figma Design Agent — 프로젝트 가이드

## 언어
- 항상 한글로 설명할 것

## 권한
- 이 프로젝트에서 Bash 명령어는 **모두 자동 허용** — `.claude/settings.json`에 `"Bash"` 전체 허용 설정됨
- 별도 승인 요청 없이 바로 실행할 것

## 프로젝트 개요
AI 기반 Figma 디자인 생성 데스크톱 앱: Electron + React + Anthropic SDK

## 빌드 & 실행
```bash
npm run dev     # 빌드 + electron 실행
npm run build   # tsup + vite 빌드만
npm start       # electron . (이미 빌드된 상태에서)
```

## 아키텍처
- **Main Process** (`src/main/`): Agent orchestrator (Claude Sonnet 4), FigmaWSServer (port 8767), 58+ 내장 MCP 도구, 4개 DS 조회 도구, Gemini 이미지 생성, 스트리밍 파서
- **Renderer** (`src/renderer/`): React 19, ChatPanel, AgentStatus, FigmaConnection, SettingsPanel, useAgent hook
- **Preload** (`src/preload/`): Context bridge (IPC 보안 통신)
- **Shared** (`src/shared/`): 타입 정의, IPC 채널 상수, DS 데이터 로더
- **Build**: tsup (main+preload → CJS) + Vite (renderer), ws/sharp external

## 주요 파일
| 파일 | 역할 |
|------|------|
| `src/main/index.ts` | Electron 메인 프로세스 진입점, IPC 핸들러 |
| `src/main/agent-orchestrator.ts` | Claude API 기반 에이전트 오케스트레이터 |
| `src/main/figma-ws-server.ts` | Figma 플러그인 WebSocket 서버 (8767) |
| `src/main/figma-mcp-embedded.ts` | 58+ Figma MCP 도구 레지스트리 |
| `src/main/image-generator.ts` | Gemini API 이미지 생성 (동적 API 키) |
| `src/main/settings-store.ts` | 설정 저장소 (userData/settings.json) |
| `src/main/ds-lookup-tools.ts` | 디자인 시스템 조회 도구 4종 |
| `src/shared/types.ts` | 공유 타입 및 IPC 채널 상수 |
| `src/preload/index.ts` | Context bridge (electronAPI 노출) |
| `src/renderer/App.tsx` | 루트 React 컴포넌트 |
| `src/renderer/hooks/useAgent.ts` | 에이전트 상태 관리 훅 |
| `src/renderer/components/SettingsPanel.tsx` | Gemini API 키 설정 UI |
| `src/renderer/components/FigmaConnection.tsx` | Figma 연결 상태 UI |

## 설정 저장 방식
- `electron-store` v10은 ESM 전용이라 tsup CJS 번들링 불가
- 대신 `app.getPath('userData')/settings.json` + fs 사용
- `src/main/settings-store.ts`에서 `getGeminiApiKey()` / `setGeminiApiKey()` 제공

---

## Design System Architecture

### Current DS: DS-1

| 파일 | 역할 | 생성 방법 |
|------|------|-----------|
| [`src/DS_PROFILE.md`](src/DS_PROFILE.md) | Variant Key, Suffix Map, 속성명, 아이콘 소스 | `generate-ds-profile` 스크립트 |
| [`src/DESIGN_TOKENS.md`](src/DESIGN_TOKENS.md) | 색상 hex, spacing px, radius px, typography, **Text Styles key/ID (44)**, **Effect Styles key/ID (24)** | `generate-ds-profile` 스크립트 (REST API `/files/:key/styles` + 변수) |
| `ds/ds-1-icons.json` | icon name → componentId 매핑 (1141개) | MCP `scan_instances_for_swap` |
| `ds/ds-1-variants.jsonl` | 154 컴포넌트, 4716 배리언트 | `generate-ds-profile` 스크립트 |

DS 교체 시 위 파일만 교체하면 됨. 아이콘 파일은 DS별로 분리: `ds-1-icons.json`, `ds-2-icons.json` 등.

### 대용량 파일 접근 규칙
- **`DS_PROFILE.md` (483KB)**: Read 도구의 256KB 제한 초과 → **반드시 `offset`/`limit` 파라미터로 부분 읽기하거나, Grep 도구로 검색**. 전체 Read 시도 금지
  - 섹션 1~5 (1~42줄): Identity, INSTANCE_SWAP, Text Node, Button, Icon 정보
  - 섹션 6 (43줄~끝): Variant Key Index → **`ds-1-variants.jsonl` 사용** (아래 참고)
- **`DESIGN_TOKENS.md`**: 크기에 따라 동일 규칙 적용

### Variant Key 조회 (필수: ds-1-variants.jsonl 사용)
- DS_PROFILE.md의 섹션 6 대신 **`ds-1-variants.jsonl`** 파일로 Variant Key 조회 — 154개 컴포넌트, 4716개 변형
- **JSONL 형식**: 한 줄 = 하나의 컴포넌트 (`{"name":"...", "setKey":"...", "variants":{...}}`)
- **사용법**: `Grep "컴포넌트명" ds-1-variants.jsonl` → 해당 컴포넌트의 setKey와 전체 variants가 한 줄로 반환
- **예시**: `Grep "Checkbox"` → `{"name":"Checkboxes","setKey":"...","variants":{"Size=sm, Type=Checkbox, Checked=False":"key1",...}}`
- DS_PROFILE.md에서 Variant Key Index를 직접 검색하지 말 것 — 느리고 비효율적

### DS 토큰 소스: GitHub (stresslee/design-system) — 절대 규칙

> **디자인 생성 시 토큰(컬러, 스페이싱, 타이포그래피, 효과)은 반드시 GitHub에서 최신 데이터를 가져와서 사용한다.**
> 로컬 `ds/DESIGN_TOKENS.md`가 오래된 값일 수 있으므로, **디자인 생성 전 반드시 동기화 스크립트를 실행**한다.

**토큰 흐름:**
```
Figma Token Studio → git push → GitHub(stresslee/design-system/tokens.json)
                                      ↓ sync-tokens-from-github.sh
                                ds/DESIGN_TOKENS.md + ds/TOKEN_MAP.json (최신 값)
                                      ↓
                                디자인 생성 (batch_build_screen, set_bound_variables 등)
```

**동기화 실행:**
```bash
bash scripts/sync-tokens-from-github.sh
```

**규칙:**
- **디자인 생성 요청마다 매번 실행** — `batch_build_screen` 또는 blueprint 빌드 직전에 항상 `sync-tokens-from-github.sh` 실행. 같은 세션이라도 사용자가 중간에 DS를 변경하고 푸시했을 수 있으므로 캐싱하지 않는다
- 동기화 스크립트는 실행 시간이 짧으므로(수 초) 매번 실행해도 부담 없음
- 스크립트가 GitHub에서 `tokens.json` + `sync-to-agent.js`를 fetch → `DESIGN_TOKENS.md` + `TOKEN_MAP.json` 재생성
- 이렇게 해야 사용자가 Figma에서 컬러를 바꾸고 Token Studio로 push하면 자동 반영됨
- 로컬 `ds/` 파일을 수동으로 편집하는 것은 금지 — 항상 GitHub이 소스

**GitHub Actions (CI 자동 동기화):**
- `.github/workflows/sync-tokens.yml` — `repository_dispatch` 또는 수동 트리거 시 동일 로직 실행
- design-system 레포에서 push 시 figma-design-agent의 `ds/` 파일 자동 업데이트

### DS 토큰 업데이트 워크플로우

DS 라이브러리에서 변수를 변경한 후:
1. 사용자가 "변수 업데이트했어" 라고 말하면
2. `get_local_variables(includeLibrary: true)` 실행 — 355+ 변수 값 resolve (alias 재귀 포함)
3. 현재 `DESIGN_TOKENS.md`와 diff 비교
4. 변경된 값 자동 업데이트

DS 라이브러리에서 Text Style/Effect Style을 변경한 후:
1. `generate-ds-profile.js` 재실행 (REST API `/files/:key/styles`에서 자동 추출)
2. 또는 수동: `DESIGN_TOKENS.md`의 "## Text Styles" / "## Effect Styles" 섹션 업데이트

### Text Style 바인딩 체계

DS-1은 Typography **Variables** (fontSize, lineHeight) + **Text Styles** 이중 시스템 사용.
둘 다 적용해야 완전한 DS 연결:
- `set_bound_variables` → fontSize, lineHeight 변수 바인딩
- `set_text_style_id` → Text Style 바인딩 (DESIGN_TOKENS.md에서 Style ID 참조)
- Style ID 형식: `S:{key},{nodeId}` — 리모트 라이브러리 스타일 자동 import
- DS 인스턴스(Button, Checkbox 등) 내부 텍스트는 이미 적용됨 → `create_text`로 직접 생성한 노드만 바인딩

### 새 DS 생성 워크플로우 (DS-2 등)

```bash
# Step 1: 컴포넌트 + 변수 + Text/Effect Styles 프로필 생성
npm run generate-ds-profile -- "<figma-file-url>" \
  --token <token> --name "DS-2" --exclude-icons \
  --variables-json /path/to/variables.json

# Step 2: 아이콘 매핑 생성 (DS 파일에서 플러그인 실행 후)
# MCP: scan_instances_for_swap → ds-2-icons.json 저장

# Step 3: 수동 보완 (MCP 도구로 탐색)
```

### generate-ds-profile 스크립트

```
scripts/generate-ds-profile.js

옵션:
  --token <token>          Figma Personal Access Token (또는 FIGMA_ACCESS_TOKEN 환경변수)
  --name <name>            DS 이름 (기본: 파일명에서 추출)
  --out <dir>              출력 디렉토리 (기본: src/)
  --variables-json <path>  MCP로 추출한 변수 JSON 경로 (하이브리드 모드)
  --exclude-icons          아이콘 페이지 제외 (아이콘은 별도 JSON으로 관리)
  --dry-run                파일 쓰기 없이 미리보기
```

## DS Lookup Tools (MCP 내장 — Grep 대신 사용)

DS 데이터 조회 시 **Grep/Read 대신 아래 MCP 도구 사용** — 컨텍스트 토큰 절약 + 라운드트립 감소.

| 도구 | 용도 | 예시 |
|------|------|------|
| `lookup_icon` | 아이콘 이름 → componentId | `lookup_icon("arrow")` → arrow 관련 아이콘 20개 |
| `lookup_variant` | 컴포넌트 → setKey + variants | `lookup_variant("Button")` → Button variants |
| `lookup_design_token` | 토큰 이름 → 값 | `lookup_design_token("bg-primary", category="colors")` |
| `lookup_text_style` | 스타일 이름 → Style ID | `lookup_text_style("Text sm")` → Style ID |

### 사용 규칙
- `ds-1-icons.json` 검색 → `lookup_icon` 사용
- `ds-1-variants.jsonl` 검색 → `lookup_variant` 사용
- `DESIGN_TOKENS.md` 색상/spacing/radius 검색 → `lookup_design_token` 사용
- `DESIGN_TOKENS.md` Text Style/Effect Style 검색 → `lookup_text_style` 사용
- **Figma 채널 연결 불필요** — 로컬 파일에서 직접 읽기, 서버 시작 시 자동 캐싱

## INSTANCE_SWAP Guide

INSTANCE_SWAP properties use **component node IDs** (e.g. `"12:3822"`), NOT component keys.
> DS별 속성명 패턴은 [`src/DS_PROFILE.md`](src/DS_PROFILE.md) §2 참조

### Icon Swap Workflow

1. Look up the icon name in `ds-1-icons.json` to get its `componentId`
2. Use `set_instance_properties` with that `componentId` as the value
3. Use `get_instance_properties` first to discover exact property names

### Important Notes

- `getMainComponentAsync()` and `importComponentByKeyAsync()` hang for remote library components in Figma plugin sandbox
- No pre-import is needed for INSTANCE_SWAP — `setProperties()` accepts node IDs directly

---

## Design Rules

> **⚠️ 디자인 생성 전 반드시 읽기: 기본 빌드 규칙 (MUST READ FIRST)**

### 기본 빌드 규칙 (디자인 생성 시 첫 번째로 적용)

아래 규칙은 **모든 디자인 생성/수정 시** 기본으로 적용한다. 위반하면 QA에서 반드시 실패한다.

#### 디자인 생성 전 필수 실행 스텝 (MANDATORY PRE-BUILD)
> 이 스텝을 건너뛰면 잘못된 색상, 깨진 레이아웃이 생성된다. **스킵 절대 금지.**

1. **DS 토큰 동기화**: `bash scripts/sync-tokens-from-github.sh` 실행 (디자인 생성 요청마다 매번)

#### Blueprint 컬러 규칙 — $token() 참조 필수 (RGBA 하드코딩 절대 금지)
> **블루프린트 JSON에 RGBA 값을 직접 넣지 마라.** 토큰 이름으로 참조하면 빌드 시 TOKEN_MAP.json에서 최신값으로 자동 resolve된다.

- **사용법**: `fill`, `fontColor`, `iconColor`, `stroke` 등 컬러 필드에 `"$token(토큰이름)"` 사용
- **예시**:
  ```json
  {"fill": "$token(bg-brand-solid)"}
  {"fontColor": "$token(fg-brand-primary)"}
  {"fill": "$token(bg-brand-section)"}
  {"iconColor": "$token(fg-primary)"}
  {"fill": {"r": 1, "g": 1, "b": 1, "a": 1}}   ← 흰색/검정 등 기본색만 직접 RGBA 허용
  ```
- **resolve 흐름**: `figma_mcp_client.py build` 실행 → `$token()` 발견 → `TOKEN_MAP.json`에서 hex 조회 → RGBA 변환 → 빌드
- **토큰 이름**: `DESIGN_TOKENS.md`의 토큰 이름 사용 (예: `bg-brand-solid`, `fg-primary`, `border-secondary`)
- **직접 RGBA 허용 케이스**: 순수 흰색 `{r:1,g:1,b:1,a:1}`, 순수 검정 `{r:0,g:0,b:0,a:1}`, 투명 `{r:0,g:0,b:0,a:0}` 등 DS 토큰이 아닌 기본색만
- **이 규칙을 위반하면**: 토큰 변경 시 디자인에 이전 컬러가 남아 불일치 발생

#### 빌드 규칙
1. **부모 프레임에 배경색이 있으면 자식 레이아웃 프레임은 투명** — Card Top, Card Tags, Title Group 등 순수 레이아웃 프레임에 fill 넣지 않기. 태그/버튼/아바타 등 의도적 시각 구분 요소만 fill 허용
2. **리스트 아이템의 아이콘-텍스트 간격 최소 12px** — HORIZONTAL auto-layout의 `itemSpacing`을 12~16px로 설정. 아이콘과 텍스트가 붙어 보이면 안 됨
3. **FAB는 Tab Bar 위 최소 16px 간격** — `FAB.y = TabBar.y - FAB.height - 16`
    > **섹션 간 간격 24px 균일 (필수)** — 루트 프레임 직접 자식인 콘텐츠 섹션(Hero Section, Recommended Stages, Fun Section, Daily Tasks 등) 사이 간격은 **일관되게 24px**. 예외: NavBar↔Ribbon↔Hero는 0px 밀착, FAB↔TabBar는 16px. 빌드 후 반드시 각 섹션의 y, height를 조회하여 `gap = next.y - (prev.y + prev.h)` 계산으로 검증. 겹침(음수 gap) 절대 금지
4. **Tab Bar 외곽선 없음** — Tab Bar 프레임에 검은/진한 stroke 금지. 필요하면 상단 1px 연한 회색(`#F0F0F1`) stroke만 허용
5. **Tab Bar 아이템 균등 배분** — 모든 탭 아이템 `layoutSizingHorizontal: "FILL"`, `layoutMode: "VERTICAL"`, `counterAxisAlignItems: "CENTER"`, `primaryAxisAlignItems: "CENTER"`, `itemSpacing: 4`
6. **아이콘은 SVG로 렌더링 확인** — `batch_build_screen` 후 `_fallback: true`인 아이콘 프레임은 반드시 수정. SVG가 없으면 직접 `type: "svg_icon"` + `svgData`로 삽입
7. **Tab Bar / FAB는 root 직접 자식 + ABSOLUTE** — Content 프레임 안에 넣지 않는다. root 하단에 ABSOLUTE 포지셔닝
8. **SPACE_BETWEEN + FILL 자식 금지 / HORIZONTAL FILL이 itemSpacing을 삼키는 문제** — HORIZONTAL auto-layout에서 `primaryAxisAlignItems: "SPACE_BETWEEN"`과 자식 `layoutSizingHorizontal: "FILL"`을 동시에 사용하면 간격이 0이 됨. FILL 자식이 있으면 `primaryAxisAlignItems: "MIN"`으로 설정하고 `itemSpacing`으로 고정 간격 지정. **추가**: HORIZONTAL 부모에서 자식 중 하나라도 `layoutSizingHorizontal: "FILL"`이면 그 자식이 남은 공간을 전부 차지하여 `itemSpacing`이 시각적으로 사라짐 (0px 간격). 배너/리스트 등 아이콘+텍스트+chevron 행에서 텍스트 프레임을 FILL로 설정하면 아이콘·chevron과 붙어버림 → **텍스트 프레임은 HUG로 설정**하고 `itemSpacing`으로 간격 확보할 것
9. **blueprint에 FILL이 필요한 프레임은 반드시 명시적 width도 함께 설정** — `layoutSizingHorizontal: "FILL"`만으로는 code.js 빌드 후 루트 auto-layout 제거 시 width가 HUG로 축소됨. 안전장치로 `width: 353` (부모 inner width) 등 명시적 크기 병행 설정
10. **빌드 후 프로그래밍적 QA 필수** — 스크린샷만으로 QA하지 말 것. `get_node_info`로 주요 섹션의 실제 width, height를 확인하고 rootWidth(393)와 비교. width < 393*0.9인 full-width 섹션은 즉시 수정
11. **텍스트 중요도에 따라 fontWeight 차등 적용 (필수)** — 모든 텍스트가 동일 weight면 시각적 위계가 없어 가독성이 떨어짐. 아래 기준 준수:
    - **섹션 타이틀** (추천! 스테이지, 놓칠 수 없는 즐거움 등): **Bold**
    - **카드 핵심 정보** (금액, 이름, CTA 라벨): **Bold** 또는 **SemiBold**
    - **카드 보조 정보** (이율, 기간, 탭 라벨): **Medium**
    - **설명/부제목** (서브타이틀, 캡션): **Regular**
    - **절대 금지**: 화면 전체를 Regular 또는 Medium 하나로 통일하는 것
12. **정보성 리본/띠 배너는 저대비 스타일 필수** — 누적 거래 건수, 공지사항 한 줄 등 보조 정보를 표시하는 얇은 리본(띠 배너)에 `bg-brand-section`(짙은 보라) 같은 고대비 배경을 사용하면 NavBar/히어로와 시각적으로 충돌하여 화면이 산만해짐. 반드시 **연한 배경 + 중간 톤 텍스트** 조합 사용:
    - **배경**: `$token(bg-brand-primary)` (연한 보라 #f4f3ff) 또는 `$token(bg-secondary)` (연한 회색 #fafafa)
    - **텍스트**: `$token(fg-tertiary)` (회색 #535862) 또는 `$token(fg-secondary)` (진한 회색 #414651)
    - **아이콘**: `$token(fg-brand-primary)` (브랜드 보라 #6938ef) — 텍스트보다 살짝 강조
    - **절대 금지**: 리본에 `bg-brand-section`, `bg-brand-solid` 등 짙은 배경 + 흰색 텍스트 조합. 이 스타일은 히어로 배너 전용
13. **Tag/Chip/Badge는 반드시 width: HUG** — 태그, 칩, 배지, 인디케이터 등 라벨 컨테이너는 **예외 없이** `layoutSizingHorizontal: "HUG"` 사용. FILL이 되면 부모 너비 전체로 늘어나 디자인이 깨짐. 히어로 배너 내부 태그(EVENT 등), 이율 태그, 보너스 태그, 탭 필터, 카루셀 인디케이터 모두 해당. Blueprint에서 태그/칩 프레임에 `layoutSizingHorizontal`을 명시하지 않거나 `"FILL"`로 설정하는 것은 금지
14. **섹션 내 탭 메뉴는 DS Tabs 컴포넌트(Underline) 스타일 사용** — 추천 스테이지 등 섹션 내 필터/탭 전환 UI는 pill/버튼 스타일이 아닌 **Underline 스타일** 적용. DS 참조: `https://stresslee.github.io/design-system-docs/components/tabs`
    - **Tab Row (컨테이너)**: HORIZONTAL auto-layout, `itemSpacing: 8`, 배경 fill 없음(투명), **하단 stroke 1px `$token(border-secondary)` (inside)** — 전체 너비에 걸친 회색 베이스라인 역할. `layoutSizingHorizontal: "FILL"` (부모 너비 채움)
    - **Active 탭**: VERTICAL auto-layout, HUG×HUG, padding `T4/B0/L4/R4`, `itemSpacing: 8`, 배경 투명, cornerRadius 0. 자식: ① 텍스트 `$token(fg-brand-primary)` + fontWeight 600(SemiBold) ② Underline bar (height 2px, `layoutSizingHorizontal: "FILL"`, brand 컬러 fill `$token(bg-brand-solid)`)
    - **Inactive 탭**: VERTICAL auto-layout, HUG×FILL (세로 FILL — Active 탭 높이에 맞춰 베이스라인 정렬), padding `T4/B0/L4/R4`, 배경 투명, cornerRadius 0. 자식: 텍스트 `$token(fg-tertiary)` + fontWeight 500(Medium), 언더라인 없음
    - **베이스라인 원리**: Tab Row의 하단 stroke가 전체 너비 회색 선을 그리고, Active 탭의 2px 언더라인 bar가 그 위에 겹쳐서 brand 컬러로 활성 탭을 표시. Inactive 탭은 `layoutSizingVertical: "FILL"`로 Active 탭과 동일 높이를 유지하여 베이스라인 정렬
    - **절대 금지**: pill 형태(cornerRadius 20 + 배경 fill) 탭을 섹션 내 필터로 사용하는 것. Pill 탭은 상단 네비게이션 전용
15. **배너형 CTA 카드(아이콘+텍스트+chevron 행)는 padding 16, spacing 16** — 계산기 배너, 프로모션 배너 등 아이콘+텍스트그룹+chevron을 한 줄로 배치하는 카드형 CTA는: `HORIZONTAL`, `SPACE_BETWEEN`, `CENTER`, **padding 16(전방향)**, **itemSpacing 16**, `cornerRadius: 16`. 텍스트 그룹은 반드시 `HUG` (FILL 금지 — rule 8 참조)

---

### Root Frame
- 루트 프레임(스크린)은 **Auto Layout을 사용하지 않는다** — 자식 요소는 절대 좌표로 배치
- `batch_build_screen` 사용 시에도 루트에 `autoLayout` 설정 금지
- **내용이 길어질 경우 루트 프레임 height를 미리 충분히 늘려서** UI 생성 및 배치 — 콘텐츠가 프레임 밖으로 잘리지 않도록 사전에 여유 확보 후, 완성 후 적절히 조정
- **새 화면 생성 시 기존 프레임 삭제 금지** — 캔버스에 이미 존재하는 프레임을 절대 삭제하지 않는다. 새 화면은 기존 프레임의 **오른쪽**에 생성할 것

### NavBar 로고 (필수)
- **NavBar 로고는 반드시 icons 페이지의 logo 컴포넌트(`64:1449`)를 `clone_node`로 복제**해서 사용할 것
- 텍스트 노드로 "imin" 로고를 직접 만들지 않는다
- 절차: `clone_node(64:1449, navBarId)` → `insert_child(index=0)` — NavBar의 첫 번째 자식으로 배치

### 버튼/CTA 컴포넌트 인스턴스 필수
- 버튼은 반드시 DS `Buttons/Button` 컴포넌트 인스턴스를 사용 — 프레임+텍스트로 수동 구성 금지
- **CTA 버튼**: `Size=xl, Hierarchy=Primary, State=Default, Icon only=False` (componentKey: `90cc91183f75975cc066f2fc156babfdad1c6937`)
- **일반 버튼 (Large)**: `Size=lg, Hierarchy=Primary, State=Default, Icon only=False` (componentKey: `e31817b31fc5241395325fe519bba29c306c9d5e`)
- **일반 버튼 (Medium)**: `Size=md, Hierarchy=Primary, State=Default, Icon only=False` (componentKey: `db2280e1aaa99563769a7d0fce59dfcde7a39b09`)
- **Secondary 버튼**: `Size=md, Hierarchy=Secondary, State=Default, Icon only=False` (componentKey: `10d012c26a93c7623d06`)
- 텍스트 변경: `textOverrides` 또는 `set_text_content`로 인스턴스 내부 텍스트 노드(name="Text") 수정
- `batch_build_screen`에서 `type: "instance"` + `componentKey` 사용
- **아이콘 표시 규칙** (Button 인스턴스 속성):
  - `⬅️ Icon leading#3287:1577` (BOOLEAN): leading 아이콘 표시 여부
  - `➡️ Icon trailing#3287:2338` (BOOLEAN): trailing 아이콘 표시 여부
  - `🔀 Icon leading swap#3466:91` (INSTANCE_SWAP): leading 아이콘 컴포넌트 교체
  - `🔀 Icon trailing swap#3466:852` (INSTANCE_SWAP): trailing 아이콘 컴포넌트 교체
  - **CTA 버튼**: leading/trailing 모두 `false` — 텍스트 전용이 가장 깔끔 (핀테크 표준)
  - **네비게이션 버튼**: trailing만 `true` + chevron-right 아이콘
  - **아이콘 첨부 버튼**: leading만 `true` + 해당 아이콘
  - **주의**: INSTANCE_SWAP에 리모트 라이브러리 아이콘 ID(`17:xxxx`)는 직접 사용 불가 — 로컬 컴포넌트 ID만 가능

### Auto Layout (루트 하위 모든 컴포넌트에 필수)
- 루트 프레임의 직접 자식 섹션 (NavBar, 카드, 섹션 등)과 그 하위 모든 컴포넌트에 **Auto Layout 필수 적용**
- 방향별 기준:
  - **NavBar**: HORIZONTAL, primaryAxis=SPACE_BETWEEN, counterAxis=CENTER, paddingLeft/Right=16, height 고정
  - **섹션 카드 (수직 나열)**: VERTICAL, paddingTop/Bottom=20, paddingLeft/Right=20, gap 적절히
  - **행(Row) / 버튼 / 태그**: HORIZONTAL, counterAxis=CENTER, gap 적절히
  - **테이블 행**: HORIZONTAL, primaryAxis=SPACE_BETWEEN, counterAxis=CENTER, paddingLeft/Right=8
- `batch_build_screen`에서 `autoLayout` 속성으로 설정하거나, 생성 후 `set_auto_layout`으로 적용

### Typography
- 모든 텍스트는 기본 폰트 **Pretendard** 사용 — 디자이너의 특별한 요청이 없는 한 예외 없음
- `create_text`, `batch_build_screen` 등으로 텍스트 생성 시 반드시 Pretendard 폰트 적용
- **섹션 타이틀은 반드시 Bold** — "추천! 스테이지", "놓칠 수 없는 즐거움" 등 섹션 헤더 텍스트는 `fontName: {family: "Pretendard", style: "Bold"}` 필수. Regular/Medium 금지

### Icons
- 기호(+, ×, ✓, 화살표 등)는 **절대 텍스트로 처리하지 않는다** — 반드시 `ds-1-icons.json`에서 해당 아이콘을 찾아 인스턴스로 삽입
- 아이콘 삽입 방법: icons 페이지에서 해당 아이콘 노드를 `clone_node` → 부모에 `insert_child` → `set_selection_colors`로 색상 적용 → `resize_node`로 크기 조정

### People Photos (Unsplash)
- **사람 얼굴/인물 사진이 필요한 경우 Gemini로 생성하지 않는다** — 반드시 **Unsplash**에서 검색하여 실제 사진을 가져올 것
- 프로필 아바타, 사용자 썸네일, 팀원 소개 등 사람이 등장하는 모든 이미지에 적용
- **사용법**: `https://images.unsplash.com/photo-{ID}?w={size}&h={size}&fit=crop&crop=face` — API 키 불필요
- **검색 URL**: `https://unsplash.com/s/photos/{keyword}` 에서 적절한 이미지 ID 확보
- 다운로드 후 PIL로 리사이즈 (Figma 노드 크기 × 3) → base64로 `set_image_fill` 적용
- 아바타 프레임은 `cornerRadius`를 width/2로 설정하여 원형으로 만들 것
- Gemini는 3D 오브젝트, 일러스트, 배너 그래픽 등 **비사진 그래픽**에만 사용

### Graphics & Illustrations (Gemini 이미지 생성)
- **히어로 이미지 타겟 노드 규칙 (필수):**
  1. Hero Section 안에 **Banner Card 프레임이 있으면** → Banner Card에 `set_image_fill` 적용 (Hero Section 자체에는 이미지 채우지 않음)
  2. Banner Card 프레임이 **없으면** → Hero Section 프레임에 직접 `set_image_fill` 적용
  - 두 프레임 모두에 이미지가 채워지는 일이 절대 없어야 함
- **Banner Card 높이 = 200px 고정** — 히어로 섹션 내 배너 카드는 항상 height=200으로 설정. MIN_HERO_SIZE(200) 우회 불필요
- **히어로 배너 텍스트 width = 배너 폭의 50%** — Banner Card 안의 타이틀/서브타이틀/설명 텍스트는 width를 배너 폭의 50% 이하로 제한 (예: 배너 353px → 텍스트 ~176px). 이미지 그래픽과 텍스트가 겹치지 않도록 좌측 절반에만 텍스트 배치
- **히어로 배너 이미지 레이아웃 규칙 (필수):** Gemini로 히어로 배너 이미지 생성 시, 프롬프트에 **반드시** 다음 조건을 포함:
  - 이미지의 **좌측 절반은 완전히 비워둘 것** — 단색 배경만 허용, 오브젝트/텍스트/장식 일체 금지
  - 모든 3D 오브젝트/그래픽은 **우측 절반에만** 배치
  - 좌측은 텍스트 오버레이 영역이므로, 텍스트 가독성을 해치는 요소가 절대 없어야 함
- **배경 제거 규칙 (필수):**
  - **히어로/배너 이미지**: 배경 유지 (isHero=true, rembg 미적용)
  - **그 외 모든 이미지 (아이콘, 카드 그래픽 등)**: 반드시 **rembg로 배경 제거** → 투명 PNG로 적용. Gemini API 직접 호출 시에도 rembg 파이프라인을 반드시 거칠 것
- **기본 그래픽 스타일 = 3D 소프트 매트** — 사용자가 명시적으로 2D/flat을 요청하지 않는 한 항상 3D 소프트 매트 스타일(Cinema4D, Octane render, matte finish) 적용. 2D 스타일은 명시적 요청 시에만 사용
- **스타일 레퍼런스 이미지 참조 (필수):** `assets/reference-images/` 폴더의 레퍼런스 이미지를 Gemini API 호출 시 `inlineData`로 함께 전달하여 스타일 일관성 유지. `generate_image` MCP 도구 사용 시 자동 처리되지만, Gemini API 직접 호출 시에도 반드시 레퍼런스를 포함할 것
  - **3D 아이콘/일러스트**: `assets/reference-images/icon/` 에서 랜덤 2장 참조 (기본)
  - **2D/flat 스타일**: `assets/reference-images/2d/` 에서 랜덤 2장 참조 (style="2d" 시)
  - **히어로/배너**: `assets/reference-images/hero/` 에서 랜덤 2장 참조 (isHero=true 시)
  - 키워드 매칭: hero(banner/배너/히어로/carousel/cover), icon(icon/아이콘/logo/symbol/badge/coin/gift/object), 매칭 없으면 icon/ 기본
- **그래픽·일러스트가 필요한 영역은 반드시 Gemini(nano-banana-pro)로 생성해서 삽입** — 배너 배경 이미지, 히어로 일러스트, 3D 오브젝트, 캐릭터, 프로모션 비주얼 등
- **전체 UI 화면을 Gemini로 생성하는 것은 금지** — 스타일 일관성이 깨지고 수정 불가능. 그래픽 에셋 생성에만 사용
- **생성 워크플로우:**
  1. 이미지를 채울 프레임/rectangle 노드를 먼저 Figma에 생성
  2. Python으로 Gemini API 호출 → `assets/generated/` 에 PNG 저장
  3. HTTP 서버(`python3 -m http.server 18765`, 프로젝트 루트 기준)로 서빙
  4. `set_image_fill(url="http://localhost:18765/assets/generated/파일명.png", scaleMode="FILL")`로 적용
- **API 정보:**
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`
  - Header: `X-goog-api-key: {API_KEY}`
  - Body: `{"contents":[{"parts":[{"text":"..."}]}],"generationConfig":{"responseModalities":["IMAGE","TEXT"]}}`
  - API Key: Settings UI에서 설정 (src/main/settings-store.ts에 저장됨)
  - 응답: `candidates[0].content.parts[].inlineData.data` (base64 PNG)
- **3x 해상도 필수:** 모든 그래픽 이미지는 **Figma 노드 사이즈의 3배**로 생성 후, 원래 크기의 노드에 `FILL`로 적용. Figma가 자동으로 축소하여 고해상도 렌더링. 예: 36×36 노드 → 108×108 이미지 생성, 361×180 배너 → 1083×540 이미지 생성
- **크기 맞추기:** Gemini 출력 비율이 타겟과 다를 수 있음 → PIL로 center-crop 후 `img.resize((W*3, H*3), Image.LANCZOS)` 적용 (3x 해상도)
- **스타일 레퍼런스:** 이전에 생성한 이미지를 `inlineData`로 같이 전달하면 스타일 일관성 유지 가능
- **기본 그래픽 스타일:** `Cinema4D, Octane render, soft diffused studio lighting, matte finish, front view, orthographic view` — 소프트 매트 질감 기본, glossy 금지. 사용자가 별도 스타일/뷰를 지정하지 않으면 이 스타일을 기본 적용
- **이미지 사이즈 규칙 (용도별 4단계):**
  - **대형 배너 (히어로, 프로모션 등):** 이미지 사이즈 = 배너 프레임 사이즈 × 3. 텍스트가 좌측에 배치될 경우, Gemini 프롬프트에 "place the 3D object on the **right side** of the image, leave the **left half empty** for text overlay"를 포함하여 그래픽을 우측에 생성
  - **중형 카드 그래픽 (랜덤박스, 기프트샵 등):** Figma 노드 **50×50px 고정** → 이미지 **150×150px** (3x)로 생성. Gemini 출력 후 PIL로 투명 영역 trim → `150×150`로 리사이즈. 투명 배경 필수 (rembg 적용)
  - **소형 아이콘 그래픽 (3D):** Figma 노드 32×32px → 이미지 **96×96px**로 생성. 동일하게 trim 후 리사이즈. DS 아이콘으로 대체 불가능한 커스텀 일러스트에만 사용
  - **2D 플랫 그래픽 (리스트 아이콘 등):** Figma 노드 **24×24px 고정**, `cornerRadius: 0` 필수 → 이미지 **72×72px** (3x)로 생성. `assets/reference-images/2d/` 레퍼런스를 반드시 함께 전달하여 이모지 스타일 일관성 유지. 투명 배경 필수 (rembg 적용). 완전 플랫 단색, 그라데이션/투명/그림자 금지

### Text
- 텍스트가 프레임 하단에 위치할 때는 **textAlignVertical을 BOTTOM**으로 설정 — 텍스트가 잘려 보이는 것을 방지
- 텍스트 박스 높이는 **언제나 auto height** 사용 — `set_layout_sizing`의 `vertical: "HUG"` 또는 `textAutoResize: "HEIGHT"` 적용
- 텍스트 줄 수 제한 요청 시 → `textAutoResize: "TRUNCATE"` + `maxLines` 설정 (예: "2줄로 제한" → `maxLines: 2`)
- **줄바꿈은 반드시 `<br>` 마커 사용** — `\n`(Enter/paragraph break)은 Figma에서 단락 간격을 추가하므로 금지. `<br>`은 MCP 서버가 자동으로 U+2028(Shift+Enter/line break)로 변환하여 동일 단락 내 줄바꿈을 생성

### Colors
- **커스텀 컬러 절대 금지** — 모든 색상은 반드시 `DESIGN_TOKENS.md`에 정의된 DS 토큰만 사용
- fill, stroke, text color 모두 DS 변수로 바인딩할 것 — `set_bound_variables`의 `fills/0`, `strokes/0` 필드 사용
- DS에 정확한 색상이 없으면 가장 가까운 토큰으로 대체 (커스텀 hex 값 사용 금지)
- Primitive 색상(Colors/Blue/500 등)은 라이브러리에 퍼블리시되지 않을 수 있음 → Semantic 토큰(Colors/Background/, Colors/Text/ 등) 또는 Component colors(Component colors/Utility/) 사용
- **Color token은 반드시 DS 전용** — `DESIGN_TOKENS.md`의 Semantic/Component 토큰만 사용. 다른 앱 색상 팔레트나 hex 값을 참고해 직접 적용하는 행위 금지
- **Brand color도 DS 전용** — DS-1의 brand 토큰(`Colors/Background/bg-brand-*`, `Colors/Foreground/fg-brand-*`, `Component colors/Utility/Brand/*` 등)을 그대로 사용. 임의 변형이나 외부 브랜드 색상 대입 금지

#### 브랜드 컬러 — $token() 참조 사용 (RGBA 하드코딩 금지)
- **블루프린트에서 브랜드 컬러는 반드시 `$token()` 참조** — `"$token(bg-brand-solid)"`, `"$token(fg-brand-primary)"` 등. RGBA 직접 입력 금지
- **CTA/액션 버튼은 반드시 `$token(bg-brand-solid)` 사용** — 임의 색상 사용 금지
- **Grep으로 hex 조회 후 RGBA 변환은 더 이상 불필요** — `figma_mcp_client.py build`가 자동 resolve

#### Brand Color 사용 범위 규칙
- **Brand color는 CTA와 Primary Action 전용** — 버튼, FAB, 강조 링크, active 탭 등 사용자의 핵심 행동을 유도하는 요소에만 사용
- **필터 칩/토글/배지 등 보조 UI에는 brand color 사용 금지** — 뉴트럴 다크(Gray-700 #344054 등) 또는 outline 스타일 사용. 필터 옵션은 CTA가 아님
- **아이콘 명도 대비 4:1 필수** — 색상 배경 위 아이콘은 반드시 흰색(#FFF) 사용. 검정/다크 아이콘을 컬러 배경에 올리면 대비 부족으로 안 보임
- 대비 확인 기준: 짙은 배경(brand, dark gray 등) → 아이콘/텍스트 **흰색**, 연한 배경(gray-50, white 등) → 아이콘/텍스트 **다크**

#### 컬러 조화 규칙 (화면 단조로움 방지)
- **중요 텍스트·기능·버튼은 Brand color** — CTA, 핵심 수치, 강조 라벨, active 탭 아이콘 등
- **기본 톤은 Gray Modern** — 배경: `bg-primary`(white) / `bg-secondary`(gray-50), 텍스트: `fg-primary`(gray-900) / `fg-secondary`(gray-600) / `fg-tertiary`(gray-400), 보더: `border-secondary`(gray-200)
- **2~3개 액센트 컬러 혼용 필수** — Brand 단색만 쓰면 단조로움. DS 토큰의 Error(빨강), Warning(주황), Success(초록) 등 Semantic color를 상황에 맞게 배치하여 시각적 리듬감 부여
  - 예: 마감임박 배지 → Error red, 수익률/긍정 지표 → Success green, 신규/HOT 태그 → Warning orange
  - 히어로 배너 배경 → `bg-brand-section` (짙은 brand), 카드 배경 → `bg-brand-primary` (연한 brand)
- **동일 색상의 농도 변화로 깊이감** — bg-brand-primary(연) → bg-brand-secondary(중) → bg-brand-solid(진) 순으로 계층 표현

### Variable Binding (필수)
- 디자인 생성 완료 후 **반드시 마지막 단계에서 DS 변수 바인딩 수행** — 절대 빠뜨리지 말 것
- 바인딩 순서: ① Text Style (`set_text_style_id`) → ② Typography 변수 (fontSize, lineHeight) → ③ Radius 변수 → ④ Color 변수 (fills/0, strokes/0)
- `set_bound_variables`로 바인딩: fontSize, lineHeight, cornerRadius(topLeftRadius 등), padding, itemSpacing, fills/0, strokes/0
- `set_text_style_id`로 Text Style 바인딩 (Style ID 형식: `S:{key},{nodeId}`)

---

## Mobile Detail Screen 패턴

- **핵심 수치 = Inline Horizontal Stat 1행** — 약정금/이율/인원/기간 등 4개 이내 수치는 카드 그리드(2×2) 대신 **한 줄 가로 배치**로 세로 공간 절약. 카드형은 데스크톱/태블릿 전용
- **부제목 필수** — 화면 타이틀 아래 한 줄 설명 텍스트로 맥락 전달 (예: "매월 30만원씩 12개월간 진행하는 스테이지입니다")
- **긴급 알림 배너** — 잔여석, 마감임박 등 FOMO 요소를 경고 배너로 표시 (예: "잔여 4석 | 빠른 참여를 권장합니다")
- **"보기"와 "행동" 섹션 분리** — 참여현황(상태 확인)과 순번선택(사용자 행동)을 별도 섹션으로 분리. 혼합 금지
- **호스트/작성자 프로필 = 탭 가능 카드** — 아바타+이름+뱃지+chevron-right로 내비게이션 어포던스 제공
- **태그에 아이콘 포함** — 텍스트만 있는 태그보다 아이콘+텍스트 조합이 가독성과 스캔성 향상
- **iOS Status Bar 포함 필수 (최우선 규칙)** — 모바일 프레임 생성 시 Status Bar를 직접 만들지 말고, **반드시 icons 페이지의 `Status bar` 인스턴스(노드 ID: `1:3448`)를 `clone_node`로 복제**해서 사용할 것. 절차: `clone_node(1:3448, rootId)` → `insert_child(index=0)` → `set_layout_sizing(horizontal: FILL)` → `resize_node(393, 54)`. Blueprint JSON에 Status Bar 자식 노드를 직접 정의하지 말 것 — 빌드 후 clone으로 삽입
- **섹션 구분 = 여백 우선** — 두꺼운 Divider(8px 배경색) 대신 **여백(16~24px)**과 섹션 타이틀로 구분. Divider는 같은 섹션 내 항목 간 얇은 선(1px)만 사용
- **CTA 버튼에 아이콘 장식** — 주요 행동 버튼에 아이콘을 추가하면 시각적 강조 효과
- **정보 밀도 최적화** — 모바일은 스크롤 최소화가 핵심. 불필요한 패딩/카드 여백을 줄이고 한 화면에 최대한 많은 정보 노출
- **순번/좌석 선택 UI** — 그리드 형태(3~4열)의 원형/라운드 버튼으로 표시. 상태는 3종류: 확정(filled), 선택됨(brand color), 선택 가능(outline). 반드시 범례(Legend) 포함

### Julee App Pattern Reference (ds/JULEE_APP_PATTERNS.md)
- **레이아웃·컴포넌트·인터랙션 패턴만 참고** — 화면 구조, 카드 레이아웃, 탐색 흐름, 제스처 등 UX 패턴 적용 가능
- **색상 패턴은 완전 무시** — 외부 색상 팔레트, 배경색, 텍스트 색, 브랜드 컬러는 참고하지 않음. 색상은 항상 DS-1 토큰 전용

### Mobile Screen Size
- 모바일 디자인은 **iPhone 16** 기준: **393 × 852** px
- **상단 Status Bar 62px 확보 필수** — y=0~62 구간은 항상 비워둘 것. 콘텐츠는 **y=74** (62 + 12px 패딩)부터 시작
- 모든 모바일 디자인 생성 시 이 사이즈를 기본으로 사용
- TabBar 높이: 74px → TabBar y = 852 - 74 = **778**
- FAB 위치: TabBar 위 16px → FAB y = 778 - 56 - 16 = **706**, x = 393 - 56 - 20 = **317**

### Constraints & Scroll Behavior (프로토타입 필수 설정)
- **NavBar**: Scroll behavior → Position: **Fixed (stay in place)**, Overflow: **No scrolling**
- **TabBar**: Constraints: **Left, Bottom** / Scroll behavior → Position: **Fixed (stay in place)**, Overflow: **No scrolling**
- **FAB**: Constraints: **Right, Bottom**
- NavBar와 TabBar는 스크롤 시 화면에 고정, FAB는 우하단에 고정

---

## 디자인 완료 QA 절대 규칙 (ABSOLUTE RULES)

> 이 규칙은 **모든 디자인 생성 작업**에서 반드시 적용된다. 예외 없음.

### 스크린샷 촬영 방법 (필수 — MCP HTTP 직접 호출)
MCP 도구(`export_node_as_image`)가 "Server not initialized" 에러를 내는 경우, **MCP HTTP 엔드포인트를 직접 호출**하여 스크린샷을 로컬 PNG로 저장한 뒤 `Read` 도구로 이미지를 확인한다.

```python
import json, urllib.request, base64

url = 'http://localhost:8769/mcp'

# 1. Initialize session
init_body = json.dumps({'jsonrpc':'2.0','method':'initialize','params':{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'qa','version':'1.0'}},'id':1})
req = urllib.request.Request(url, init_body.encode(), {'Content-Type':'application/json'})
resp = urllib.request.urlopen(req, timeout=10)
sid = resp.headers.get('Mcp-Session-Id','')

# 2. Export screenshot
body = json.dumps({'jsonrpc':'2.0','method':'tools/call','params':{'name':'export_node_as_image','arguments':{'nodeId':'<ROOT_ID>','format':'PNG','scale':1}},'id':2})
req = urllib.request.Request(url, body.encode(), {'Content-Type':'application/json','Mcp-Session-Id':sid})
resp = urllib.request.urlopen(req, timeout=30)
data = json.loads(resp.read())

# 3. Save image
for part in data.get('result',{}).get('content',[]):
    if part.get('type') == 'image':
        img = base64.b64decode(part['data'])
        with open('/tmp/qa_screenshot.png','wb') as f:
            f.write(img)
        break
```

저장 후 `Read("/tmp/qa_screenshot.png")`로 이미지를 **직접 눈으로 확인**한 뒤 QA를 수행한다. **스크린샷을 Read로 열어보지 않고 QA를 통과시키는 것은 금지.**

### 빌드 중간 QA (단계별 스크린샷 필수)
디자인은 **한 번에 완벽하게 끝나지 않는다.** 빌드 직후 반드시 스크린샷을 찍고 문제를 즉시 수정해야 한다.

**필수 스크린샷 시점:**
1. **`batch_build_screen` 직후** — 빌드 결과를 스크린샷으로 확인. 레이아웃 깨짐, 텍스트 잘림, 아이콘 미표시, 색상 오류 등 즉시 수정
2. **후처리(Tab Bar absolute, FILL 사이징, 아이콘 색상 등) 적용 후** — 후처리가 올바르게 적용되었는지 스크린샷 확인
3. **이미지 생성 및 적용 후** — Gemini 이미지가 올바른 노드에 올바른 크기로 적용되었는지 확인
4. **수정 작업 후 매번** — 어떤 수정이든 적용 후 반드시 스크린샷으로 결과 검증

**스크린샷 촬영 → Read로 확인 → 문제 발견 → 수정 → 다시 촬영** 사이클을 반복한다. Read로 이미지를 열어보지 않은 QA는 무효.

**중간 QA 체크 항목:**
- 아이콘이 실제로 보이는가? (프레임만 있고 빈 상태가 아닌가?)
- 아이콘/텍스트가 배경 대비 보이는가? (명도 대비 4:1 이상)
- 텍스트가 잘리지 않는가?
- 섹션 너비가 화면 전체(393px)를 채우는가?
- Auto Layout이 의도대로 동작하는가? (HUG vs FILL)

**규칙: 스크린샷 없이 다음 단계로 넘어가지 말 것.** 눈으로 확인하지 않은 변경은 문제를 누적시킨다.

### 완료 전 필수 QA (스크린샷 체크리스트)
디자인 생성/수정 후 "확인해주세요"를 말하기 전 **반드시 스크린샷을 찍고 아래 6개 항목을 하나씩 확인**:

1. **모든 full-width 요소는 width=393** — NavBar, TabBar, 섹션 프레임 등 루트 직접 자식은 반드시 화면 폭과 동일 (393px)
2. **텍스트 가시성** — 모든 텍스트가 배경 대비 읽히는지 확인. 특히 컬러 배경 위 버튼 텍스트는 **명시적으로 fontColor 설정**
3. **최소 폰트 12px** — 9px, 10px 등 사용 금지. 예외: 탭 라벨/FAB 라벨은 최소 11px 허용
4. **PRD 1:1 매핑** — PRD에 명시된 모든 UI 요소가 화면에 존재하는지 항목별 체크. 하나라도 빠지면 실패
5. **아이콘/북마크 시각적 확인** — 프레임만 만들고 끝내지 말 것. 반드시 아이콘이 렌더링되는지 스크린샷으로 확인. `_fallback: true` 프레임 없어야 함
6. **이미지 필요 영역** — placeholder 프레임(빈 사각형)을 남기지 말 것. Gemini 이미지 생성 또는 DS 아이콘으로 반드시 채울 것
7. **자식 프레임 불필요 fill 없음** — 부모에 배경색이 있는 카드/섹션 내부 레이아웃 프레임(Top, Tags, Title Group)에 흰색 fill이 있으면 실패
8. **아이콘-텍스트 간격 확인** — 리스트 아이템, 탭 등에서 아이콘과 텍스트가 붙어있으면 실패 (최소 12px)
9. **FAB-TabBar 간격 확인** — FAB가 Tab Bar와 붙어있으면 실패 (최소 16px)
10. **Tab Bar 정렬** — 모든 탭 아이템 균등 배분(FILL), 아이콘+라벨 수직 중앙 정렬, 외곽선 없음
11. **SPACE_BETWEEN + FILL 충돌** — HORIZONTAL auto-layout에서 `SPACE_BETWEEN` + 자식 `FILL` 조합이 있으면 실패 (간격이 0이 됨)
12. **텍스트 weight 위계** — 섹션 타이틀이 Bold가 아니거나, 화면 전체가 동일 weight이면 실패. 타이틀→Bold, 핵심 정보→Bold/SemiBold, 보조→Medium, 설명→Regular
13. **섹션 간 간격 균일성 (24px)** — 루트 프레임의 직접 자식 콘텐츠 섹션 간 간격이 **일관되게 24px**인지 `get_nodes_info`로 각 섹션의 y, height를 조회하여 프로그래밍적으로 검증. `gap = next_section.y - (current_section.y + current_section.height)`. 간격이 24px ± 2px 범위를 벗어나면 실패. **겹침(음수 gap)은 절대 금지**. 예외: NavBar↔Ribbon↔Hero는 0px(밀착), FAB↔TabBar는 16px

### 레이아웃 절대 규칙
- **루트 프레임 높이 = 모든 UI가 보이는 높이** — 콘텐츠가 852px(뷰포트)를 초과하면 루트 프레임 height를 늘려서 **모든 UI 요소가 스크린샷에 보이도록** 할 것. 잘리는 콘텐츠 절대 금지
- **TabBar/FAB는 Constraints: Bottom** — 루트 프레임 높이를 늘릴 때 TabBar와 FAB는 항상 루트 프레임 하단에 고정
- 루트 프레임 자식 중 가로 전체를 차지하는 프레임: **반드시 width=393, x=0**
- Auto Layout 자식: **set_layout_sizing(horizontal: "FILL")** 적용
- 버튼/태그 텍스트: 배경색과 텍스트 색상 대비 반드시 확인 후 명시적 color 설정
- 프레임 안에 아이콘이 있으면 아이콘이 보이는 크기인지 확인 (최소 16×16)

### 디자인 완료 후 워크플로우 (순서대로 실행)
QA 체크리스트 통과 후, 아래 단계를 **순서대로** 진행:

1. **히어로/배너 그래픽 생성 확인** — 히어로 섹션이나 배너에 그래픽·일러스트가 필요한 경우 사용자에게 물어본다: "히어로 섹션에 그래픽 이미지를 생성할까요?" → 사용자가 허락하면 Gemini로 생성, 거부하면 패스
2. **DS 변수 바인딩 확인** — "디자인 시스템 변수 바인딩을 진행할까요?" → 사용자가 허락하면 바인딩 수행 (Text Style → Typography → Radius → Color 순서), 거부하면 패스
3. **최종 전달** — "확인해주세요"로 전달

### 완료 판단 기준 (QA 2회 필수 — 스크린샷 실물 확인)
- "완료"라고 말하면 **절대 안 됨** — 항상 "확인해주세요"로 전달
- **QA는 반드시 2회(2 pass) 수행** — 매 pass마다 스크린샷을 MCP HTTP로 저장 → `Read`로 이미지를 직접 열어서 확인 → 체크리스트 항목별 서술형 확인
- 1회차 QA에서 발견된 문제 수정 → 2회차 QA 스크린샷 촬영 + `Read`로 열어서 재확인. 2회차도 통과해야만 사용자에게 전달
- **스크린샷을 `Read`로 열어보지 않고 "통과"라고 하는 것은 절대 금지** — 프로그래밍적 치수 확인만으로는 부족, 반드시 시각적 확인 필수
- 하나라도 실패하면 수정 후 다시 스크린샷 → `Read` → 재확인 (2회 통과할 때까지 반복)
- 체크리스트 전체 통과 × 2회 후에만 사용자에게 전달

---

## AI 이미지 생성 (Gemini API)

디자인에 일러스트, 배너 그래픽, 아이콘 이미지 등이 필요한 경우 **반드시 Gemini API (나노바나나프로 모델)** 를 사용한다.

### 파이프라인
```
Gemini API (나노바나나프로) → 로컬 저장 (assets/generated/) → rembg 배경 제거 → HTTP 서버 (localhost:18765) → Figma set_image_fill
```

### 사용법
- **API Key**: Settings UI에서 설정 (앱 헤더 기어 아이콘 → Gemini API Key 입력)
- **모델**: `nano-banana-pro-preview` ← 반드시 이 모델 사용 (실제 작동 확인)
- **API Header**: `X-goog-api-key` 헤더로 키 전달 (Authorization Bearer 방식 아님)
- **저장 경로**: `assets/generated/` 디렉토리에 PNG로 저장
- **배경 제거**: rembg Python 라이브러리 사용 (`python3 -c "from rembg import remove; ..."`)
- **HTTP 서버**: `python3 -m http.server 18765` 로 로컬 서빙 → Figma가 localhost URL로 이미지 다운로드
- **Figma 적용**: `set_image_fill(nodeId, url: "http://localhost:18765/assets/generated/xxx.png", scaleMode: "FILL")`

### 그래픽 스타일 기본값 (소프트 매트 3D)
- **기본 렌더링**: `Cinema4D, Octane render, soft diffused studio lighting, front view, orthographic view`
- **기본 뷰**: 사용자가 view에 대한 다른 요구사항이 없으면 항상 **front view** 적용
- **기본 질감 = 소프트 매트 (NOT glossy)** — 광택 없는 부드러운 매트/클레이 질감이 기본. glossy/shiny는 명시적 요청 시에만 사용
- **3D 그래픽 스타일 핵심 특징** (Gemini 프롬프트에 반영):
  - **질감**: soft matte material with very subtle sheen, like matte clay or soft rubber — 광택 반사(specular highlight) 최소화, 매끄럽지만 반사 없는 표면
  - **오브젝트**: 단순하고 상징적인 형태, 서비스 컨셉과 직결되는 명확한 객체 (동전, 지갑, 로켓 등)
  - **배경**: 투명 또는 단색 (solid white), 디스트랙션 최소화
  - **색감**: 파스텔 톤 기반, 밝고 산뜻한 톤, 따뜻하고 친근한 느낌. 강한 명암 대비 금지
  - **조명**: 매우 부드럽고 고른 디퓨즈드 조명 (diffused studio lighting), 강한 그림자 없음, subtle pastel-tinted rim light만 허용
  - **분위기**: 차갑고 딱딱한 느낌을 따뜻하고 친근하게 전환, 토이 같은 느낌
- **Gemini 프롬프트 필수 키워드**: `"Soft matte material with very subtle sheen, NOT glossy, NOT shiny. Like matte clay or soft rubber texture. Soft diffused studio lighting, NO harsh shadows, NO strong contrast. Cinema4D Octane render, soft even illumination, matte finish. Single centered object, pure white background, no ground shadow."`
- 모든 Gemini 이미지 프롬프트에 위 스타일 키워드를 기본으로 포함할 것
- 사용자가 별도 스타일을 지정한 경우에만 기본 스타일 대신 해당 스타일 적용

### 규칙 (자동 적용 필수)
- 디자인 작업 중 일러스트, 배너 그래픽, 히어로 이미지, 썸네일 등 커스텀 그래픽이 필요한 상황이 오면 **사용자가 별도로 요청하지 않아도 자동으로 이 파이프라인을 실행**한다
- 텍스트/아이콘으로 대체하거나 placeholder rectangle을 남기는 것 금지
- 프롬프트는 영어로 작성, 배경 투명 필요 시 rembg 실행, 필요 없으면 raw 이미지 바로 사용
- rembg는 `rembg` CLI 명령어가 없을 수 있으므로 Python API로 직접 호출할 것:
  ```python
  from rembg import remove
  output = remove(open("input.png","rb").read())
  open("output.png","wb").write(output)
  ```

---

## 멀티에이전트 디자인 모드

> 전체 프로토콜: [`src/multi-agent-design-SKILL.md`](src/multi-agent-design-SKILL.md)
> QA 체크리스트: [`src/QA_CHECKLIST.md`](src/QA_CHECKLIST.md)

### 발동 조건 (2개 이상 충족 시)
- 화면 섹션 **3개 이상**
- 커스텀 이미지/그래픽 **1개 이상**
- 아이콘 삽입 **5개 이상**
- DS 변수 바인딩 대상 **20개 노드 이상**

### 에이전트 구성
| Agent | 역할 | 실행 Wave |
|-------|------|-----------|
| Orchestrator | 계획 수립, 루트 프레임 생성, 이미지 머지, Fix 루프 | 전체 |
| **Agent A** (구조빌드) | 섹션 프레임, 컴포넌트 인스턴스, 텍스트 | Wave 1 ‖ |
| **Agent B** (Gemini이미지) | nano-banana-pro-preview 이미지 생성, 로컬 저장 | Wave 1 ‖ |
| **Agent C** (DS토큰) | Text Style + Typography + Radius + Color 변수 바인딩 | Wave 2 ‖ |
| **Agent D** (아이콘) | ds-1-icons.json → clone_node → insert_child | Wave 2 ‖ |
| **QA Agent** | CLAUDE.md 10개 항목 체크, fixInstructions 생성 | Wave 3 |

### 실행 순서
```
Orchestrator: 플랜 수립 + 루트 프레임
   ↓ 동시 실행
[Task(Agent A)] ‖ [Task(Agent B)]   ← Wave 1
   ↓ Orchestrator: 이미지 적용 (set_image_fill)
[Task(Agent C)] ‖ [Task(Agent D)]   ← Wave 2
   ↓
[Task(QA Agent)]                    ← QA
   ↓ 실패 시 Fix (최대 2회)
완료
```

### 핵심 규칙
- **Task 병렬 호출**: Wave 1과 Wave 2에서 두 Task를 **단일 메시지**에 동시 포함
- **채널 공유**: 모든 Agent가 `join_channel(channel)` 후 동일 Figma 문서 접근
- **Output JSON**: 각 Agent는 반드시 구조화된 JSON으로 응답 (nodeId 포함)
- **Fix 루프**: QA 실패 시 Orchestrator가 직접 수정, 최대 2회 반복

---

## Pencil → Figma 보내기 ("figma로 보내줘")

사용자가 "figma로 보내줘", "figma로 보내", "피그마로 보내" 등을 말하면:

**전제 조건**: Figma Design Agent 앱이 실행 중이고 Figma 플러그인과 연결된 상태

**방식**: LLM 중재 — Pencil 스크린샷(시각) + JSX(구조)를 보고 LLM이 `batch_build_screen` blueprint를 직접 생성

**워크플로우** (5단계, 자동 실행):
1. **Pencil 현재 상태 읽기**: `mcp__pencil-mcp__get_editor_state()` → 현재 선택된 노드/아트보드 ID
2. **시각 + 구조 수집** (동시 호출):
   - `mcp__pencil-mcp__get_screenshot({ nodeId, scale: 2 })` → 시각적 레이아웃/색상/아이콘
   - `mcp__pencil-mcp__get_jsx({ nodeId, format: "inline-styles" })` → 텍스트/색상값/padding
3. **Blueprint 생성**: LLM이 스크린샷 + JSX 분석 → `batch_build_screen` blueprint 직접 생성
4. **Figma 빌드**: `mcp__figma-tools__batch_build_screen({ blueprint })` → 한 번에 전체 화면 생성
5. **결과 비교 QA**: 빌드 결과 스크린샷과 원본 Pencil 스크린샷 비교 검증

**참고**:
- `convert_pen_to_figma` 사용 금지 (deprecated) — 런타임에서 차단됨
- DS-1 컴포넌트 활용 + 아이콘 시맨틱 매핑 (Pencil 아이콘 → DS-1 아이콘)
- `figma-tools` MCP 서버는 Electron 앱의 HTTP MCP (port 8769) — 앱 실행 필요

## Pencil → Figma Blueprint 생성 규칙

> `batch_build_screen` blueprint를 LLM이 생성할 때 반드시 적용하는 규칙. 이 규칙을 무시하면 레이아웃이 깨짐.

### 폰트 규칙
- Figma에서 한글 텍스트는 **반드시 Pretendard** 사용 — DM Sans, Bricolage Grotesque 등 Latin 전용 폰트는 한글 글리프가 없어 텍스트가 렌더링되지 않음
- Pencil 원본이 DM Sans/Bricolage Grotesque를 사용해도 Figma blueprint에서는 **전부 Pretendard로 대체**
- fontWeight 매핑: 400→Regular, 500→Medium, 600→SemiBold, 700→Bold, 800→ExtraBold

### Auto Layout 사이징 규칙 (code.js 자동 적용)
- Auto-layout 프레임에 **명시적 width/height가 없으면 → HUG** (콘텐츠에 맞춤)
- Auto-layout 프레임에 **명시적 width/height가 있으면 → FIXED** (지정 크기 유지)
- Blueprint에서 카드/섹션 등 콘텐츠 래퍼는 height를 생략하여 HUG 자동 적용

### 텍스트 FILL 사이징 규칙 (code.js 자동 적용)
- 텍스트 노드의 자동 FILL은 **VERTICAL 부모에서만** 적용
- HORIZONTAL 부모에서 텍스트에 FILL을 적용하면 텍스트들이 폭을 경쟁하여 **글자가 세로로 1자씩 줄바꿈**되는 버그 발생
- HORIZONTAL 부모 내 텍스트가 공간을 채워야 할 경우, **텍스트를 감싸는 부모 프레임**에 layoutSizingHorizontal: "FILL"을 설정

### 텍스트 정렬 규칙
- **FILL 너비 텍스트는 textAlignHorizontal 명시 필수**
- 탭 라벨, 버튼 라벨 등 중앙에 위치해야 하는 텍스트: **textAlignHorizontal: "CENTER"**
- counterAxisAlignItems: "CENTER" 부모 내의 FILL 너비 텍스트: **textAlignHorizontal: "CENTER"**

### 아이콘 래퍼 프레임 규칙
- 아이콘을 감싸는 프레임(배경색 있는 아이콘 박스)은 **정사각형 또는 의도된 비율**이어야 함
- 아이콘 래퍼 프레임: **명시적 width/height를 동일하게 설정** (예: 48×48, 56×56)
- 래퍼 프레임에 width/height를 생략하면 HUG가 적용되어 아이콘 크기(24)에만 맞춰져 패딩 없는 찌그러진 프레임이 됨

### 탭바/네비게이션 스타일 규칙
- 탭 바 필(pill) 배경: **흰색(#FFFFFF) + 회색 보더(#F3F4F6, 1px, inside)** — 회색 배경이 아님
- 각 탭 프레임: layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL" (균등 분배)
- 탭 라벨: fontSize 10, textAlignHorizontal: "CENTER"

### FAB + 탭바 절대 위치 규칙 (하단 고정 요소)
- **Tab Bar와 FAB는 반드시 `layoutPositioning: "ABSOLUTE"`로 하단 고정**
- Tab Bar: `constraints: { horizontal: "STRETCH", vertical: "MAX" }`, x: 0, y: (rootHeight - tabBarHeight)
- FAB: `constraints: { horizontal: "STRETCH", vertical: "MAX" }`, Tab Bar보다 위에 위치
- Content 프레임: `layoutSizingVertical: "FILL"` — 헤더와 하단 고정 요소 사이 남은 공간 채움

### FAB 구조
- FAB는 **HORIZONTAL** auto-layout, **HUG×HUG**, padding `12/12/20/20`, `itemSpacing: 8`, `cornerRadius: 28`
- 자식은 아이콘(24×24) + 텍스트 — 중간 래퍼 프레임 금지

### Blueprint 구조 패턴 (모바일 풀스크린)
```
Root (VERTICAL, FIXED 393×852)
├── Status Bar (FILL × FIXED 62)
├── Header (FILL × HUG, padding [12, 24])
├── Content (FILL × FILL ← 남은 공간 채움, padding [4, 24, 0, 24], gap 22)
│   ├── Card (FILL × HUG, cornerRadius, padding, gap)
│   ├── Section (FILL × HUG, gap 12)
│   │   ├── SectionHeader (FILL × HUG, SPACE_BETWEEN)
│   │   └── SectionList (FILL × HUG, VERTICAL, gap 8)
│   └── ...
├── FAB (ABSOLUTE, FILL × FIXED 56, y = 하단에서 tabBar 위)
└── Tab Bar (ABSOLUTE, FILL × FIXED 95, padding [12, 21, 21, 21])
```

### 색상 형식 규칙
- batch_build_screen blueprint에서 색상은 **`$token(토큰이름)`** 또는 **{r, g, b, a} 형식 (0–1 범위)**
- **DS 토큰 컬러 → `$token()` 참조 필수**: `"$token(bg-brand-solid)"`, `"$token(fg-primary)"` 등. `figma_mcp_client.py build`가 TOKEN_MAP.json에서 최신 hex → RGBA로 자동 변환
- **직접 RGBA는 기본색만 허용**: 흰색 `{r:1,g:1,b:1,a:1}`, 검정, 투명 등
- **CTA/강조 색상은 반드시 `$token(bg-brand-solid)` 사용**

### 색상 대비 최소 4:1 (WCAG AA)
- 모든 텍스트·아이콘은 배경 대비 **최소 4:1** 비율 필수
- 짙은 배경(brand-section 등)에 검정 아이콘/텍스트 금지 → 반드시 흰색(#FFF) 사용
- 연한 배경(brand-primary 등)에는 fg-brand-primary 이상의 대비 사용

### VERTICAL 카드형 레이아웃 텍스트 중앙 정렬
- 아이콘 + 텍스트 라벨이 세로로 쌓이는 카드에서 텍스트 라벨은 `textAlignHorizontal: "CENTER"` 필수

### 토글형 아이콘 active 상태 = solid(filled)
- bookmark, heart, star, bell 등 토글 가능한 아이콘은 **active 상태일 때 fill을 채워서 solid로 표현** 필수
- active: `set_stroke_color` + `set_fill_color` 동일 색상 적용 — `DESIGN_TOKENS.md`의 `fg-brand-primary` 토큰 조회 후 사용
- inactive: `set_stroke_color`만 회색(`{r:0.816, g:0.835, b:0.867}`), fill 없음 (outline만)
- @untitledui/icons는 stroke 기반이라 별도 solid 파일이 없음 → fill 색상으로 solid 효과 구현

### Badge/Tag는 반드시 HUG
- Badge, Tag, Chip 등 라벨 컨테이너는 **반드시 `layoutSizingHorizontal: "HUG"`** — FILL 금지
- auto-layout 부모 안에서 FILL이 되면 전체 너비로 늘어나서 디자인이 깨짐
- 예: 이벤트 배지, 포인트 태그, 카테고리 칩 등

### 이미지 fill scaleMode 규칙
- **히어로/배너 배경**: `scaleMode: "FILL"` (프레임 전체를 채움)
- **아이콘/그래픽/일러스트**: `scaleMode: "FIT"` (프레임 안에 맞춤, 잘림 없음)
- 이미지를 프레임에 채울 때 기본은 **FIT** — FILL은 히어로/배너만

### 카드형 CTA는 아이콘 대신 그래픽 이미지
- 랜덤박스, 기프트샵, 계산기 등 **카드형 CTA에서 핵심 비주얼이 하나인 경우** → 아이콘 대신 생성 이미지 사용
- UI 기능 표시(탭 바, 리스트 아이템, 네비게이션 등) → 아이콘 사용
- 이미지 생성 후 해당 프레임 내 아이콘 노드가 남아있으면 **반드시 삭제** (이미지를 가림)
- **그래픽 이미지가 들어가는 프레임의 cornerRadius는 반드시 0** — radius가 있으면 이미지가 잘림

### 히어로 이미지 생성 규칙
- `generate_image`에서 `isHero: true`는 **반드시 Banner Card 프레임**에 적용 — Section 프레임 아님
- Banner Card 높이는 항상 200px 고정 — MIN_HERO_SIZE 우회 불필요
- `isHero: false`는 배경 제거 모드 — 히어로/배너에 절대 사용 금지

### 히어로 배너 섹션 상단 여백
- Hero Banner Section은 `paddingTop: 20` 필수 — 위 요소와 배너 카드 사이에 시각적 간격 확보

### 소요시간 트래킹 (필수)
- 사용자가 "피그마로 보내줘"를 말한 시점부터 **시작 시각 기록**
- 최종 완료(QA 통과) 시점에서 **종료 시각 기록**
- 완료 보고 시 반드시 **총 소요시간**을 함께 표시

---

## Plugin & Build

- Plugin code: `src/claude_mcp_plugin/code.js` (plain JS, Figma sandbox — no optional chaining `?.`)
- MCP server: TypeScript, built by `tsup` via `npm run build`
- `npm run build` → dist/ (CJS + ESM)
- `npm run build:dxt` → .dxt extension for Claude Desktop → `dxt/` 폴더에 버전 번호 포함 복사

### Git Commit & Push 규칙
- 사용자가 커밋+푸시를 요청하면 **반드시 `npm run build:dxt` 실행 후** 커밋
- 순서: `build:dxt` → git add → git commit → git push

## Python HTTP MCP 클라이언트 (디자인 생성/수정/바인딩)

MCP 도구 호출이 불안정할 때(세션 끊김, 파라미터 매핑 버그) **Python HTTP 클라이언트**를 사용.
스크립트: `scripts/figma_mcp_client.py`

### 사용법
```bash
# 세션 초기화 (필수 — 첫 실행 시)
python3 scripts/figma_mcp_client.py init

# 디자인 생성 (blueprint JSON 파일)
python3 scripts/figma_mcp_client.py build <blueprint.json>

# DS 변수 바인딩 (bindings JSON 파일)
python3 scripts/figma_mcp_client.py bind <bindings.json>

# 텍스트 스타일 바인딩
python3 scripts/figma_mcp_client.py bind-text-styles <styles.json>

# 단일 도구 호출
python3 scripts/figma_mcp_client.py call <tool_name> '<args_json>'

# 인터랙티브 모드
python3 scripts/figma_mcp_client.py interactive
```

### 언제 Python HTTP를 사용하는가
| 작업 | MCP 도구 | Python HTTP | 권장 |
|------|---------|-------------|------|
| 단건 조회/수정 | ✅ 빠름 | ✅ | MCP 도구 |
| 디자인 생성 (batch_build_screen) | ⚠️ 세션 끊김 빈번 | ✅ 안정적 | **Python** |
| DS 변수 바인딩 (대량) | ❌ 파라미터 버그 | ✅ 262건+ 검증 | **Python** |
| 텍스트 스타일 바인딩 | ❌ 파라미터 버그 | ✅ 183건+ 검증 | **Python** |

### Blueprint JSON 규칙
- `scripts/` 폴더에 blueprint JSON 저장 → 재사용 가능
- blueprint 내 `layoutPositioning: "ABSOLUTE"` + `constraints`는 batch_build_screen에서 미적용 → 빌드 후 `set_layout_positioning` 별도 호출 필요
- 텍스트 노드 width=0 버그: `textAutoResize: "WIDTH_AND_HEIGHT"` 재설정 후 `layoutSizingHorizontal: "FILL"` 적용으로 해결
- 프레임 fill 판단: 자식이 있는 layout 프레임은 fill 숨김(투명), 카드/배너 등 배경이 필요한 프레임만 fill 적용

### 디자인 생성 → 후속 수정 흐름 (Python)
```bash
# Step 1: Blueprint JSON 작성 → 빌드
python3 scripts/figma_mcp_client.py build scripts/my_blueprint.json

# Step 2: 후속 수정 (absolute positioning, text fix 등)
python3 scripts/figma_mcp_client.py call set_layout_positioning '{"nodeId":"X","positioning":"ABSOLUTE","constraints":{"horizontal":"STRETCH","vertical":"MAX"}}'
python3 scripts/figma_mcp_client.py call set_text_properties '{"nodeId":"Y","textAutoResize":"WIDTH_AND_HEIGHT"}'
python3 scripts/figma_mcp_client.py call set_layout_sizing '{"nodeId":"Y","horizontal":"FILL"}'

# Step 3: DS 변수 바인딩
python3 scripts/figma_mcp_client.py bind scripts/my_bindings.json

# Step 4: 스크린샷 QA
python3 scripts/figma_mcp_client.py call export_node_as_image '{"nodeId":"ROOT_ID","format":"PNG","scale":1}'
```

## 알려진 이슈
- DesignPreview 컴포넌트 참조되지만 미구현
- 테스트 없음 (단위/통합)
- Figma 도구 호출 캐싱 없음
