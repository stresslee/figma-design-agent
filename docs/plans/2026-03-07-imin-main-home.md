# imin 메인 홈 화면 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PRD 기반 imin 메인 홈 화면을 Figma에 새로 생성한다.

**Architecture:** 기존 `blueprint_imin_home_v2.json`을 기반으로 스테이지 카드를 가로 스크롤로 변경한 새 블루프린트를 작성, `batch_build_screen`으로 빌드 후 후처리 + 이미지 생성 + DS 바인딩.

**Tech Stack:** Figma MCP (batch_build_screen, set_layout_positioning, clone_node 등), Gemini API (이미지 생성), Python HTTP MCP Client

---

### Task 1: DS 토큰 동기화 + 블루프린트 JSON 생성

**Files:**
- Read: `scripts/blueprint_imin_home_v2.json` (기존 블루프린트 참조)
- Read: `ds/DESIGN_TOKENS.md` (brand color 확인)
- Create: `scripts/blueprint_imin_home_v3.json` (새 블루프린트)

**Step 1: DS 토큰 동기화**
```bash
bash scripts/sync-tokens-from-github.sh
```

**Step 2: 브랜드 컬러 최신값 조회**
```bash
grep -E "bg-brand-solid|fg-brand-primary|bg-brand-section" ds/DESIGN_TOKENS.md
```
RGBA 변환 메모:
- `bg-brand-solid` #4ca30d → {r:0.298, g:0.639, b:0.051, a:1}
- `bg-brand-section` #326212 → {r:0.196, g:0.384, b:0.071, a:1}
- `fg-brand-primary` #4ca30d → {r:0.298, g:0.639, b:0.051, a:1}
- `bg-brand-primary` #f3fee7 → {r:0.953, g:0.996, b:0.906, a:1}
- `bg-brand-secondary` #e3fbcc → {r:0.890, g:0.984, b:0.800, a:1}

**Step 3: 새 블루프린트 작성**

v2 블루프린트를 기반으로 아래 변경사항 적용:

1. **Root frame**: auto-layout 사용 (VERTICAL), height 1500 (콘텐츠가 많으므로 여유있게)
2. **Stage Cards → 가로 스크롤**: `Stage Cards` 프레임을 HORIZONTAL auto-layout으로, 자식 카드는 width 160px FIXED, `clipsContent: true`
3. **Stage Card 구조 (160×180px 각):**
   - 상단: 금액 (Bold 18px)
   - 중간: 이율 (SemiBold 14px, success green), 기간 (Medium 12px)
   - 하단: 혜택 태그 (HUG) + 북마크 아이콘
4. **나머지 섹션**: v2 블루프린트 그대로 유지
5. **Tab Bar / FAB**: `layoutPositioning: "ABSOLUTE"` + constraints 포함 (빌드 후 별도 set_layout_positioning 필요)

`scripts/blueprint_imin_home_v3.json`에 저장.

---

### Task 2: batch_build_screen 빌드

**Step 1: MCP 세션 초기화**
```bash
python3 scripts/figma_mcp_client.py init
```

**Step 2: 빌드 실행**
```bash
python3 scripts/figma_mcp_client.py build scripts/blueprint_imin_home_v3.json
```

빌드 결과에서 root nodeId 기록.

**Step 3: 빌드 직후 스크린샷 QA**
```bash
python3 scripts/figma_mcp_client.py call export_node_as_image '{"nodeId":"<ROOT_ID>","format":"PNG","scale":1}'
```
스크린샷을 `/tmp/qa_build.png`로 저장 → Read로 확인.

**체크 항목:**
- 모든 섹션 width=393
- 텍스트 잘림 없음
- 아이콘 프레임 표시 확인
- 가로 스크롤 카드 레이아웃

---

### Task 3: 후처리 (Status Bar, Tab Bar ABSOLUTE, FAB 위치)

**Step 1: Status Bar 삽입**
```bash
python3 scripts/figma_mcp_client.py call clone_node '{"nodeId":"1:3448","targetParentId":"<ROOT_ID>"}'
python3 scripts/figma_mcp_client.py call insert_child '{"childId":"<STATUS_BAR_CLONE_ID>","parentId":"<ROOT_ID>","index":0}'
python3 scripts/figma_mcp_client.py call set_layout_sizing '{"nodeId":"<STATUS_BAR_CLONE_ID>","horizontal":"FILL"}'
python3 scripts/figma_mcp_client.py call resize_node '{"nodeId":"<STATUS_BAR_CLONE_ID>","width":393,"height":54}'
```

