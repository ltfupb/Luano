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

### Crash reporting service
**What:** No crash reporting. When users hit bugs, zero diagnostic data is available.
**Why:** The basic log file (v0.6.4) helps for local debugging, but remote crash reports help fix bugs users don't report.
**Effort:** M (human: ~1 day / CC: ~30min)
**Depends on:** Sentry or similar service account

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

## P3 — Strategy

### Strategic direction decision for v0.7.0
**What:** Luano's standalone editor approach is being compressed by Studio-native AI tools (MCP, Code Assist, plugins). Need to decide: deepen standalone moat, go hybrid (standalone + MCP server), or pivot.
**Why:** Every release that doesn't differentiate loses ground. The landscape research (April 2026) shows 5+ competitors inside Studio, plus Roblox's own AI features.
**Context:** See CEO review landscape analysis. Key competitors: Rebirth ($8.99-15.99/mo), Lux (free), SuperbulletAI (1M free tokens/mo). Studio now has MCP Server + native Git + Code Assist.
**Effort:** Decision, not code. Inform by user feedback + metrics.
**Depends on:** v0.6.4 shipping, user feedback data
