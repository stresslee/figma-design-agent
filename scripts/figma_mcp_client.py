#!/usr/bin/env python3
"""
Figma MCP HTTP Client — 디자인 생성, 수정, 바인딩을 위한 Python 클라이언트

Usage:
    # 1. 세션 초기화 (필수 — 첫 실행 시)
    python3 scripts/figma_mcp_client.py init

    # 2. 단일 도구 호출
    python3 scripts/figma_mcp_client.py call get_selection '{}'
    python3 scripts/figma_mcp_client.py call get_node_info '{"nodeId":"51:33050"}'

    # 3. batch_build_screen (디자인 생성)
    python3 scripts/figma_mcp_client.py build blueprint.json

    # 4. DS 변수 바인딩
    python3 scripts/figma_mcp_client.py bind bindings.json

    # 5. 인터랙티브 모드
    python3 scripts/figma_mcp_client.py interactive
"""

import json
import sys
import os
import time
import requests
from typing import Any, Optional, List, Dict

MCP_URL = "http://localhost:8769/mcp"
SESSION_FILE = os.path.join(os.path.dirname(__file__), ".mcp_session")
TOKEN_MAP_FILE = os.path.join(os.path.dirname(__file__), "..", "ds", "TOKEN_MAP.json")

# Cached token map (loaded once per process)
_token_map: Optional[Dict[str, dict]] = None


def load_token_map() -> Dict[str, dict]:
    """Load TOKEN_MAP.json and build a lookup by figmaPath."""
    global _token_map
    if _token_map is not None:
        return _token_map

    token_map_path = os.path.normpath(TOKEN_MAP_FILE)
    if not os.path.exists(token_map_path):
        print(f"WARNING: TOKEN_MAP.json not found at {token_map_path}. Token references won't be resolved.")
        _token_map = {}
        return _token_map

    with open(token_map_path) as f:
        raw = json.load(f)

    # Build lookup: figmaPath → {value, type}
    # e.g. "Colors/Background/bg-brand-solid" → {"value": "#1570ef", "type": "COLOR"}
    _token_map = {}
    for css_var, info in raw.items():
        figma_path = info.get("figmaPath", "")
        if figma_path:
            _token_map[figma_path] = info
            # Also index by the last segment for convenience
            # e.g. "bg-brand-solid" → same info
            short_name = figma_path.rsplit("/", 1)[-1] if "/" in figma_path else figma_path
            if short_name not in _token_map:
                _token_map[short_name] = info
    return _token_map


def hex_to_rgba(hex_color: str) -> Dict[str, float]:
    """Convert hex color (#RRGGBB or #RRGGBBAA) to Figma RGBA dict (0-1 range)."""
    h = hex_color.lstrip("#")
    if len(h) == 6:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = 255
    elif len(h) == 8:
        r, g, b, a = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16)
    else:
        return {"r": 0, "g": 0, "b": 0, "a": 1}
    return {"r": round(r / 255, 3), "g": round(g / 255, 3), "b": round(b / 255, 3), "a": round(a / 255, 3)}


def resolve_token_ref(value: str) -> Optional[Dict[str, float]]:
    """Resolve a $token(name) reference to RGBA.

    Supported formats:
        "$token(bg-brand-solid)"
        "$token(Colors/Background/bg-brand-solid)"
        "$token(fg-brand-primary)" — matches "fg-brand-primary (600)" etc.
    """
    if not isinstance(value, str) or not value.startswith("$token("):
        return None
    token_name = value[7:-1]  # strip "$token(" and ")"
    token_map = load_token_map()

    # Exact match
    info = token_map.get(token_name)
    if info and info.get("type") == "COLOR":
        return hex_to_rgba(info["value"])

    # Partial match — search for token name in figmaPath endings
    for path, info_item in token_map.items():
        figma_path = info_item.get("figmaPath", path)
        last_segment = figma_path.rsplit("/", 1)[-1] if "/" in figma_path else figma_path
        # Match: exact segment, or segment starts with token_name + space/underscore
        # e.g. "fg-brand-primary" matches "fg-brand-primary (600)"
        if last_segment == token_name or last_segment.startswith(token_name + " ") or last_segment.startswith(token_name + "_"):
            if info_item.get("type") == "COLOR":
                return hex_to_rgba(info_item["value"])

    print(f"WARNING: Token '{token_name}' not found in TOKEN_MAP.json")
    return None


