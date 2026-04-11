# Luano — TODOS

> 현재 미완료 항목과 v0.8.0 빌드 계획.
> 완료된 항목은 릴리즈 히스토리(CLAUDE.md)를 참조.

---

## v0.8.0 빌드 계획 (2026-04-11 기준, plan-eng-review 반영)

> 목표: **AI 에이전트 성숙도**. v0.7.x에서 올린 속도/안정성 기반 위에 Claude Advisor, 툴 품질 업그레이드, Signals 기본 패턴을 쌓는다.
>
> **제외 (v0.8.1로 연기):** rocale-cli 통합 (독립 "클라우드 통합" 테마로 분리), AI 툴 10개 중 4개 (glob / get_diagnostics / web_fetch / git_status).

### 0. 툴체인 개별 검증 (사용자 수동 릴리즈 게이트)

**What:** v0.8.0 코드 작업 시작 전에 **사용자가 직접** Rojo / Selene / StyLua / luau-lsp / Rokit을 앱에서 하나씩 꼼꼼히 돌려보고 정상 동작을 확인. 코딩 범위 아님 — 릴리즈 품질 게이트.

**Why:** v0.7.9에서 번들링 → 온디맨드 다운로드 전환 이후 v0.7.5/6/7 연속 핫픽스. 툴체인이 매 릴리즈마다 회귀하는 영역이라 신기능에 리소스 쓰기 전에 바닥이 단단한지 직접 확인해야 안심하고 진행 가능.

**사용자가 수동으로 확인할 것 (체크리스트):**
- **Rojo** — `rojo serve`가 `default.project.json`을 읽고 34872 포트에서 서빙 → Studio 플러그인 연결 → 파일 수정 시 Studio 반영
- **Selene** — `lint_file` 툴이 실제 경고/에러를 반환, 프로젝트 전체 `Lint All`이 완료까지 진행
- **StyLua** — `Format All`이 `.luaurc` 또는 `stylua.toml` 없이도 기본 설정으로 포맷
- **luau-lsp** — 에디터 첫 open 시 < 2s 안에 completion/hover 응답, 타입 에러 diagnostic 표시
- **Rokit** — `rokit.toml` 감지 시 install 자동 실행, PATH에 올바르게 등록

**Effort:** 엔지니어링 범위 밖 (사용자 QA 시간 ~반나절)
**Depends on:** 없음. v0.8.0 착수 선결 조건.
**산출물:** 없음 (코드 아님). 문제 발견 시 백로그에 핫픽스 항목 추가.

---

### 1. Anthropic SDK 업그레이드 (선행 블로커)

**What:** `@anthropic-ai/sdk`를 `^0.24.3` → `^0.60`으로 업그레이드. #2 Claude Advisor가 `anthropic.beta.messages.create` API를 요구하는데 0.24.3은 `beta/` 폴더 자체가 없음.

**변경 지점:**
- `package.json` dependency 버전 bump + `npm install` 재생성
- `electron/ai/provider.ts:385` — `messages.create` 호출부 타입 검증
- `electron/ai/agent.ts:322` — content block 파싱 타입 narrowing 추가 가능 (`if (block.type === "text")`)
- `electron/ai/tools.ts:16` — `Anthropic.Tool[]` 타입 그대로 사용 가능
- `withRetry`/`withTimeout` 래퍼는 수정 불필요

**검증:**
```bash
npx tsc -p tsconfig.node.json --noEmit
npx vitest run electron/ai
```

**Effort:** S (human: ~2h / CC: ~20min) — 기계적 마이그레이션. 기능 변화 없음.
**Depends on:** Electron 종료 후 실행 (node_modules 잠금 회피).
**리스크:** 거의 없음. SDK는 add-only. 번들 사이즈 ~200KB 증가 (무시 가능).

---

### 2. Claude Advisor Tool 통합 (Anthropic 공식 beta 기능)

