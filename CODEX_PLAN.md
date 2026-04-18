# Luano 개선 계획 — Codex CLI 레퍼런스 기반

> Codex CLI 오픈소스 코드 분석 결과를 바탕으로 Luano에 적용할 기능 목록.
> 방향: Claude Code/Codex에 있는 **기본 기능** 추가 + 기존 기능 고도화.
> 복잡한 신규 기능(백그라운드 에이전트 데몬 등)은 제외.

---

## 현재 Luano가 이미 가진 것 (건드리지 않을 것)

- Phase 아키텍처 (plan → execute → verify)
- MicroCompact (도구 결과 로컬 압축, API 호출 없음)
- Checkpoint / 롤백
- 스톨 감지 + 넛지 메시지
- MAX_TOOLS_PER_ROUND (런어웨이 방지)
- DANGEROUS_TOOLS 분류
- ThinkingBubble (첫 토큰 전 3초 대기 후 rotating hints)
- Advisor 도구 통합

---

## 1. apply_patch 파일 편집 (우선순위 HIGH)

**참고:** `codex-rs/apply-patch/src/`

**문제점:**
현재 `edit_file`은 `old_text → new_text` 정확 문자열 교체 방식.
LLM이 공백/탭 하나 틀리면 실패한다.

**개선:**
커스텀 패치 포맷 — 함수명/클래스명 같은 시맨틱 컨텍스트로 위치를 찾아서
정확한 문자열 매치 없이도 편집 가능.

```
*** Begin Patch
*** Update File: src/foo.luau
@@ function handleTouch
-  local x = 1
+  local x = 2
*** End Patch
```

**구현:**
- [ ] TypeScript로 apply_patch 파서 구현 (`seek_sequence` 알고리즘)
- [ ] 기존 `edit_file` 도구를 apply_patch 방식으로 교체 또는 보완
- [ ] AI 시스템 프롬프트에 포맷 지시 추가

---

## 2. 대화 히스토리 자동 컴팩션 (우선순위 HIGH)

**참고:** `codex-rs/core/src/compact.rs`

**문제점:**
현재 MicroCompact는 도구 결과만 압축한다.
긴 세션에서 대화 히스토리 자체가 컨텍스트 윈도우를 채워서 오류가 난다.

**개선:**
대화 히스토리 토큰이 임계값 도달 시 LLM으로 자동 요약 후 교체.

**구현:**
- [ ] 토큰 수 추정 유틸리티 (bytes / 4 휴리스틱)
- [ ] 컨텍스트 80% 도달 시 자동 요약 트리거
- [ ] 요약 결과로 히스토리 교체
- [ ] 채팅 UI에 컴팩션 발생 알림 표시

---

## 3. Extended Thinking 인디케이터 고도화 (우선순위 MEDIUM)

**문제점:**
현재 ThinkingBubble은 첫 토큰까지 걸리는 시간만 본다.
실제로 모델이 thinking 중인지 텍스트 생성 중인지 구분하지 않는다.

**개선:**
Claude API의 extended thinking 블록을 감지해서 UI에 반영.

**구현:**
- [ ] `provider.ts`: `content_block_start` where `type === "thinking"` → `streamChannel:thinking true` IPC 전송
- [ ] thinking 블록 종료 시 → `false` 전송
- [ ] `ChatPanel.tsx`: thinking 이벤트 구독 → "Thinking…" vs "Writing…" 구분 표시
- [ ] extended thinking API 파라미터 (설정으로 토글)

---

## 4. 도구 실행 승인 흐름 (우선순위 MEDIUM)

**참고:** Codex `AutoApprove / AskUser / Reject` 3단계

**문제점:**
현재 AI가 `delete_file`, `run_studio_script` 등 위험한 작업을 바로 실행한다.
DANGEROUS_TOOLS 분류는 있지만 사용자 확인 UI가 없다.

**개선:**
위험 도구 실행 전 인라인 확인 UI.

**구현:**
- [ ] 도구별 위험도 분류 정교화 (read-only / write / destructive / exec)
- [ ] destructive 도구 호출 시 renderer에 확인 요청 IPC 전송
- [ ] ChatPanel에 승인/거부 버튼 UI
- [ ] 사용자 설정: 특정 도구는 항상 자동 승인

---

## 진행 현황

| 항목 | 상태 |
|------|------|
| apply_patch 편집 (patch_file 도구) | ✅ 완료 |
| edit_file 공백 정규화 폴백 | ✅ 완료 |
| 대화 히스토리 컴팩션 | ✅ 이미 구현됨 |
| Extended Thinking 인디케이터 | ✅ 완료 |
| 도구 실행 승인 흐름 | ✅ 완료 |
| MAX_ROUNDS 제거 (CC/Codex 방식) | ✅ 완료 |
| Lazy context injection (CC/Codex 방식) | ✅ 완료 |