def _flatten_padding_objects(node: Any) -> Any:
    """Recursively convert padding objects to individual paddingTop/Bottom/Left/Right.

    autoLayout.padding = {top:12, bottom:12, left:20, right:20}
    → autoLayout.paddingTop=12, paddingBottom=12, paddingLeft=20, paddingRight=20
    """
    if isinstance(node, dict):
        result = {}
        for k, v in node.items():
            if k == "autoLayout" and isinstance(v, dict) and "padding" in v and isinstance(v["padding"], dict):
                v = dict(v)  # shallow copy
                p = v.pop("padding")
                if "top" in p: v["paddingTop"] = p["top"]
                if "bottom" in p: v["paddingBottom"] = p["bottom"]
                if "left" in p: v["paddingLeft"] = p["left"]
                if "right" in p: v["paddingRight"] = p["right"]
            result[k] = _flatten_padding_objects(v)
        return result
    elif isinstance(node, list):
        return [_flatten_padding_objects(item) for item in node]
    return node


def validate_blueprint(blueprint: dict) -> list:
    """Validate blueprint JSON before building. Returns list of error/warning strings."""
    issues = []

    def _check_node(node: dict, path: str = "root"):
        # Check autoLayout
        al = node.get("autoLayout")
        if al:
            mode = al.get("layoutMode") or al.get("direction")
            if mode and mode not in ("HORIZONTAL", "VERTICAL"):
                issues.append(f"ERROR {path}: invalid layoutMode/direction '{mode}' (must be HORIZONTAL or VERTICAL)")

            # Check padding is not an object (should be flat)
            if "padding" in al and isinstance(al["padding"], dict):
                issues.append(f"WARN {path}: padding is an object — will be auto-flattened, but prefer paddingTop/Bottom/Left/Right")

            # Check SPACE_BETWEEN + FILL conflict
            if al.get("primaryAxisAlignItems") == "SPACE_BETWEEN":
                for child in node.get("children", []):
                    child_al = child.get("autoLayout", {})
                    if child.get("layoutSizingHorizontal") == "FILL" or child_al.get("layoutSizingHorizontal") == "FILL":
                        issues.append(f"WARN {path} → {child.get('name','?')}: SPACE_BETWEEN parent + FILL child = 0px spacing")

        # Check fill/fontColor is not raw hex string
        for color_key in ("fill", "fontColor", "iconColor", "stroke"):
            val = node.get(color_key)
            if isinstance(val, str) and val.startswith("#"):
                issues.append(f"ERROR {path}: {color_key}='{val}' is hex string — use $token() or {{r,g,b,a}} object")

        # Check font for Korean text
        text = node.get("text") or node.get("characters")
        if text and any('\uac00' <= ch <= '\ud7a3' for ch in str(text)):
            font = node.get("fontFamily") or node.get("fontName", {}).get("family", "")
            if font and font not in ("Pretendard", ""):
                issues.append(f"WARN {path}: Korean text with font '{font}' — should use Pretendard")

        # R1: FRAME children of root/sections must be FILL (not HUG)
        node_type = node.get("type", "frame")
        is_frame = node_type in ("frame", "FRAME")
        parent_has_layout = bool(node.get("autoLayout"))

        if is_frame and path != "root":
            sizing_h = node.get("layoutSizingHorizontal", "")
            # Frames inside auto-layout parents should be FILL
            if sizing_h == "HUG" or (sizing_h == "" and parent_has_layout):
                node_name = node.get("name", "?")
                # Skip small frames (icons, tags, chips, indicators, dots)
                w = node.get("width", 999)
                skip_keywords = ("Tag", "Chip", "Badge", "Dot", "Icon", "Indicator", "Nav Right", "DI1 Left", "DI2 Left", "DI3 Left")
                is_small = w <= 60
                is_skip = any(kw in node_name for kw in skip_keywords)
                # Only warn for section/card-level frames and their direct children
                depth = path.count("/")
                if not is_small and not is_skip and depth <= 3:
                    issues.append(f"WARN {path}: FRAME '{node_name}' has layoutSizingHorizontal='{sizing_h or 'unset'}' — should be FILL")

        # R2: Tab Bar and FAB must have ABSOLUTE positioning note
        node_name = node.get("name", "")
        if "Tab Bar" in node_name or "FAB" in node_name:
            pos = node.get("layoutPositioning", "")
            if pos != "ABSOLUTE":
                issues.append(f"WARN {path}: '{node_name}' needs layoutPositioning='ABSOLUTE' (batch_build_screen won't apply it — must be set in post-processing)")

        # R3: Hero/Banner section should have HORIZONTAL carousel wrapper
        if ("Banner" in node_name or "Hero" in node_name or "Carousel" in node_name):
            children = node.get("children", [])
            banner_children = [c for c in children if "Banner" in c.get("name", "") and c.get("type", "frame") in ("frame", "FRAME")]
            if len(banner_children) >= 2:
                layout_mode = (node.get("autoLayout", {}).get("layoutMode", "") or
                               node.get("autoLayout", {}).get("direction", ""))
                clips = node.get("clipsContent", False)
                if layout_mode != "HORIZONTAL":
                    issues.append(f"WARN {path}: Carousel '{node_name}' has {len(banner_children)} banners but layoutMode='{layout_mode}' — should be HORIZONTAL")
                if not clips:
                    issues.append(f"WARN {path}: Carousel '{node_name}' needs clipsContent=true to show only first banner")

        # R4: FAB with text should be pill-shaped (width >= 100)
        if "FAB" in node_name:
            w = node.get("width", 0)
            children = node.get("children", [])
            has_text = any(c.get("type") in ("text", "TEXT") for c in children)
            if has_text and w < 100:
                issues.append(f"WARN {path}: FAB has text but width={w} — use pill shape (width >= 100)")

        # Check children
        for i, child in enumerate(node.get("children", [])):
            child_name = child.get("name", f"child[{i}]")
            _check_node(child, f"{path}/{child_name}")

    _check_node(blueprint)
    return issues