**What:** Anthropic의 **Advisor Tool** (beta, `advisor-tool-2026-03-01`)을 Luano의 Claude 프로바이더에 통합. 현재 Sonnet 4.6 executor로 돌아가는 에이전트에 Opus 4.6을 advisor로 붙여, "Sonnet 비용에 Opus 수준 지능"을 제공.

**작동 방식 (Anthropic 공식 문서 기준):**
- `tools` 배열에 `{type: "advisor_20260301", name: "advisor", model: "claude-opus-4-6"}` 추가
- 헤더에 `anthropic-beta: advisor-tool-2026-03-01` 세팅
- 에이전트(executor = Sonnet)가 복잡한 판단이 필요할 때 `advisor` 툴을 호출
- 서버 측에서 Opus가 전체 트랜스크립트를 읽고 400~700 토큰의 전략/플랜을 반환
- Executor가 advice를 반영해 계속 진행
- **단일 API 호출 내부에서 처리됨** — 클라이언트가 루프 관리할 필요 없음

**Anthropic 공식 수치:**
- Sonnet + Opus advisor = Sonnet alone 대비 **SWE-bench Multilingual +2.7pp**
- **비용 -11.9%** (executor가 대부분의 토큰 생성, advisor는 짧은 플랜만)
- Advisor 출력은 보통 400-700 텍스트 토큰 (thinking 포함 1,400-1,800)

**모델 페어링 제한:**
| Executor | Advisor |
|---|---|
| Claude Haiku 4.5 | Claude Opus 4.6 |
| Claude Sonnet 4.6 | Claude Opus 4.6 |
| Claude Opus 4.6 | Claude Opus 4.6 |

Opus-Opus는 의미 없음. Haiku-Opus는 Haiku 비용을 올리지만 의도한 케이스. 주력은 **Sonnet-Opus**.

**Luano 통합 구조:**
1. **`electron/ai/provider.ts`** — Anthropic 클라이언트 호출에서 betas/tools 추가
   ```typescript
   const tools = [
     { type: "advisor_20260301", name: "advisor", model: "claude-opus-4-6" },
     ...existingTools
   ]
   client.beta.messages.create({
     model: "claude-sonnet-4-6",
     betas: ["advisor-tool-2026-03-01"],
     tools,
     ...
   })
   ```
2. **Settings > AI** — "Enable Claude Advisor" 토글 (Claude 프로바이더 선택 시만 노출)
3. **시스템 프롬프트** — Anthropic 권장 타이밍 블록 + "100 단어 미만, enumerated" 컨사이즈 지시 prepend
4. **비용 제어** — 클라이언트 측 advisor 호출 카운트. 대화당 최대 5회 (기본값), `max_uses`는 request당 캡
5. **UI 표시** — 채팅 메시지에 "💡 Advisor consulted (Opus)" 배지. 토큰 사용량 패널에 executor/advisor 분리 표시
6. **Caching** — 3회 이상 호출 예상되는 긴 세션에서만 `caching: {type: "ephemeral", ttl: "5m"}` 활성
7. **에러 처리** — `advisor_tool_result_error` 받으면 (`overloaded`, `too_many_requests` 등) 조용히 진행, 사용자에게 경고 토스트

**Why:**
- 이건 **타 에디터가 따라하기 어려운 차별점**. OpenAI/Gemini는 동일 메커니즘 없음. Luano Claude 사용자만 얻는 가치.
- 비용 중립 (오히려 절감). "Pro 티어 전용" 이유가 없음 — 오히려 Community에 오픈해서 "Luano = 같은 API 키로 더 나은 결과" 포지셔닝.
- Zero Data Retention 지원 → 기업 사용자 대응.
- v0.8.0 "AI 성숙도" 테마에 완벽히 부합.

**Effort:** M (human: ~1 day / CC: ~45min)
- provider.ts 수정: 30분 (tools 배열, betas, beta client 사용)
- 시스템 프롬프트 업데이트: 10분
- Settings 토글 + i18n: 20분
- usage.iterations 파싱 + UI 표시: 30분
- 클라이언트 캡 + 테스트: 20분

