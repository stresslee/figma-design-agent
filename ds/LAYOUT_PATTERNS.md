# Auto Layout 디자인 패턴 라이브러리

> PRD-to-Figma 스킬에서 참조하는 노드 구조 패턴 모음.
> 모든 프레임은 Auto Layout으로 생성하며, 절대좌표(x, y) 사용 금지.

---

## layoutSizing 결정 기준

| 요소 | horizontal | vertical | 설명 |
|------|-----------|----------|------|
| 콘텐츠 영역, 카드 | FILL | HUG 또는 FILL | 부모 너비에 맞춤 |
| 인풋, 버튼 (form) | FILL | HUG | 전체 너비 사용 |
| 텍스트 | FILL | HUG | 너비에 맞춰 줄바꿈 |
| 아바타, 아이콘 | FIXED | FIXED | 고정 크기 |
| 사이드바 | FIXED (240~296px) | FILL | 고정 너비, 높이 채움 |
| 구분선 (divider) | FILL | FIXED (1px) | 전체 너비 |
| 같은 Row 내 카드들 | FILL | **FILL** | 가장 높은 카드에 맞춰 높이 통일 |

**HUG vs FILL 주의사항:**
- Root가 HUG 높이일 때, Content(본문 영역)도 **HUG vertical**로 설정해야 한다
- Content를 FILL vertical로 하면 고정 높이가 되어 **하단 콘텐츠가 잘린다** (clipContent)
- 사이드바처럼 높이를 채워야 하는 경우만 FILL vertical 사용
- Root가 FIXED 높이(예: 960px)일 때만 Content에 FILL vertical 가능

---

## 페이지 레이아웃 패턴

### 패턴: Dashboard

**핵심: Section → Container 2중 구조 + DS 인스턴스 최대 활용**

```
Root (H, padding: 0, FIXED 1440×960)
├── Sidebar navigation (INSTANCE, FIXED 296, FILL height)
└── Main (V, FILL, padding: 0)
    ├── Header section (V, FILL width)
    │   └── Container (V, FILL width, padding: 32/0)
    │       ├── Page header (INSTANCE, FILL width)
    │       └── Tabs and filters (H, FILL width)
    │           ├── Button group (INSTANCE) ← 기간 필터
    │           └── Actions (H)
    │               ├── Date picker dropdown (INSTANCE)
    │               └── Buttons/Button (INSTANCE, "Filters")
    ├── Section (V, FILL width) ← 차트 섹션
    │   └── Container (V, FILL width, padding: 32/0)
    │       ├── Heading and chart (H, 808px)
    │       │   ├── Heading and number (V) ← 직접 구성
    │       │   └── Line and bar chart (INSTANCE)
    │       └── Metrics (V, 240px)
    │           └── 3× Heading and number (직접 구성)
    └── Section (V, FILL width) ← 콘텐츠 섹션
        └── Container (V, FILL width, padding: 32/0)
            ├── Section header (INSTANCE)
            └── Content (H, FILL)
                ├── Section (V, 808px)
                │   ├── CTAs (H) ← CTA 카드 2개
                │   │   └── CTA (frame, Featured icon INSTANCE + 텍스트)
                │   └── Posts (V)
                │       ├── Section header (INSTANCE)
                │       └── 2× Blog post card (INSTANCE)
                └── Content (V, 240px) ← 사이드 패널
                    ├── Heading "Top members"
                    └── Activity feed (_Feed item base INSTANCE)
```

**808:240 비율 패턴**: 메인 콘텐츠(808px)와 사이드 패널(240px)을 반복 사용
**Section → Container**: 모든 섹션에 동일 구조로 일관된 padding 확보

### 패턴: Form / Auth

```
Root (V, CENTER both axes, padding: 80/40, FIXED 480×900)
└── FormCard (V, FILL width, HUG height, padding: 40/32, itemSpacing: 20, cornerRadius: 16)
    ├── Title (text, HUG)
    ├── InputField (instance, FILL width)
    ├── InputField (instance, FILL width)
    ├── Button (instance, FILL width)
    ├── Divider (instance, FILL width)
    └── SocialButtons (instance, FILL width)
```

### 패턴: Landing Page

```
Root (V, padding: 0, counterAxis: CENTER, FIXED 1440)
├── HeaderNav (instance, FILL width)
├── HeroSection (instance, FILL width)
├── FeaturesSection (instance, FILL width)
├── TestimonialSection (instance, FILL width)
├── CTASection (instance, FILL width)
└── Footer (instance, FILL width)
```

### 패턴: Card Grid