def resolve_tokens_in_blueprint(node: Any) -> Any:
    """Recursively resolve all $token() references in a blueprint JSON."""
    if isinstance(node, str):
        resolved = resolve_token_ref(node)
        if resolved is not None:
            return resolved
        return node
    elif isinstance(node, dict):
        result = {}
        for k, v in node.items():
            resolved = resolve_tokens_in_blueprint(v)
            result[k] = resolved
        return result
    elif isinstance(node, list):
        return [resolve_tokens_in_blueprint(item) for item in node]
    return node


def _count_token_refs(node: Any) -> int:
    """Count $token() references in a JSON structure."""
    if isinstance(node, str):
        return 1 if node.startswith("$token(") else 0
    elif isinstance(node, dict):
        return sum(_count_token_refs(v) for v in node.values())
    elif isinstance(node, list):
        return sum(_count_token_refs(item) for item in node)
    return 0


def get_session_id() -> Optional[str]:
    if os.path.exists(SESSION_FILE):
        with open(SESSION_FILE) as f:
            return f.read().strip()
    return None


def save_session_id(sid: str):
    with open(SESSION_FILE, "w") as f:
        f.write(sid)


def mcp_request(method: str, params: Optional[dict] = None, msg_id: int = 1) -> dict:
    """Send a JSON-RPC request to the MCP HTTP endpoint."""
    payload = {"jsonrpc": "2.0", "id": msg_id, "method": method}
    if params:
        payload["params"] = params

    headers = {"Content-Type": "application/json"}
    sid = get_session_id()
    if sid:
        headers["mcp-session-id"] = sid

    resp = requests.post(MCP_URL, json=payload, headers=headers, timeout=300)

    # Save session ID from response
    new_sid = resp.headers.get("mcp-session-id")
    if new_sid:
        save_session_id(new_sid)

    return resp.json()


def init_session() -> str:
    """Initialize MCP session."""
    result = mcp_request("initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "figma-py-client", "version": "1.0"}
    })
    sid = get_session_id()
    print(f"Session initialized: {sid}")

    # Send initialized notification
    payload = {"jsonrpc": "2.0", "method": "notifications/initialized"}
    headers = {"Content-Type": "application/json"}
    if sid:
        headers["mcp-session-id"] = sid
    requests.post(MCP_URL, json=payload, headers=headers, timeout=10)

    return sid


def call_tool(name: str, args: dict, msg_id: int = 1) -> List[dict]:
    """Call an MCP tool and return content array."""
    result = mcp_request("tools/call", {
        "name": name,
        "arguments": args
    }, msg_id)

    if "error" in result:
        raise Exception(f"MCP error: {result['error']}")

    content = result.get("result", {}).get("content", [])
    return content


def parse_content(content: List[dict]) -> dict:
    """Parse MCP response content — handles text, image, and mixed types."""
    texts = []
    images = []
    parsed_json = None

    for item in content:
        ctype = item.get("type", "text")
        if ctype == "text":
            text = item.get("text", "")
            texts.append(text)
            # Try to parse as JSON
            try:
                parsed_json = json.loads(text)
            except (json.JSONDecodeError, TypeError):
                pass
        elif ctype == "image":
            images.append({
                "mimeType": item.get("mimeType", "image/png"),
                "data_length": len(item.get("data", "")),
            })

    return {
        "texts": texts,
        "images": images,
        "json": parsed_json,
        "raw": content,
    }