**Depends on:**
- 없음. #1 전에도 가능. 다만 #3(AI 툴 확장)과 같이 하는 게 자연스러움 — advisor는 executor가 고를 수 있는 "툴" 중 하나이므로 툴 배열이 정리된 후 넣는 게 리뷰 편함.
- Anthropic SDK 버전 확인 필요: 현재 `@anthropic-ai/sdk ^0.24.3` → beta messages API가 이 버전에 있는지 확인. 없으면 업그레이드.

**리스크:**
- **Beta 기능**. Anthropic이 스키마/헤더 변경 가능. version-pinned 헤더(`advisor-tool-2026-03-01`)로 고정돼 있어 안정적이지만 GA 전까지는 모니터링 필요.
- Advisor output stream 불가 → 사용자가 채팅 중 "멈춘 것 같은" 순간 경험. "💭 Consulting advisor..." 인디케이터 필수.
- `clear_thinking` 기본값이 advisor cache를 깨므로 `keep: "all"` 설정 필요.

**Edge cases (구현 전 명시):**
1. **스트림 인디케이터** — advisor는 서버 측이라 chunk가 오지 않는 "침묵 구간"이 발생. `aiChatStream` 래퍼에서 advisor 호출 감지 시 가상 이벤트 발송 → ChatPanel이 "💭 Consulting advisor (Opus)…" 표시 + 타이머. 10초 이상이면 "여전히 생각 중…" 메시지 교체.
2. **`advisor_tool_result_error` 처리** — `overloaded` / `too_many_requests` / `api_error` 수신 시: 재시도 없이 조용히 진행. 사용자에게는 고정 위치 토스트 ("Advisor unavailable, continuing without it"). 3회 연속 실패 시 현재 세션에서 advisor 비활성화 (토큰 낭비 방지).
3. **`max_uses` / 비용 캡 저장 위치** — **세션 단위**. Zustand `aiStore`에 `advisorCallsThisSession: number` 필드. 새 세션 생성 시 0으로 리셋. Main process에서는 request별 `max_uses=5` 하드캡 추가 (악성 응답 방지).
4. **Abort 흐름** — 사용자가 stop 누르면 `aiAbort()` IPC 호출 → main process가 현재 `AbortController` signal 중단. Anthropic SDK는 advisor 실행 중에도 signal 전파함 (0.60+ 검증 필요). 중단 시 인디케이터 즉시 제거.
5. **Caching 호환성** — `clear_thinking` 기본값이 cache 깸. `system` 프롬프트에 `cache_control: {type: "ephemeral"}` 블록 추가할 때 advisor와 공존 가능한지 한 번의 통합 테스트로 확인.

**참고:** Anthropic 권장 시스템 프롬프트는 advisor를 "substantive work 전에 호출, 완료 전에 호출, 막혔을 때 호출"하도록 지시. 우리 에이전트 프롬프트에 그대로 prepend.

---

### 3. AI 에이전트 툴 확장 (6개로 축소)

**What:** 현재 Luano AI 에이전트는 13개 툴. grep은 literal match, glob 없음, 웹 검색 없음, 태스크 추적 없음. 가치 70%가 모여있는 **6개만** v0.8.0에 추가.

**현재 툴 (13개):**
- File: `read_file`, `edit_file`, `create_file`, `delete_file`, `list_files`, `grep_files`
- Lint: `lint_file`
- Docs: `search_docs` (Roblox API 문서)
- Studio bridge: `read_instance_tree`, `get_runtime_logs`, `run_studio_script`, `set_property`

**추가/교체 대상 (6개):**

