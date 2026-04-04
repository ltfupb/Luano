# Luano Architecture

## 1. Product Vision

Luano는 Roblox 개발자를 위한 올인원 AI 바이브코딩 에디터.
앱 열고, 말로 시키면, AI가 Luau 코드 작성 → Rojo로 Studio 동기화 → 에러 읽고 자동 수정.
Zero setup: 모든 도구(Rojo, Selene, StyLua, luau-lsp)가 앱 안에 번들링.

---

## 2. License

- **FSL-1.1-ALv2** (Functional Source License) — 릴리즈 후 2년 경과 시 Apache 2.0 자동 전환
- **Private repo (@luano/pro)** — 독점 라이선스. AI Agent, Studio Bridge, 분석 도구

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 31 |
| Frontend | React 19 + TypeScript |
| Editor | Monaco Editor + monaco-languageclient |
| Bundler | Vite 5 (electron-vite) |
| State | Zustand (persist) |
| Styling | Tailwind CSS + Radix UI |
| Terminal | xterm.js + node-pty |
| LSP | luau-lsp (stdio ↔ WebSocket bridge, port 6008) |
| AI | Claude API (primary), OpenAI (secondary), @anthropic-ai/sdk |
| RAG | better-sqlite3 + FTS5 |
| Update | electron-updater (GitHub Releases auto-update) |
| License | LemonSqueezy License API (Pro 구독 관리) |
| Sidecar | Rojo, Selene, StyLua, luau-lsp (resources/binaries/{win,mac,linux}/) |

---

## 4. Project Structure

