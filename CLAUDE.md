# Luano — CLAUDE.md

## 프로젝트 개요

Roblox 개발자를 위한 올인원 AI 바이브코딩 에디터 (Electron 데스크탑 앱).
"앱 열고 → AI에게 말로 시키면 → Luau 코드 작성 → Rojo로 Studio 동기화 → 에러 자동 수정"
Zero-setup: Rojo, Selene, StyLua, luau-lsp 전부 앱 안에 번들링.

기술 스택, 디렉토리 구조, 시스템 설계는 [ARCHITECTURE.md](ARCHITECTURE.md) 참조.

---

## 빌드 및 실행 명령어

```bash
npm run dev      # electron-vite dev (HMR, DevTools 자동 오픈)
npm run build    # electron-vite build
npm run preview  # 빌드 결과물 미리보기
npm run package  # electron-builder로 배포용 인스톨러 생성
```

출력:
- `out/main/` — Electron 메인 컴파일 결과
- `out/preload/` — preload 브릿지 컴파일 결과
- `out/renderer/` — React 앱 번들
- `release/` — 최종 인스톨러 (NSIS, DMG 등)

---

## 코딩 컨벤션

- TypeScript strict 모드
- Zustand 스토어: `persist` 플러그인으로 세션 복구
- Tailwind 테마 3종 (Dark / Light / Tokyo Night): CSS 커스텀 변수 기반, `data-theme` 속성으로 전환
- 사이드카 바이너리: `spawnSidecar()` 헬퍼 사용, 크래시 시 자동 재시작 (지수 백오프)
- IPC 핸들러명 컨벤션: `"domain:action"` (예: `"ai:chat-stream"`, `"project:open-folder"`)

---

## CI / 푸시 전 체크리스트 (반드시 준수)

> **과거 반복된 CI 실패 원인을 정리한 섹션. 코드 수정 후 push 전에 반드시 확인할 것.**

### 1. .gitignore된 Pro 파일은 절대 직접 import 금지

`.gitignore`에 등록된 파일은 CI에 존재하지 않는다. **반드시 `electron/pro/modules.ts`의 `tryRequire()` 패턴**을 통해 import하고 no-op 폴백을 제공해야 한다.

**gitignore된 Pro 파일 목록:**
```
electron/pro/impl.ts
electron/pro/internal-keys.ts
electron/ai/agent.ts
electron/ai/tools.ts
electron/ai/context.ts
electron/ai/rag.ts
electron/bridge/server.ts
electron/mcp/client.ts
electron/analysis/
electron/datastore/
electron/topology/
electron/telemetry/
src/ai/InlineEditOverlay.tsx
src/ai/DiffView.tsx
src/studio/
src/analysis/
src/datastore/
src/topology/
```

**잘못된 예 (CI 실패):**
```typescript
// ❌ 직접 import — CI에서 모듈 못 찾음
import { startBridgeServer } from "./bridge/server"
import { getLastCheckpoint } from "../ai/agent"
```

**올바른 예:**
```typescript
// ✅ pro/modules.ts를 통한 import — 없으면 no-op 폴백
import { startBridgeServer, getLastCheckpoint } from "./pro/modules"
```

### 2. preload.ts의 API와 env.d.ts 타입 동기화

`electron/preload.ts`에 새 API 함수를 추가하면 `src/env.d.ts`의 `Window.api` 인터페이스에도 반드시 추가해야 한다. 안 하면 renderer 코드에서 타입 에러.

### 3. 타입 리터럴 변경 시 모든 참조 업데이트

예: `RojoStatus` 타입에서 `"connected"`를 제거했으면, 코드 전체에서 `status === "connected"` 비교를 모두 제거해야 한다. TypeScript가 `This comparison appears to be unintentional` 에러를 낸다.

### 4. require() 대신 ES import 사용

ESLint `@typescript-eslint/no-require-imports` 규칙이 활성화되어 있다. 일반 코드에서 `require()` 사용 금지. 유일한 예외: `pro/modules.ts` (eslint-disable 주석으로 명시적 허용).

### 5. push 전 로컬 검증 명령어

```bash
npx tsc -p tsconfig.web.json --noEmit    # renderer 타입 체크
npx tsc -p tsconfig.node.json --noEmit   # main process 타입 체크
npx eslint "src/**/*.{ts,tsx}" "electron/**/*.ts" --max-warnings 20
```

세 명령어 모두 통과해야 CI가 통과한다. **반드시 push 전에 실행할 것.**

