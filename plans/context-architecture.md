# Luano Context Architecture — 솔로 게임 개발 완주를 위한 에이전트 시스템

> **목적:** Luano로 솔로 개발자가 Roblox 게임 한 편을 끝까지 만들 수 있게 하는 에이전트 아키텍처 설계.
> **범위:** 코드 작업 한정 (에셋/UI 비주얼 디자인은 별도 트랙).
> **상태:** 설계 단계 — 자평 + critique 반영본. 미해결 결정 섹션 참고.

---

## 1. 핵심 인사이트

대부분이 놓치는 포인트: **컨텍스트 불안은 윈도우 문제가 아니라 메모리 문제다.**

1M 토큰 윈도우는 충분히 큼. 진짜 병목은 에이전트가 **이미 알았던 것을 매 턴 재학습**해야 한다는 것. 해결책은 RAG/컴팩션 같은 "윈도우 절약 기법"이 아니라, **에이전트가 컨텍스트 리셋을 살아남는 외부 두뇌를 갖게 하는 것.**

다른 도구가 못 따라오는 진짜 moat:

> **Roblox/Luau 수직 통합 + Studio Bridge 런타임 피드백.**

일반 아키텍처 영리함은 보조. Cursor Composer, Cognition Devin, Replit Agent 다 비슷한 아키텍처는 함. 다만 일반 코딩 에이전트라 Roblox에 최적화 못 됨. Luano는 Roblox 원툴 지향이라 깊게 파고들 수 있음.

---

## 2. 수정된 핵심 원칙

**원칙 1 — Bulk read 금지:**
> Manager는 bulk read를 안 한다. 작은 스코프 도구(`outline`, `findSymbol`, `snippet`)는 직접 호출 가능. 무거운 작업(구현/리팩토링/조사)은 worker로 위임.

원안의 "Manager가 코드를 절대 안 읽음"은 너무 절대적이라 실전에서 깨짐 ("이 5줄 함수 뭐해?" 같은 즉답에 worker spawn은 오버킬). 위 원칙이 더 정확.

**원칙 2 — Memory의 두 종류 분리:**
- **User-검증 ground truth** (`mistakes.md`) — 유저가 교정한 내용. 절대 위반 금지. 가장 신호 강한 memory.
- **LLM-유지 working knowledge** (`architecture.md`, `decisions.md`) — 에이전트가 작성/유지. 검증 도구로 코드 현실과 매치 체크.

**원칙 3 — 검증 가능한 memory:**
LLM이 자유 마크다운으로 유지하면 3주 안에 50KB의 모순적 노이즈 됨. 구조화된 형식 + 자동 검증 + user-editable + rollback 필수.

---

## 3. 아키텍처 (4 레이어)

### Layer 1: 프로젝트 두뇌 (`.luano/`)

프로젝트 폴더에 영구 저장. 어떤 에이전트 컨텍스트와도 독립.

```
.luano/
  index/                    # 코드 인텔리전스 (자동 생성/incremental 업데이트)
    symbols.json           # 심볼 → 파일:라인 (luau-lsp 결과 캐시)
    deps.json              # 모듈 의존성 그래프
    embeddings.bin         # 시맨틱 검색 인덱스 (Tier 3, 옵셔널)

  memory/                   # 에이전트가 작성/유지 (구조화된 형식)
    architecture.md        # 전체 설계 (LLM 유지 + 검증)
    decisions.md           # 결정 로그 + 이유 (파일/심볼 태그)
    mistakes.md            # 유저 교정 로그 (ground truth, 위반 금지)

  sessions/                 # 작업 상태 (영구)
    current-plan.md        # 현재 계획 (체크박스)
```

**삭제된 것 (YAGNI):**
- `glossary.md` — 코드에서 자동 추출 가능
- `patterns.md` — LLM이 쓰면 코드 현실과 어긋남, 코드 분석으로 derive
- `recent-edits.json` — git이 이미 함
- `types.json` — luau-lsp 떠있는데 캐시 불필요, invalidation 지옥

### Layer 2: Manager Agent (긴 스레드)

유저가 대화하는 그 에이전트. 두 단계 도구 접근:

- **가벼운 도구 (sync, 직접 호출):** `outline`, `findSymbol`, `snippet(file, lines)`, `grep`. 작은 응답. 80% 케이스 커버.
- **무거운 작업 (async, worker spawn):** 구현/리팩토링/조사. 요약만 회신.

읽는 것:
- `.luano/memory/*` (모든 작업 시작 시)
- `.luano/sessions/current-plan.md`
- 워커 응답 (구조화된 스키마)
- 유저 대화

이게 핵심 트릭. **Manager 컨텍스트가 영원히 20~50K로 유지됨.**

**Manager 프롬프트는 일급 시민** — 별도 설계 필요:
- 강제 룰 (memory 항상 읽고 업데이트)
- 자기-리마인더 패턴 (긴 대화에서도 룰 유지)
- 사이즈 예산 (몇 토큰까지 허용)

**Manager 모델:** Opus (판단/위임). 비용 절약 위해 routine dispatch는 Sonnet으로 graceful downgrade 검토.