1. **`grep` (기존 `grep_files` 재작성)** — 정규식 + glob 필터(`**/*.server.luau`) + `-A/-B/-C` 컨텍스트 + output 모드 (`content` / `files_with_matches` / `count`). 기존은 literal match만 가능해서 에이전트가 "RemoteEvent.*FireServer" 같은 패턴을 못 찾음. **ReDoS 방어**: 사용자 정규식 입력은 `safe-regex` 또는 timeout (300ms)으로 감싸기.
2. **`multi_edit`** — 한 파일 내 여러 edit을 원자적으로 적용. `edits: [{old_text, new_text}, ...]` 순차 적용, **중간 실패 시 원본 복구** (edit 시작 전 snapshot 유지). 토큰/시간 낭비 제거.
3. **`todo_write`** — 다단계 작업 체크리스트. 에이전트가 `[{content, status}, ...]` 업데이트 → ChatPanel 옆 패널에 진행 상황 표시. IPC 이벤트 `ai:todos-updated` 추가.
4. **`web_search`** — **Anthropic 네이티브 서버 툴** (`web_search_20250305`) + **Gemini `google_search`** 사용. 사용자 API 키 불필요, 비용은 기본 API 요금에 포함, 소스 인용 자동. OpenAI 프로바이더는 v0.8.1 (Responses API 마이그레이션 필요). Local 프로바이더는 미지원.
5. **`format_file`** — StyLua 포맷 실행. 기존 `electron/sidecar/stylua.ts` 재사용. 에이전트가 파일 수정 후 자동 포맷.
6. **`type_check`** — luau-lsp JSON-RPC로 단일 파일 타입 체크. `lint_file`(Selene)보다 강력. Luau 타입 에러를 에이전트가 직접 피드백 루프에 넣을 수 있음. LSP 프록시 아키텍처 가치 있음.

**Why:**
- `grep` + `multi_edit` 둘이 가치 70%. 매 대화에서 쓰임.
- `web_search`는 "에이전트가 찾아봤어요" 순간. 네이티브 서버 툴 경로라 DDG 스크레이프 유지비용 0.
- `todo_write`는 긴 작업 UX.
- `format_file` + `type_check`는 에이전트 자가 수정 루프 완성.

**Effort:** M (human: ~1-2 day / CC: ~1-1.5h)
- `grep` 재작성: 60분 (regex + glob + 컨텍스트 + ReDoS 가드)
- `multi_edit`: 30분 (snapshot + 롤백)
- `todo_write` + UI: 60분 (핸들러 + IPC + ChatPanel 패널)
- `web_search` (Anthropic + Gemini): 40분 (tools 배열 분기만)
- `format_file`: 15분 (기존 StyLua 사이드카 래핑)
- `type_check`: 40분 (luau-lsp JSON-RPC 클라이언트 재사용)

**Depends on:** #1(SDK 업그레이드) — tool_use 파싱 타입 검증 이후.

**v0.8.1로 연기:**
- **`glob`** — `grep`의 glob 필터가 파일명만 반환하는 모드 지원하면 사실상 중복. v0.8.1에서 실사용 데이터 보고 결정.
- **`get_diagnostics`** — `type_check`와 커버리지 겹침. 실제 필요 발생 시 추가.
- **`web_fetch`** — `web_search`가 본문 일부까지 반환하므로 마진 가치. v0.8.1.
- **`git_status` / `git_diff`** — 가치 약함. 에이전트가 "방금 뭘 바꿨어"에 필요한 컨텍스트는 세션 히스토리로 충분.
- **OpenAI `web_search`** — Responses API 마이그레이션은 별도 작업 단위.

**v0.9.0으로 밀린 항목:**
- **`spawn_explorer` (제한된 서브에이전트)** — read-only 탐색 전용 서브에이전트. 별도 대화 상태, 툴 화이트리스트, depth=1 제한 필요. 아키텍처 변경이 커서 v0.8.0 범위 초과.

---

### 4. Roblox Signals 지원 (공식 `Roblox/signal-lua`)

**What:** Roblox 공식 Signal 라이브러리 `Roblox/signal-lua`를 신규 프로젝트의 기본 패키지로 포함시키고, AI가 이벤트 코드를 작성할 때 자동으로 Signal을 쓰도록 유도.

