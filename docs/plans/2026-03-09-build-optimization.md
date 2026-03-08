# 디자인 생성 시간 최적화 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 디자인 생성 전체 시간을 25분 → 12-15분으로 단축 (후처리 자동화 + 이미지 병렬 생성)

**Architecture:** `figma_mcp_client.py`에 `post-fix` 명령 추가 — rootNodeId 하나만 받아서 FILL 사이징, Tab Bar/FAB ABSOLUTE 배치, 섹션 간격 0, zero-width 텍스트 수정, 루트 프레임 크기 조정을 한 번에 실행. 이미지 생성은 CLAUDE.md에 병렬 실행 가이드라인 추가.

**Tech Stack:** Python 3 (figma_mcp_client.py), MCP HTTP API (localhost:8769)

---

### Task 1: `post-fix` 명령 — 노드 트리 수집 함수

**Files:**
- Modify: `scripts/figma_mcp_client.py`

**Step 1: `_collect_tree` 헬퍼 함수 작성**

`get_node_info`를 재귀적으로 호출하여 rootId부터 전체 노드 트리를 수집하는 함수.
후속 단계에서 트리를 분석하여 수정 대상을 한번에 파악.

```python
def _collect_tree(node_id: str, depth: int = 0) -> dict:
    """get_node_info로 노드 트리 수집 (최대 depth 3)."""
    content = call_tool("get_node_info", {"nodeId": node_id})
    result = parse_content(content)
    node = result["json"] or {}
    node["_depth"] = depth

    if depth < 3:
        children_info = []
        for child in node.get("children", []):
            child_id = child.get("id")
            if child_id:
                child_full = _collect_tree(child_id, depth + 1)
                children_info.append(child_full)
        node["_children_full"] = children_info

    return node
```

`cmd_build` 함수 바로 아래 (line ~484), `cmd_bind` 함수 위에 추가.

**Step 2: 실행 테스트**

Run: `python3 scripts/figma_mcp_client.py call get_node_info '{"nodeId":"85:1488"}'`
Expected: 노드 정보 JSON 출력 (기존 기능 동작 확인)

---

### Task 2: `post-fix` 명령 — FILL 사이징 자동 수정

**Files:**
- Modify: `scripts/figma_mcp_client.py`

**Step 1: `_fix_fill_sizing` 함수 작성**

트리에서 FRAME 타입이면서 `layoutSizingHorizontal`이 FILL이 아닌 노드를 찾아 일괄 수정.
아이콘, 태그 등 고정 크기 요소(width ≤ 60)와 Banner Card(캐로셀 내 FIXED)는 제외.

```python
def _fix_fill_sizing(tree: dict) -> int:
    """FRAME 자식 노드 중 HUG/FIXED → FILL로 수정. 수정 건수 반환."""
    fixes = 0
    skip_names = ("icon", "Icon", "chevron", "dot", "Dot", "Tag", "Badge", "Indicator", "Nav Right", "Vector")

    def _walk(node: dict, parent_layout: str = ""):
        nonlocal fixes
        node_type = node.get("type", "")
        node_name = node.get("name", "")
        node_id = node.get("id", "")
        sizing_h = node.get("layoutSizingHorizontal", "")
        width = node.get("width", 999)

        # Skip: non-FRAME, small elements, icon/tag/dot, Banner Cards inside carousel
        is_frame = node_type == "FRAME"
        is_small = width <= 60
        is_skip_name = any(kw in node_name for kw in skip_names)
        is_banner_card = "Banner Card" in node_name
        parent_is_horizontal = parent_layout == "HORIZONTAL"

        if is_frame and not is_small and not is_skip_name and not (is_banner_card and parent_is_horizontal):
            if sizing_h in ("HUG", "FIXED") and node_id:
                try:
                    call_tool("set_layout_sizing", {"nodeId": node_id, "horizontal": "FILL"})
                    fixes += 1
                    print(f"  FILL fix: {node_name} ({node_id})")
                except Exception as e:
                    print(f"  FILL skip: {node_name} ({node_id}) — {e}")

        layout_mode = node.get("layoutMode", "")
        for child in node.get("_children_full", []):
            _walk(child, layout_mode)

    # root 자체는 스킵, root 직계 자식부터 처리
    for child in tree.get("_children_full", []):
        layout_mode = tree.get("layoutMode", "")
        _walk(child, layout_mode)

    return fixes
```

