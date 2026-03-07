# Auto DS Token Sync Design

## Problem

DS 라이브러리에서 브랜드 컬러 등을 변경하면 GitHub Actions가 `tokens.json` + `tokens.css`를 `stresslee/design-system` 리포에 커밋한다. 현재는 수동으로 `sync-tokens-from-github.sh`를 실행해야 로컬 `DESIGN_TOKENS.md`에 반영되는데, 최종 사용자(비개발자)는 이 과정을 모른다.

## Solution

Bridge 서버 시작 시 전체 동기화 + 디자인 생성 직전 GitHub commit SHA 비교로 자동 감지.

## Architecture

```
Figma DS 변경
  → GitHub Actions
  → tokens.json + tokens.css 커밋 (stresslee/design-system)

Bridge 시작 시:
  → sync-tokens-from-github.sh 실행
  → invalidateDSCaches()
  → ds/.last_sync_sha에 latest SHA 저장

batch_build_screen 호출 시:
  → GitHub API: GET /repos/stresslee/design-system/commits?path=tokens.json&per_page=1
  → latest SHA vs ds/.last_sync_sha 비교
  → 다르면: re-sync + invalidateDSCaches() + SHA 갱신
  → 같으면: skip
```

## Changes

### 1. `src/shared/ds-data.ts` — `syncTokensIfNeeded()` 추가

```typescript
export async function syncTokensIfNeeded(): Promise<boolean> {
  // 1. GitHub API로 tokens.json의 latest commit SHA 가져오기
  // 2. ds/.last_sync_sha 파일과 비교
  // 3. 다르면 sync-tokens-from-github.sh 실행 + invalidateDSCaches() + SHA 저장
  // 4. 같으면 skip, return false
  // 에러 시 로그만 남기고 false 반환 (디자인 생성 차단 안 함)
}

export function syncTokensFull(): void {
  // execSync('bash scripts/sync-tokens-from-github.sh')
  // SHA 저장 + invalidateDSCaches()
  // Bridge 시작 시 호출 (동기)
}
```

### 2. `src/bridge/index.ts` — 시작 시 sync

```typescript
async function main() {
  setProjectRoot(PROJECT_ROOT);

  // NEW: 시작 시 토큰 동기화
  syncTokensFull();

  // ... 나머지 서버 초기화
}
```

### 3. `src/main/figma-mcp-embedded.ts` — batch_build_screen에 체크

`batch_build_screen` 핸들러 시작부에:
```typescript
await syncTokensIfNeeded();
```

### 4. `ds/.last_sync_sha` — 새 파일

마지막 동기화 시점의 GitHub commit SHA 저장. `.gitignore`에 추가.

## Error Handling

| 상황 | 처리 |
|------|------|
| 네트워크 실패 (GitHub API) | 로그, skip — 기존 토큰 사용 |
| sync-to-agent.js 실패 | 로그, skip — 기존 파일 유지 |
| GitHub rate limit (403) | 로그, skip |
| tokens.json fetch 실패 | 로그, skip |

모든 에러는 디자인 생성을 차단하지 않는다.

## Files Changed

| 파일 | 변경 내용 |
|------|----------|
| `src/shared/ds-data.ts` | `syncTokensIfNeeded()`, `syncTokensFull()` 추가 |
| `src/bridge/index.ts` | 시작 시 `syncTokensFull()` 호출 |
| `src/main/figma-mcp-embedded.ts` | `batch_build_screen` 핸들러에 `syncTokensIfNeeded()` 추가 |
| `ds/.last_sync_sha` | 새 파일 (gitignored) |
| `.gitignore` | `ds/.last_sync_sha` 추가 |
