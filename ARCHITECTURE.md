# Luano Architecture Design Document

## 1. Product Vision

Luano는 Roblox 개발자를 위한 올인원 바이브코딩 에디터.
앱 열고, 말로 시키면, AI가 Luau 코드 작성 → Rojo로 Studio 동기화 → 에러 읽고 자동 수정.
Zero setup: 모든 도구(Rojo, Selene, StyLua, luau-lsp)가 앱 안에 번들링.

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Shell** | Electron | Cursor/VS Code와 동일, AI 코드 생성 성공률 최고 |
| **Frontend** | React 19 + TypeScript | Monaco 통합, 생태계 성숙 |
| **Editor** | Monaco Editor | VS Code 엔진, LSP client 네이티브 지원 |
| **Bundler** | Vite | 빠른 HMR, tree-shaking |
| **State** | Zustand | 경량, 보일러플레이트 없음 |
| **Styling** | Tailwind CSS + Radix UI | 유틸리티 CSS, 접근성 컴포넌트 |
| **Terminal** | xterm.js + node-pty | 검증된 조합 (VS Code가 사용) |
| **LSP** | monaco-languageclient + Node.js stdio | Node가 luau-lsp 프로세스 관리, stdio 직접 연결 |
| **AI Backend** | Claude API (primary) | 스트리밍, tool use |
| **RAG** | better-sqlite3 + FTS5 | 오프라인, Node.js 네이티브 |
| **Sidecar** | Rojo, Selene, StyLua, luau-lsp | 플랫폼별 바이너리 번들링 (extraResources) |

---

## 3. Project Structure

