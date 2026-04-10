# Luano — TODOS

> Deferred items from CEO review (2026-04-05). Prioritized by risk.

---

## P1 — Security

### ~~AI path traversal protection~~ ✅ (v0.6.5)
Done. `electron/file/sandbox.ts` validates all agent file tool paths against project root.

### Auto-updater code signing verification
**What:** `electron-updater` installs updates from GitHub Releases. No explicit signature verification mentioned.
**Why:** If the GitHub repo/release is compromised, malicious code installs silently on next app quit. Supply chain risk for a tool that handles API keys.
**Effort:** M (human: ~1 day / CC: ~30min)
**Depends on:** Code signing certificate

### ~~IPC channel allowlist in preload~~ ✅ (v0.6.5)
Done. `ALLOWED_CHANNELS` prefix list in `preload.ts`, unauthorized channels blocked with console warning.

---

## P2 — Reliability

### ~~store.ts silent write failure handling~~ ✅ (v0.6.5)
Done. `store.ts` now logs errors and shows dialog on write failure.

### ~~AI request timeout~~ ✅ (v0.6.5)
Done. 60s timeout on both Anthropic and OpenAI clients. `withTimeout` on streaming initial connection.

### ~~AI 429 rate limit handling~~ ✅ (v0.6.5)
Done. `withRetry` for non-streaming (2 retries), specific rate limit message for streaming.

---

## P2 — Quality

### E2E test suite
**What:** Zero E2E tests. Need at least: app launches, file open/save, AI chat sends message, Rojo starts.
**Why:** Unit tests don't catch integration failures. The close handler bug would have been caught by an E2E test.
**Effort:** L (human: ~1 week / CC: ~1 hour)
**Depends on:** Playwright or Spectron setup
**Context:** v0.7.10에서 툴체인 통합 E2E로 구축. Rojo/Selene/StyLua/luau-lsp 각각에 대해 실제 Luano 앱을 Playwright로 구동하고 에디터/싱크/진단까지 전 플로우 검증. Rojo 첫 Connect 시 Studio 파일 wipe 방지 regression 테스트 포함.

### Crash reporting service
**What:** No crash reporting. When users hit bugs, zero diagnostic data is available.
**Why:** The basic log file (v0.6.4) helps for local debugging, but remote crash reports help fix bugs users don't report.
**Effort:** M (human: ~1 day / CC: ~30min)
**Depends on:** Sentry or similar service account

### Performance regression gate (CI)
**What:** Playwright 기반 콜드 스타트/LSP 응답 시간 측정, CI에서 임계치 초과 시 빌드 실패.
**Why:** v0.7.12 속도 최적화 후 회귀 방지. 현재는 "빨라졌다" 감에만 의존. 측정 없으면 다음 릴리즈에 다시 느려져도 모름.
**Effort:** M (human: ~1 day / CC: ~45min)
**Depends on:** v0.7.10 E2E 인프라 완료
**Context:** 지표 — 콜드 스타트 < 2s, 에디터 첫 렌더 < 400ms, LSP 첫 completion < 600ms. 5% 이상 회귀 시 실패.

### 패널별 ErrorBoundary
**What:** 현재 전역 ErrorBoundary 하나. 패널(ChatPanel/SettingsPanel/etc.) 각각에 ErrorBoundary 래퍼 추가.
**Why:** 한 패널 크래시가 전체 앱 다운으로 전파됨. 사용자가 재시작해야 함. 패널 격리하면 해당 패널만 에러 상태로 표시, 나머지 작동.
**Effort:** S (human: ~2h / CC: ~15min)
**Depends on:** v0.7.13 리팩토링 후 (패널 경계가 명확해진 시점)

### Zustand store 분리 검토
**What:** v0.7.13 리팩토링 중 현재 store 크기/책임 확인. 거대 store 발견 시 도메인별 (editor/ai/project/ui) 분리.
**Why:** 큰 store는 불필요한 리렌더를 유발. 리팩토링 PR 스코프는 컴포넌트였지만 store도 같은 병 가능성.
**Effort:** M (human: ~4h / CC: ~30min)
**Depends on:** v0.7.13 컴포넌트 리팩토링 완료 후 재평가

---

## P2 — Feature

### ~~AI Code Review (built-in skill)~~ ✅ (v0.6.5)
Done. `/review` built-in skill in `src/ai/skills.ts`.

### 실시간 협업 (Multiplayer)
**What:** 같은 프로젝트를 여러 명이 동시에 편집. Roblox 팀 개발 워크플로우에 맞춤.
**Why:** Roblox Studio 자체에 실시간 협업 없음. 경쟁 에디터 중에도 없음. 팀 개발하는 Roblox 스튜디오에게 킬러 피처.
**Effort:** XL (human: ~2-3 weeks / CC: ~3-4h). CRDT 또는 OT 필요.
**Depends on:** 서버 인프라 또는 P2P 아키텍처 결정

---

## P3 — Architecture

### env.d.ts IPC 재설계
**What:** `src/env.d.ts`가 345 LOC 단일 `Window.api` 인터페이스. 도메인별 (ai, project, toolchain, file, lsp, rojo, studio, analysis, sync) 그룹으로 분리 + 각 도메인 타입 파일로 분할.
**Why:** 현 상태는 IPC 전역 싱글톤 느낌이고, 한 도메인 변경이 항상 이 거대 파일을 건드리게 함. preload.ts도 동시에 재구성 필요.
**Effort:** L (human: ~1 day / CC: ~45min)
**Depends on:** v0.7.13 리팩토링 완료 (컴포넌트 분리 먼저)
**Context:** v0.8.x에서 IPC 전체 재설계와 함께. 단독으로 하면 대형 diff만 생기고 이점 적음.

### Monaco 언어 동적 로드
**What:** v0.7.11에서 Luau + JSON + TOML + YAML + MD 5개를 정적 등록. 추후 더 많은 언어가 필요해지면 on-demand 동적 로드로 전환.
**Why:** 현 5개는 로블록스 워크플로우 전체 커버. 하지만 사용자가 Python 스크립트(예: Roblox API 호출 도구)를 편집하거나 할 때 대응 가능성.
**Effort:** S (human: ~3h / CC: ~20min)
**Depends on:** 실제 사용자 요청 발생 시 (현 시점 가설)

### 공통 `<Panel>` 컴포넌트 추출
**What:** 리팩토링 중 ChatPanel/SettingsPanel/ToolchainPanel 등이 공통 레이아웃(fixed overlay + close button + backdrop)을 각자 구현하는지 검사. 중복 발견 시 `src/components/Panel.tsx`로 추출.
**Why:** DRY. 디자인 시스템 일관성. 현재 각 패널이 살짝씩 다른 애니메이션/z-index를 쓸 가능성.
**Effort:** S (human: ~2h / CC: ~20min)
**Depends on:** v0.7.13 중 발견 시 기회적으로 수행

---

## P3 — Strategy

### Strategic direction decision for v0.7.0
**What:** Luano's standalone editor approach is being compressed by Studio-native AI tools (MCP, Code Assist, plugins). Need to decide: deepen standalone moat, go hybrid (standalone + MCP server), or pivot.
**Why:** Every release that doesn't differentiate loses ground. The landscape research (April 2026) shows 5+ competitors inside Studio, plus Roblox's own AI features.
**Context:** See CEO review landscape analysis. Key competitors: Rebirth ($8.99-15.99/mo), Lux (free), SuperbulletAI (1M free tokens/mo). Studio now has MCP Server + native Git + Code Assist.
**Effort:** Decision, not code. Inform by user feedback + metrics.
**Depends on:** v0.6.4 shipping, user feedback data
