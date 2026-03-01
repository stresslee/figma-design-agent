# Figma Design Agent — 프로젝트 가이드

## 언어
- 항상 한글로 설명할 것

## 프로젝트 개요
AI 기반 Figma 디자인 생성 데스크톱 앱: Electron + React + Anthropic SDK

## 빌드 & 실행
```bash
npm run dev     # 빌드 + electron 실행
npm run build   # tsup + vite 빌드만
npm start       # electron . (이미 빌드된 상태에서)
```

## 아키텍처
- **Main Process** (`src/main/`): Agent orchestrator (Claude Sonnet 4), FigmaWSServer (port 8767), 58+ 내장 MCP 도구, 4개 DS 조회 도구, Gemini 이미지 생성, 스트리밍 파서
- **Renderer** (`src/renderer/`): React 19, ChatPanel, AgentStatus, FigmaConnection, SettingsPanel, useAgent hook
- **Preload** (`src/preload/`): Context bridge (IPC 보안 통신)
- **Shared** (`src/shared/`): 타입 정의, IPC 채널 상수, DS 데이터 로더
- **Build**: tsup (main+preload → CJS) + Vite (renderer), ws/sharp external

## 주요 파일
| 파일 | 역할 |
|------|------|
| `src/main/index.ts` | Electron 메인 프로세스 진입점, IPC 핸들러 |
| `src/main/agent-orchestrator.ts` | Claude API 기반 에이전트 오케스트레이터 |
| `src/main/figma-ws-server.ts` | Figma 플러그인 WebSocket 서버 (8767) |
| `src/main/figma-mcp-embedded.ts` | 58+ Figma MCP 도구 레지스트리 |
| `src/main/image-generator.ts` | Gemini API 이미지 생성 (동적 API 키) |
| `src/main/settings-store.ts` | 설정 저장소 (userData/settings.json) |
| `src/main/ds-lookup-tools.ts` | 디자인 시스템 조회 도구 4종 |
| `src/shared/types.ts` | 공유 타입 및 IPC 채널 상수 |
| `src/preload/index.ts` | Context bridge (electronAPI 노출) |
| `src/renderer/App.tsx` | 루트 React 컴포넌트 |
| `src/renderer/hooks/useAgent.ts` | 에이전트 상태 관리 훅 |
| `src/renderer/components/SettingsPanel.tsx` | Gemini API 키 설정 UI |
| `src/renderer/components/FigmaConnection.tsx` | Figma 연결 상태 UI |

## 설정 저장 방식
- `electron-store` v10은 ESM 전용이라 tsup CJS 번들링 불가
- 대신 `app.getPath('userData')/settings.json` + fs 사용
- `src/main/settings-store.ts`에서 `getGeminiApiKey()` / `setGeminiApiKey()` 제공

## 디자인 시스템 (DS-1)
- `ds/ds-1-icons.json`: 1141개 아이콘
- `ds/ds-1-variants.jsonl`: 154 컴포넌트, 4716 배리언트
- `ds/DESIGN_TOKENS.md`: 407 색상, 간격, 반경, 44 텍스트 스타일, 24 이펙트 스타일
- `ds/CLAUDE.md`: 디자인 규칙 및 DS 아키텍처

## 알려진 이슈
- DesignPreview 컴포넌트 참조되지만 미구현
- 테스트 없음 (단위/통합)
- Figma 도구 호출 캐싱 없음
