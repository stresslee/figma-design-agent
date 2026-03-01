# Claude Talk to Figma MCP

## Design System Architecture

### Current DS: DS-1

| 파일 | 역할 | 생성 방법 |
|------|------|-----------|
| [`src/DS_PROFILE.md`](src/DS_PROFILE.md) | Variant Key, Suffix Map, 속성명, 아이콘 소스 | `generate-ds-profile` 스크립트 |
| [`src/DESIGN_TOKENS.md`](src/DESIGN_TOKENS.md) | 색상 hex, spacing px, radius px, typography, **Text Styles key/ID (44)**, **Effect Styles key/ID (24)** | `generate-ds-profile` 스크립트 (REST API `/files/:key/styles` + 변수) |
| `ds-1-icons.json` | icon name → componentId 매핑 (1141개) | MCP `scan_instances_for_swap` |

DS 교체 시 위 3개 파일만 교체하면 됨. 아이콘 파일은 DS별로 분리: `ds-1-icons.json`, `ds-2-icons.json` 등.

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
# REST API에서 자동 추출: components, component_sets, styles, variables
npm run generate-ds-profile -- "<figma-file-url>" \
  --token <token> --name "DS-2" --exclude-icons \
  --variables-json /path/to/variables.json
# → DS_PROFILE.md: 컴포넌트 Variant Key Index
# → DESIGN_TOKENS.md: 변수 + Text Styles (44) + Effect Styles (24) 자동 생성

# Step 2: 아이콘 매핑 생성 (DS 파일에서 플러그인 실행 후)
# MCP: scan_instances_for_swap → ds-2-icons.json 저장

