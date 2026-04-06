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

- **v0.7.0** — Customizable Toolchain + Multi-Tool Support
- **v0.6.4** — Security + Stability + Test Coverage
- **v0.6.3** — English Comments + Bridge Fix
- **v0.6.2** — Code Optimization + Refactoring
- **v0.6.1** — CI Fix + Vitest Downgrade
- **v0.6.0** — Light Theme + Split Editor + UX Polish
- **v0.5.0** — UX 기본기 + 수익화 + AI 품질 강화
- **v0.4.0** — AI 코드 품질 개선 + Welcome 화면 + Full API RAG
- **v0.3.0** — Free/Pro 분리 + Studio 플러그인 + 멀티 AI
- **v0.2.0** — 인라인 편집 + RAG docs + Studio 브릿지 + Agent 모드
- **v0.1.0** — 에디터 + LSP + Rojo + AI 채팅 + 템플릿

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
# 1) version bump (package.json)
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

### 3. Public repo push

```bash
git push origin main
```

CI 체크 (타입체크/린트/테스트) 통과 확인.

### 4. Pro 파일 동기화 (필요시)

public repo에서 Pro 파일이 참조하는 인터페이스/타입을 변경했다면:
```bash
cd C:/Users/USER/desktop/luano-build
# pro/ 폴더의 해당 파일 수정
git add -A && git commit -m "sync: match public repo changes"
git push origin main
```

### 5. 릴리즈 빌드 (luano-build에서 태그)

```bash
cd C:/Users/USER/desktop/luano-build
git tag v0.X.0
git push origin v0.X.0
```

`luano-build`의 `build.yml`이 자동 트리거 → public repo checkout + Pro overlay → Win/Mac/Linux 빌드 → **public repo에 릴리즈 발행**.

### 6. 빌드 확인

```bash
gh run list --workflow=build.yml --limit 1 --repo ltfupb/luano-build
gh run watch <RUN_ID> --repo ltfupb/luano-build
```

### 7. 릴리즈 설명 업데이트

```markdown
## v0.X.0 — 쉼표 없이 짧은 한줄 요약

### 카테고리 (예: AI / UX / Fixes)
- 변경사항 설명

### Binaries

| File | Platform |
|------|----------|
| Luano-0.X.0-win-x64.exe | Windows x64 |
| Luano-0.X.0-mac-arm64.dmg | macOS Apple Silicon |
| Luano-0.X.0-mac-x64.dmg | macOS Intel |
| Luano-0.X.0-linux-x86_64.AppImage | Linux x64 |

**Full Changelog**: https://github.com/ltfupb/Luano/compare/v0.이전...v0.X.0
```

```bash
gh release edit v0.X.0 --repo ltfupb/Luano --notes "$(cat <<'EOF'
여기에 위 형식대로 작성
EOF
)"
```

**규칙:**
- **릴리즈 제목은 `vX.Y.Z` 형식만 사용** (예: `v0.6.3`). 부가 설명은 제목에 넣지 말고 본문에 작성.
- 릴리즈 노트 본문은 영어로 작성
- Binaries 테이블 항상 포함
- .blockmap과 latest.yml은 auto-update용이므로 삭제 금지

### 태그 재설정이 필요한 경우 (빌드 실패 등)

```bash
gh release delete v0.X.0 --repo ltfupb/Luano --yes  # 기존 릴리즈 삭제
# luano-build에서:
git tag -d v0.X.0
git push origin :refs/tags/v0.X.0
# 수정 후 다시 태그 + push
git tag v0.X.0
git push origin v0.X.0
```

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