```
Container (V, FILL, padding: 24, itemSpacing: 16)
└── Row (H, FILL width, HUG height, itemSpacing: 16, layoutWrap: "WRAP")
    ├── Card (V, FIXED width 320, HUG height, padding: 24, cornerRadius: 12)
    ├── Card (V, FIXED width 320, HUG height, padding: 24, cornerRadius: 12)
    └── Card (V, FIXED width 320, HUG height, padding: 24, cornerRadius: 12)
```

### 패턴: Data List (Table Page)

**핵심: Column 기반 테이블 + DS Table cell 인스턴스 활용 (70개+ 인스턴스)**

```
Root (H, padding: 0, FIXED 1440×960)
├── Sidebar navigation (INSTANCE, FIXED 296, FILL height)
└── Main (V, FILL, padding: 0)
    ├── Header section (V, FILL width)
    │   └── Container (V, FILL width, padding: 32/0)
    │       ├── Page header (INSTANCE, FILL width)
    │       │   └── Actions (H) ← 여러 Buttons/Button INSTANCE
    │       └── Horizontal tabs (INSTANCE, FILL width)
    │           └── 6~10× _Tab button base (각각 Badge 카운트 포함)
    ├── Section (V, FILL width) ← 메트릭
    │   └── Container (V, FILL width, padding: 32/0)
    │       └── Metric group (H, itemSpacing: 24)
    │           └── 3× Metric item (INSTANCE, FILL width, 196px height, 미니차트 포함)
    └── Section (V, FILL width) ← 테이블
        └── Container (V, FILL width, padding: 32/0)
            └── Table (V, fill #fdfdfd, stroke #e9eaeb, r=12)
                ├── Card header (INSTANCE) ← 테이블 제목
                ├── Filters bar (H)
                │   ├── Button group (INSTANCE) ← 필터 탭
                │   └── Actions (H)
                │       ├── Select (INSTANCE) ← 드롭다운 필터
                │       └── Buttons/Button (INSTANCE) ← "Filters" 버튼
                ├── Content (H, 6× Column FRAME)
                │   ├── Column 1 (FILL) ← Checkbox + Name
                │   │   ├── Table header cell (INSTANCE)
                │   │   └── 7× Table cell (INSTANCE, Checkbox + Text)
                │   ├── Column 2 (FIXED ~117px) ← Status
                │   │   ├── Table header cell (INSTANCE)
                │   │   └── 7× Table cell (INSTANCE, Text)
                │   ├── Column 3 (FIXED ~115px) ← Role
                │   │   ├── Table header cell (INSTANCE)
                │   │   └── 7× Table cell (INSTANCE, Text)
                │   ├── Column 4 (FILL) ← Progress
                │   │   ├── Table header cell (INSTANCE)
                │   │   └── 7× Table cell (INSTANCE, Progress bar)
                │   ├── Column 5 (FIXED ~117px) ← Status Badge
                │   │   ├── Table header cell (INSTANCE)
                │   │   └── 7× Table cell (INSTANCE, Badge)
                │   └── Column 6 (FIXED ~90px) ← Actions
                │       ├── Table header cell (INSTANCE, empty)
                │       └── 7× Table cell (INSTANCE, 4× Button utility)
                └── Pagination (INSTANCE) ← 하단 페이지네이션
```

**테이블 Column 구성 패턴:**

| Column 유형 | sizing | 셀 내용 | 인스턴스 |
|------------|--------|---------|---------|
| Name (주) | FILL | Checkbox + Avatar + Text | Table cell + Checkbox |
| Text data | FIXED (~115px) | 텍스트 값 | Table cell |
| Progress | FILL | 프로그레스 바 | Table cell + Progress bar |
| Status | FIXED (~117px) | 상태 뱃지 | Table cell + Badge |
| Actions | FIXED (~90px) | 버튼 그룹 | Table cell + Button utility ×4 |

**핵심 차이 (vs Dashboard):**
- Horizontal tabs (INSTANCE) 사용 — 각 탭에 Badge 카운트 포함
- Metric item 다른 variant (344×196, 미니차트 포함, fill `#fdfdfd`)
- Column 기반 테이블 — Row가 아닌 Column FRAME으로 구성
- Table 전용 인스턴스 집중 활용 (Table cell, Table header cell, Pagination)
- Filters bar — Button group + Select + Button 조합

---

## 컴포넌트 조합 패턴

### CTA 카드

```
CTA (frame, fill #ffffff, stroke #e9eaeb, cornerRadius 12, H auto layout, padding 24, itemSpacing 16)
├── Featured icon (INSTANCE, 48×48, stroke #d5d7da, radius 10)
└── Text and supporting text (V, itemSpacing 4)
    ├── Text (14px, Medium, #414651) "Create your first member"
    └── Supporting text (14px, Regular, #535862) "Add yourself or import..."
```

