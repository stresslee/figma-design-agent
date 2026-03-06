# Input Source Selection — Terminal / App Mode

## Problem

Figma Design Agent는 두 가지 입력 경로를 지원한다:
- **App 모드**: Electron 앱의 ChatPanel → AgentOrchestrator → Claude API → 도구 실행
- **Terminal 모드**: Claude Code → MCP HTTP(8769) → 도구 직접 호출

현재 두 경로가 동시에 열려있어 충돌 가능. 모드를 명시적으로 선택하고 반대쪽을 차단해야 한다.

## Design

### 선택 위치: Figma 플러그인 UI

플러그인 상단에 `Terminal / App` 토글. WebSocket으로 모드를 FigmaWSServer에 전달.

### 데이터 흐름

```
Figma Plugin UI  ──(set-input-mode)──→  FigmaWSServer.inputMode
                                              │
                       ┌──────────────────────┼──────────────────────┐
                       ▼                                             ▼
              McpHttpServer                                  Electron App
              mode === 'terminal' → 허용                    mode === 'app' → 허용
              mode === 'app' → 403 차단                     mode === 'terminal' → disabled
```

### 변경 범위

#### 1. Figma 플러그인 UI (`src/figma-plugin/ui.html`)
- 상단에 Terminal / App 토글 버튼 추가
- 선택 시 `socket.send({ type: 'set-input-mode', mode: 'terminal' | 'app' })`
- 현재 모드 시각적 표시 (색상/텍스트)
- 기본값: `app` (기존 동작 유지)

#### 2. WebSocket 서버 (`src/main/figma-ws-server.ts`)
- `inputMode: 'terminal' | 'app'` 상태 추가 (기본: `app`)
- `set-input-mode` 메시지 핸들러 추가
- `connection-change` 이벤트에 `inputMode` 포함
- `getInputMode()` 메서드 노출

#### 3. MCP HTTP 서버 (`src/main/mcp-http-server.ts`)
- constructor에 `figmaWS` 참조 추가 (또는 `getInputMode` 콜백)
- 미들웨어에 모드 체크: `inputMode === 'app'`이면 403 반환
- 에러 메시지: "Currently in App mode. Switch to Terminal mode in Figma plugin."

#### 4. Electron 앱 Main Process (`src/main/index.ts`)
- `figmaWS.on('input-mode-change')` → `mainWindow.send('figma:input-mode', mode)`
- `agent:send-message` 핸들러에 모드 체크: terminal 모드면 무시 + 에러 전달

#### 5. Renderer (`src/renderer/`)
- `ChatPanel.tsx`: inputMode 상태 수신 → terminal 모드시 textarea disabled + 안내 메시지
- `useAgent.ts` 또는 `App.tsx`: `figma:input-mode` IPC 이벤트 수신

#### 6. Preload (`src/preload/index.ts`)
- `figma:input-mode` IPC 채널 추가

#### 7. Shared Types (`src/shared/types.ts`)
- `InputMode` 타입 추가: `'terminal' | 'app'`
- IPC 채널 상수 추가: `figma:input-mode`

#### 8. `.mcp.json` 설정
```json
{
  "mcpServers": {
    "figma-tools": {
      "type": "http",
      "url": "http://127.0.0.1:8769/mcp"
    }
  }
}
```

### 기본 모드
- 앱 시작 시 `app` 모드 (기존 동작 유지)
- Figma 플러그인에서 명시적으로 전환해야 터미널 모드로 변경

### 충돌 방지
- 활성 모드만 허용, 반대쪽은 차단
- 터미널 모드: MCP HTTP 허용, ChatPanel disabled
- 앱 모드: ChatPanel 허용, MCP HTTP 차단

### 전제 조건
- 두 모드 모두 Electron 앱은 실행 중이어야 함 (FigmaWSServer 호스팅)
- Figma 플러그인이 연결된 상태에서만 모드 전환 가능
