# Luano — TODOS

> 미완료 항목 모음. 완료된 항목은 릴리즈 히스토리(CLAUDE.md) 참조.

---

## 다음 릴리즈 후보 (v0.8.3 — 안정성)

작고 독립적인 항목들. 모아서 "안정성 + 내부 정리" 패치로 내기 좋음.

### SDK 타입 캐스팅 정리
**What:** `agent.ts`의 `as unknown as` 캐스트 5곳 (advisor beta event 파싱). SDK가 advisor types를 GA로 출시하면 제거.
**Why:** Beta API라 SDK 타입에 advisor 필드가 아직 없음. `// SAFETY:` + `// TODO:` 주석으로 마킹 완료.
**Effort:** XS — SDK 업데이트 후 캐스트 제거만.
**Depends on:** `@anthropic-ai/sdk`가 advisor types 출시.

---

## 백로그

### P1 — Security

#### Auto-updater 코드 서명 검증
**What:** `electron-updater`가 GitHub Releases에서 업데이트를 설치. 명시적 서명 검증 없음.
**Why:** Repo/릴리즈가 compromise되면 다음 앱 종료 시 악성 코드 설치. API 키를 다루는 툴이라 공급망 리스크가 실질적.
**Effort:** M (human: ~1 day / CC: ~30min)
**Depends on:** 코드 서명 인증서 구매.

---

### P2 — Feature

#### Perf 경고 클릭 시 에디터에서 라인 하이라이트
**What:** Analysis 탭의 Perf 경고를 클릭하면 파일이 열림 (✅ `f6c4201`에서 fix). 추가로 해당 `w.line`으로 스크롤 + 그 라인에 1-2초 동안 깜빡이는 강조 이펙트 (배경 플래시 or 좌측 인디케이터). Monaco의 `deltaDecorations` + fade-out 클래스 활용.
**Why:** 지금은 파일만 열리고 사용자가 라인 번호 기억해서 직접 찾아야 함. VSCode의 "Go to line"이 깜빡이는 UX 흉내. 인지 부담 ↓.
**Effort:** S (human: ~1-2h / CC: ~20min) — `openFile` 호출 후 Monaco editor ref에 `revealLineInCenter(line)` + 데코레이션 추가 → setTimeout으로 제거.
**Depends on:** 없음. `EditorPane`에서 Monaco instance 노출하는 훅/ref 한 줄이면 연결.

#### 스킬 인터랙티브 선택지 UI
**What:** `/wag` 같은 스킬이 실행될 때 채팅 패널에 버튼 선택지를 표시. Claude Code의 AskUserQuestion처럼 스킬이 분기 로직을 가질 수 있게.
**Why:** 현재 스킬은 정적 프롬프트만 지원. wag/ 있을 때/없을 때 다른 동작, "몬스터 추가할게요 / 기존 수정할게요" 같은 분기가 필요한 스킬에 필수.
**Effort:** M (human: ~1 day / CC: ~45min) — Skill 인터페이스에 `choices` 필드 추가, ChatPanel에 버튼 UI, 선택 결과에 따른 프롬프트 분기.
**Depends on:** 없음.

#### rocale-cli 통합 (Open Cloud Luau Execution)
**What:** `Roblox/rocale-cli`를 번들/자동 설치해 "Studio 없이 Roblox 클라우드에서 스크립트 실행" 지원. 사이드바 **Remote Run** 패널 + 에이전트 툴 `run_remote_script`.

**구성 요소:**
- 툴체인 레지스트리에 rocale-cli 추가 (기존 온디맨드 다운로드 경로 재사용)
- Settings > Integrations > Roblox Open Cloud: API 키 (safeStorage 암호화), Universe/Place ID
- 사이드바 Remote Run 패널: 엔트리포인트 파일 선택, ▶ Run, stdout/stderr → xterm 스트리밍
- 에이전트 툴 `run_remote_script` — permission-gated (사용자 명시적 승인 필수)

**Why:** Studio bridge(로컬) + rocale(클라우드) 조합은 경쟁 에디터에 없음.
**Effort:** XL (human: ~2-3 days / CC: ~1.5h)
**리스크:** Open Cloud API 키 발급이 새 단계. `universe-places:write` + `luau-execution-sessions:write` 권한 설명 튜토리얼 필수.

#### 실시간 협업 (Multiplayer)
**What:** 같은 프로젝트를 여러 명이 동시에 편집.
**Why:** Roblox Studio에 실시간 협업 없음. 팀 스튜디오에게 킬러 피처.
**Effort:** XL (human: ~2-3 weeks / CC: ~3-4h). CRDT 또는 OT 필요.
**Depends on:** 서버 인프라 또는 P2P 아키텍처 결정.

---

### P2 — Quality

#### E2E 테스트 스위트
**What:** E2E 테스트 zero. 최소: 앱 런칭, 파일 open/save, AI chat 전송, Rojo serve.
**Why:** 유닛 테스트는 통합 실패를 못 잡음. 과거 close handler 버그도 E2E 하나면 잡혔을 것.
**Effort:** L (human: ~1 week / CC: ~1h)
**Depends on:** Playwright 셋업. 툴체인 통합 커버리지부터 (Rojo/Selene/StyLua/luau-lsp 각각 실제 앱 구동).

#### 성능 회귀 게이트 (CI)
**What:** 콜드 스타트/LSP 응답 시간 측정, CI에서 임계치 초과 시 빌드 실패.
**Why:** v0.7.10 속도 최적화 후 회귀 방지. 현재는 "빨라졌다" 감에만 의존.
**Effort:** M (human: ~1 day / CC: ~45min)
**Depends on:** E2E 인프라 완료.
**지표:** 콜드 스타트 < 2s, 에디터 첫 렌더 < 400ms, LSP 첫 completion < 600ms. 5% 이상 회귀 시 실패.

---

### P3 — Architecture

#### agent.ts 공통 루프 추출
**What:** `agentChatAnthropic`과 `agentChatOpenAI`가 각각 ~600줄로 코어 루프 로직 중복. 공통 단계(plan → execute → verify → checkpoint, stall guard, MAX_ROUNDS)를 shared function으로 추출하고 provider별 API 호출만 전략 패턴으로 분리.
**Why:** 한 쪽에 버그 수정/기능 추가 시 다른 쪽에도 동일 변경 반복. advisor/web_search 분기가 이미 Anthropic 전용이라 불일치 발생 가능.
**Effort:** M (human: ~1 day / CC: ~40min) — 순수 리팩토링, 기능 변화 없음.
**Depends on:** 없음. 리팩토링 + 기능 변경 동시 금지 (Beck 원칙).

#### Monaco 언어 동적 로드
**What:** v0.7.10에서 Luau + JSON + TOML + YAML + MD 5개를 정적 등록. 더 필요해지면 on-demand 동적 로드로 전환.
**Why:** 현 5개는 Roblox 워크플로우 전체 커버. 사용자가 Python 등 요청 시 대응.
**Effort:** S (human: ~3h / CC: ~20min)
**Depends on:** 실제 사용자 요청 발생 시.

---

### P3 — Strategy

#### Strategic direction decision
**What:** Luano의 standalone 에디터 접근이 Studio-native AI 툴(MCP, Code Assist, plugin)에 압박받는 중. Decision: standalone 모트 강화, 하이브리드(standalone + MCP server), 또는 피벗.
**Why:** 차별화 없는 릴리즈는 매번 점유를 잃음. 2026-04 기준 경쟁자 5+ (Rebirth, Lux, SuperbulletAI 등) + Studio 자체 기능.
**Effort:** Decision, not code. 사용자 피드백 + 지표로 판단.