def ensure_session():
    """Ensure we have a valid session, init if needed."""
    sid = get_session_id()
    if not sid:
        print("No session found, initializing...")
        init_session()
    else:
        # Test session validity
        try:
            call_tool("get_selection", {})
        except Exception:
            print("Session expired, re-initializing...")
            init_session()


# ─── High-level commands ───


def cmd_init():
    init_session()
    print("Ready.")


def cmd_call(tool_name: str, args_json: str):
    ensure_session()
    args = json.loads(args_json) if args_json else {}
    content = call_tool(tool_name, args)
    result = parse_content(content)

    if result["json"]:
        print(json.dumps(result["json"], indent=2, ensure_ascii=False))
    else:
        for t in result["texts"]:
            print(t)
    if result["images"]:
        print(f"\n[{len(result['images'])} image(s) returned]")


def cmd_build(blueprint_file: str):
    """Build a screen from a blueprint JSON file.

    Supports $token() references in color fields. Before building,
    all $token(name) values are resolved to RGBA using TOKEN_MAP.json.

    Example blueprint color:
        "fill": "$token(bg-brand-solid)"
        "fontColor": "$token(fg-brand-primary)"
    These are resolved to {"r": ..., "g": ..., "b": ..., "a": ...} at build time.
    """
    ensure_session()

    with open(blueprint_file) as f:
        blueprint = json.load(f)

    # Step 1: Validate blueprint before any processing
    issues = validate_blueprint(blueprint)
    errors = [i for i in issues if i.startswith("ERROR")]
    warns = [i for i in issues if i.startswith("WARN")]
    if errors:
        print(f"\n{'='*50}")
        print(f"BLUEPRINT VALIDATION FAILED — {len(errors)} error(s), {len(warns)} warning(s):")
        for issue in issues:
            print(f"  {issue}")
        print(f"{'='*50}\n")
        print("Fix errors before building. Use --force to skip validation.")
        if "--force" not in sys.argv:
            return
    elif warns:
        print(f"Blueprint validation: {len(warns)} warning(s)")
        for w in warns:
            print(f"  {w}")

    # Step 2: Flatten padding objects in autoLayout before build
    blueprint = _flatten_padding_objects(blueprint)

    # Step 3: Resolve $token() references to RGBA using latest TOKEN_MAP.json
    token_count = _count_token_refs(blueprint)
    if token_count > 0:
        print(f"Resolving {token_count} $token() references from TOKEN_MAP.json...")
        blueprint = resolve_tokens_in_blueprint(blueprint)

    children_count = len(blueprint.get('children', []))
    root_name = blueprint.get('name', 'unnamed')
    print(f"Building '{root_name}' with {children_count} top-level children...")
    start = time.time()

    content = call_tool("batch_build_screen", {"blueprint": blueprint})
    result = parse_content(content)

    elapsed = time.time() - start

    # Step 4: Extract and display rootId prominently
    root_id = None
    total_nodes = None
    node_map = None
    if result["json"]:
        root_id = result["json"].get("rootId") or result["json"].get("nodeId")
        total_nodes = result["json"].get("totalNodes")
        node_map = result["json"].get("nodeMap")

    print(f"\n{'='*50}")
    print(f"BUILD COMPLETE in {elapsed:.1f}s")
    if root_id:
        print(f"  rootId: {root_id}")
    if total_nodes:
        print(f"  totalNodes: {total_nodes}")
    if node_map:
        print(f"  nodeMap keys: {len(node_map)}")
        # Print first 10 node mappings for reference
        for i, (name, nid) in enumerate(node_map.items()):
            if i >= 10:
                print(f"  ... and {len(node_map) - 10} more")
                break
            print(f"    {name}: {nid}")
    print(f"{'='*50}")

    if result["images"]:
        print(f"[Screenshot returned: {result['images'][0]['data_length']} bytes]")

    # Auto post-fix
    if root_id:
        print("\n🔧 자동 후처리 실행 중...")
        cmd_post_fix(root_id)
    else:
        print("⚠️  rootId를 찾을 수 없어 post-fix를 건너뜁니다.")

    # Auto image generation
    if node_map:
        image_specs = _extract_image_specs(blueprint, node_map)
        if image_specs:
            print(f"\n🎨 이미지 자동 생성 ({len(image_specs)}건)...")
            _generate_images(image_specs)
        else:
            print("\n(imageGen 스펙 없음 — 이미지 생성 건너뜀)")