### Layer 3: Worker Agents (소모성 스레드)

서브태스크당 spawn → 신선한 컨텍스트 → 끝나면 죽음.

**v1: Generic worker 1종.** 5종 분류는 임의/premature. 패턴 보고 나중에 특화.

**Worker 응답 계약 (구조화 스키마, 필수):**
```json
{
  "status": "completed | partial | failed | needs_input",
  "summary": "300자 이내",
  "files_modified": [{"path": "...", "change": "..."}],
  "new_decisions": [{"decision": "...", "reason": "...", "tags": ["file1", "symbolX"]}],
  "blockers": [...],
  "follow_ups": [...]
}
```

실패/부분완료/에스컬레이션 핸들링 없으면 manager가 무지에 빠짐.

**Worker 모델:** 작업 복잡도별 (간단=Sonnet/Haiku, 복잡=Opus). 비용 차이 10배라 명시 필수.

**동시성:** 디폴트 sequential. 병렬은 manager가 명시적으로 "독립적임" 선언 시에만. 파일 race condition 방지.

### Layer 4: Code Intelligence Tools (Luano의 진짜 무기)

Worker가 raw `readFile` 대신 쓰는 도구들. 50K 토큰 파일 읽기를 500토큰 응답으로 압축.

**v1 도구 (3개만):**
- `outline(file)` — 본문 제외, 구조만
- `findSymbol(name)` — 심볼 위치 + 시그니처 (luau-lsp wrapping)
- `grep(pattern)` — 텍스트 검색

**Month 1 추가:**
- `getCallers(symbol)` — 호출처 리스트 (luau-lsp)
- `getDependencies(file)` — Roblox `require()` resolver (numeric ID, ReplicatedStorage 경로, Wally, pesde 다 처리. 진짜 엔지니어링 작업)
- `snippet(file, lineRange)` — 작은 코드 조각 직접 읽기

**Month 2-3 추가 (가장 강력):**
- `runLuauAnalyze(file)` — 정적 분석 결과
- `studioBridge.runScript(luau)` — 런타임 검증 (Studio Bridge로 실제 실행)

> **이게 grep보다 신호 100배 강함.** 다른 IDE가 못 따라오는 Luano만의 무기. 원안 빼먹은 가장 큰 누락.

**나중에 필요시:**
- `semanticSearch(query, k)` — embeddings 기반. **시작하지 말 것.** grep + outline으로 80% 커버. 코드 임베딩은 prose보다 한참 약함 (스타일/주석이 로직 압도, 변수명 바꾸면 깨짐).

---

## 4. UX (제품의 본질)

원안에서 통째로 빼먹은 영역. 백엔드 아키텍처는 안 보임 — UX가 제품이야.

**필수 UI 요소:**

1. **Memory Inspector** — `.luano/memory/*` 시각화. 인라인 편집 가능. Manager가 뭘 알고 있는지 투명하게.
2. **Plan Panel** — `current-plan.md` 체크박스 인터랙션. 유저가 plan 직접 수정 가능.
3. **Worker Activity Feed** — 어떤 워커가 뭐 하고 있는지 라이브 표시. 30분 돌리는 동안 진행상황 가시화.
4. **Memory Correction Quickaction** — "이거 틀렸어" 한 클릭으로 `mistakes.md` 추가. Ground truth 입력의 friction 최소화.
5. **Worker Failure Surface** — 워커 실패 시 manager가 어떻게 핸들하는지 + 유저가 개입할 지점.

---

## 5. Memory 검증 인프라 (모래 위 성 방지)

전체 논지가 "manager가 memory를 알아서 잘 유지함"에 의존. 이건 프롬프트 엔지니어링 문제고 무조건 깨짐. 검증 인프라 없으면 castle of sand.

**필요한 것:**

1. **구조화된 memory 형식**
   - 자유 마크다운 X
   - Frontmatter + 섹션 사이즈 제한
   - 가독성용 렌더링은 별도 (UI에서 예쁘게)

2. **자동 검증 도구**
   - `architecture.md`가 "Roact 사용"이라 했는데 코드에 Fusion 있음 → 경고
   - `decisions.md`의 파일/심볼 태그가 stale (해당 파일 삭제됨) → 경고
   - 주기적 lint job

3. **User-editable + rollback**
   - UI에서 직접 수정
   - 잘못된 자동 업데이트 되돌리기 (git-style)

4. **Memory aging / reset**
   - 30일 지나면 memory에 잘못된 가정이 굳음
   - 주기적 "fresh eyes" 모드 (memory 재생성)
   - 유저 트리거 reset
   - Memory entry 만료 (N주 미터치 → 후보군 제외)

---

## 6. Phased 빌드 플랜

**Week 1-2: Proof of Concept**

목표: "Manager가 bulk read 안 함" 룰이 진짜로 컨텍스트 불안 줄이는지 측정.

- Manager 프롬프트 (gen 1)
- Generic worker 1종
- Tools: `outline`, `grep`, `snippet`
- `architecture.md` 1개 (수동 작성으로 시작)
- 측정: 30분 작업 후 manager 컨텍스트 사이즈 + 품질

