# QA Checklist — CLAUDE.md 규칙 기반

> QA Agent가 Figma 화면 검토 시 반드시 사용하는 체크리스트.
> 멀티에이전트 파이프라인의 Phase 3에서 실행됨.

---

## 검사 방법

```
join_channel(channel)
get_node_info(rootFrameId) → 루트 검사
각 섹션 노드 → get_node_info(sectionId)
텍스트 노드 샘플링 → get_node_info(textNodeId)
```

---

## 10개 필수 체크 항목

### ① 루트 프레임 구조
| 항목 | 기준 | 검사 방법 |
|------|------|-----------|
| 크기 | 393 × 852px | `node.width === 393 && node.height === 852` |
| Auto Layout 없음 | `layoutMode === "NONE"` | `node.layoutMode` |
| 이름 | 화면명 일치 | `node.name` |

**실패 예시:** `layoutMode: "VERTICAL"` → 루트에 Auto Layout이 걸린 경우

---

### ② NavBar
| 항목 | 기준 | 검사 방법 |
|------|------|-----------|
| Y 좌표 | `y === 0` | `node.y` |
| 높이 | `height === 88` | `node.height` |
| 배경색 | fills 존재 (투명 금지) | `node.fills.length > 0 && fills[0].opacity > 0` |
| 내용 정렬 | `counterAxisAlignItems === "MAX"` (bottom) | `node.counterAxisAlignItems` |
| paddingBottom | `paddingBottom === 16` | `node.paddingBottom` |

**실패 예시:** height=44 (status bar만), y=44 (status bar 아래부터 시작)

---

### ③ 첫 콘텐츠 섹션 위치
| 항목 | 기준 |
|------|------|
| Y 좌표 | `y === 88` (NavBar 바로 아래, gap 없음) |

**실패 예시:** y=100 (12px gap이 생긴 경우)

---

### ④ 섹션 간 간격
| 항목 | 기준 |
|------|------|
| 섹션 간격 | 연속 섹션 간 `nextSection.y - (prevSection.y + prevSection.height) === 8` |

**실패 예시:** gap=0 (붙어있음), gap=16 (너무 큰 간격)

---

### ⑤ 하위 프레임 Auto Layout
| 항목 | 기준 |
|------|------|
| 루트 직속 자식 프레임 | `layoutMode === "HORIZONTAL" or "VERTICAL"` |
| 중첩 프레임 | 마찬가지로 NONE 금지 (group 제외) |

**예외:** 루트 프레임 자체는 NONE이 맞음

**실패 예시:** 섹션 내부 Row 프레임에 layoutMode=NONE

---

### ⑥ Pretendard 폰트
| 항목 | 기준 |
|------|------|
| 모든 텍스트 노드 | `fontFamily === "Pretendard"` |

**실패 예시:** fontFamily=Inter, fontFamily=SF Pro, fontFamily=Noto Sans

> 검사 방법: scan_text_nodes(rootFrameId) 후 fontFamily 필드 확인

---

### ⑦ 아이콘 텍스트 기호 없음
| 항목 | 기준 |
|------|------|
| 텍스트 노드 내용 | `→`, `←`, `×`, `+`, `✓`, `▶`, `•` 등 단독 기호 금지 |
| 아이콘 용도 텍스트 | 반드시 컴포넌트 인스턴스로 대체 |

**실패 예시:** `characters: "→"` 인 TEXT 노드 발견

> 검사 방법: scan_text_nodes로 characters가 단일 기호인 노드 탐지

---

### ⑧ 커스텀 Hex 색상 없음
| 항목 | 기준 |
|------|------|
| fills | DS 변수 바인딩 (`boundVariables.fills` 존재) |
| strokes | DS 변수 바인딩 (`boundVariables.strokes` 존재) |
| 하드코딩 hex | 금지 (단, 이미지 fill은 예외) |

**실패 예시:** fills에 `{r:1, g:0.5, b:0.2}` 하드코딩, boundVariables 없음

> 검사 방법: get_bound_variables(nodeId)로 바인딩 존재 여부 확인

---

### ⑨ 이미지 Fill 적용
| 항목 | 기준 |
|------|------|
| 이미지가 필요한 섹션 | `fills[0].type === "IMAGE"` |
| Placeholder 사각형 | 이미지로 교체됨 (단색 fill 잔존 금지) |

**실패 예시:** hero 섹션에 fills=[{type:"SOLID", color:#F0F0F0}] — placeholder 그대로

---

### ⑩ DS 변수 바인딩 (핵심)
| 항목 | 기준 |
|------|------|
| 주요 텍스트 노드 | `boundVariables.fontSize` 존재 |
| 배경 프레임 | `boundVariables.fills` 존재 |
| 카드/버튼 | `boundVariables.topLeftRadius` 등 존재 |

> 검사 방법: get_bound_variables(sampleNodeId) 호출로 샘플 확인

---

## 출력 형식

```json
{
  "agent": "QA",
  "passed": false,
  "score": "8/10",
  "checklist": {
    "rootFrame":        { "pass": true,  "note": "" },
    "navBar":           { "pass": false, "note": "height=60, 기준=88" },
    "sectionY":         { "pass": true,  "note": "" },
    "sectionGap":       { "pass": true,  "note": "" },
    "autoLayout":       { "pass": true,  "note": "" },
    "pretendardFont":   { "pass": false, "note": "노드 74:1234 — fontFamily=Inter" },
    "noTextIcons":      { "pass": true,  "note": "" },
    "noCustomHex":      { "pass": true,  "note": "" },
    "imageFill":        { "pass": true,  "note": "" },
    "variableBinding":  { "pass": true,  "note": "" }
  },
  "failedItems": ["navBar", "pretendardFont"],
  "fixInstructions": [
    "NavBar height 수정: resize_node('navbarNodeId', 393, 88)",
    "폰트 수정: set_font_name('74:1234', 'Pretendard', 'Regular')"
  ]
}
```

---

## 통과 기준

| 점수 | 판정 |
|------|------|
| 10/10 | ✅ 완전 통과 — Fix 불필요 |
| 8–9/10 | ⚠️ 경미한 수정 — Fix 1회 |
| 5–7/10 | 🔶 보통 수정 — Fix 최대 2회 |
| 4/10 이하 | ❌ 구조적 문제 — 사용자에게 보고 |

---

## 자주 발생하는 실패 패턴

| 항목 | 원인 | Fix |
|------|------|-----|
| NavBar height=44 | status bar 포함 안 함 | resize_node(navbarId, 393, 88) |
| 첫 섹션 y=100 | 12px gap 추가됨 | move_node(sectionId, 0, 88) |
| fontFamily=Inter | 기본 폰트 사용 | load_font_async("Pretendard") + set_font_name |
| fills 하드코딩 | Agent C 바인딩 누락 | set_bound_variables + fills/0 |
| 아이콘 텍스트 "→" | Agent D 미처리 | delete_node + clone_node + insert_child |