```
luano/
├── package.json
├── pnpm-workspace.yaml
│
├── apps/
│   └── desktop/
│       ├── package.json
│       ├── vite.config.ts
│       ├── electron-builder.json      # Electron 빌드 설정
│       │
│       ├── electron/                   # Electron main process (Node.js)
│       │   ├── main.ts                 # 앱 진입점, BrowserWindow 생성
│       │   ├── preload.ts              # contextBridge 노출
│       │   │
│       │   ├── sidecar/               # 외부 바이너리 프로세스 관리
│       │   │   ├── index.ts           # 공통 spawn/kill/restart
│       │   │   ├── rojo.ts            # Rojo serve/build/sourcemap
│       │   │   ├── selene.ts          # Selene 린트 실행
│       │   │   └── stylua.ts          # StyLua 포맷 실행
│       │   │
│       │   ├── lsp/                   # LSP 프로세스 관리
│       │   │   ├── manager.ts         # luau-lsp spawn, stdio 연결
│       │   │   └── bridge.ts          # stdio ↔ WebSocket 브릿지
│       │   │
│       │   ├── ai/                    # AI 백엔드 (main process)
│       │   │   ├── provider.ts        # Claude API 추상화, 스트리밍
│       │   │   ├── context.ts         # 컨텍스트 빌더 (Global Summary)
│       │   │   ├── tools.ts           # AI tool definitions
│       │   │   └── rag.ts            # better-sqlite3 FTS5 검색
│       │   │
│       │   ├── mcp/                   # Studio MCP 클라이언트 (후순위)
│       │   │   ├── client.ts
│       │   │   └── studioTools.ts
│       │   │
│       │   ├── file/                  # 파일 시스템 관리
│       │   │   ├── watcher.ts         # chokidar 파일 감시
│       │   │   ├── project.ts         # 프로젝트 열기/생성
│       │   │   └── template.ts        # 템플릿 스캐폴딩
│       │   │
│       │   └── ipc/                   # IPC 핸들러 등록
│       │       └── handlers.ts        # ipcMain.handle 모음
│       │
│       ├── src/                       # React renderer (브라우저)
│       │   ├── main.tsx
│       │   ├── App.tsx                # Root layout (panel grid)
│       │   │
│       │   ├── components/            # 공통 UI
│       │   │   ├── Panel.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   └── StatusBar.tsx
│       │   │
│       │   ├── editor/                # Monaco 통합
│       │   │   ├── EditorPane.tsx
│       │   │   ├── LuauLanguageClient.ts  # monaco-languageclient → WebSocket
│       │   │   ├── LuauTokensProvider.ts  # Syntax highlighting
│       │   │   ├── LuauTheme.ts           # Roblox Studio 스타일 다크 테마
│       │   │   └── EditorActions.ts       # 인라인 AI (Cmd+K)
│       │   │
│       │   ├── explorer/              # 파일 탐색기
│       │   │   ├── FileTree.tsx
│       │   │   ├── RojoHierarchyView.tsx  # sourcemap → DataModel 트리 (후순위)
│       │   │   └── FileIcons.tsx
│       │   │
│       │   ├── terminal/              # 빌트인 터미널
│       │   │   ├── TerminalPane.tsx
│       │   │   └── TerminalManager.ts
│       │   │
│       │   ├── ai/                    # AI 채팅 패널
│       │   │   ├── ChatPanel.tsx
│       │   │   ├── ChatMessage.tsx
│       │   │   ├── InlineEditOverlay.tsx   # Cmd+K diff (Phase 2)
│       │   │   ├── DiffView.tsx
│       │   │   ├── useAIChat.ts
│       │   │   └── CodeBlockRenderer.tsx
│       │   │
│       │   ├── rojo/                  # Rojo 통합 패널
│       │   │   ├── RojoPanel.tsx
│       │   │   ├── ProjectInitWizard.tsx
│       │   │   └── RojoStatusIndicator.tsx
│       │   │
│       │   ├── studio/                # Studio 브릿지 패널 (Phase 2+)
│       │   │   ├── StudioPanel.tsx
│       │   │   ├── ConsoleOutput.tsx
│       │   │   └── ErrorExplainer.tsx
│       │   │
│       │   ├── templates/
│       │   │   ├── TemplateGallery.tsx
│       │   │   └── templateData.ts
│       │   │
│       │   ├── stores/                # Zustand stores
│       │   │   ├── editorStore.ts
│       │   │   ├── projectStore.ts
│       │   │   ├── aiStore.ts
│       │   │   ├── rojoStore.ts
│       │   │   └── studioStore.ts
│       │   │
│       │   ├── hooks/
│       │   │   ├── useIpc.ts          # contextBridge 래퍼
│       │   │   ├── useFileWatcher.ts
│       │   │   └── useKeybindings.ts
│       │   │
│       │   └── lib/
│       │       ├── constants.ts
│       │       └── types.ts
│       │
│       └── resources/                 # 앱 번들 리소스
│           ├── binaries/              # 사이드카 (플랫폼별)
│           │   ├── win/
│           │   │   ├── rojo.exe
│           │   │   ├── selene.exe
│           │   │   ├── stylua.exe
│           │   │   └── luau-lsp.exe
│           │   ├── mac/
│           │   └── linux/
│           │
│           ├── roblox-docs/
│           │   └── roblox_docs.db     # Pre-indexed FTS5 DB
│           ├── templates/
│           │   ├── empty/
│           │   ├── obby/
│           │   └── tycoon/
│           └── type-defs/
│               └── globalTypes.d.luau
│
├── packages/
│   └── doc-indexer/                   # 빌드 타임 문서 인덱서
│       └── src/
│           ├── clone-docs.ts
│           ├── parse-markdown.ts
│           └── build-index.ts
│
└── .github/
    └── workflows/
        ├── ci.yml
        ├── build.yml                  # electron-builder (Win/Mac/Linux)
        └── update-docs.yml
```

---

## 4. Core Modules

### 4.1 Editor (Monaco + Luau LSP)

Electron이라 LSP 연결이 단순해짐. Node.js main process가 직접 luau-lsp stdio를 관리.

```
Monaco Editor (renderer)
  ↕ monaco-languageclient (WebSocket client)
  ↕ WebSocket (localhost)
  ↕ [Main Process] lsp/bridge.ts — WebSocket server
  ↕ [Main Process] lsp/manager.ts — child_process.spawn
  ↕ luau-lsp process (stdin/stdout)
```