**왜 공식 라이브러리인가:**
- **`Roblox/signal-lua`가 공식** — Roblox가 직접 유지하는 read-only mirror. MIT 라이선스. v1.0 릴리즈, CI/CD 파이프라인.
- "a simple Signal implementation for Luau, approximating the functionality of `RBXScriptSignal`, but with an API adjusted for additional flexibility" — Roblox 공식 설명.
- 커뮤니티 표준 GoodSignal (stravant) 대비 장점: **공식 지원**. 장기 유지 보장. 기업/스튜디오 채택 시 벤더 리스크 없음.
- 설치는 **Rotriever만** 지원. Wally/Rokit 경로 없음 → Luano는 그냥 `Signal.lua` 파일만 복사.

**Signal이 BindableEvent보다 나은 점:**
- 메모리 누수 없음 (순수 Luau 구현, GC 깔끔)
- 테이블 파라미터 레퍼런스 유지 (BindableEvent는 깊은 복사)
- `task` 라이브러리 기반 → 더 빠름
- `:Once()`, `:DisconnectAll()` 편의 메서드

**Why:**
- 신규 개발자는 BindableEvent로 시작 → 메모리 누수 + task 라이브러리 미활용 → 나중에 리팩토링 고통.
- Luano가 처음부터 공식 Signal을 밀어주면 "Roblox가 권장하는 모범 패턴"으로 시작.
- **공식 라이브러리를 밀어준다는 것 자체가 Luano의 신뢰성 시그널** — 커뮤니티 fork가 아닌 Roblox 소스.

**구현 항목:**
- `resources/templates/_shared/ReplicatedStorage/Packages/Signal.lua` — signal-lua `src/init.lua` 그대로 복사. 상단에 한 줄 주석 `-- See LICENSES/signal-lua.txt`만 추가 (소스 파일에 라이선스 전문 주입 금지 — upstream diff 오염 방지).
- `resources/templates/_shared/LICENSES/signal-lua.txt` — signal-lua 레포의 `LICENSE` 원문 그대로. 단일 위치. 앞으로 추가되는 3rd-party 소스는 모두 이 폴더에 `<project>.txt` 형식으로.
- 템플릿 복사 로직에 `_shared/` prefix 처리 추가 (이미 공유 폴더라면 스킵).
- `resources/type-defs/signal.d.luau` 추가 — luau-lsp가 `resources/type-defs/`에서 자동 로드 → `sig:Connect` 등 자동완성.
- 에이전트 시스템 프롬프트 업데이트 (`electron/ai/provider.ts` 시스템 프롬프트 빌드) — "For internal event systems, prefer `require(ReplicatedStorage.Packages.Signal)` over `BindableEvent`".

**Effort:** S (human: ~2h / CC: ~15min)

**Depends on:** 없음. 가장 빠른 승리.

**추가 고민:**
- **Rotriever 지원 고려?** — Luano는 현재 Rotriever를 번들하지 않음 (Wally/Rokit만). 단순히 `Signal.lua` 파일만 복사하는 방식으로 시작, 나중에 Rotriever 지원 요청이 나오면 추가.
- **Upstream 업데이트 전략** — signal-lua는 v1.0 안정 상태. 새 릴리즈 나올 때마다 `Signal.lua` + `LICENSES/signal-lua.txt` 한 쌍만 교체. 버전 기록은 커밋 메시지로 충분.

---

### 5. env.d.ts IPC 도메인 분리 (v0.8.0 마지막)

**What:** 현재 `src/env.d.ts`의 `Window.api` 인터페이스가 ~280줄 단일 블록. #2 Advisor + #3 AI 툴 확장으로 신규 IPC가 ~10개 추가되므로, 추가분까지 포함해 도메인별 파일로 분할.

**분할 구조:**
```
src/types/ipc/
  project.d.ts      // openFolder, openProject, initProject, readDir, watchProject ...
  file.d.ts         // readFile, writeFile, createFile, renameEntry, deleteEntry ...
  ai.d.ts           // aiChat, aiChatStream, aiAgentChat, aiSetKey, aiAdvisor* ...
  rojo.d.ts         // rojoServe, rojoStop, rojoGetStatus
  lint.d.ts         // formatFile, lintFile
  bridge.d.ts       // bridge*, studio*
  terminal.d.ts     // terminal*
  analysis.d.ts     // analyzeTopology, analyzeCrossScript, perfLint*
  datastore.d.ts    // datastore*
  skills.d.ts       // skills*
  memory.d.ts       // memory*, instructionsLoad
  toolchain.d.ts    // toolchain*
  license.d.ts      // license*, getProStatus
  updater.d.ts      // updater*
  telemetry.d.ts    // telemetry*
  misc.d.ts         // perfStats, events, setZoomFactor
```
`src/env.d.ts`는 각 파일을 reference하고 `Window.api` union만 조립.