### 인스턴스 래핑 (padding/cornerRadius 없는 인스턴스 보정)

**적용 조건:**
- 같은 Row에 padding/stroke/cornerRadius가 있는 카드와 없는 인스턴스가 혼재
- 인스턴스 자체를 수정할 수 없으므로 외부 래퍼로 스타일 통일

**절차:**
1. 페이지 레벨에 래퍼 프레임 생성 (`create_frame` + fill `#ffffff` + stroke `#e9eaeb`)
2. `set_auto_layout` (VERTICAL) + `set_corner_radius` (12)
3. 인스턴스를 래퍼 안으로 `insert_child`
4. 래퍼를 원래 부모에 `insert_child` (index로 위치 지정)
5. 인스턴스의 `set_layout_sizing` → FILL (horizontal, vertical)
6. `set_bound_variables`로 토큰 바인딩: cornerRadius → `radius-xl`, padding → `spacing-3xl`

**예시:**
```
ChartsRow (H, FILL)
├── ChartCard (V, auto layout, fill, stroke, radius-xl, padding spacing-3xl)  ← 래퍼
│   └── Line and bar chart (INSTANCE, FILL × FILL)
└── RightCards (V, auto layout)
    ├── ConversionCard (자체 fill/stroke/radius)
    └── RevenueCard (자체 fill/stroke/radius)
```

---

## 커스텀 UI 패턴

> DS 컴포넌트만으로 표현할 수 없는 UI는 frame, rectangle, ellipse, text, auto layout 조합으로 직접 디자인한다.

### 커스텀 차트

**라인 차트:**
```
Chart Area (frame, 배경색 fcfcfd, cornerRadius 8)
├── Y축 레이블 (text: "3K", "2K", "1K", "0")
├── Grid Lines (rectangle: width=차트폭, height=1, 색상 e9eaeb) × 4
├── Data Points (ellipse: 8×8, 브랜드 컬러) × 데이터 수
├── X축 레이블 (text: "Mon", "Tue", ...)
└── (선택) 연결 선은 생략 — dot만으로 충분히 차트 느낌 전달
```

**바 차트:**
```
Chart Area (frame)
├── Y축 레이블 (text)
├── Grid Lines (rectangle) × N
├── Bars (rectangle: cornerRadius 상단만, 브랜드 컬러, 높이=값 비례) × 데이터 수
└── X축 레이블 (text)
```