### 6. package-lock.json 동기화 — 반드시 `npm install`로 생성

CI는 `npm ci`를 사용하므로 `package.json`과 `package-lock.json`이 어긋나면 빌드가 실패한다.

**핵심 규칙: `npm install --package-lock-only` 사용 금지.**
이 명령은 현재 OS의 optional dependency만 resolve하므로, 다른 플랫폼(Linux CI)의 esbuild 바이너리가 lock file에서 누락된다.

**올바른 방법:**
```bash
# version bump 등으로 lock file 재생성이 필요할 때:
rm -f package-lock.json && npm install   # 전체 재생성 (모든 플랫폼 deps 포함)
git diff package-lock.json               # 변경 있으면 함께 커밋
```

**잘못된 방법 (CI 실패):**
```bash
# ❌ cross-platform esbuild deps 누락됨
npm install --package-lock-only
```

**주의:** Electron이 실행 중이면 `node_modules`가 잠겨서 `npm install`이 실패한다. 반드시 앱을 종료한 후 실행할 것.

---

## 릴리즈 히스토리

- **v0.7.4** — Security and Onboarding Fixes
- **v0.7.3** — Crash Reporting and Toolchain Auto-Update
- **v0.7.1** — Gemini and Local Model Support
- **v0.7.0** — Customizable Toolchain and Multi-Tool Support
- **v0.6.4** — Security and Stability
- **v0.6.3** — Studio Bridge Fix
- **v0.6.2** — Code Quality and Refactoring
- **v0.6.1** — UI Scaling and AI Panel Fixes
- **v0.6.0** — Some Remakes and Tiny Features
- **v0.5.0** — UX Polish and Pro Monetization
- **v0.4.0** — AI Code Quality and UX Improvements
- **v0.3.0** — Free/Pro Separation and Multi-AI
- **v0.2.0** — Inline Edit and Studio Bridge
- **v0.1.0** — Editor, LSP, Rojo and AI Chat

> **참고:** v0.7.2는 빌드 에셋 누락으로 삭제됨. v0.7.3에 변경사항 통합.

---

## 빌드 아키텍처 (Public + Private Repo)

> Pro 소스코드 보호를 위해 빌드를 분리한 구조.

| Repo | 공개 | 용도 |
|---|---|---|
| `ltfupb/Luano` | public | 소스 코드, 커뮤니티 기여, CI 체크 (타입체크/린트/테스트) |
| `ltfupb/luano-build` | private | Pro 파일 overlay + 릴리즈 빌드 → public repo에 릴리즈 발행 |

**빌드 흐름**: `luano-build` CI가 public repo checkout → `pro/` 폴더 overlay → 빌드 → public repo GitHub Releases에 발행.

**Pro 파일 수정 시**: `luano-build` repo의 `pro/` 폴더에서 수정 후 커밋/푸시.
public repo에서 인터페이스/타입을 변경하면 `luano-build`의 Pro 파일도 함께 업데이트할 것.

---

## 릴리즈 절차 (정형화)

> 매번 릴리즈할 때 실수 반복하지 않도록 정리한 표준 절차.

### 1. 코드 준비

```bash
# 1) package.json version bump
# 2) 변경사항 커밋
git add -A && git commit -m "v0.X.0: 릴리즈 설명"
```

### 2. 로컬 검증 (필수)

```bash
npx tsc -p tsconfig.web.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npx eslint "src/**/*.{ts,tsx}" "electron/**/*.ts" --max-warnings 20
```

**세 개 다 통과해야 push 가능. 하나라도 실패하면 태그 걸지 말 것.**

### 3. Public repo push + CI 확인

```bash
git push origin main
```

CI 체크 (타입체크/린트/테스트) 통과 확인 후 다음 단계로.

### 4. Pro 파일 동기화 (필요시)

public repo에서 Pro 파일이 참조하는 인터페이스/타입을 변경했다면:
```bash
cd C:/Users/USER/desktop/luano-build
# pro/ 폴더의 해당 파일 수정
git add -A && git commit -m "sync: match public repo changes"
git push origin main
```

### 5. 양쪽 repo에 태그 → 빌드 트리거

**public repo에도 태그 필요** — build workflow가 public repo를 태그 ref로 checkout하기 때문.

```bash
# public repo 태그
cd C:/Users/USER/desktop/luano
git tag v0.X.0
git push origin v0.X.0

# luano-build 태그 (빌드 트리거)
cd C:/Users/USER/desktop/luano-build
git tag v0.X.0
git push origin v0.X.0
```