**Why:**
- 현 구조는 신규 API 추가 시 항상 거대 파일 끝에 붙이므로 merge conflict 빈도 높음.
- #3 AI 툴 6개 추가 시 `ai.d.ts`가 명확한 home이 있어야 리뷰 편함.
- v0.8.0 **마지막**에 하는 이유: Advisor/툴 확장으로 추가되는 모든 신규 IPC를 한 번에 포함해 분할해야 작업이 1회에 끝남. 먼저 하면 Advisor PR에서 또 env.d.ts를 건드려야 함.

**Effort:** S (human: ~2h / CC: ~20min) — 순수 리팩토링, 런타임 변화 없음.

**Depends on:** #2 Advisor + #3 AI 툴 확장 완료. 신규 API가 모두 들어온 후 분할.

**검증:** `npx tsc -p tsconfig.web.json --noEmit` 통과하면 끝.

---

### v0.8.0 실행 순서 (의존성 반영)

0. **#0 툴체인 수동 검증** — 사용자 릴리즈 게이트. 통과 못하면 아래 착수 금지. 엔지니어링 예산 밖.
1. **#1 Anthropic SDK 업그레이드** — `@anthropic-ai/sdk` 0.24.3 → ^0.60. 기계적 마이그레이션. #2의 선행 블로커.
2. **#2 Claude Advisor Tool 통합** — beta tool + provider.ts + Settings 토글 + 엣지 케이스 5개.
3. **#3 AI 에이전트 툴 확장 (6개)** — grep 재작성, multi_edit, todo_write, web_search (Anthropic + Gemini), format_file, type_check.
4. **#4 Roblox Signals** — 가장 작은 승리. 큰 작업 사이 휴식처.
5. **#5 env.d.ts IPC 도메인 분리** — 모든 신규 IPC가 들어온 후 마지막에 한 번.

**예상 기간:** 코드 작업 인간 기준 ~1.5주, CC 기준 ~4-5시간. #0은 별도 (엔지니어링 예산 밖).

**출시 조건:** #1 ~ #5 전부 완료 (#4는 독립적이라 나중에 뺄 수 있지만 권장 포함).

---

## 미결 백로그 (v0.8.0 범위 밖)

### v0.8.1 — Cloud Integration 테마

#### rocale-cli 통합 (Open Cloud Luau Execution)
**What:** `Roblox/rocale-cli`를 번들/자동 설치해서 Luano에서 "Studio 없이 Roblox 클라우드에서 스크립트 실행" 지원. 사이드바 **Remote Run** 패널 + 에이전트 툴 `run_remote_script` 추가.

**구성 요소:**
- 툴체인 레지스트리에 rocale-cli 추가 (기존 온디맨드 다운로드 경로 재사용)
- Settings > Integrations > Roblox Open Cloud: API 키 (electron safeStorage 암호화), Universe/Place ID 드롭다운 (API fetch)
- 사이드바 Remote Run 패널: 엔트리포인트 파일 선택, ▶ Run, stdout/stderr → xterm 스트리밍
- 에이전트 툴 `run_remote_script` — **permission-gated** (사용자 명시적 승인 없으면 실행 금지, 토큰/쿼터 소비하는 외부 작용)

**Why:** Studio 없이 CI/터미널에서 Luau 코드를 검증하는 유일한 공식 경로. Studio bridge(로컬) + rocale(클라우드) 조합은 경쟁 에디터에 없음.

**Effort:** XL (human: ~2-3 days / CC: ~1.5h) — 바이너리 관리 + 온보딩 UX + 권한 게이트 + 튜토리얼.

