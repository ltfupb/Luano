# Luano — CLAUDE.md

## 프로젝트 개요

Roblox 개발자를 위한 올인원 AI 바이브코딩 에디터 (Electron 데스크탑 앱).
"앱 열고 → AI에게 말로 시키면 → Luau 코드 작성 → Rojo로 Studio 동기화 → 에러 자동 수정"
Zero-setup: Rojo, Selene, StyLua, luau-lsp 전부 앱 안에 번들링.

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Shell | Electron 31 |
| Frontend | React 19 + TypeScript |
| Editor | Monaco Editor + monaco-languageclient |
| Bundler | Vite 5 (electron-vite) |
| State | Zustand (persist 플러그인) |
| Styling | Tailwind CSS + Radix UI |
| Terminal | xterm.js + node-pty |
| LSP | luau-lsp (stdio ↔ WebSocket bridge, port 6008) |
| AI | Claude API (primary), OpenAI (secondary), @anthropic-ai/sdk |
| DB | better-sqlite3 + FTS5 (Roblox docs RAG) |
| Sidecar | Rojo, Selene, StyLua, luau-lsp 바이너리 (resources/binaries/{win,mac,linux}/) |

---

## 디렉토리 구조

```
luano/
├── ARCHITECTURE.md              # 상세 설계 문서 (한국어)
├── electron/                    # Electron main process (Node.js)
│   ├── main.ts                  # BrowserWindow 생성, 앱 라이프사이클
│   ├── preload.ts               # contextBridge IPC API 노출
│   ├── store.ts                 # electron-store 기반 설정 저장
│   ├── pro/
│   │   ├── index.ts             # @luano/pro 인터페이스 + Feature gating (Free/Pro 분리)
│   │   └── modules.ts           # tryRequire() 기반 Pro 모듈 중앙 로더
│   ├── sidecar/                 # 외부 바이너리 프로세스 관리
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
│   │   ├── context.ts           # 3-레이어 컨텍스트 + topology/sourcemap 주입
│   │   ├── tools.ts             # AI 도구 12개 (lint_file 포함)
│   │   └── rag.ts               # FTS5 docs 검색
│   ├── file/
│   │   ├── project.ts           # 프로젝트 열기/생성
│   │   └── watcher.ts           # chokidar 파일 감시 (300ms debounce)
│   ├── ipc/
│   │   └── handlers.ts          # ipcMain.handle() 등록, Pro feature gating
│   ├── mcp/client.ts            # Studio MCP 클라이언트 (legacy)
│   ├── bridge/server.ts         # Studio HTTP polling 브릿지
│   ├── topology/analyzer.ts     # 의존성 그래프 + RemoteEvent 분석
│   ├── analysis/
│   │   ├── cross-script.ts      # 스크립트 간 참조 분석
│   │   └── performance-lint.ts  # 성능 안티패턴 감지
│   ├── datastore/
│   │   └── schema.ts            # DataStore 스키마 생성/마이그레이션
│   └── telemetry/
│       └── collector.ts         # 로컬 SQLite 텔레메트리 (opt-in)
│
├── src/                         # Renderer process (React)
│   ├── App.tsx                  # 루트 레이아웃
│   ├── main.tsx                 # React 엔트리포인트
│   ├── editor/                  # Monaco + LSP
│   │   ├── EditorPane.tsx       # 탭 바, 분할 뷰
│   │   ├── LuauLanguageClient.ts # WebSocket LSP 클라이언트
│   │   ├── LuauTokensProvider.ts # 문법 강조
│   │   └── LuauSnippets.ts     # 코드 스니펫
│   ├── ai/                      # AI 채팅 패널
│   │   ├── ChatPanel.tsx        # 메인 채팅 UI
│   │   ├── CodeBlock.tsx        # 코드 블록 렌더링 + DiffView 연동
│   │   ├── DiffView.tsx         # Pro: AI 수정 diff 비교
│   │   ├── InlineEditOverlay.tsx # Pro: Cmd+K 인라인 편집 오버레이
│   │   └── skills.ts            # 빌트인 AI 스킬 10개 (/explain, /fix 등)
│   ├── explorer/                # 파일 트리
│   ├── terminal/                # 내장 터미널 (xterm.js)
│   ├── rojo/                    # Rojo 패널 + 상태 표시
│   ├── studio/                  # Studio 브릿지 패널 (Pro)
│   ├── topology/                # Roblox 계층 시각화 (Pro)
│   ├── analysis/                # 크로스 스크립트 분석 (Pro)
│   ├── datastore/               # DataStore 스키마 관리 (Pro)
│   ├── components/              # 공유 UI
│   │   ├── Sidebar.tsx, StatusBar.tsx, SettingsPanel.tsx
│   │   ├── QuickOpen.tsx, SearchPanel.tsx
│   │   ├── ErrorBoundary.tsx, Toast.tsx, TutorialOverlay.tsx
│   ├── stores/                  # Zustand 스토어
│   │   ├── projectStore.ts      # 파일 트리, 열린 파일, 내용
│   │   ├── aiStore.ts           # 채팅 메시지, 스트리밍 상태, planMode
│   │   ├── rojoStore.ts         # Rojo 상태 + 로그
│   │   └── settingsStore.ts     # 사용자 설정
│   ├── hooks/                   # useIpc, useKeybindings, useFileWatcher
│   ├── lib/
│   │   └── loadPro.tsx          # Renderer Pro 컴포넌트 중앙 로더 (import.meta.glob)
│   └── i18n/                    # 다국어 (translations.ts, useT.ts)
│
├── resources/
│   ├── binaries/{win,mac,linux}/  # 플랫폼별 바이너리
│   ├── roblox-docs/roblox_docs.db # FTS5 사전인덱싱 DB
│   ├── type-defs/globalTypes.d.luau
│   ├── studio-plugin/LuanoPlugin.lua
│   └── templates/empty/           # 프로젝트 템플릿
│
├── packages/doc-indexer/        # 빌드타임 Roblox 문서 → SQLite FTS5 인덱서
├── scripts/download-binaries.ts
└── .github/workflows/
    ├── ci.yml                   # lint + typecheck
    └── build.yml                # 3-platform build + auto GitHub Release
```

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