def _extract_image_specs(blueprint: dict, node_map: dict) -> list:
    """Blueprint에서 imageGen 스펙을 추출하고, nodeMap으로 실제 nodeId를 매핑.

    Blueprint 노드에 imageGen 필드가 있으면:
    {
        "name": "Banner Card 1",
        "imageGen": {
            "prompt": "3D coins floating...",
            "isHero": true,
            "style": "yanolja-3d"  // optional
        }
    }

    Returns: [{"nodeId": "85:1502", "prompt": "...", "isHero": true, "style": "..."}, ...]
    """
    specs = []

    def _walk(node: dict):
        name = node.get("name", "")
        image_gen = node.get("imageGen")
        if image_gen and isinstance(image_gen, dict):
            # nodeMap에서 실제 nodeId 찾기
            node_id = node_map.get(name)
            if node_id:
                spec = {
                    "nodeId": node_id,
                    "nodeName": name,
                    "prompt": image_gen.get("prompt", ""),
                    "isHero": image_gen.get("isHero", False),
                    "width": image_gen.get("width"),
                    "height": image_gen.get("height"),
                    "style": image_gen.get("style"),
                }
                specs.append(spec)
            else:
                print(f"  ⚠️ imageGen 노드 '{name}'의 nodeId를 nodeMap에서 찾을 수 없음")

        for child in node.get("children", []):
            _walk(child)

    _walk(blueprint)
    return specs


def _generate_images(specs: list):
    """generate_image MCP 도구로 이미지 생성 + Figma 노드에 적용.

    generate_image 도구는 내부적으로:
    1. Gemini API 호출 (이미지 생성)
    2. 아이콘은 rembg 배경 제거
    3. set_image_fill로 Figma 노드에 적용
    """
    start = time.time()
    success = 0
    fail = 0

    for i, spec in enumerate(specs):
        node_name = spec["nodeName"]
        node_id = spec["nodeId"]
        prompt = spec["prompt"]
        is_hero = spec.get("isHero", False)

        print(f"  [{i+1}/{len(specs)}] {node_name} ({'hero' if is_hero else 'icon'})...")

        params = {
            "prompt": prompt,
            "nodeId": node_id,
            "isHero": is_hero,
        }
        if spec.get("width"):
            params["width"] = spec["width"]
        if spec.get("height"):
            params["height"] = spec["height"]
        if spec.get("style"):
            params["style"] = spec["style"]

        try:
            content = call_tool("generate_image", params)
            result = parse_content(content)
            if result["json"] and result["json"].get("success"):
                print(f"    ✅ 완료 ({result['json'].get('width')}x{result['json'].get('height')})")
                success += 1
            else:
                print(f"    ❌ 실패: {result.get('texts', ['unknown error'])}")
                fail += 1
        except Exception as e:
            print(f"    ❌ 에러: {e}")
            fail += 1

    elapsed = time.time() - start
    print(f"\n  이미지 생성 완료 — {success} 성공, {fail} 실패 ({elapsed:.1f}s)")


def _collect_tree(node_id: str, depth: int = 0, max_depth: int = 3) -> dict:
    """노드 트리를 재귀적으로 수집 (최대 depth 3).

    get_node_info로 노드 정보를 가져오고, children의 각 id에 대해 재귀 호출.
    결과 노드에 _children_full 키로 완전한 자식 정보를 포함.
    """
    content = call_tool("get_node_info", {"nodeId": node_id})
    result = parse_content(content)
    node = result.get("json") or {}

    if not node:
        return {"id": node_id, "type": "UNKNOWN", "_children_full": []}

    children_full = []
    if depth < max_depth:
        children = node.get("children", [])
        for child in children:
            child_id = child.get("id") if isinstance(child, dict) else child
            if child_id:
                child_node = _collect_tree(str(child_id), depth + 1, max_depth)
                children_full.append(child_node)

    node["_children_full"] = children_full
    return node


