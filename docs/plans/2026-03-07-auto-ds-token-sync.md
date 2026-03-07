# Auto DS Token Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bridge 서버가 자동으로 GitHub의 최신 DS 토큰을 감지하고 동기화하여, 비개발자 사용자가 항상 최신 디자인 시스템으로 디자인을 생성할 수 있게 한다.

**Architecture:** Bridge 시작 시 `sync-tokens-from-github.sh`로 전체 동기화. 디자인 생성(`batch_build_screen`) 직전에 GitHub API로 `tokens.json`의 latest commit SHA를 비교하여 변경 시에만 re-sync. 모든 에러는 non-blocking.

**Tech Stack:** Node.js (execSync, https), existing `sync-tokens-from-github.sh`, GitHub REST API

---

### Task 1: `syncTokensFull()` — Bridge 시작 시 전체 동기화

**Files:**
- Modify: `src/shared/ds-data.ts:70-76` (캐시 무효화 함수 근처)

**Step 1: 구현 — `syncTokensFull()` 함수 추가**

`src/shared/ds-data.ts` 맨 아래에 추가:

```typescript
import { execSync } from 'child_process';

const GITHUB_REPO = 'stresslee/design-system';
const GITHUB_FILE = 'tokens.json';

function getShaFilePath(): string {
  return path.join(getDsDir(), '.last_sync_sha');
}

function getStoredSha(): string | null {
  const shaPath = getShaFilePath();
  if (fs.existsSync(shaPath)) {
    return fs.readFileSync(shaPath, 'utf-8').trim();
  }
  return null;
}

function storeSha(sha: string): void {
  fs.writeFileSync(getShaFilePath(), sha, 'utf-8');
}

async function fetchLatestSha(): Promise<string | null> {
  return new Promise((resolve) => {
    const https = require('https');
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/commits?path=${GITHUB_FILE}&per_page=1`,
      headers: { 'User-Agent': 'figma-design-agent' },
    };
    https.get(options, (res: any) => {
      if (res.statusCode !== 200) {
        resolve(null);
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const commits = JSON.parse(data);
          resolve(commits[0]?.sha || null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

/** Full sync at bridge startup (synchronous). */
export function syncTokensFull(): void {
  const scriptPath = path.join(getRoot(), 'scripts', 'sync-tokens-from-github.sh');
  if (!fs.existsSync(scriptPath)) {
    console.warn('[DS Sync] sync script not found:', scriptPath);
    return;
  }
  try {
    console.log('[DS Sync] Syncing tokens from GitHub...');
    execSync(`bash "${scriptPath}"`, { cwd: getRoot(), stdio: 'pipe', timeout: 30000 });
    invalidateDSCaches();
    // Store SHA after successful sync
    fetchLatestSha().then((sha) => {
      if (sha) storeSha(sha);
    });
    console.log('[DS Sync] Sync complete.');
  } catch (err) {
    console.warn('[DS Sync] Sync failed, using existing tokens:', (err as Error).message);
  }
}

/** Lightweight check before design generation. Re-syncs only if SHA changed. */
export async function syncTokensIfNeeded(): Promise<boolean> {
  try {
    const latestSha = await fetchLatestSha();
    if (!latestSha) return false;

    const storedSha = getStoredSha();
    if (latestSha === storedSha) return false;

    console.log('[DS Sync] Token change detected, re-syncing...');
    const scriptPath = path.join(getRoot(), 'scripts', 'sync-tokens-from-github.sh');
    execSync(`bash "${scriptPath}"`, { cwd: getRoot(), stdio: 'pipe', timeout: 30000 });
    invalidateDSCaches();
    storeSha(latestSha);
    console.log('[DS Sync] Re-sync complete.');
    return true;
  } catch (err) {
    console.warn('[DS Sync] Check failed, continuing with existing tokens:', (err as Error).message);
    return false;
  }
}
```

**Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공

**Step 3: 커밋**

```bash
git add src/shared/ds-data.ts
git commit -m "feat: add syncTokensFull and syncTokensIfNeeded for auto DS sync"
```

---

### Task 2: Bridge 시작 시 `syncTokensFull()` 호출

**Files:**
- Modify: `src/bridge/index.ts:52-56`

**Step 1: import 추가 및 호출**

`src/bridge/index.ts` 상단 import에 추가:
```typescript
import { setProjectRoot, syncTokensFull } from '../shared/ds-data';
```

`main()` 함수의 `setProjectRoot(PROJECT_ROOT);` 바로 다음에:
```typescript
  // Auto-sync DS tokens from GitHub on startup
  syncTokensFull();
```

**Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공

**Step 3: 커밋**

```bash
git add src/bridge/index.ts
git commit -m "feat: auto-sync DS tokens on bridge startup"
```

---

### Task 3: `batch_build_screen`에 `syncTokensIfNeeded()` 추가

**Files:**
- Modify: `src/main/figma-mcp-embedded.ts:640` (batch_build_screen 핸들러 시작부)

**Step 1: import 추가**

`src/main/figma-mcp-embedded.ts` 상단 import에 `syncTokensIfNeeded` 추가:
```typescript
import { ..., syncTokensIfNeeded } from '../shared/ds-data';
```

**Step 2: 핸들러에 체크 삽입**

`batch_build_screen` 핸들러의 연결 체크(`if (!figmaWS.isConnected)`) 바로 다음, `hasParentId` 전에:
```typescript
    // Auto-check for DS token updates before building
    await syncTokensIfNeeded();
```

**Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공

**Step 4: 커밋**

```bash
git add src/main/figma-mcp-embedded.ts
git commit -m "feat: check DS token updates before batch_build_screen"
```

---

### Task 4: `.gitignore`에 SHA 파일 추가

**Files:**
- Modify: `.gitignore`

**Step 1: 추가**

`.gitignore` 끝에:
```
# DS sync state
ds/.last_sync_sha
```

**Step 2: 커밋**

```bash
git add .gitignore
git commit -m "chore: gitignore ds/.last_sync_sha"
```

---

### Task 5: 수동 테스트

**Step 1: Bridge 시작 시 sync 확인**

Run: `npm run build && npm run bridge`
Expected: 로그에 `[DS Sync] Syncing tokens from GitHub...` → `[DS Sync] Sync complete.` 출력

**Step 2: SHA 파일 확인**

Run: `cat ds/.last_sync_sha`
Expected: 40자 SHA 해시 출력

**Step 3: 재시작 시 skip 확인**

Bridge 재시작 후, 디자인 생성 요청 시 로그에 `[DS Sync] Token change detected` 가 나오지 않으면 skip 정상 동작.