**Step 2: 로컬 테스트용 단독 실행 확인**

이 함수는 Task 5에서 `cmd_post_fix`에 통합됨. 이 단계에서는 함수 작성만.

---

### Task 3: `post-fix` 명령 — Tab Bar/FAB ABSOLUTE 배치 + 섹션 간격 0

**Files:**
- Modify: `scripts/figma_mcp_client.py`

**Step 1: `_fix_tab_bar_fab` 함수 작성**

1. 루트 자식 중 "Tab Bar"와 "FAB" 이름을 가진 노드를 찾음
2. 나머지 콘텐츠 노드의 y+height 최대값 = content_bottom 계산
3. 같은 배경색(fills 없음) 섹션 간 gap을 0으로 조정 (섹션 간 divider 없으면)
4. FAB: y = content_bottom + 24, ABSOLUTE
5. Tab Bar: y = FAB_y + 44 + 16, ABSOLUTE
6. Root height = Tab Bar_y + 73

```python
def _fix_layout_and_positions(tree: dict) -> dict:
    """섹션 간격 0 + Tab Bar/FAB ABSOLUTE 배치. 결과 요약 반환."""
    root_id = tree.get("id", "")
    children = tree.get("_children_full", [])

    # 분류: content vs tab_bar vs fab
    tab_bar = None
    fab = None
    content_nodes = []

    for child in children:
        name = child.get("name", "")
        if "Tab Bar" in name:
            tab_bar = child
        elif "FAB" in name:
            fab = child
        else:
            content_nodes.append(child)

    # 섹션 간격 재계산: 배경 동일 + divider 없으면 gap 0
    if content_nodes:
        # 첫 노드는 그대로, 이후 노드는 이전 bottom에 붙임
        prev_bottom = content_nodes[0]["y"] + content_nodes[0].get("height", 0)

        for i in range(1, len(content_nodes)):
            node = content_nodes[i]
            prev = content_nodes[i - 1]

            # 배경색 비교: fills 없으면 투명(white)
            prev_has_fill = bool([f for f in prev.get("fills", []) if f.get("visible", True)])
            curr_has_fill = bool([f for f in node.get("fills", []) if f.get("visible", True)])

            # 둘 다 투명이면 gap 0
            if not prev_has_fill and not curr_has_fill:
                new_y = prev_bottom
            else:
                new_y = prev_bottom  # 다른 색도 일단 0 (사이에 리본 같은 색 경계가 있으므로)

            if node["y"] != new_y:
                try:
                    call_tool("move_node", {"nodeId": node["id"], "x": node["x"], "y": new_y})
                    print(f"  Move: {node['name']} y={node['y']}→{new_y}")
                    node["y"] = new_y
                except Exception as e:
                    print(f"  Move skip: {node['name']} — {e}")

            prev_bottom = node["y"] + node.get("height", 0)

        content_bottom = prev_bottom
    else:
        content_bottom = 0

    # FAB 배치
    fab_y = content_bottom + 24
    if fab:
        try:
            call_tool("set_layout_positioning", {"nodeId": fab["id"], "positioning": "ABSOLUTE"})
        except Exception:
            pass
        call_tool("move_node", {"nodeId": fab["id"], "x": 253, "y": fab_y})
        print(f"  FAB: y={fab_y}, ABSOLUTE")

    # Tab Bar 배치
    tab_y = fab_y + 44 + 16 if fab else content_bottom + 24
    if tab_bar:
        try:
            call_tool("set_layout_positioning", {"nodeId": tab_bar["id"], "positioning": "ABSOLUTE"})
        except Exception:
            pass
        call_tool("move_node", {"nodeId": tab_bar["id"], "x": 0, "y": tab_y})
        print(f"  Tab Bar: y={tab_y}, ABSOLUTE")

    # Root 높이 조정
    root_height = tab_y + 73 if tab_bar else fab_y + 44
    call_tool("resize_node", {"nodeId": root_id, "width": 393, "height": root_height})
    print(f"  Root height: {root_height}")

    return {"content_bottom": content_bottom, "fab_y": fab_y, "tab_y": tab_y, "root_height": root_height}
```