def _fix_fill_sizing(tree: dict) -> int:
    """FRAME 노드의 layoutSizingHorizontal을 FILL로 수정.

    스킵 조건:
    - width <= 60 (아이콘 등 고정 크기)
    - 이름에 icon/chevron/dot/Tag/Badge/Indicator/Nav Right/Vector 포함
    - HORIZONTAL 부모 안의 Banner Card (캐로셀 배너는 FIXED 유지)
    """
    SKIP_KEYWORDS = ("icon", "chevron", "dot", "Tag", "Badge", "Indicator",
                     "Nav Right", "Vector", "Icon", "Chevron", "Dot")
    fix_count = 0

    def _walk(node: dict, parent_layout_mode: str = ""):
        nonlocal fix_count
        node_type = (node.get("type") or "").upper()
        node_name = node.get("name") or ""
        node_id = node.get("id")
        width = node.get("width", 999)
        sizing_h = node.get("layoutSizingHorizontal", "")

        is_frame = node_type in ("FRAME", "COMPONENT", "INSTANCE")

        if is_frame and node_id != tree.get("id"):
            # 스킵 조건 확인
            skip = False
            if width <= 60:
                skip = True
            if any(kw in node_name for kw in SKIP_KEYWORDS):
                skip = True
            # HORIZONTAL 부모 안의 Banner Card (캐로셀)
            if parent_layout_mode == "HORIZONTAL" and "Banner" in node_name:
                skip = True

            if not skip and sizing_h != "FILL":
                try:
                    call_tool("set_layout_sizing", {
                        "nodeId": node_id,
                        "horizontal": "FILL"
                    })
                    fix_count += 1
                    print(f"  FILL 수정: {node_name} ({node_id}) [{sizing_h} → FILL]")
                except Exception as e:
                    print(f"  FILL 수정 실패: {node_name} ({node_id}): {e}")

        # 자식 노드 재귀
        current_layout = node.get("layoutMode", "")
        for child in node.get("_children_full", []):
            _walk(child, current_layout)

    _walk(tree)
    return fix_count


def _fix_layout_and_positions(tree: dict) -> dict:
    """Tab Bar/FAB를 ABSOLUTE로 루트 하단에 배치하고, 인접 섹션 간 갭 조정.

    Returns:
        dict with content_bottom, fab_y, tab_y, root_height
    """
    root_id = tree.get("id")
    children = tree.get("_children_full", [])

    # 자식 분류
    content_nodes = []
    tab_bar = None
    fab = None

    for child in children:
        name = (child.get("name") or "").lower()
        if "tab bar" in name or "tabbar" in name:
            tab_bar = child
        elif "fab" in name:
            fab = child
        else:
            content_nodes.append(child)

    # 인접 섹션 간 갭 제거 (둘 다 투명 배경이면)
    for i in range(1, len(content_nodes)):
        prev = content_nodes[i - 1]
        curr = content_nodes[i]

        prev_fills = prev.get("fills", [])
        curr_fills = curr.get("fills", [])

        # 투명 여부 판단: fills가 비어있거나, 모든 fill의 opacity/a가 0이거나, visible=false
        def _is_transparent(fills):
            if not fills:
                return True
            for f in fills:
                if f.get("visible") is False:
                    continue
                opacity = f.get("opacity", 1)
                color = f.get("color", {})
                a = color.get("a", 1)
                if opacity > 0 and a > 0:
                    return False
            return True

        if _is_transparent(prev_fills) and _is_transparent(curr_fills):
            prev_bottom = (prev.get("y") or 0) + (prev.get("height") or 0)
            curr_y = curr.get("y") or 0
            if curr_y > prev_bottom:
                try:
                    call_tool("move_node", {
                        "nodeId": curr.get("id"),
                        "x": curr.get("x", 0),
                        "y": prev_bottom
                    })
                    print(f"  갭 제거: {curr.get('name')} y={curr_y} → {prev_bottom}")
                    curr["y"] = prev_bottom
                except Exception as e:
                    print(f"  갭 제거 실패: {curr.get('name')}: {e}")

    # content_bottom 계산 (갭 제거 후 재계산)
    content_bottom = 0
    for node in content_nodes:
        bottom = (node.get("y") or 0) + (node.get("height") or 0)
        if bottom > content_bottom:
            content_bottom = bottom

    result = {"content_bottom": content_bottom, "fab_y": None, "tab_y": None, "root_height": None}

    # FAB 배치
    fab_y = content_bottom + 24
    if fab:
        try:
            call_tool("set_layout_positioning", {
                "nodeId": fab.get("id"),
                "positioning": "ABSOLUTE"
            })
        except Exception as e:
            print(f"  FAB ABSOLUTE 설정 실패 (무시): {e}")
        try:
            call_tool("move_node", {
                "nodeId": fab.get("id"),
                "x": 253,
                "y": fab_y
            })
            print(f"  FAB 배치: y={fab_y}, x=253")
            result["fab_y"] = fab_y
        except Exception as e:
            print(f"  FAB 이동 실패: {e}")

    # Tab Bar 배치
    if fab:
        tab_y = fab_y + 44 + 16
    else:
        tab_y = content_bottom + 24

    if tab_bar:
        try:
            call_tool("set_layout_positioning", {
                "nodeId": tab_bar.get("id"),
                "positioning": "ABSOLUTE"
            })
        except Exception as e:
            print(f"  Tab Bar ABSOLUTE 설정 실패 (무시): {e}")
        try:
            call_tool("move_node", {
                "nodeId": tab_bar.get("id"),
                "x": 0,
                "y": tab_y
            })
            print(f"  Tab Bar 배치: y={tab_y}, x=0")
            result["tab_y"] = tab_y
        except Exception as e:
            print(f"  Tab Bar 이동 실패: {e}")

    # 루트 프레임 높이 조정
    if tab_bar:
        root_height = tab_y + 73
    elif fab:
        root_height = fab_y + 44 + 24
    else:
        root_height = content_bottom + 24

    try:
        call_tool("resize_node", {
            "nodeId": root_id,
            "width": tree.get("width", 393),
            "height": root_height
        })
        print(f"  루트 프레임 높이: {root_height}")
        result["root_height"] = root_height
    except Exception as e:
        print(f"  루트 높이 조정 실패: {e}")

    return result