```
luano/
├── electron/                    # Electron main process (Node.js)
│   ├── main.ts                  # BrowserWindow 생성, 앱 라이프사이클
│   ├── preload.ts               # contextBridge IPC API 노출
│   ├── store.ts                 # electron-store 기반 설정 저장
│   ├── updater.ts               # electron-updater 자동 업데이트
│   ├── pro/
│   │   ├── index.ts             # @luano/pro 인터페이스 + Feature gating (Free/Pro 분리)
│   │   ├── license.ts           # LemonSqueezy 라이센스 관리
│   │   └── modules.ts           # tryRequire() 기반 Pro 모듈 중앙 로더
│   ├── sidecar/
│   │   ├── index.ts             # spawnSidecar() 공통 헬퍼
│   │   ├── rojo.ts              # Rojo serve/build/sourcemap
│   │   ├── selene.ts            # Selene 린터
│   │   └── stylua.ts            # StyLua 포매터
│   ├── lsp/
│   │   ├── manager.ts           # luau-lsp 스폰 + WebSocket 브릿지
│   │   └── bridge.ts            # stdio ↔ WebSocket 변환
│   ├── ai/
│   │   ├── provider.ts          # Claude/OpenAI 기본 채팅/스트리밍 + Prompt Caching
│   │   ├── agent.ts             # Agent loop (Anthropic + OpenAI 양쪽 tool use)
│   │   ├── evaluator.ts         # AI 코드 품질 평가기 (VERIFY 단계 독립 평가)
│   │   ├── context.ts           # 3-레이어 컨텍스트 빌더 + topology/sourcemap 주입
│   │   ├── tools.ts             # AI 도구 12개 (lint_file 포함)
│   │   ├── memory.ts            # AI 대화 자동 메모리 감지/저장
│   │   └── rag.ts               # FTS5 docs 검색
│   ├── file/
│   │   ├── project.ts           # 프로젝트 열기/생성
│   │   └── watcher.ts           # chokidar 파일 감시 (300ms debounce)
│   ├── ipc/
│   │   └── handlers.ts          # ipcMain.handle() 등록, Pro feature gating
│   ├── bridge/
│   │   └── server.ts            # Studio 실시간 HTTP polling 브릿지
│   ├── mcp/
│   │   └── client.ts            # Studio MCP 클라이언트 (legacy)
│   ├── topology/
│   │   └── analyzer.ts          # sourcemap.json 파싱 + 의존성 그래프
│   ├── analysis/
│   │   ├── cross-script.ts      # 스크립트 간 참조 분석
│   │   └── performance-lint.ts  # 성능 안티패턴 감지
│   ├── datastore/
│   │   └── schema.ts            # DataStore 스키마 생성/마이그레이션
│   └── telemetry/
│       └── collector.ts         # 로컬 SQLite 텔레메트리 (opt-in)
│
├── src/                         # Renderer process (React)
│   ├── App.tsx
│   ├── main.tsx
│   ├── editor/
│   │   ├── EditorPane.tsx       # 탭 바, Split Editor (좌우 분할), 테마별 Monaco 설정
│   │   ├── LuauLanguageClient.ts # WebSocket LSP 클라이언트
│   │   ├── LuauTokensProvider.ts # 문법 강조
│   │   └── LuauSnippets.ts     # 코드 스니펫
│   ├── ai/
│   │   ├── ChatPanel.tsx        # AI 채팅 패널
│   │   ├── CodeBlock.tsx        # 코드 블록 렌더링 + DiffView 연동
│   │   ├── DiffView.tsx         # Pro: AI 수정 diff 비교
│   │   ├── InlineEditOverlay.tsx # Pro: Cmd+K 인라인 편집 오버레이
│   │   └── skills.ts            # 빌트인 AI 스킬 10개 (/explain, /fix 등)
│   ├── explorer/
│   │   └── FileExplorer.tsx     # 파일 트리
│   ├── terminal/
│   │   └── TerminalPane.tsx     # 내장 터미널 (xterm.js)
│   ├── rojo/
│   │   └── RojoPanel.tsx        # Rojo 패널 + 상태 표시
│   ├── studio/
│   │   ├── StudioPanel.tsx      # Pro: Studio 브릿지 패널
│   │   └── InstanceTree.tsx     # Pro: 인스턴스 트리 뷰
│   ├── topology/
│   │   └── TopologyPanel.tsx    # Pro: Roblox 계층 시각화
│   ├── analysis/
│   │   └── CrossScriptPanel.tsx # Pro: 크로스 스크립트 분석
│   ├── datastore/
│   │   └── DataStorePanel.tsx   # Pro: DataStore 스키마 관리
│   ├── components/              # 공유 UI
│   │   ├── Sidebar.tsx
│   │   ├── StatusBar.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── QuickOpen.tsx
│   │   ├── SearchPanel.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── Toast.tsx
│   │   └── TutorialOverlay.tsx
│   ├── stores/
│   │   ├── projectStore.ts      # 파일 트리, 열린 파일, 내용
│   │   ├── aiStore.ts           # 채팅 메시지, 스트리밍 상태, planMode, chatHistory persist
│   │   ├── rojoStore.ts         # Rojo 상태 + 로그
│   │   └── settingsStore.ts     # 사용자 설정
│   ├── sync/
│   │   └── SyncPanel.tsx        # Rojo + Studio Bridge 통합 Sync 패널
│   ├── hooks/
│   │   ├── useIpc.ts
│   │   ├── useKeybindings.ts
│   │   └── usePanelResize.ts    # 드래그 리사이즈 훅 (터미널, 사이드패널, 채팅)
│   ├── lib/
│   │   └── loadPro.tsx          # Renderer Pro 컴포넌트 중앙 로더 (import.meta.glob)
│   └── i18n/
│       ├── translations.ts
│       └── useT.ts
│
├── resources/
│   ├── binaries/{win,mac,linux}/
│   ├── roblox-docs/roblox_docs.db
│   ├── type-defs/globalTypes.d.luau
│   ├── studio-plugin/LuanoPlugin.lua
│   └── templates/empty/         # 프로젝트 템플릿
│
├── tests/                       # Vitest 테스트
│   ├── memory.test.ts
│   └── provider.test.ts
├── packages/doc-indexer/        # 빌드타임 Roblox 문서 → SQLite FTS5 인덱서
├── scripts/download-binaries.ts
├── vitest.config.ts
└── .github/workflows/
    ├── ci.yml                   # lint + typecheck
    └── build.yml                # 3-platform build + auto GitHub Release
```

---

## 5. Core Systems

### 5.1 IPC 통신

```typescript
// preload.ts에서 contextBridge로 노출
window.api.openFolder()
window.api.aiChatStream(messages, context, onChunk)

// 스트리밍 AI 응답
const channel = `ai:stream:${Date.now()}`;
ipcRenderer.on(channel, (_, chunk) => updateMessage(chunk));
win.webContents.send(channel, null); // null = 스트림 종료
```

### 5.2 LSP Bridge

```
Monaco (renderer) ↔ WebSocket (port 6008) ↔ Node.js main ↔ luau-lsp stdio
```

- luau-lsp flags: `--definitions=globalTypes.d.luau --sourcemap=sourcemap.json`
- 크래시 시 자동 재시작
- 기능: autocomplete, diagnostics, hover, go-to-def, rename, inlay hints

### 5.3 Sidecar Binary Management

모든 바이너리는 `spawnSidecar()` 헬퍼로 관리. 크래시 시 지수 백오프 재시작.