# Step 3: 수동 보완 (MCP 도구로 탐색)
# - DS_PROFILE §2: INSTANCE_SWAP 패턴 → get_instance_properties
# - DS_PROFILE §3: Text Node Suffix Map → scan_text_nodes
# - DS_PROFILE §4: Button Instance Properties → get_instance_properties
```

변수 JSON은 MCP 플러그인으로 추출 (REST API는 `file_variables:read` 스코프 필요):
- Figma에서 DS 파일 열기 → 플러그인 실행 → 채널 연결
- `get_local_variables(includeLibrary: true)` → JSON 저장 → `--variables-json`에 전달

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

REST API 엔드포인트 사용:
  /files/:key?depth=1       → 파일 이름, 구조
  /files/:key/components    → 컴포넌트 Variant Key
  /files/:key/component_sets → 컴포넌트 세트
  /files/:key/styles        → Text Styles, Fill Styles, Effect Styles (key + node_id)
  /files/:key/variables/local → 변수 (file_variables:read 스코프 필요)
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

## Design Rules

### Root Frame
- 루트 프레임(스크린)은 **Auto Layout을 사용하지 않는다** — 자식 요소는 절대 좌표로 배치
- `batch_build_screen` 사용 시에도 루트에 `autoLayout` 설정 금지
- **내용이 길어질 경우 루트 프레임 height를 미리 충분히 늘려서** UI 생성 및 배치 — 콘텐츠가 프레임 밖으로 잘리지 않도록 사전에 여유 확보 후, 완성 후 적절히 조정

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

### Icons
- 기호(+, ×, ✓, 화살표 등)는 **절대 텍스트로 처리하지 않는다** — 반드시 `ds-1-icons.json`에서 해당 아이콘을 찾아 인스턴스로 삽입
- 아이콘 삽입 방법: icons 페이지에서 해당 아이콘 노드를 `clone_node` → 부모에 `insert_child` → `set_selection_colors`로 색상 적용 → `resize_node`로 크기 조정

### Graphics & Illustrations (Gemini 이미지 생성)
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
  - API Key: `AIzaSyDkXdVjlrTXDDIoHvO-VNp9fUul7UDfy4E`
  - 응답: `candidates[0].content.parts[].inlineData.data` (base64 PNG)
- **3x 해상도 필수:** 모든 그래픽 이미지는 **Figma 노드 사이즈의 3배**로 생성 후, 원래 크기의 노드에 `FILL`로 적용. Figma가 자동으로 축소하여 고해상도 렌더링. 예: 36×36 노드 → 108×108 이미지 생성, 361×180 배너 → 1083×540 이미지 생성
- **크기 맞추기:** Gemini 출력 비율이 타겟과 다를 수 있음 → PIL로 center-crop 후 `img.resize((W*3, H*3), Image.LANCZOS)` 적용 (3x 해상도)
- **스타일 레퍼런스:** 이전에 생성한 이미지를 `inlineData`로 같이 전달하면 스타일 일관성 유지 가능
- **기본 그래픽 스타일:** `Cinema4D, Octane render, studio lighting, front view, orthographic view` — 사용자가 별도 스타일/뷰를 지정하지 않으면 이 스타일을 기본 적용
- **이미지 사이즈 규칙 (용도별 3단계):**
  - **대형 배너 (히어로, 프로모션 등):** 이미지 사이즈 = 배너 프레임 사이즈 × 3. 텍스트가 좌측에 배치될 경우, Gemini 프롬프트에 "place the 3D object on the **right side** of the image, leave the **left half empty** for text overlay"를 포함하여 그래픽을 우측에 생성. 예: 361×180 배너 → **1083×540** 이미지 생성
  - **중형 카드 그래픽 (랜덤박스, 기프트샵 등):** Figma 노드 36×36px → 이미지 **108×108px**로 생성. Gemini 출력 후 PIL로 투명 영역 trim → `108×108`로 리사이즈. 투명 배경 필수 (rembg 적용)
    ```python
    from PIL import Image
    img = Image.open("raw.png").convert("RGBA")
    bbox = img.getbbox()  # trim transparent area
    img = img.crop(bbox)
    img = img.resize((108, 108), Image.LANCZOS)  # 36 * 3 = 108
    img.save("trimmed.png")
    ```
  - **소형 아이콘 그래픽:** Figma 노드 32×32px → 이미지 **96×96px**로 생성. 동일하게 trim 후 리사이즈. DS 아이콘으로 대체 불가능한 커스텀 일러스트에만 사용

### Text
- 텍스트가 프레임 하단에 위치할 때는 **textAlignVertical을 BOTTOM**으로 설정 — 텍스트가 잘려 보이는 것을 방지
- 텍스트 박스 높이는 **언제나 auto height** 사용 — `set_layout_sizing`의 `vertical: "HUG"` 또는 `textAutoResize: "HEIGHT"` 적용
- 텍스트 줄 수 제한 요청 시 → `textAutoResize: "TRUNCATE"` + `maxLines` 설정 (예: "2줄로 제한" → `maxLines: 2`)
- **줄바꿈은 반드시 `<br>` 마커 사용** — `\n`(Enter/paragraph break)은 Figma에서 단락 간격을 추가하므로 금지. `<br>`은 MCP 서버가 자동으로 U+2028(Shift+Enter/line break)로 변환하여 동일 단락 내 줄바꿈을 생성. `set_text_content`, `batch_execute`, `batch_build_screen` 모두 지원.

### Colors
- **커스텀 컬러 절대 금지** — 모든 색상은 반드시 `DESIGN_TOKENS.md`에 정의된 DS 토큰만 사용
- fill, stroke, text color 모두 DS 변수로 바인딩할 것 — `set_bound_variables`의 `fills/0`, `strokes/0` 필드 사용
- DS에 정확한 색상이 없으면 가장 가까운 토큰으로 대체 (커스텀 hex 값 사용 금지)
- Primitive 색상(Colors/Blue/500 등)은 라이브러리에 퍼블리시되지 않을 수 있음 → Semantic 토큰(Colors/Background/, Colors/Text/ 등) 또는 Component colors(Component colors/Utility/) 사용
- **Color token은 반드시 DS 전용** — `DESIGN_TOKENS.md`의 Semantic/Component 토큰만 사용. 다른 앱(Toss 등) 색상 팔레트나 hex 값을 참고해 직접 적용하는 행위 금지
- **Brand color도 DS 전용** — DS-1의 brand 토큰(`Colors/Background/bg-brand-*`, `Colors/Foreground/fg-brand-*`, `Component colors/Utility/Brand/*` 등)을 그대로 사용. 임의 변형이나 외부 브랜드 색상 대입 금지

### Variable Binding (필수)
- 디자인 생성 완료 후 **반드시 마지막 단계에서 DS 변수 바인딩 수행** — 절대 빠뜨리지 말 것
- 바인딩 순서: ① Text Style (`set_text_style_id`) → ② Typography 변수 (fontSize, lineHeight) → ③ Radius 변수 → ④ Color 변수 (fills/0, strokes/0)
- `set_bound_variables`로 바인딩: fontSize, lineHeight, cornerRadius(topLeftRadius 등), padding, itemSpacing, fills/0, strokes/0
- `set_text_style_id`로 Text Style 바인딩 (Style ID 형식: `S:{key},{nodeId}`)

### Mobile Detail Screen 패턴 (Pencil 비교 분석 기반)
- **핵심 수치 = Inline Horizontal Stat 1행** — 약정금/이율/인원/기간 등 4개 이내 수치는 카드 그리드(2×2) 대신 **한 줄 가로 배치**로 세로 공간 절약. 카드형은 데스크톱/태블릿 전용
- **부제목 필수** — 화면 타이틀 아래 한 줄 설명 텍스트로 맥락 전달 (예: "매월 30만원씩 12개월간 진행하는 스테이지입니다")
- **긴급 알림 배너** — 잔여석, 마감임박 등 FOMO 요소를 경고 배너로 표시 (예: "잔여 4석 | 빠른 참여를 권장합니다")
- **"보기"와 "행동" 섹션 분리** — 참여현황(상태 확인)과 순번선택(사용자 행동)을 별도 섹션으로 분리. 혼합 금지
- **호스트/작성자 프로필 = 탭 가능 카드** — 아바타+이름+뱃지+chevron-right로 내비게이션 어포던스 제공
- **태그에 아이콘 포함** — 텍스트만 있는 태그보다 아이콘+텍스트 조합이 가독성과 스캔성 향상
- **iOS Status Bar 포함 필수** — icons 페이지의 `Status bar` 인스턴스(노드 ID: `96:13667`)를 `clone_node` → NavBar에 `insert_child(index=0)` → `resize_node(393, 원래높이)` + `move_node(0, 0)`으로 삽입. **높이는 원본 컴포넌트의 자연 높이를 유지 (HUG)** — 44px 등 임의 고정값 강제 금지. `set_layout_sizing(horizontal: FILL, vertical: HUG)` 적용. 직접 rectangle/text로 만들지 않고 **반드시 DS 인스턴스 복제**로 삽입할 것
- **섹션 구분 = 여백 우선** — 두꺼운 Divider(8px 배경색) 대신 **여백(16~24px)**과 섹션 타이틀로 구분. Divider는 같은 섹션 내 항목 간 얇은 선(1px)만 사용
- **CTA 버튼에 아이콘 장식** — 주요 행동 버튼에 ✨, ⚡ 등 아이콘을 추가하면 시각적 강조 효과
- **정보 밀도 최적화** — 모바일은 스크롤 최소화가 핵심. 불필요한 패딩/카드 여백을 줄이고 한 화면에 최대한 많은 정보 노출
- **순번/좌석 선택 UI** — 그리드 형태(3~4열)의 원형/라운드 버튼으로 표시. 상태는 3종류: 확정(filled), 선택됨(brand color), 선택 가능(outline). 반드시 범례(Legend) 포함

### Toss App Pattern Reference (src/TOSS_APP_PATTERNS.md)
- **레이아웃·컴포넌트·인터랙션 패턴만 참고** — 화면 구조, 카드 레이아웃, 탐색 흐름, 제스처 등 UX 패턴 적용 가능
- **색상 패턴은 완전 무시** — Toss의 색상 팔레트, 배경색, 텍스트 색, 브랜드 컬러는 참고하지 않음. 색상은 항상 DS-1 토큰 전용
- 참고 가능 항목: 카드 구조, 필터 칩 배치, 정렬 바, FAB 위치, 탭바 구성, 빈 상태 레이아웃, 로딩 패턴, 타이포 계층 구조

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

## 디자인 완료 QA 절대 규칙 (ABSOLUTE RULES)

> 이 규칙은 **모든 디자인 생성 작업**에서 반드시 적용된다. 예외 없음.

### 완료 전 필수 QA (스크린샷 체크리스트)
디자인 생성/수정 후 "확인해주세요"를 말하기 전 **반드시 스크린샷을 찍고 아래 6개 항목을 하나씩 확인**:

1. **모든 full-width 요소는 width=393** — NavBar, TabBar, 섹션 프레임 등 루트 직접 자식은 반드시 화면 폭과 동일 (393px)
2. **텍스트 가시성** — 모든 텍스트가 배경 대비 읽히는지 확인. 특히 컬러 배경 위 버튼 텍스트는 **명시적으로 fontColor 설정**
3. **최소 폰트 12px** — 9px, 10px 등 사용 금지. 예외: 탭 라벨/FAB 라벨은 최소 11px 허용
4. **PRD 1:1 매핑** — PRD에 명시된 모든 UI 요소가 화면에 존재하는지 항목별 체크. 하나라도 빠지면 실패
5. **아이콘/북마크 시각적 확인** — 프레임만 만들고 끝내지 말 것. 반드시 아이콘이 렌더링되는지 스크린샷으로 확인
6. **이미지 필요 영역** — placeholder 프레임(빈 사각형)을 남기지 말 것. Gemini 이미지 생성 또는 DS 아이콘으로 반드시 채울 것

### 레이아웃 절대 규칙
- **루트 프레임 높이 = 모든 UI가 보이는 높이** — 콘텐츠가 852px(뷰포트)를 초과하면 루트 프레임 height를 늘려서 **모든 UI 요소가 스크린샷에 보이도록** 할 것. 잘리는 콘텐츠 절대 금지
- **TabBar/FAB는 Constraints: Bottom** — 루트 프레임 높이를 늘릴 때 TabBar와 FAB는 항상 루트 프레임 하단에 고정. TabBar y = 루트높이 - 74, FAB y = TabBar y - 56 - 16
- 루트 프레임 자식 중 가로 전체를 차지하는 프레임: **반드시 width=393, x=0**
- Auto Layout 자식: **set_layout_sizing(horizontal: "FILL")** 적용
- 버튼/태그 텍스트: 배경색과 텍스트 색상 대비 반드시 확인 후 명시적 color 설정
- 프레임 안에 아이콘이 있으면 아이콘이 보이는 크기인지 확인 (최소 16×16)

### 완료 판단 기준
- "완료"라고 말하면 **절대 안 됨** — 항상 "확인해주세요"로 전달
- 최종 스크린샷을 찍고 위 체크리스트 6개 항목을 하나씩 서술형으로 확인
- 하나라도 실패하면 수정 후 다시 스크린샷 → 재확인
- 체크리스트 전체 통과 후에만 사용자에게 전달

## AI 이미지 생성 (Gemini API)

디자인에 일러스트, 배너 그래픽, 아이콘 이미지 등이 필요한 경우 **반드시 Gemini API (나노바나나프로 모델)** 를 사용한다.

### 파이프라인
```
Gemini API (나노바나나프로) → 로컬 저장 (assets/generated/) → rembg 배경 제거 → HTTP 서버 (localhost:18765) → Figma set_image_fill
```

### 사용법
- **API Key**: `AIzaSyDkXdVjlrTXDDIoHvO-VNp9fUul7UDfy4E`
- **모델**: `nano-banana-pro-preview` ← 반드시 이 모델 사용 (실제 작동 확인)
- **API Header**: `X-goog-api-key` 헤더로 키 전달 (Authorization Bearer 방식 아님)
- **저장 경로**: `assets/generated/` 디렉토리에 PNG로 저장
- **배경 제거**: rembg Python 라이브러리 사용 (`python3 -c "from rembg import remove; ..."`)
- **HTTP 서버**: `python3 -m http.server 18765` 로 로컬 서빙 → Figma가 localhost URL로 이미지 다운로드
- **Figma 적용**: `set_image_fill(nodeId, url: "http://localhost:18765/assets/generated/xxx.png", scaleMode: "FILL")`

### 그래픽 스타일 기본값 (토스 일러스트 스타일 참고)
- **스타일 레퍼런스**: [토스 AI 그래픽 생성기 토스트](https://toss.tech/article/ai-graphic-generator-2)
- **기본 렌더링**: `Cinema4D, Octane render, studio lighting with soft rim light, front view, orthographic view`
- **기본 뷰**: 사용자가 view에 대한 다른 요구사항이 없으면 항상 **front view** 적용
- **토스 그래픽 스타일 핵심 특징** (프롬프트에 반영):
  - **질감**: glossy plastic material, 매끄럽고 광택감 있는 3D 표면, 부드러운 하이라이트와 그림자
  - **오브젝트**: 단순하고 상징적인 형태, 서비스 컨셉과 직결되는 명확한 객체 (동전, 지갑, 로켓 등)
  - **배경**: 투명 또는 단색 (solid white), 디스트랙션 최소화
  - **색감**: 제한된 컬러 팔레트, 밝고 산뜻한 톤, 따뜻하고 친근한 느낌
  - **조명**: 입체감을 주는 선명한 광원, 부드러운 그라데이션, soft rim light
  - **분위기**: 금융의 차갑고 딱딱한 느낌을 따뜻하고 친근하게 전환
- **메인 배너 그래픽**: 토스 일러스트 스타일 **80% 이상 참고** — 배너 히어로 이미지는 토스의 3D 일러스트 톤·질감·구도를 최대한 반영
- 모든 Gemini 이미지 프롬프트에 위 스타일 키워드를 기본으로 포함할 것
- 사용자가 별도 스타일(flat, watercolor, pixel art 등)을 지정한 경우에만 기본 스타일 대신 해당 스타일 적용

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
✅ 완료
```

### 핵심 규칙
- **Task 병렬 호출**: Wave 1과 Wave 2에서 두 Task를 **단일 메시지**에 동시 포함
- **채널 공유**: 모든 Agent가 `join_channel(channel)` 후 동일 Figma 문서 접근
- **Output JSON**: 각 Agent는 반드시 구조화된 JSON으로 응답 (nodeId 포함)
- **Fix 루프**: QA 실패 시 Orchestrator가 직접 수정, 최대 2회 반복

## Plugin & Build

- Plugin code: `src/claude_mcp_plugin/code.js` (plain JS, Figma sandbox — no optional chaining `?.`)
- MCP server: TypeScript, built by `tsup` via `npm run build`
- `npm run build` → dist/ (CJS + ESM)
- `npm run build:dxt` → .dxt extension for Claude Desktop → `dxt/` 폴더에 버전 번호 포함 복사

### Git Commit & Push 규칙
- 사용자가 커밋+푸시를 요청하면 **반드시 `npm run build:dxt` 실행 후** 커밋
- 순서: `build:dxt` → git add → git commit → git push