def _fix_zero_width_text(tree: dict) -> int:
    """width=0인 TEXT 노드를 수정: textAutoResize → WIDTH_AND_HEIGHT, 그 후 FILL."""
    fix_count = 0

    def _walk(node: dict):
        nonlocal fix_count
        node_type = (node.get("type") or "").upper()
        node_id = node.get("id")
        width = node.get("width", 1)

        if node_type == "TEXT" and width == 0 and node_id:
            try:
                call_tool("set_text_properties", {
                    "nodeId": node_id,
                    "textAutoResize": "WIDTH_AND_HEIGHT"
                })
                call_tool("set_layout_sizing", {
                    "nodeId": node_id,
                    "horizontal": "FILL"
                })
                fix_count += 1
                print(f"  텍스트 수정: {node.get('name', '?')} ({node_id}) [width=0 → FILL]")
            except Exception as e:
                print(f"  텍스트 수정 실패: {node.get('name', '?')} ({node_id}): {e}")

        for child in node.get("_children_full", []):
            _walk(child)

    _walk(tree)
    return fix_count


def cmd_post_fix(root_node_id: str):
    """빌드 후 자동 후처리: FILL 사이징, Tab Bar/FAB 배치, 섹션 갭, 텍스트 수정.

    Usage:
        python3 scripts/figma_mcp_client.py post-fix <rootNodeId>
    """
    ensure_session()

    print(f"\n{'='*50}")
    print(f"POST-FIX 자동 후처리 시작 — rootId: {root_node_id}")
    print(f"{'='*50}")
    start = time.time()

    # 1. 노드 트리 수집
    print("\n[1/4] 노드 트리 수집 중...")
    tree = _collect_tree(root_node_id)
    children_count = len(tree.get("_children_full", []))
    print(f"  루트 '{tree.get('name', '?')}' — 직계 자식 {children_count}개")

    # 2. FILL 사이징 수정
    print("\n[2/4] FILL 사이징 검증/수정 중...")
    fill_fixes = _fix_fill_sizing(tree)
    print(f"  → {fill_fixes}건 수정")

    # 3. Tab Bar/FAB 배치 + 섹션 갭 조정
    print("\n[3/4] Tab Bar/FAB 배치 + 섹션 갭 조정 중...")
    layout_result = _fix_layout_and_positions(tree)
    print(f"  → content_bottom={layout_result['content_bottom']}, "
          f"fab_y={layout_result['fab_y']}, tab_y={layout_result['tab_y']}, "
          f"root_height={layout_result['root_height']}")

    # 4. Zero-width 텍스트 수정
    print("\n[4/4] Zero-width 텍스트 수정 중...")
    text_fixes = _fix_zero_width_text(tree)
    print(f"  → {text_fixes}건 수정")

    elapsed = time.time() - start
    print(f"\n{'='*50}")
    print(f"POST-FIX 완료 — {elapsed:.1f}s")
    print(f"  FILL 수정: {fill_fixes}건")
    print(f"  텍스트 수정: {text_fixes}건")
    print(f"  루트 높이: {layout_result['root_height']}")
    print(f"{'='*50}\n")