**Step 2: Tab Bar ABSOLUTE 설정**
```bash
python3 scripts/figma_mcp_client.py call set_layout_positioning '{"nodeId":"<TAB_BAR_ID>","positioning":"ABSOLUTE","constraints":{"horizontal":"STRETCH","vertical":"MAX"}}'
```

**Step 3: FAB ABSOLUTE 설정**
```bash
python3 scripts/figma_mcp_client.py call set_layout_positioning '{"nodeId":"<FAB_ID>","positioning":"ABSOLUTE","constraints":{"horizontal":"MAX","vertical":"MAX"}}'
```

**Step 4: 후처리 스크린샷 확인**

---

### Task 4: Gemini 이미지 생성

3개 이미지 생성:

**Step 1: 히어로 배너 이미지**
- 타겟: Banner Card (353×170)
- Gemini 프롬프트: "Vibrant promotional banner for a savings app, showing golden coins stacking up with gift boxes, 친구 초대 theme. Cinema4D, Octane render, soft diffused studio lighting, matte finish. Place 3D objects on the right side, leave left half empty for text overlay. Pure gradient green background matching #326212 to #4ca30d."
- 크기: 1059×510 (3x)
- isHero=true (배경 유지)
- `set_image_fill(Banner Card nodeId, scaleMode: "FILL")`

**Step 2: 랜덤박스 3D 아이콘**
- 타겟: Random Icon Frame (40×40)
- Gemini 프롬프트: "A cute 3D mystery gift box with question mark, soft matte material, pastel green and gold colors. Cinema4D Octane render, front view, pure white background."
- 크기: 120×120 (3x)
- rembg 배경 제거
- `set_image_fill(Random Icon Frame nodeId, scaleMode: "FIT")`

**Step 3: 기프트샵 3D 아이콘**
- 타겟: Gift Icon Frame (40×40)
- Gemini 프롬프트: "A cute 3D shopping bag with ribbon and gift tag, soft matte material, pastel orange and cream colors. Cinema4D Octane render, front view, pure white background."
- 크기: 120×120 (3x)
- rembg 배경 제거
- `set_image_fill(Gift Icon Frame nodeId, scaleMode: "FIT")`

**Step 4: 목돈 계산기 3D 아이콘**
- 타겟: Calc Icon Frame (40×40)
- Gemini 프롬프트: "A cute 3D calculator with coin stacks, soft matte material, pastel green colors. Cinema4D Octane render, front view, pure white background."
- 크기: 120×120 (3x)
- rembg 배경 제거
- `set_image_fill(Calc Icon Frame nodeId, scaleMode: "FIT")`

**Step 5: 이미지 적용 후 스크린샷 확인**

---

### Task 5: DS 변수 바인딩

**Step 1: Text Style 바인딩**
- DESIGN_TOKENS.md에서 Text Style ID 조회 (Text sm, Text md, Text lg, Display sm 등)
- `set_text_style_id`로 각 텍스트 노드에 스타일 적용

**Step 2: Typography 변수 바인딩**
- fontSize, lineHeight 변수 바인딩 (set_bound_variables)

**Step 3: Color 변수 바인딩**
- 모든 fill, stroke를 DS 변수로 바인딩
- fills/0, strokes/0 필드 사용

**Step 4: Radius 변수 바인딩**
- cornerRadius → DS radius 변수

---

### Task 6: QA (2-pass 필수)

**QA Pass 1:**
1. 스크린샷 촬영 → Read로 확인
2. 12개 QA 체크리스트 항목 전부 확인:
   - [ ] full-width 요소 width=393
   - [ ] 텍스트 가시성 (대비 4:1)
   - [ ] 최소 폰트 12px
   - [ ] PRD 1:1 매핑 (모든 UI 요소 존재)
   - [ ] 아이콘 렌더링 확인
   - [ ] 이미지 영역 채움 확인
   - [ ] 불필요 fill 없음
   - [ ] 아이콘-텍스트 간격 12px+
   - [ ] FAB-TabBar 간격 16px+
   - [ ] Tab Bar 정렬 균등
   - [ ] SPACE_BETWEEN + FILL 충돌 없음
   - [ ] 텍스트 weight 위계

**QA Pass 2:**
- Pass 1에서 발견된 문제 수정 후 재촬영 + 재확인
- 2회 모두 통과해야 완료

**완료 후:**
- "확인해주세요"로 전달