- **Rojo**: 프로젝트 열면 자동 serve + sourcemap watch
- **StyLua**: 파일 변경 시 자동 포맷
- **Selene**: 파일 변경 시 자동 린트 (300ms debounce)
- **luau-lsp**: 프로젝트 열면 자동 시작

**파일 변경 워크플로우**:
```
chokidar 감지 → StyLua 포맷 → Selene 린트 → renderer IPC 알림 (300ms debounce)
```

### 5.4 AI System

**아키텍처 분리**:
- `provider.ts`: 기본 채팅/스트리밍, Prompt Caching, 클라이언트 관리
- `agent.ts`: Agent loop (Pro) — Anthropic + OpenAI 양쪽 tool use 지원

**Phase-based Agent Loop (Claude Code subagent 패턴 참조)**:
- 3단계 실행: EXPLORE → EXECUTE → VERIFY
- EXPLORE: 읽기 전용 도구만 제공 (`read_file`, `list_files`, `grep_files`, `search_docs`, `read_instance_tree`, `get_runtime_logs`). 코드 이해 후 실행으로 전환
- EXECUTE: 전체 도구. 파일 생성/수정/삭제 + lint 검증
- VERIFY: 실행 완료 후 수정된 모든 .lua/.luau 파일 자동 lint → ERROR만 수정 (WARNING 무시), 동일 에러 반복 시 자동 중단
- 순수 질문(`?`, `뭐야`, `explain` 등)은 EXPLORE 건너뛰고 바로 EXECUTE
- Anthropic: `messages.stream()` + `tool_use` stop reason
- OpenAI: `chat.completions.create()` + function calling
- MAX_ROUNDS (15) + MAX_VERIFY_ROUNDS (3), 동일한 abort/retry 로직

**Phase별 tool_choice**:
- EXPLORE 첫 라운드: tool 사용 강제 (`any` / `required`)
- EXECUTE 첫 라운드: tool 사용 강제 (질문 제외)
- 이후 라운드: `auto`

**Scope Discipline (Claude Code 참조)**:
- 시스템 프롬프트에 "하지 마" 규칙 포함 — 요청 범위 밖 리팩토링/기능 추가/과잉 추상화 방지
- 건드리지 않은 코드에 주석/타입 추가 금지, 불가능한 시나리오 에러 핸들링 금지

**Prompt Caching (Anthropic)**:
- `toCachedSystem()`: 시스템 프롬프트를 "PROJECT CONTEXT:" 마커 기준으로 분리
  - 정적 규칙 (~3K tokens): `cache_control: { type: "ephemeral" }` → 캐시 히트 시 90% 비용 절약
  - 동적 컨텍스트: 캐시 없음
- `toCachedTools()`: 마지막 tool 정의에 `cache_control` 추가 → 전체 tool 스키마 캐시

**AI 도구 12개**:
`read_file`, `edit_file`, `create_file`, `delete_file`, `list_files`, `grep_files`, `search_docs`, `lint_file`, `read_instance_tree`, `get_runtime_logs`, `run_studio_script`, `set_property`

**AI Skills 10개** (`src/ai/skills.ts`):
`/explain`, `/fix`, `/optimize`, `/refactor`, `/test`, `/type`, `/doc`, `/security`, `/convert`, `/scaffold`

**Phase 전환 흐름**:
1. EXPLORE: `list_files`, `read_file`, `grep_files`로 프로젝트 이해 → `end_turn` 시 전환 메시지 주입
2. EXECUTE: `create_file`, `edit_file`로 수정 → `end_turn` 시 자동 lint 검증
3. VERIFY: ERROR만 자동 수정 (WARNING 무시), 동일 에러 반복 시 중단

**AI Evaluator** (`evaluator.ts`):
- 별도 AI API 호출로 코드 품질 평가 (1-10점)
- Luau/Roblox 특화 기준: 메모리 누수, RemoteEvent 검증, task 라이브러리 사용
- 단일 파일 + 배치 평가 지원 (Pro 전용)
- VERIFY 단계에서 lint 외 추가 품질 게이트로 사용

**4-레이어 컨텍스트**:
1. Global Summary (~500 tokens): 프로젝트 구조 + 모듈 exports + topology 의존성 + sourcemap instance map
2. Local Context: 현재 파일 + diagnostics + 첨부 파일
3. API Context: 현재 파일에서 감지된 Roblox 서비스/클래스의 Full API 정의 (`api-context.ts`)
4. On-Demand RAG: Roblox 문서 FTS5 검색 (8,528 entries)

**Session Handoff**:
- 새 세션 시작 시 이전 대화의 마지막 assistant 응답 + user 토픽을 `sessionHandoff`로 저장
- 다음 세션의 시스템 프롬프트에 자동 주입 → 맥락 연속성
- Progress file (`.luano/progress.md`)과 함께 장기 작업 지원