이 경로는 VS Code가 쓰는 방식과 거의 동일해서 레퍼런스가 풍부함.

- luau-lsp flags: `--definitions=globalTypes.d.luau --sourcemap=sourcemap.json`
- Rojo sourcemap watch와 동시 실행
- 크래시 시 자동 재시작
- 제공 기능: autocomplete, diagnostics, hover, go-to-def, rename, inlay hints
- `textDocument/didChange` debounce: 50ms

### 4.2 Rojo Integration

Node.js `child_process`로 관리. Electron IPC로 renderer에 상태 전달.

```typescript
// electron/sidecar/rojo.ts — 핵심 API
class RojoManager {
  serve(projectPath: string): void    // rojo serve 시작, stdout 스트림
  stop(): void                        // 프로세스 종료
  build(projectPath: string): void    // .rbxlx 빌드
  sourcemap(projectPath: string): void // sourcemap.json 생성
  getStatus(): RojoStatus             // serving/stopped/error
}
```

자동 동작:
- `default.project.json` 감지 시 자동 serve
- sourcemap watch 자동 시작 (`--watch` 플래그)
- 크래시 시 2초 후 재시작 (exponential backoff)

### 4.3 Selene/StyLua Auto-Run

```typescript
// electron/file/watcher.ts
chokidar.watch("**/*.{lua,luau}").on("change", async (path) => {
  await stylua.format(path)     // StyLua 포맷
  const diags = await selene.lint(path)  // Selene 린트 (JSON output)
  ipcMain.emit("lint:diagnostics", diags) // renderer로 전달
})
```

- 300ms debounce 적용
- 프로젝트 로컬 `selene.toml` / `.stylua.toml` 우선, 없으면 Roblox 기본값

### 4.4 AI Chat Panel

**Phase 1 — 채팅만**:
- Claude API 스트리밍 (main process에서 처리, API 키 보호)
- Global Context Summary 포함
- 코드 블록 Luau syntax highlighting

**Phase 2 — 추가**:
- Inline Edit (Cmd+K) + diff 미리보기
- Agent 모드 (다중 파일)
- Error Explain (Studio 에러 → AI 설명)

**AI tool-use 정의 (Phase 2+)**:
- `edit_file(path, edits[])` — 파일 수정
- `create_file(path, content)` — 파일 생성
- `read_file(path)` — 파일 읽기
- `search_docs(query)` — Roblox 문서 검색
- `search_codebase(query)` — 프로젝트 검색

### 4.5 Studio Bridge (Phase 2+)

Node.js가 MCP 클라이언트 역할. 읽기 전용부터 시작.

**Phase 2**: MCP 읽기 전용 (`get_console_output`만)
**Phase 3**: Luano Studio Plugin (HttpService 기반) + 양방향

### 4.6 빌트인 터미널

node-pty + xterm.js — VS Code가 쓰는 검증된 조합.

```typescript
// electron/main.ts
import * as pty from "node-pty"
const shell = pty.spawn("powershell.exe", [], { /* ... */ })
// xterm.js로 renderer에 연결
```

### 4.7 File Explorer

- chokidar로 파일 시스템 감시
- Luau 파일 아이콘 구분 (Server/Client/Module Script)
- Roblox 계층구조 뷰는 Phase 2 (sourcemap.json 파싱)

---

## 5. AI System

### 5.1 Global Context Summary

**Phase 1부터 포함 — AI 정확도의 핵심.**

```typescript
// electron/ai/context.ts
function buildGlobalSummary(projectPath: string): string {
  // 1. default.project.json 파싱 → 프로젝트 구조
  // 2. 모든 .lua/.luau 파일 스캔
  // 3. 각 모듈의 export 함수 시그니처 추출 (정규식 기반)
  // 4. ~500 token 요약 생성
}
```