---

### Task 4: `post-fix` 명령 — zero-width 텍스트 수정

**Files:**
- Modify: `scripts/figma_mcp_client.py`

**Step 1: `_fix_zero_width_text` 함수 작성**

트리에서 TEXT 타입이면서 width=0인 노드를 찾아 `textAutoResize: WIDTH_AND_HEIGHT` → `layoutSizingHorizontal: FILL` 적용.

```python
def _fix_zero_width_text(tree: dict) -> int:
    """width=0 TEXT 노드 수정. 수정 건수 반환."""
    fixes = 0

    def _walk(node: dict):
        nonlocal fixes
        if node.get("type") == "TEXT" and node.get("width", 1) == 0:
            node_id = node.get("id", "")
            if node_id:
                try:
                    call_tool("set_text_properties", {"nodeId": node_id, "textAutoResize": "WIDTH_AND_HEIGHT"})
                    call_tool("set_layout_sizing", {"nodeId": node_id, "horizontal": "FILL"})
                    fixes += 1
                    print(f"  Text fix: {node.get('name', '?')} ({node_id})")
                except Exception as e:
                    print(f"  Text skip: {node.get('name', '?')} — {e}")

        for child in node.get("_children_full", []):
            _walk(child)

    _walk(tree)
    return fixes
```

---

### Task 5: `post-fix` 명령 — 메인 함수 통합 + CLI 등록

**Files:**
- Modify: `scripts/figma_mcp_client.py`

**Step 1: `cmd_post_fix` 함수 작성**

Task 1-4의 함수를 순서대로 호출하는 통합 함수.

```python
def cmd_post_fix(root_node_id: str):
    """빌드 후 자동 후처리: FILL 사이징 + Tab Bar/FAB 배치 + 섹션 간격 + 텍스트 수정."""
    ensure_session()

    print(f"\n{'='*50}")
    print(f"POST-FIX 자동 후처리 시작: {root_node_id}")
    print(f"{'='*50}")
    start = time.time()

    # Step 1: 노드 트리 수집
    print("\n[1/4] 노드 트리 수집...")
    tree = _collect_tree(root_node_id)
    child_count = len(tree.get("_children_full", []))
    print(f"  루트 '{tree.get('name', '?')}' — {child_count} 직계 자식")

    # Step 2: FILL 사이징 수정
    print("\n[2/4] FILL 사이징 검증/수정...")
    fill_fixes = _fix_fill_sizing(tree)
    print(f"  {fill_fixes}건 수정됨")

    # Step 3: 섹션 간격 + Tab Bar/FAB 배치
    print("\n[3/4] 섹션 간격 + Tab Bar/FAB 배치...")
    layout_result = _fix_layout_and_positions(tree)

    # Step 4: zero-width 텍스트 수정
    print("\n[4/4] zero-width 텍스트 수정...")
    text_fixes = _fix_zero_width_text(tree)
    print(f"  {text_fixes}건 수정됨")

    elapsed = time.time() - start
    print(f"\n{'='*50}")
    print(f"POST-FIX 완료 ({elapsed:.1f}s)")
    print(f"  FILL 수정: {fill_fixes}건")
    print(f"  텍스트 수정: {text_fixes}건")
    print(f"  루트 높이: {layout_result['root_height']}px")
    print(f"{'='*50}\n")
```

**Step 2: CLI 등록 — `main()` 함수에 `post-fix` 명령 추가**

```python
    elif cmd == "post-fix":
        if len(sys.argv) < 3:
            print("Usage: figma_mcp_client.py post-fix <rootNodeId>")
            sys.exit(1)
        cmd_post_fix(sys.argv[2])
```