def cmd_bind(bindings_file: str):
    """Apply DS variable bindings from a JSON file.

    File format:
    [
        {"nodeId": "51:33050", "bindings": {"fills/0": "Colors/Brand/brand-600"}},
        ...
    ]
    """
    ensure_session()

    with open(bindings_file) as f:
        bindings_list = json.load(f)

    print(f"Applying {len(bindings_list)} binding operations...")
    start = time.time()

    success = 0
    fail = 0
    for i, item in enumerate(bindings_list):
        node_id = item["nodeId"]
        bindings = item["bindings"]
        try:
            call_tool("set_bound_variables", {
                "nodeId": node_id,
                "bindings": bindings
            }, msg_id=i + 1)
            success += 1
        except Exception as e:
            print(f"  FAIL {node_id}: {e}")
            fail += 1

        if (i + 1) % 50 == 0:
            print(f"  Progress: {i + 1}/{len(bindings_list)}")

    elapsed = time.time() - start
    print(f"Done in {elapsed:.1f}s — {success} success, {fail} fail")


def cmd_bind_text_styles(styles_file: str):
    """Apply text style bindings from a JSON file.

    File format:
    [
        {"nodeId": "51:33100", "textStyleId": "S:key,nodeId"},
        ...
    ]
    """
    ensure_session()

    with open(styles_file) as f:
        styles_list = json.load(f)

    print(f"Applying {len(styles_list)} text style bindings...")
    start = time.time()

    success = 0
    fail = 0
    for i, item in enumerate(styles_list):
        try:
            call_tool("set_text_style_id", {
                "nodeId": item["nodeId"],
                "textStyleId": item["textStyleId"]
            }, msg_id=i + 1)
            success += 1
        except Exception as e:
            print(f"  FAIL {item['nodeId']}: {e}")
            fail += 1

    elapsed = time.time() - start
    print(f"Done in {elapsed:.1f}s — {success} success, {fail} fail")


def cmd_interactive():
    """Interactive REPL for MCP tool calls."""
    ensure_session()
    print("Figma MCP Interactive Mode (type 'help' or 'quit')")

    while True:
        try:
            line = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!")
            break

        if not line:
            continue
        if line in ("quit", "exit", "q"):
            break
        if line == "help":
            print("Commands:")
            print("  <tool_name> <json_args>  — call a tool")
            print("  list                     — list available tools")
            print("  quit                     — exit")
            continue
        if line == "list":
            content = call_tool("get_document_info", {})
            result = parse_content(content)
            print("(Use 'tools/list' for full list)")
            if result["json"]:
                print(json.dumps(result["json"], indent=2, ensure_ascii=False))
            continue

        parts = line.split(None, 1)
        tool_name = parts[0]
        args_str = parts[1] if len(parts) > 1 else "{}"

        try:
            args = json.loads(args_str)
            content = call_tool(tool_name, args)
            result = parse_content(content)
            if result["json"]:
                print(json.dumps(result["json"], indent=2, ensure_ascii=False))
            else:
                for t in result["texts"]:
                    print(t)
            if result["images"]:
                print(f"[{len(result['images'])} image(s)]")
        except Exception as e:
            print(f"Error: {e}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "init":
        cmd_init()
    elif cmd == "call":
        if len(sys.argv) < 3:
            print("Usage: figma_mcp_client.py call <tool_name> [args_json]")
            sys.exit(1)
        cmd_call(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "{}")
    elif cmd == "build":
        if len(sys.argv) < 3:
            print("Usage: figma_mcp_client.py build <blueprint.json>")
            sys.exit(1)
        cmd_build(sys.argv[2])
    elif cmd == "bind":
        if len(sys.argv) < 3:
            print("Usage: figma_mcp_client.py bind <bindings.json>")
            sys.exit(1)
        cmd_bind(sys.argv[2])
    elif cmd == "bind-text-styles":
        if len(sys.argv) < 3:
            print("Usage: figma_mcp_client.py bind-text-styles <styles.json>")
            sys.exit(1)
        cmd_bind_text_styles(sys.argv[2])
    elif cmd == "post-fix":
        if len(sys.argv) < 3:
            print("Usage: figma_mcp_client.py post-fix <rootNodeId>")
            sys.exit(1)
        cmd_post_fix(sys.argv[2])
    elif cmd == "validate":
        if len(sys.argv) < 3:
            print("Usage: figma_mcp_client.py validate <blueprint.json>")
            sys.exit(1)
        with open(sys.argv[2]) as f:
            bp = json.load(f)
        bp = _flatten_padding_objects(bp)
        issues = validate_blueprint(bp)
        if not issues:
            print("✓ Blueprint validation passed — no issues found")
        else:
            errors = [i for i in issues if i.startswith("ERROR")]
            warns = [i for i in issues if i.startswith("WARN")]
            print(f"{'✗' if errors else '⚠'} {len(errors)} error(s), {len(warns)} warning(s):")
            for issue in issues:
                print(f"  {issue}")
    elif cmd == "interactive":
        cmd_interactive()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