**Month 1: Foundation**

- LSP 래핑 (`findSymbol`, `getCallers`)
- Worker 응답 구조화 스키마
- `mistakes.md` + UI quickaction
- `current-plan.md` discipline
- `architecture.md` 자동 업데이트 (manager가 작업 후 호출)

**Month 2-3: Production**

- Studio Bridge worker (`runScript` 검증)
- `runLuauAnalyze` 도구
- Memory 검증 도구 (lint job)
- UI: Memory Inspector, Plan Panel, Worker Activity Feed
- Manager 프롬프트 v2 (Week 1-2 데이터 반영)
- 기존 모드 (Plan/Agent/Chat) 통합 또는 마이그레이션

**이후 (필요 시 only):**

- Embeddings (`semanticSearch`)
- 워커 특화 (DataStore/Networking/UI)
- Compaction (manager 컨텍스트가 50K 못 지키면)
- Drunk detection (순환 행동 감지)
- Memory aging (30일+ 운영 데이터 보고)

각 단계 끝마다 **"진짜 컨텍스트 불안 줄었나?"** 측정. 안 줄면 그 단계 재설계.

---

## 7. 기존 Luano와의 통합 (미해결 결정)

Luano에 이미 있음:
- Plan Mode, Agent Mode, Chat Mode
- Studio Bridge
- Inline Edit, DiffView (Pro)
- Multi-AI provider
- `electron/ai/agent.ts`, `tools.ts`, `context.ts`, `rag.ts` (Pro)

**결정 필요:**

- [ ] Manager는 Agent Mode를 **대체**? **흡수**? **공존**?
- [ ] Plan Mode가 Manager의 디폴트가 되나?
- [ ] 새 Manager가 기존 `agent.ts`/`tools.ts`/`rag.ts`를 어떻게 활용/대체?
- [ ] Chat Mode (단순 대화)는 Manager 안 거치고 그대로 유지?
- [ ] Inline Edit는 Manager 외부 (단발성 작업)?

명시 없으면 코드가 누더기 됨. 빌드 시작 전 결정 필요.

---

## 8. 측정 지표 (성공/실패 판단)

**컨텍스트 불안 감소 측정:**

- Manager 평균 컨텍스트 사이즈 (목표: ≤50K, 작업 길이 무관)
- 30분 작업 후 manager 컨텍스트 사이즈
- "Drunk" 행동 빈도 (같은 파일 N번 읽기, 순환 등)
- 워커 평균 컨텍스트 사이즈 (목표: ≤200K, 단일 작업)

**제품 효과 측정:**

- 솔로 개발자가 한 세션에 완성하는 기능 수
- 유저 개입 빈도 (자동화 정도)
- `mistakes.md` 항목 증가율 (낮을수록 manager가 잘 학습)

**비용:**

- 작업당 토큰 사용량
- Manager vs Worker 비용 비율
- 모델 다운그레이드 (Opus→Sonnet) 가능성

---

## 9. 자평 / Critique 노트 (의사결정 흔적)

이 plan은 두 번째 패스. 첫 패스의 결함:

**큰 결함 (반영 완료):**
1. UX 통째 누락 → §4 추가
2. "Manager가 코드 절대 안 읽음" 너무 절대적 → §2 원칙 1로 수정
3. Memory 검증 인프라 0줄 → §5 추가

**YAGNI 컷 (반영 완료):**
- Worker 5종 → 1종 (generic)
- Memory 5개 → 3개 (architecture, decisions, mistakes)
- `types.json`, `glossary.md`, `patterns.md`, `recent-edits.json` 제거
- Embeddings v1 진입 금지
- 7개 도구 한방 빌드 금지 (3개로 시작)
- Drunk detection / Roblox 특화 워커 v1 금지

**개선 반영:**
- Worker 응답 구조화 스키마 (§3 Layer 3)
- 동시성 정책 (디폴트 sequential)
- `runLuauAnalyze` / `studioBridge.runScript` 도구 추가 (§3 Layer 4)
- Manager 프롬프트 일급 시민 (§3 Layer 2)
- Manager/Worker 모델 선택 명시
- Memory aging / reset (§5)
- Roblox-specific `getDependencies` 처리 (§3 Layer 4)

**Moat 재해석:**
- 원안: "4개 다 합친 도구 없음" (오버스테이트)
- 수정: "Roblox 수직 통합 + Studio Bridge 런타임 피드백" (§1)

**시간 추정:**
- 원안: "2-3개월 v1" (vibes)
- 수정: phased 빌드 (§6) — 각 단계 측정 기반

---

## 10. 다음 액션

1. §7의 통합 결정 답하기 (Manager가 기존 모드 흡수/대체/공존)
2. Week 1-2 PoC 스코프 확정 — Manager 프롬프트 v0 + generic worker + 3개 도구
3. 측정 인프라 셋업 (§8 지표 기록)
4. 기존 `electron/ai/agent.ts` 코드 inventory — 무엇을 재사용 vs 재작성