**3단계 컨텍스트 빌더**:
```
Layer 1: Global Summary (항상 포함, ~500 tokens)
  - rojo.json → 전체 프로젝트 구조
  - 주요 모듈 API 시그니처 (함수명 + 인자)
  - 자동 생성, 파일 변경 시 갱신

Layer 2: Local Context (요청 시, ~2000 tokens)
  - 현재 파일 전체
  - require()로 참조하는 파일들의 export 시그니처
  - 현재 파일의 diagnostics

Layer 3: On-Demand (RAG, Phase 2, ~1000 tokens)
  - Roblox API 문서 조각
  - 프로젝트 내 유사 코드 패턴
```

**Global Summary 예시**:
```
PROJECT: MyGame (Rojo)
MODULES:
  shared/DamageUtil: ApplyDamage(hum, raw), ApplyPenetrationDamage(hum, raw, pen)
  shared/AbilityUtil: getModifier(ctx, key, fallback), canAct(player, ctx)
  server/HeatService: AddHeat(p, amt, tag), CoolHeat(p, amt, tag), CanAct(p)
STRUCTURE:
  server/ → ServerScriptService
  shared/ → ReplicatedStorage
  client/ → StarterPlayerScripts
```

### 5.2 시스템 프롬프트 구조

```
You are Luano, an AI for Roblox Luau development.

PROJECT CONTEXT:
{Global Summary — Layer 1}
{Local Context — Layer 2}

ROBLOX DOCUMENTATION:
{RAG results — Layer 3, Phase 2}

RULES:
- Roblox best practices
- StyLua 포맷 (tabs, 120col, double quotes)
- Selene roblox standard
- --!strict for new files
- Use task.spawn/task.defer, not coroutine
- Never use deprecated APIs
```

### 5.3 RAG 강화 로드맵 (Phase 2+)

```
Phase 2: better-sqlite3 FTS5 BM25
  - 키워드 기반 검색, Roblox API 클래스/메서드명 매칭
  - ~30-50 MB pre-indexed DB

Phase 3: FTS5 + Structured API Index
  - deprecated 플래그, since 버전, 대체 API 매핑

Phase 4: 선택적 ONNX 임베딩 (로컬)
  - 의미 검색: "플레이어가 죽었을 때" → Humanoid.Died
```

---

## 6. Data Flow

### Phase 1 기본 루프
```
에디터에서 코드 작성
→ 저장 시 StyLua 자동 포맷
→ Selene 린트 결과 Monaco에 표시
→ Rojo가 Studio에 자동 sync
→ AI 채팅으로 질문/코드 생성
```

### Phase 2+ 전체 루프
```
에디터에서 코드 작성
→ 저장 시 StyLua 자동 포맷 → Selene 린트
→ Rojo → Studio sync
→ Studio에서 실행
→ MCP가 에러 읽기
→ AI가 에러 설명 + 수정 제안
→ 사용자 수락 → 파일 수정 → Studio sync → 반복
```

---

## 7. 리스크 분석 & 기술적 고도화

### 7.1 LSP Bridge (Electron이라 간단해짐)

Node.js가 직접 `child_process.spawn`으로 luau-lsp stdio 관리.
WebSocket 브릿지도 Node.js 단일 프로세스 내에서 처리.

```
[Electron 경로 — 검증됨]
Monaco → monaco-languageclient → WebSocket → Node.js bridge → luau-lsp stdio
```

VS Code가 정확히 이 구조. 디버깅 포인트 최소화.

### 7.2 Rojo Sync 최적화

**Transaction 기반 Sync** (Phase 2, Agent 모드 시):
1. AI 수정 중에는 chokidar 이벤트 무시
2. Accept 시점에 변경 파일 일괄 저장
3. Rojo가 자연스럽게 일괄 감지 → Studio sync

일반 편집 시에는 chokidar 300ms debounce면 충분.

### 7.3 Studio Bridge 현실적 구현 (Phase 2+)

**이중 구조**:
1. **Studio 빌트인 MCP 서버** → Node.js MCP 클라이언트 연결 (기본)
2. **Luano Studio Plugin** (HttpService 기반) → 확장 기능 (Phase 3)

Phase 2에서는 MCP 읽기 전용만. playtest 제어, screen capture는 Phase 4.

### 7.4 텔레메트리 & AI 품질 추적

