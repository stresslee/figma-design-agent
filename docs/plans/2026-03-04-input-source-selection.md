# Input Source Selection (Terminal / App Mode) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Figma 플러그인 UI에서 Terminal/App 모드를 선택하면, 활성 모드 쪽만 입력이 허용되고 반대쪽은 차단된다.

**Architecture:** Figma 플러그인 UI 토글 → WebSocket `set-input-mode` → FigmaWSServer가 모드 상태 관리 → McpHttpServer(terminal gate) + ChatPanel(app gate)이 각각 모드 체크.

**Tech Stack:** TypeScript, Electron IPC, WebSocket, Hono HTTP middleware, React

---

### Task 1: Shared Types — InputMode 타입 및 IPC 채널 추가

**Files:**
- Modify: `src/shared/types.ts:58-63` (FigmaConnectionState), `src/shared/types.ts:100-104` (IPC_CHANNELS)

**Step 1: FigmaConnectionState에 mode 필드 추가**

`src/shared/types.ts` line 58-63에서 `FigmaConnectionState` 인터페이스에 `inputMode` 추가:

```typescript
export type InputMode = 'terminal' | 'app';

export interface FigmaConnectionState {
  status: FigmaConnectionStatus;
  channel: string | null;
  pluginVersion?: string;
  documentName?: string;
  inputMode?: InputMode;
}
```

**Step 2: IPC_CHANNELS에 모드 관련 채널 추가**

line 103 `APP_ERROR` 뒤에 추가:

```typescript
  FIGMA_INPUT_MODE: 'figma:input-mode',
```

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add InputMode type and IPC channel for input source selection"
```

---

### Task 2: FigmaWSServer — 모드 상태 관리 및 WebSocket 메시지 처리

**Files:**
- Modify: `src/main/figma-ws-server.ts:27` (클래스 필드), `src/main/figma-ws-server.ts:109-111` (getter), `src/main/figma-ws-server.ts:215` (handleMessage)

**Step 1: 클래스 필드에 inputMode 추가**

line 27 `lastPongTime` 다음에:

```typescript
  private currentInputMode: InputMode = 'app';
```

파일 상단 import에 `InputMode` 추가:

```typescript
import type { FigmaConnectionState, InputMode } from '../shared/types';
```

**Step 2: getter 추가**

line 111 (`get channel()` 끝) 다음:

```typescript
  get inputMode(): InputMode {
    return this.currentInputMode;
  }
```

**Step 3: handleMessage에 set-input-mode 메시지 처리 추가**

line 215 (join 처리 `return;` 다음), `progress_update` 처리 전에:

```typescript
    // Handle input mode change from plugin
    if (json.type === 'set-input-mode') {
      const mode = json.mode as string;
      if (mode === 'terminal' || mode === 'app') {
        this.currentInputMode = mode;
        console.log(`[FigmaWS] Input mode changed to: ${mode}`);
        this.emit('input-mode-change', mode);
      }
      return;
    }
```

**Step 4: connection-change 이벤트에 inputMode 포함**

join 처리 블록 (line 208-212) 에서 emit 객체에 `inputMode` 추가:

```typescript
    this.emit('connection-change', {
      status: 'connected',
      channel,
      documentName,
      inputMode: this.currentInputMode,
    } satisfies FigmaConnectionState);
```

**Step 5: disconnect 시 모드 초기화**

`handleDisconnect` 메서드 (또는 socket close 핸들러) 에서 `this.currentInputMode = 'app';` 추가.

**Step 6: Commit**

```bash
git add src/main/figma-ws-server.ts
git commit -m "feat: add input mode state management to FigmaWSServer"
```

---

### Task 3: MCP HTTP Server — 터미널 모드 게이트

**Files:**
- Modify: `src/main/mcp-http-server.ts:36-43` (클래스 필드, constructor), `src/main/mcp-http-server.ts:50-71` (미들웨어)

**Step 1: constructor에 모드 getter 추가**

```typescript
export class McpHttpServer {
  private httpServer: ReturnType<typeof serve> | null = null;
  private sessions = new Map<string, Session>();
  private tools: Map<string, ToolDefinition>;
  private getInputMode: () => 'terminal' | 'app';

