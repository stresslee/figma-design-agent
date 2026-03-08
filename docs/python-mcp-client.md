# Python HTTP MCP 클라이언트 (디자인 생성/수정/바인딩)

MCP 도구 호출이 불안정할 때(세션 끊김, 파라미터 매핑 버그) **Python HTTP 클라이언트**를 사용.
스크립트: `scripts/figma_mcp_client.py`

## 사용법
```bash
# 세션 초기화 (필수 — 첫 실행 시)
python3 scripts/figma_mcp_client.py init

# Blueprint 사전 검증 (빌드 전 필수)
python3 scripts/figma_mcp_client.py validate <blueprint.json>

# 디자인 생성 (blueprint JSON 파일 — 자동 검증 포함)
python3 scripts/figma_mcp_client.py build <blueprint.json>

# DS 변수 바인딩 (bindings JSON 파일)
python3 scripts/figma_mcp_client.py bind <bindings.json>

# 텍스트 스타일 바인딩
python3 scripts/figma_mcp_client.py bind-text-styles <styles.json>

# 빌드 후 자동 후처리 (FILL 사이징, Tab Bar/FAB 배치, 섹션 간격, 텍스트 수정)
python3 scripts/figma_mcp_client.py post-fix <rootNodeId>

# 단일 도구 호출
python3 scripts/figma_mcp_client.py call <tool_name> '<args_json>'

# 인터랙티브 모드
python3 scripts/figma_mcp_client.py interactive
```

## 언제 Python HTTP를 사용하는가
| 작업 | MCP 도구 | Python HTTP | 권장 |
|------|---------|-------------|------|
| 단건 조회/수정 | ✅ 빠름 | ✅ | MCP 도구 |
| 디자인 생성 (batch_build_screen) | ⚠️ 세션 끊김 빈번 | ✅ 안정적 | **Python** |
| DS 변수 바인딩 (대량) | ❌ 파라미터 버그 | ✅ 262건+ 검증 | **Python** |
| 텍스트 스타일 바인딩 | ❌ 파라미터 버그 | ✅ 183건+ 검증 | **Python** |

## Blueprint JSON 규칙
- `scripts/` 폴더에 blueprint JSON 저장 → 재사용 가능
- blueprint 내 `layoutPositioning: "ABSOLUTE"` + `constraints`는 batch_build_screen에서 미적용 → 빌드 후 `set_layout_positioning` 별도 호출 필요
- 텍스트 노드 width=0 버그: `textAutoResize: "WIDTH_AND_HEIGHT"` 재설정 후 `layoutSizingHorizontal: "FILL"` 적용으로 해결
- 프레임 fill 판단: 자식이 있는 layout 프레임은 fill 숨김(투명), 카드/배너 등 배경이 필요한 프레임만 fill 적용

## 디자인 생성 → 후속 수정 흐름 (Python)
```bash
# Step 0: Blueprint 사전 검증
python3 scripts/figma_mcp_client.py validate scripts/my_blueprint.json

# Step 1: Blueprint JSON 작성 → 빌드 (post-fix 자동 실행됨)
python3 scripts/figma_mcp_client.py build scripts/my_blueprint.json
# → 빌드 완료 후 자동으로 post-fix 실행 (FILL, Tab Bar/FAB, 섹션 간격, 텍스트)

# Step 2: (필요시) post-fix만 별도 실행
python3 scripts/figma_mcp_client.py post-fix <rootNodeId>

# Step 3: DS 변수 바인딩
python3 scripts/figma_mcp_client.py bind scripts/my_bindings.json

# Step 4: 스크린샷 QA
python3 scripts/figma_mcp_client.py call export_node_as_image '{"nodeId":"ROOT_ID","format":"PNG","scale":1}'
```

## 이미지 생성 병렬화 (필수 — 빌드 시간 단축)
디자인에 Gemini 이미지가 필요한 경우, **빌드와 이미지 생성을 병렬로 실행**하여 약 3분 절약:

```
[Blueprint 작성] → [빌드 시작 (batch_build_screen)]
                    ↓ 동시에
                   [Gemini 이미지 생성 (백그라운드)]
                    ↓
[빌드 완료] → [후처리] → [이미지 적용 (set_image_fill)] → [QA]
```

- **방법**: Agent 도구의 `run_in_background: true`로 이미지 생성 에이전트를 백그라운드 실행
- **조건**: 이미지가 들어갈 프레임의 nodeId를 빌드 결과 `nodeMap`에서 얻은 후 적용
- **주의**: 빌드 결과의 `nodeMap`에서 정확한 nodeId를 확인한 뒤 `set_image_fill` 호출