### 5.5 Editor

**Split Editor**: 좌우 분할 편집. 토글 버튼으로 활성화, 우측 패널은 파일 드롭다운으로 독립 선택. 파일 닫힘 시 자동 해제.

**테마 시스템**: Dark / Light / Tokyo Night 3종. CSS 커스텀 변수(`data-theme` 속성) + Monaco 테마(`luano-dark`, `luano-light`, `luano-tokyo-night`) + Terminal 테마 동기화.

**앱 종료 미저장 확인**: `mainWindow.on("close")`에서 `dirtyFiles` 개수 확인 → 네이티브 다이얼로그 (Save & Quit / Quit without Saving / Cancel). `__luanoDirtyCount()`, `__luanoSaveAll()` 글로벌 함수를 renderer에서 노출.

### 5.6 Studio Bridge

HTTP polling 기반. Roblox Studio 플러그인(`LuanoPlugin.lua`)이 주기적으로 Luano에 요청.

- Instance tree 읽기
- Console 로그/에러 수집
- Luau 스크립트 원격 실행
- 인스턴스 프로퍼티 수정

AI 시스템 프롬프트에 Studio Testing Loop 포함: 코드 수정 → 자동 테스트 → 에러 감지 → 자동 수정.

### 5.7 Topology Analyzer

`sourcemap.json` + 소스 코드 정적 분석으로:
- `require()` 의존성 그래프 생성
- `RemoteEvent` fire/receive 관계 추출
- 핸들러 없는 Remote 경고 (빨간 노드 + 헤더 카운트)
- 결과를 UI 시각화 + AI 컨텍스트에 주입

---

## 6. Community vs Pro

| 기능 | Community (Free) | Pro |
|------|:-:|:-:|
| Monaco + Luau LSP | O | O |
| Rojo, Selene, StyLua | O | O |
| File explorer, Terminal | O | O |
| Project templates | O | O |
| AI Chat (BYOK, Q&A) | O | O |
| AI Agent mode | - | O |
| Inline AI Edit (Cmd+K) | - | O |
| Roblox Docs RAG | - | O |
| Studio Live Bridge | - | O |
| Cross-script analysis | - | O |
| Performance lint | - | O |
| DataStore schema generator | - | O |

**Pro 모듈 로딩**:
- Backend: `electron/pro/modules.ts`에서 `tryRequire()` 패턴으로 중앙 관리. 모든 Pro 함수를 no-op 폴백과 함께 export
- Frontend: `src/lib/loadPro.tsx`에서 `import.meta.glob` + `React.lazy`로 Pro 패널/컴포넌트 동적 로딩
- Feature gate: `electron/pro/index.ts`에서 LemonSqueezy 라이센스 또는 `@luano/pro` 패키지 또는 `LUANO_PRO=1` 환경변수로 판별
- License: `electron/pro/license.ts` — LemonSqueezy public API, product_id 검증 (937319), 오프라인 grace
- Dev build: `LUANO_PRO=1`일 때 electron-vite가 `preserveModules: true`로 빌드하여 동적 require() 경로 유지

### 6.1 Auto-Update

- `electron/updater.ts`: electron-updater 기반 자동 업데이트
- GitHub Releases의 `latest.yml`을 읽어 새 버전 감지
- 시작 10초 후 자동 체크 → StatusBar에 상태 표시
- 수동 다운로드 + 재시작 설치 (autoDownload: false)

---

## 7. Security

| 위협 | 대응 |
|---|---|
| API 키 저장 | electron-store (향후 OS keychain) |
| AI에 코드 노출 | Privacy mode 토글 |
| Studio Bridge | 명시적 플러그인 설치, localhost only |
| Sidecar 무결성 | 다운로드 시 파일 크기 검증 |
| Electron 보안 | contextIsolation: true, nodeIntegration: false, CSP |

---

## 8. Build & CI

```bash
npm run dev        # electron-vite dev (HMR)
npm run build      # electron-vite build
npm run package    # electron-builder (NSIS/DMG/AppImage)
npm run lint       # ESLint
npm run typecheck  # TypeScript 타입 체크
```

**Pro Dev 빌드**: `LUANO_PRO=1 npm run dev` — `preserveModules: true`로 빌드, 동적 require() 경로 유지

GitHub Actions:
- `ci.yml`: lint + typecheck
- `build.yml`: Windows, macOS, Linux 매트릭스 빌드 + `v*` 태그 푸시 시 자동 GitHub Release
- 바이너리 자동 다운로드 (`scripts/download-binaries.ts`)
