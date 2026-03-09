# 디자인 생성 시간 최적화 (26분→8분)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 디자인 빌드 시간을 26분에서 8분으로 단축 — 버그 2개 수정 + 섹션 템플릿 시스템 도입

**Architecture:** figma_mcp_client.py의 imageGen 빈 dict 검사 버그와 post-fix 안전장치 부재를 수정하고, 반복률 95%+ 섹션 5개(NavBar, TabBar, FAB, Hero, Ribbon)의 Blueprint 템플릿을 JSON으로 정의하여 Claude의 JSON 작성 시간을 대폭 단축한다.

**Tech Stack:** Python 3, JSON

---

## Task 1: imageGen 빈 dict 검사 버그 수정

**Files:**
- Modify: `scripts/figma_mcp_client.py:511`

**문제:** `node_map`이 빈 dict `{}`일 때 `if node_map`이 False → 백그라운드 이미지 생성 cancel
**수정:** `if pre_gen_future and node_map is not None:` + nodeMap 디버그 로깅 강화

```python
# Line 511: 기존
if pre_gen_future and node_map:

# Line 511: 수정
if pre_gen_future and node_map is not None:
```

추가로 Line 491의 로깅도 수정:
```python
# 기존
if node_map:

# 수정
if node_map is not None:
    print(f"  nodeMap keys: {len(node_map)}")
    if len(node_map) == 0:
        print(f"  ⚠️ nodeMap이 비어있음 — 이미지 적용 시 이름 매칭 불가")
```

---

## Task 2: post-fix 안전장치 추가

**Files:**
- Modify: `scripts/figma_mcp_client.py:1180-1228` (cmd_post_fix)
- Modify: `scripts/figma_mcp_client.py:1066-1083` (_fix_layout_and_positions)

**문제:** _collect_tree가 자식 0개 반환 시 root_height = 0 + 24 = 24px로 파괴
**수정:**

1. `cmd_post_fix`에 early return 추가:
```python
# Line 1196-1197 이후 추가
if children_count == 0:
    print(f"  ⚠️ 직계 자식이 0개 — 데이터 수집 실패. post-fix 중단 (루트 보호)")
    return
```

2. `_fix_layout_and_positions`에 최소 높이 검증:
```python
# Line 1066-1083 수정
original_height = tree.get("height") or tree.get("absoluteBoundingBox", {}).get("height", 0)

if tab_bar:
    root_height = tab_y + 73
elif fab:
    root_height = fab_y + 44 + 24
else:
    root_height = content_bottom + 24

# 안전장치: 계산 높이가 원본의 50% 미만이면 파괴 방지
if original_height > 0 and root_height < original_height * 0.5:
    print(f"  ⚠️ 높이 급감 감지: {original_height} → {root_height}. 원본 유지.")
    root_height = original_height
```

---

## Task 3: 섹션 템플릿 JSON 생성

**Files:**
- Create: `scripts/blueprint_templates.json`

5개 고정 섹션(NavBar, TabBar, FAB, Hero Section, Transaction Ribbon) 템플릿 정의.
각 템플릿에 `_variables` 필드로 교체 가능한 변수 표시.

---

## Task 4: 템플릿 조립 함수 구현

**Files:**
- Modify: `scripts/figma_mcp_client.py` (새 함수 추가)

`cmd_template` 명령 추가:
```bash
python3 scripts/figma_mcp_client.py template <template_config.json>
```

template_config.json 예시:
```json
{
  "rootName": "My Screen",
  "width": 393,
  "sections": ["NavBar", "Ribbon", "Hero", "custom...", "FAB", "TabBar"],
  "variables": {
    "NavBar": {},
    "Ribbon": {"text": "누적 거래 5,000,000건"},
    "Hero": {
      "banners": [
        {"title": "이벤트 1", "imagePrompt": "3D coins..."},
        {"title": "이벤트 2", "imagePrompt": "3D gifts..."}
      ]
    },
    "FAB": {"label": "마이 월렛", "icon": "wallet-02"},
    "TabBar": {}
  },
  "customSections": [...]
}
```

함수가 템플릿을 조립하여 완전한 Blueprint JSON 생성 → build 실행.