  constructor(tools: Map<string, ToolDefinition>, getInputMode: () => 'terminal' | 'app') {
    this.tools = tools;
    this.getInputMode = getInputMode;
  }
```

**Step 2: 보안 미들웨어에 모드 체크 추가**

line 70 `await next()` 직전에:

```typescript
      // 4. Block tool calls when in App mode
      if (this.getInputMode() === 'app') {
        return c.text('Currently in App mode. Switch to Terminal mode in Figma plugin.', 403);
      }
```

**Step 3: Commit**

```bash
git add src/main/mcp-http-server.ts
git commit -m "feat: gate MCP HTTP server on terminal mode"
```

---

### Task 4: Main Process — 이벤트 배선 및 IPC 핸들러

**Files:**
- Modify: `src/main/index.ts:235` (McpHttpServer 생성), `src/main/index.ts:249-258` (이벤트), `src/main/index.ts:391-461` (agent:send-message), `src/main/index.ts:583` (setupIPC 끝)

**Step 1: McpHttpServer 생성 시 mode getter 전달**

line 235 변경:

```typescript
mcpServer = new McpHttpServer(tools, () => figmaWS.inputMode);
```

**Step 2: input-mode-change 이벤트 핸들러 추가**

line 258 (connection-change 핸들러 다음):

```typescript
  figmaWS.on('input-mode-change', (mode: string) => {
    console.log(`[Main] Input mode changed: ${mode}`);
    mainWindow?.webContents.send(IPC_CHANNELS.FIGMA_INPUT_MODE, mode);
  });
```

**Step 3: agent:send-message 핸들러에 모드 체크 추가**

line 391 핸들러 시작 직후, message 추출 전에:

```typescript
    // Block messages when in terminal mode
    if (figmaWS.inputMode === 'terminal') {
      event.sender.send(IPC_CHANNELS.AGENT_EVENT, {
        type: 'error',
        message: '현재 터미널 모드입니다. Figma 플러그인에서 앱 모드로 전환하세요.',
      });
      return;
    }
```

**Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire input mode events and gate agent messages"
```

---

### Task 5: Preload — IPC 브릿지 추가

**Files:**
- Modify: `src/preload/index.ts:11-49` (인터페이스), `src/preload/index.ts:136` (구현)

**Step 1: ElectronAPI 인터페이스에 메서드 추가**

line 48 `onError` 다음:

```typescript
  onInputModeChange: (callback: (mode: string) => void) => () => void;
```

**Step 2: contextBridge 구현 추가**

line 136 `onError` 구현 블록 다음:

```typescript
    onInputModeChange: (callback: (mode: string) => void) => {
      const handler = (_event: IpcRendererEvent, mode: string) => callback(mode);
      ipcRenderer.on(IPC_CHANNELS.FIGMA_INPUT_MODE, handler);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.FIGMA_INPUT_MODE, handler); };
    },
```

**Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose input mode change event in preload bridge"
```

---

### Task 6: ChatPanel — 터미널 모드 시 입력 차단 UI

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx:79-86` (Props), `src/renderer/components/ChatPanel.tsx:196` (canSend), `src/renderer/components/ChatPanel.tsx:273-343` (input area)

**Step 1: Props에 inputMode 추가**

```typescript
interface Props {
  messages: ChatMessage[];
  onSendMessage: (message: string, attachments?: AttachmentData[]) => void;
  isLoading: boolean;
  pipelineSteps?: PipelineStepEvent[];
  pendingAttachments?: AttachmentData[];
  onClearPendingAttachments?: () => void;
  inputMode?: 'terminal' | 'app';
}
```

**Step 2: 컴포넌트 내부에서 inputMode 디스트럭처링**

기존 props 디스트럭처링에 `inputMode = 'app'` 추가.

**Step 3: canSend에 모드 조건 추가**

```typescript
const isTerminalMode = inputMode === 'terminal';
const canSend = (input.trim() || attachments.length > 0) && !isLoading && !isTerminalMode;
```

**Step 4: textarea, 버튼 disabled 조건 수정**

textarea (line 332):
```typescript
disabled={isLoading || isTerminalMode}
```

attach 버튼 (line 319):
```typescript
disabled={isLoading || isTerminalMode}
```

**Step 5: 터미널 모드 배너 추가**

input area 시작 부분 (line 273 `{/* Input area */}` 다음)에:

```tsx
{isTerminalMode && (
  <div style={{
    padding: '12px 16px',
    background: '#1a1a2e',
    borderTop: '1px solid #333',
    color: '#8b8ba7',
    fontSize: '13px',
    textAlign: 'center',
  }}>
    🖥️ 터미널 모드 — Claude Code에서 입력하세요
  </div>
)}
```

**Step 6: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat: disable ChatPanel input in terminal mode with banner"
```

---

### Task 7: App.tsx — inputMode 상태 관리 및 ChatPanel 연결

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: inputMode 상태 추가**

```typescript
const [inputMode, setInputMode] = useState<'terminal' | 'app'>('app');
```

**Step 2: useEffect에서 onInputModeChange 구독**

```typescript
useEffect(() => {
  const cleanup = window.electronAPI.onInputModeChange((mode: string) => {
    if (mode === 'terminal' || mode === 'app') {
      setInputMode(mode);
    }
  });
  return cleanup;
}, []);
```

**Step 3: ChatPanel에 inputMode prop 전달**

```tsx
<ChatPanel
  messages={messages}
  onSendMessage={sendMessage}
  isLoading={isLoading}
  inputMode={inputMode}
  ...
/>
```

**Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: pass inputMode state to ChatPanel"
```

---

### Task 8: Figma 플러그인 UI — 모드 토글 추가

**Files:**
- Modify: `src/figma-plugin/ui.html:68` (CSS), `src/figma-plugin/ui.html:75` (HTML), `src/figma-plugin/ui.html:96` (JS state), `src/figma-plugin/ui.html:188-231` (WebSocket onmessage)

**Step 1: CSS 추가**

line 68 (`</style>` 직전)에 토글 스타일 추가:

```css
.mode-toggle {
  display: flex;
  gap: 0;
  background: #2a2a2a;
  border-radius: 6px;
  padding: 2px;
  margin-top: 8px;
}
.mode-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: #888;
  transition: all 0.2s;
}
.mode-btn.active {
  background: #4a4a6a;
  color: #fff;
}
.mode-btn:hover:not(.active) {
  color: #bbb;
}
```

**Step 2: HTML 토글 추가**

line 75 (h1 닫힘 태그 다음), line 76 (#status-row) 전에:

```html
<div class="mode-toggle" id="mode-toggle">
  <button class="mode-btn" data-mode="app" onclick="setMode('app')">App</button>
  <button class="mode-btn active" data-mode="terminal" onclick="setMode('terminal')">Terminal</button>
</div>
```

기본값을 `app` active로 설정 (또는 연결 후 서버에서 현재 모드 수신).

실제로 기본은 app 모드이므로:
```html
<div class="mode-toggle" id="mode-toggle">
  <button class="mode-btn active" data-mode="app" onclick="setMode('app')">📱 App</button>
  <button class="mode-btn" data-mode="terminal" onclick="setMode('terminal')">🖥️ Terminal</button>
</div>
```

**Step 3: JS state에 mode 추가**

line 96 `intentionalDisconnect` 다음:

```javascript
  inputMode: 'app',
```

**Step 4: setMode 함수 추가**

state 객체 정의 직후 (`}` 다음)에:

```javascript
function setMode(mode) {
  state.inputMode = mode;
  // Update UI
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  // Send to server via WebSocket
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({
      type: 'set-input-mode',
      channel: state.channel,
      mode: mode,
    }));
  }
  // Update info text
  const infoText = document.getElementById('info-text');
  if (infoText) {
    infoText.textContent = mode === 'terminal'
      ? 'Terminal mode — Claude Code에서 입력'
      : 'App mode — Electron 앱에서 입력';
  }
}
```

**Step 5: WebSocket 연결 시 현재 모드 전송**

join 메시지 전송 후 (connectToServer 내부 socket.onopen 또는 join 성공 후), 현재 mode를 서버에 알림:

```javascript
// After join success, sync current mode
state.socket.send(JSON.stringify({
  type: 'set-input-mode',
  channel: state.channel,
  mode: state.inputMode,
}));
```

**Step 6: Commit**

```bash
git add src/figma-plugin/ui.html
git commit -m "feat: add Terminal/App mode toggle to Figma plugin UI"
```

---

### Task 9: .mcp.json — figma-tools MCP 서버 등록

**Files:**
- Modify: `.mcp.json`

**Step 1: figma-tools 서버 추가**

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

이로써 Claude Code가 터미널 모드에서 `mcp__figma-tools__*` 도구를 자동 인식.

**Step 2: Commit**

```bash
git add .mcp.json
git commit -m "feat: register figma-tools MCP server for Claude Code terminal mode"
```

---

### Task 10: 빌드 및 통합 테스트

**Step 1: 빌드**

```bash
npm run build
```

Expected: 빌드 성공, 타입 에러 없음.

**Step 2: 수동 테스트 — App 모드 (기본)**

1. `npm run dev`로 앱 실행
2. Figma 플러그인 연결 확인
3. 플러그인 UI에서 "App" 모드 활성 확인
4. Electron 앱 ChatPanel에서 메시지 전송 → 정상 동작
5. Claude Code에서 MCP 도구 호출 시도 → 403 차단 확인

**Step 3: 수동 테스트 — Terminal 모드**

1. Figma 플러그인에서 "Terminal" 클릭
2. Electron 앱 ChatPanel이 disabled + 배너 표시 확인
3. Claude Code에서 MCP 도구 호출 → 정상 동작 확인
4. 앱에서 메시지 전송 시도 → 차단 확인

**Step 4: Commit (최종)**

```bash
git add -A
git commit -m "feat: input source selection — Terminal/App mode toggle

Figma 플러그인 UI에서 Terminal/App 모드 전환.
Terminal 모드: Claude Code가 MCP 도구를 직접 호출.
App 모드: Electron 앱의 ChatPanel + AgentOrchestrator 사용.
활성 모드만 입력 허용, 반대쪽은 차단."
```