**Step 3: 실행 테스트**

Run: `python3 scripts/figma_mcp_client.py post-fix 85:1488`
Expected: 4단계 후처리 실행 후 결과 요약 출력

**Step 4: Commit**

```bash
git add scripts/figma_mcp_client.py
git commit -m "feat: add post-fix command for automated post-build fixes"
```

---

### Task 6: `cmd_build`에 `post-fix` 자동 연결

**Files:**
- Modify: `scripts/figma_mcp_client.py`

**Step 1: `cmd_build` 완료 후 자동으로 `cmd_post_fix` 호출**

`cmd_build` 함수의 POST-BUILD 리마인더 출력 직후, rootId가 있으면 자동으로 `cmd_post_fix(root_id)` 호출.

기존 코드 (line ~474-482):
```python
    # Post-build reminders for recurring issues
    print(f"\n{'='*50}")
    print("⚠️  POST-BUILD 필수 작업 (반복 위반 방지):")
    ...
    print(f"{'='*50}\n")
```

변경:
```python
    # Auto post-fix
    if root_id:
        print("\n🔧 자동 후처리 실행 중...")
        cmd_post_fix(root_id)
    else:
        print("⚠️  rootId를 찾을 수 없어 post-fix를 건너뜁니다.")
```

**Step 2: 실행 테스트**

기존 `build` 명령 실행 시 빌드 완료 후 자동으로 post-fix가 실행되는지 확인.

**Step 3: Commit**

```bash
git add scripts/figma_mcp_client.py
git commit -m "feat: auto-run post-fix after build completion"
```

---

### Task 7: 문서 업데이트 — CLAUDE.md + python-mcp-client.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/python-mcp-client.md`

**Step 1: `docs/python-mcp-client.md`에 post-fix 사용법 추가**

```markdown
# 빌드 후 자동 후처리 (post-fix)
python3 scripts/figma_mcp_client.py post-fix <rootNodeId>
```

디자인 생성 → 후속 수정 흐름에서 Step 2(후속 수정)를 `post-fix` 한 줄로 대체.

**Step 2: `CLAUDE.md` 빌드 후 체크리스트에 post-fix 참조 추가**

빌드 후 필수 검증 체크리스트 섹션에:
```
빌드 후 `python3 scripts/figma_mcp_client.py post-fix <rootNodeId>` 실행하면 위 항목을 자동 수정.
```

**Step 3: `CLAUDE.md`에 이미지 병렬 생성 가이드라인 추가**

디자인 생성 필수 규칙 하단에:
```markdown
### 13. 이미지 생성 병렬화 (필수 — 빌드 시간 단축)
- 디자인에 Gemini 이미지가 필요한 경우, **빌드와 이미지 생성을 병렬로 실행**
- **방법**: `build` 실행과 동시에 Agent 도구 `run_in_background: true`로 이미지 생성 에이전트 실행
- **순서**: Blueprint 작성 → [빌드 + 이미지 생성 병렬] → 빌드 완료 → post-fix → 이미지 적용(set_image_fill) → QA
- **주의**: 이미지가 들어갈 프레임의 nodeId는 빌드 결과 `nodeMap`에서 확인 후 적용
```

**Step 4: Commit**

```bash
git add CLAUDE.md docs/python-mcp-client.md
git commit -m "docs: add post-fix usage and image parallelization guideline"
```

---

## 예상 시간 단축 효과

| Before | After | 절감 |
|--------|-------|------|
| 후처리 (FILL, Tab Bar, FAB, 간격, 텍스트): ~4분 | post-fix 자동 실행: ~30초 | **3.5분** |
| 이미지 생성 (순차 11개): ~6분 | 빌드와 병렬: ~0분 (빌드 시간에 숨김) | **~5분** |
| QA 수정 반복: ~5분 | post-fix가 사전 수정: ~2분 | **~3분** |
| **총 25분** | **~13-14분** | **~11분 절감** |
