# Luano — TODOS

> Deferred items from CEO review (2026-04-05). Prioritized by risk.

---

## P1 — Security

### AI path traversal protection
**What:** AI agent tools (`edit_file`, `create_file`, `delete_file`) have no boundary checks. The agent could write/delete files outside the project directory.
**Why:** If the AI hallucinates a system path, nothing prevents it from executing. Combined with `sandbox: false` in webPreferences, this is a real risk.
**Effort:** M (human: ~4h / CC: ~15min)
**Depends on:** None

### Auto-updater code signing verification
**What:** `electron-updater` installs updates from GitHub Releases. No explicit signature verification mentioned.
**Why:** If the GitHub repo/release is compromised, malicious code installs silently on next app quit. Supply chain risk for a tool that handles API keys.
**Effort:** M (human: ~1 day / CC: ~30min)
**Depends on:** Code signing certificate

### IPC channel allowlist in preload
**What:** The generic `on`/`off` API in preload.ts lets the renderer listen to any IPC channel. Should restrict to an explicit allowlist.
**Why:** Reduces attack surface if renderer is compromised. Defense in depth.
**Effort:** S (human: ~2h / CC: ~10min)
**Depends on:** None

---

## P2 — Reliability

### store.ts silent write failure handling
**What:** `store.ts` `save()` method has `catch {}` that silently swallows all write errors. If disk is full or file locked, API key changes are lost without user knowing.
**Why:** User thinks settings are saved, but they're gone on restart. Silent data loss.
**Effort:** S (human: ~2h / CC: ~10min)
**Depends on:** None

### AI request timeout
**What:** `chatStream` in provider.ts has no timeout. A hung API call blocks the UI indefinitely.
**Why:** User sees a frozen AI chat with no way to recover except force-quitting.
**Effort:** S (human: ~1h / CC: ~5min)
**Depends on:** None

### AI 429 rate limit handling
**What:** Claude/OpenAI 429 responses are not specifically handled. User gets a generic error.
**Why:** Rate limiting is common during heavy use. A specific message ("Rate limited, retrying in Xs") is much better UX.
**Effort:** S (human: ~2h / CC: ~10min)
**Depends on:** None

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

### AI Code Review (built-in skill)
**What:** 빌트인 스킬 `/review`로 AI가 현재 파일(또는 변경된 파일들)의 버그, 보안 이슈, 안티패턴을 짚어줌. 별도 UI 없이 채팅에서 사용.
**Why:** 경쟁사 중 이 기능 있는 곳 없음. 스킬 시스템 이미 있으므로 추가 UI 불필요. Free tier 가능.
**Effort:** M (human: ~3 days / CC: ~30min)
**Depends on:** None

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