**팁:** Grid line 균일 배치, Data point는 grid 기준 Y 계산, 브랜드 컬러(#7f56d9) 사용

### 커스텀 탭 & 세그먼트 컨트롤

```
Tab Container (frame, 배경색 f2f3f5, cornerRadius 8, H auto layout, padding 4, itemSpacing 4)
├── Tab Item - 비활성 (frame, 배경 ffffff, cornerRadius 6, padding 8/12)
│   └── Text (13px, Medium, 색상 535862)
├── Tab Item - 활성 (frame, 배경 7f56d9, cornerRadius 6, padding 8/12)
│   └── Text (13px, SemiBold, 색상 ffffff)
└── Tab Item - 비활성 (frame, 배경 ffffff, cornerRadius 6, padding 8/12)
    └── Text (13px, Medium, 색상 535862)
```

상태 구분: 활성(배경 #7f56d9, 텍스트 흰색, 600) / 비활성(배경 #ffffff, 텍스트 #535862, 500)

### 커스텀 리스트

```
List Item (frame, H auto layout, itemSpacing 12, counterAxisAlign CENTER)
├── Avatar (ellipse 36×36, IMAGE fill)
├── Info (frame, V auto layout, itemSpacing 2)
│   ├── Name (text 14px, Medium, 색상 181d27)
│   └── Subtitle (text 12px, Regular, 색상 717680)
└── Badge/Rank (text 14px, Bold, 우측 정렬)
```

### 커스텀 테이블

```
Table (frame, V auto layout, itemSpacing 0)
├── Header Row (frame, H auto layout)
│   ├── Column Title (text 13px, SemiBold, 색상 717680)
│   └── Column Title (text 13px, SemiBold, 색상 717680, 우측 정렬)
├── Divider (rectangle, height 1, 색상 e9eaeb)
├── Data Row (frame, H auto layout, itemSpacing 0, padding vertical 8)
│   ├── 🇺🇸 United States (text 14px, Regular)
│   └── 3,847 (text 14px, SemiBold, 우측 정렬)
└── ... (반복)
```

**이모지 활용:**
- 국기: 🇺🇸 🇰🇷 🇯🇵 🇬🇧 🇩🇪 🇨🇦 🇫🇷 🇦🇺 🇧🇷 🇮🇳
- 상태: ✅ ❌ ⚠️ 🔴 🟢 🟡
- 카테고리: 📊 📈 👤 🌍

### Popover / Dropdown 메뉴

```
Popover Menu (frame, V auto layout, padding 4~8px, gap 2px)
  fill: white, stroke: #e9eaeb, cornerRadius: 8
  effects: DROP_SHADOW ×2 (subtle + spread)
  ⚠️ absolute positioning 필수 (insert_child absolute: true)
├── Menu item (frame, H auto layout, padding 8×10, cornerRadius 6, layoutSizing H:FILL)
│   └── Label (text 14px, Medium, #333843)
├── Divider (rectangle, height 1, fill #e9eaeb, layoutSizing H:FILL)
└── Menu item (frame, H auto layout, padding 8×10, cornerRadius 6, layoutSizing H:FILL)
    └── Label (text 14px, Medium, #333843)
```

**핵심 포인트:**
- `insert_child(parentId, childId, absolute: true)` → auto layout 프레임 안에서 절대 위치 배치
- 위치 계산: 트리거 버튼의 absolute 좌표에서 부모 프레임의 absolute 좌표를 빼서 상대 좌표 산출
- 메뉴 항목/구분선은 모두 `layoutSizing horizontal: FILL` → popover 너비에 맞춤
- 호버 상태: 메뉴 항목 fill을 #f9fafb로 변경
- shadow: `{y:4, radius:6, spread:-2, alpha:0.08}` + `{y:12, radius:16, spread:-4, alpha:0.16}`

---

## 프레임 Fill 판단 기준

| 프레임 유형 | Fill 필요 여부 | 판단 근거 |
|------------|---------------|----------|
| **레이아웃 컨테이너** (Row, Column, Grid) | ❌ 불필요 | 자식이 전부 INSTANCE이고 각자 fill/stroke/cornerRadius 보유 |
| **콘텐츠 카드** | ✅ 필요 | 자체 배경+테두리+라운드로 시각적 영역 구분 |
| **페이지 배경** (Root, Content) | ✅ 필요 | 전체 배경색 설정 (bg-primary, bg-secondary 등) |
| **섹션 래퍼** | ❌ 불필요 | 자식 카드/인스턴스가 이미 개별 배경 보유 |
| **오버레이/모달** | ✅ 필요 | 반투명 배경 또는 별도 배경색 필요 |

**핵심 규칙**: 자식 인스턴스가 자체 fill을 가지고 있으면, 부모 컨테이너 프레임의 fill은 **투명(alpha=0) 또는 제거**한다.

---

## 이미지 소스 & 활용

### 이미지 소스별 용도

| 용도 | 소스 | 검색 키워드 예시 |
|------|------|-----------------|
| 아바타/인물 사진 | Unsplash | `professional headshot portrait` |
| 도형/벡터 이미지 (지도, 아이콘, 일러스트) | Freepik, pngimg.com | `minimal world map flat gray` |
| 풍경/오브젝트 사진 | Unsplash | `office workspace`, `nature landscape` |

### 검증된 지도 이미지

- ✅ 인포그래픽용 블루그레이 (2400×1190): `https://pngimg.com/uploads/world_map/world_map_PNG14.png`
- ❌ PNG7: 나무 질감/빈티지 — 대시보드 부적합
- ❌ PNG18: 짙은 초록 — 대시보드 부적합

### 이미지 검색 주의사항

- Unsplash: 사람, 풍경, 오브젝트 등 고품질 무료 **사진**만
- Freepik: 벡터, 일러스트, 플랫 디자인 등 **도형 이미지**
- ⚠️ Unsplash에서 지도/벡터 이미지를 검색하지 말 것 (사진 스타일만 제공)

---

## 커스텀 UI 판단 기준

| 상황 | 접근 방법 |
|------|----------|
| DS에 해당 컴포넌트 있음 | ✅ 인스턴스 사용 (clone_node 우선 → create_component_instance) |
| DS에 없지만 단순한 UI | ✅ frame + text + shape 조합 |
| 실제 이미지가 필요 | ✅ shape에 IMAGE fill + 웹 검색 |
| 차트/그래프 필요 | ✅ rectangle(grid) + ellipse(dot) + text(label) |
| 탭/세그먼트 필요 | ✅ frame + cornerRadius + 색상 상태 구분 |
| 지도 + 위치 표시 | ✅ frame(IMAGE fill 지도) + ellipse(dot 좌표) |