## 핵심 아키텍처 패턴

### IPC 통신
```typescript
// preload.ts에서 contextBridge로 노출
window.api.openFolder()
window.api.aiChatStream(messages, context, onChunk)

// 스트리밍 AI 응답
const channel = `ai:stream:${Date.now()}`;
ipcRenderer.on(channel, (_, chunk) => updateMessage(chunk));
win.webContents.send(channel, null); // null = 스트림 종료
```

### LSP 브릿지
```
Monaco (renderer) ↔ WebSocket (port 6008) ↔ Node.js main ↔ luau-lsp stdio
```

### AI 시스템
- `provider.ts`: 기본 채팅/스트리밍, Prompt Caching 유틸, 클라이언트 관리
- `agent.ts`: Pro Agent loop (Anthropic + OpenAI 양쪽 tool use, MAX_ROUNDS 15)
- Prompt Caching: `toCachedSystem()`이 시스템 프롬프트를 정적 규칙(캐시) + 동적 컨텍스트로 분리

### Pro 모듈 로딩
- Backend: `electron/pro/modules.ts` — `tryRequire()` 패턴, 모든 Pro 함수를 no-op 폴백과 함께 export
- Frontend: `src/lib/loadPro.tsx` — `import.meta.glob` + `React.lazy`로 Pro 패널/컴포넌트 동적 로딩
- Dev: `LUANO_PRO=1` 환경변수로 Pro 모드 활성화, electron-vite가 `preserveModules: true`로 빌드

### AI 컨텍스트 3레이어
1. **Global Summary** (~500 tokens): 프로젝트 구조 + 모듈 exports (정규식 기반 추출, 자동 재생성)
2. **Local Context**: 현재 파일 + requires + diagnostics
3. **On-Demand RAG**: Roblox 문서 FTS5 검색

### 파일 변경 워크플로우
`chokidar 감지` → `StyLua 포맷` → `Selene 린트` → `renderer IPC 알림` (300ms debounce)

---

## 개발 단계 로드맵

| 단계 | 내용 | 상태 |
|------|------|------|
| **Phase 1** | 에디터, LSP, Rojo, AI 채팅, 템플릿 | ✅ 완료 |
| **Phase 2** | 인라인 편집, RAG docs, Studio 브릿지, 에러 설명, Agent 모드 | ✅ 완료 |
| **Phase 3** | Free/Pro 분리, Studio 플러그인, 텔레메트리, 멀티 AI (OpenAI), Prompt Caching | ✅ 완료 |
| **Phase 4** | 플레이테스트 자동화, 화면 캡처, 플러그인 시스템 | 예정 |

---

## 보안 설정

- `contextIsolation: true`, `nodeIntegration: false`
- preload bridge에서만 명시적 API 노출
- API 키는 `electron-store` 저장 (향후 OS keychain)
- CSP: `api.anthropic.com`만 허용
- Privacy mode: AI에 코드 전송 안 함 토글

---

## 코딩 컨벤션

- TypeScript strict 모드
- Zustand 스토어: `persist` 플러그인으로 세션 복구
- Tailwind 다크 테마: surface/ink/accent/border 커스텀 색상
- 사이드카 바이너리: `spawnSidecar()` 헬퍼 사용, 크래시 시 자동 재시작 (지수 백오프)
- IPC 핸들러명 컨벤션: `"domain:action"` (예: `"ai:chat-stream"`, `"project:open-folder"`)
