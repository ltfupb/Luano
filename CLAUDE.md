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
- Tailwind 다크 테마: surface/ink/accent/border 커스텀 색상
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

---

## 릴리즈 히스토리

- **v0.5.0** — UX 기본기 + 수익화 + AI 품질 강화
- **v0.4.0** — AI 코드 품질 개선 + Welcome 화면 + Full API RAG
- **v0.3.0** — Free/Pro 분리 + Studio 플러그인 + 멀티 AI
- **v0.2.0** — 인라인 편집 + RAG docs + Studio 브릿지 + Agent 모드
- **v0.1.0** — 에디터 + LSP + Rojo + AI 채팅 + 템플릿

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

### 3. Push + 태그

```bash
git push origin main
git tag v0.X.0
git push origin v0.X.0
```

**순서 중요**: main push → CI 통과 확인 → 태그 push. 태그를 먼저 걸면 빌드가 CI 실패한 코드로 돌아감.

### 4. 빌드 확인

```bash
gh run list --workflow=build.yml --limit 1 --repo ltfupb/Luano
gh run watch <RUN_ID> --repo ltfupb/Luano
```

`build.yml`이 `v*` 태그 push에 자동 트리거. Win/Mac/Linux 3개 플랫폼 빌드 후 `softprops/action-gh-release`가 자동으로 GitHub Release 생성 + 바이너리 첨부.

### 5. 릴리즈 설명 업데이트

`build.yml`의 `generate_release_notes: true`는 커밋 로그 기반 자동 생성. 수동으로 아래 형식에 맞춰 보강:

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

**규칙:**
- 버전명에 v 접두사 필수 (v0.5.0)
- 제목 첫줄: 쉼표 없이 간결하게 (예: `v0.5.0 — UX 기본기와 수익화`)
- Binaries 테이블 항상 포함
- .blockmap 어셋 삭제, latest.yml은 auto-update용으로 유지

```bash
gh release edit v0.X.0 --repo ltfupb/Luano --notes "$(cat <<'EOF'
여기에 위 형식대로 작성
EOF
)"
```

### 태그 재설정이 필요한 경우 (빌드 실패 등)

```bash
gh release delete v0.X.0 --repo ltfupb/Luano --yes  # 기존 릴리즈 삭제
git tag -d v0.X.0                                     # 로컬 태그 삭제
git push origin :refs/tags/v0.X.0                     # 원격 태그 삭제
# 수정 후 다시 태그 + push
git tag v0.X.0
git push origin v0.X.0
```