**Depends on:** v0.8.0 #1~5 완료. 툴체인 시스템이 새 바이너리 흡수 가능한 상태.

**리스크:** Open Cloud API 키 발급이 사용자에게 새로운 단계. `universe-places:write` + `luau-execution-sessions:write` 권한 설명 튜토리얼 필수. 잘못된 permission으로 실행 실패 시 UX 붕괴.

**v0.8.0에서 연기한 이유:** "Cloud Integration"은 자체로 테마. v0.8.0의 "AI 성숙도"와 섞으면 둘 다 희석됨. 독립 릴리즈로 내면 마케팅/변경 이력이 깔끔.

---

### P1 — Security

#### Auto-updater code signing verification
**What:** `electron-updater`가 GitHub Releases에서 업데이트를 설치. 명시적 서명 검증 없음.
**Why:** GitHub repo/릴리즈가 compromise되면 다음 앱 종료 시 악성 코드 설치. API 키를 다루는 툴에 대한 공급망 리스크.
**Effort:** M (human: ~1 day / CC: ~30min)
**Depends on:** 코드 서명 인증서 구매

### P2 — Quality

#### E2E test suite
**What:** E2E 테스트 zero. 최소: 앱 런칭, 파일 open/save, AI chat 전송, Rojo serve.
**Why:** 유닛 테스트는 통합 실패를 못 잡음. close handler 버그도 E2E 하나면 잡혔을 것.
**Effort:** L (human: ~1 week / CC: ~1 hour)
**Depends on:** Playwright 또는 Spectron 셋업
**Context:** v0.7.10 시도했으나 스킵. 이후 착수 시 툴체인 통합 커버리지부터 (Rojo/Selene/StyLua/luau-lsp 각각 실제 앱 구동, Rojo 첫 Connect Studio 파일 wipe 방지 regression).

#### Performance regression gate (CI)
**What:** Playwright 기반 콜드 스타트/LSP 응답 시간 측정, CI에서 임계치 초과 시 빌드 실패.
**Why:** v0.7.10 속도 최적화 후 회귀 방지. 현재는 "빨라졌다" 감에만 의존.
**Effort:** M (human: ~1 day / CC: ~45min)
**Depends on:** E2E 인프라 완료
**Context:** 지표 — 콜드 스타트 < 2s, 에디터 첫 렌더 < 400ms, LSP 첫 completion < 600ms. 5% 이상 회귀 시 실패.

### P2 — Feature

#### 실시간 협업 (Multiplayer)
**What:** 같은 프로젝트를 여러 명이 동시에 편집.
**Why:** Roblox Studio 자체에 실시간 협업 없음. 팀 개발하는 스튜디오에게 킬러 피처.
**Effort:** XL (human: ~2-3 weeks / CC: ~3-4h). CRDT 또는 OT 필요.
**Depends on:** 서버 인프라 또는 P2P 아키텍처 결정

### P3 — Architecture

#### Monaco 언어 동적 로드
**What:** v0.7.10에서 Luau + JSON + TOML + YAML + MD 5개를 정적 등록. 더 많은 언어가 필요해지면 on-demand 동적 로드로 전환.
**Why:** 현 5개는 Roblox 워크플로우 전체 커버. 사용자가 Python 등을 편집할 때 대응 가능성.
**Effort:** S (human: ~3h / CC: ~20min)
**Depends on:** 실제 사용자 요청 발생 시

### P3 — Strategy

#### Strategic direction decision
**What:** Luano의 standalone 에디터 접근이 Studio-native AI 툴(MCP, Code Assist, plugin)에 압박받는 중. Decision: standalone 모트 강화, 하이브리드(standalone + MCP server), 또는 피벗.
**Why:** 차별화 없는 릴리즈는 매번 점유를 잃음. 2026-04 랜드스케이프 리서치상 경쟁자 5+ (Rebirth, Lux, SuperbulletAI 등) + Studio 자체 기능.
**Effort:** Decision, not code. 사용자 피드백 + 지표로 판단.