```typescript
// electron/ai/telemetry.ts
interface AIMetrics {
  acceptRate: number        // 수락/거절 비율
  editDistance: number       // 수락 후 추가 수정량
  promptEffectiveness: Map<string, number>  // 컨텍스트 조합별 수락률
}
```
- 로컬 SQLite 저장, 서버 전송은 opt-in

---

## 8. MVP Roadmap

### Phase 1 — "It Works"

**핵심 (반드시 완성)**:
- Electron + Monaco 에디터 (파일 열기/편집/탭/파일 탐색기)
- luau-lsp (WebSocket 브릿지, 자동완성/진단/hover/go-to-def)
- Rojo 번들 (원클릭 serve, sourcemap)
- Selene + StyLua (저장 시 자동)
- AI 채팅 (Claude API, Luau 시스템 프롬프트, Global Context Summary)
- 프로젝트 템플릿 3개

**선택 (시간 허용 시)**:
- 빌트인 터미널 (node-pty, 검증된 조합이라 리스크 낮음)
- Roblox 계층구조 뷰

### Phase 2 — "AI Power"

**핵심**:
- Inline edit (Cmd+K) + diff 미리보기
- Roblox docs RAG (FTS5)
- Studio Bridge 읽기 전용 (MCP get_console_output)
- Error explanation (콘솔 에러 → AI 설명)

**선택**:
- Agent 모드 (다중 파일, Transaction Sync)

### Phase 3 — "출시"
- 구독 시스템 (Free / Pro $12/mo / Team $20/mo)
- Luano Studio Plugin (양방향 브릿지)
- AI 품질 텔레메트리 (로컬)
- 멀티 AI 모델 (Claude + GPT + Ollama)
- 설정 UI, 키바인딩
- 자동 업데이트

### Phase 4 — "생태계"
- Agent 모드 + playtest 자동화 + screen capture
- RAG 강화 (ONNX 임베딩)
- 플러그인 시스템
- 에셋 브라우저
- 비주얼 스크립팅
- 튜토리얼 모드

---

## 9. Revenue Model

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | 에디터, luau-lsp, Selene, StyLua, Rojo, 터미널, 템플릿 |
| **Pro** | $12/mo | AI 채팅, inline edit, error explain, Studio bridge, RAG |
| **Team** | $20/mo/seat | Pro + 팀 설정 공유, 우선 지원 |

---

## 10. Security

| 위협 | 대응 |
|---|---|
| API 키 저장 | electron-store 암호화 또는 OS keychain (keytar) |
| AI에 코드 노출 | Privacy mode 토글, 온보딩 고지 |
| MCP 접근 | 명시적 사용자 승인, 자동 연결 없음 |
| Sidecar 무결성 | SHA-256 체크섬, 릴리스 서명 |
| 터미널 명령 실행 | Agent 모드: 명령당 사용자 승인, 프로젝트 디렉토리 제한 |
| Electron 보안 | contextIsolation: true, nodeIntegration: false, CSP 설정 |

---

## 11. Critical Implementation Files (우선순위)

**Phase 1 핵심**:
1. `electron/main.ts` — Electron 앱 진입점, BrowserWindow, IPC 등록
2. `electron/sidecar/rojo.ts` — Rojo 프로세스 라이프사이클
3. `electron/sidecar/selene.ts` + `stylua.ts` — 린트/포맷 자동화
4. `electron/lsp/manager.ts` — luau-lsp spawn + stdio 관리
5. `electron/lsp/bridge.ts` — stdio ↔ WebSocket 브릿지
6. `src/editor/LuauLanguageClient.ts` — Monaco ↔ WebSocket LSP
7. `electron/ai/provider.ts` — Claude API 스트리밍
8. `electron/ai/context.ts` — Global Context Summary 빌더

**Phase 2**:
9. `electron/ai/rag.ts` — FTS5 문서 검색
10. `electron/mcp/client.ts` — Studio MCP 읽기 전용

**Phase 3**:
11. `electron/mcp/studioTools.ts` — 양방향 Studio 브릿지
12. `studio-plugin/LuanoPlugin.lua` — Studio HttpService 플러그인