`luano-build`의 `build.yml`이 자동 트리거:
1. public repo를 `v0.X.0` 태그로 checkout
2. `pro/` 폴더 overlay
3. Win/Mac/Linux 3개 runner에서 병렬 빌드
4. `electron-builder --publish always` → **public repo에 Draft 릴리즈 생성 + 에셋 업로드**

### 6. 빌드 확인 + 에셋 검증

```bash
# 빌드 진행 확인
gh run list --workflow=build.yml --limit 1 --repo ltfupb/luano-build
gh run watch <RUN_ID> --repo ltfupb/luano-build

# 에셋 검증 (10개여야 정상)
gh release view v0.X.0 --repo ltfupb/Luano --json assets --jq '.assets | length'
gh release view v0.X.0 --repo ltfupb/Luano --json assets --jq '.assets[].name'
```

**정상 에셋 목록 (10개):**
| 파일 | 용도 |
|------|------|
| `Luano-0.X.0-win-x64.exe` | Windows 인스톨러 |
| `Luano-0.X.0-win-x64.exe.blockmap` | Windows delta update |
| `Luano-0.X.0-mac-arm64.dmg` | macOS Apple Silicon |
| `Luano-0.X.0-mac-arm64.dmg.blockmap` | macOS ARM delta update |
| `Luano-0.X.0-mac-x64.dmg` | macOS Intel |
| `Luano-0.X.0-mac-x64.dmg.blockmap` | macOS Intel delta update |
| `Luano-0.X.0-linux-x86_64.AppImage` | Linux |
| `latest.yml` | Windows auto-update 매니페스트 |
| `latest-mac.yml` | macOS auto-update 매니페스트 |
| `latest-linux.yml` | Linux auto-update 매니페스트 |

**에셋이 10개 미만이면 빌드 일부가 실패한 것 — 태그 재설정 후 재빌드 필요.**

### 7. 릴리즈 Publish + 노트 작성

빌드가 Draft 상태로 생성되므로 수동으로 publish해야 함:

```bash
# Draft → Latest로 publish
gh release edit v0.X.0 --repo ltfupb/Luano --draft=false --latest

# 릴리즈 노트 + 제목 설정
gh release edit v0.X.0 --repo ltfupb/Luano --title "v0.X.0" --notes "$(cat <<'EOF'
## v0.X.0 — Short Summary in English

### Category (e.g. AI / UX / Stability / Toolchain)
- Change description

### Binaries

| File | Platform |
|------|----------|
| Luano-0.X.0-win-x64.exe | Windows x64 |
| Luano-0.X.0-mac-arm64.dmg | macOS Apple Silicon |
| Luano-0.X.0-mac-x64.dmg | macOS Intel |
| Luano-0.X.0-linux-x86_64.AppImage | Linux x64 |

**Full Changelog**: https://github.com/ltfupb/Luano/compare/v0.이전...v0.X.0
EOF
)"
```

**릴리즈 규칙:**
- **제목은 `vX.Y.Z` 형식만** (예: `v0.7.3`). 부가 설명은 본문에 작성.
- 노트 본문은 영어로 작성
- 요약 한줄에서 항목 연결은 `and` 사용 (`+`, `&` 금지)
- Binaries 테이블 항상 포함
- `.blockmap`과 `latest*.yml`은 auto-update용이므로 **삭제 금지**
- publish 시 `--latest` 플래그로 Latest 지정

### 태그 재설정이 필요한 경우 (빌드 실패, 에셋 누락 등)

```bash
# public repo 릴리즈 삭제
gh release delete v0.X.0 --repo ltfupb/Luano --yes

# luano-build 태그 삭제 + 재생성
cd C:/Users/USER/desktop/luano-build
git tag -d v0.X.0
git push origin :refs/tags/v0.X.0
# 수정 후 다시 태그 + push
git tag v0.X.0
git push origin v0.X.0
```

**주의:** public repo의 태그는 삭제하지 않아도 됨 — build workflow가 참조만 하므로 그대로 둬도 무방.

---

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

---

## Health Stack

- typecheck-web: npx tsc -p tsconfig.web.json --noEmit
- typecheck-node: npx tsc -p tsconfig.node.json --noEmit
- lint: npx eslint "src/**/*.{ts,tsx}" "electron/**/*.ts" --max-warnings 20
- test: npx vitest run
