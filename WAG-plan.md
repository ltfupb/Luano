# WAG (Wiki-Augmented Generation) 설계 문서

> 게임 개발자가 게임 컨셉을 설명하면 AI가 나무위키 스타일의 구조화된 마크다운 위키를 자동 생성,
> AI 에이전트가 코드 작성 시 이 위키를 컨텍스트로 참조하는 시스템.

---

## 핵심 개념

- **RAG가 아닌 LLM Wiki 방식** (Karpathy 방식) — 벡터DB 없이 마크다운 파일 + `[[wikilink]]`
- **자동 생성** — 개발자가 자연어로 설명 → AI가 엔티티 파일 생성
- **양방향 참조** — 몬스터 → 정수, 정수 → 몬스터 자동 링크
- **AI 코드 생성 시 참조** — 에이전트가 관련 WAG 파일 읽고 일관성 있는 코드 작성

---

## 1. WAG 파일 구조

```
<project-root>/wag/
  INDEX.md              # 자동 생성 목차
  _meta.json            # WAG 메타데이터
  monsters/
    grade-1/
      slime.md
      goblin.md
    grade-2/
      orc.md
  items/
    weapons/
      iron-sword.md
    consumables/
      health-potion.md
  abilities/
    fireball.md
  systems/
    drop-system.md
    combat-system.md
  npcs/
    shopkeeper.md
```

**파일명:** kebab-case, `.md` 확장자. `wag/`에서의 상대 경로가 엔티티 canonical ID.

**`_meta.json`:**
```json
{
  "version": 1,
  "createdAt": "2026-04-16T12:00:00Z",
  "updatedAt": "2026-04-16T14:00:00Z",
  "entityCount": 12,
  "categories": ["monsters", "items", "abilities", "systems", "npcs"]
}
```

**엔티티 파일 예시 (`wag/monsters/grade-1/slime.md`):**
```markdown
---
type: monster
tags: [grade-1, melee, starter]
created: 2026-04-16
updated: 2026-04-16
---

# Slime

Basic starter monster found in the Beginner Forest.

## Stats
- HP: 50
- ATK: 5
- DEF: 2
- Speed: 3

## Drops
- [[items/consumables/slime-gel]] (80%)
- [[essences/fire-essence]] (5%)
- Gold: 10-20

## Behavior
- Passive until attacked
- Splits into 2 mini-slimes at 25% HP
- Uses [[abilities/slime-tackle]] as primary attack

## Related
- Spawns in [[areas/beginner-forest]]
- Required for [[quests/slime-hunt]]
```

**wikilink 형식:** `[[category/entity-name]]` — `wag/`로부터의 상대경로, `.md` 생략.
파싱 정규식: `/\[\[([^\]]+)\]\]/g`

**`INDEX.md` 형식:**
```markdown
# Game Wiki

## Monsters (4)
- [[monsters/grade-1/slime]] - Basic starter monster
- [[monsters/grade-1/goblin]] - Quick melee attacker

## Systems
- [[systems/drop-system]] - How loot drops work
- [[systems/combat-system]] - Damage calculation
```

---

## 2. AI 생성 플로우

**트리거:**
- 채팅 패널에 "Generate Wiki" 버튼 (wag/ 디렉토리 없을 때 표시)
- `/wag` 스킬 커맨드

**생성 시스템 프롬프트:**
```
You are generating a game design wiki for a Roblox game project.

FORMAT RULES:
1. YAML frontmatter with: type, tags, created (today's date)
2. Use [[wikilinks]] to link related entities — path is relative to wag/ directory, no .md extension
3. Bidirectional links with meaning: if A links to B, B must link back to A WITH context.
   BAD:  "- [[monsters/slime]]"
   GOOD: "- Dropped by [[monsters/slime]] (5%)" or "- Used in [[systems/crafting]] as ingredient"
4. Create INDEX.md listing all entities with one-line descriptions
5. File paths: kebab-case under wag/ directory
6. 20-60 lines per entity file

FORMAT EXAMPLE (genre-agnostic):
---
type: <entity-type>
tags: [tag1, tag2]
created: <today>
---

# Entity Name

One-line description.

## Properties
- property: value
- other-property: value

## Relationships
- Related to [[category/other-entity]]
- Used by [[category/system]]

## Notes
Any additional context.

CATEGORIES: Derive categories from the game concept the user describes. Do NOT assume RPG categories. A racing game needs different categories than a puzzle game. Let the game concept define the structure.
```

**에이전트 플로우:** 기존 Plan → Execute → Verify 그대로 활용.
Plan 페이즈에서 생성할 파일 목록 계획, Execute 페이즈에서 `create_file`로 생성.

---

## 3. 점진적 업데이트

**추가 (Add):** 새 엔티티 파일 생성 → `wag_update` 호출 (INDEX + 백링크 자동 삽입)

**수정 (Modify):** `wag_read`로 파일 읽기 → `edit_file`/`patch_file`로 수정 → `wag_update` 호출

**`rebuildWagIndex` (핵심):**
- INDEX.md + _meta.json 재생성
- 깨진 링크(존재하지 않는 파일 참조) 목록 반환 → `wag_update` 툴 결과에 포함
- **백링크 자동 삽입 없음** — 관계 설명이 없는 나열은 노이즈. AI가 의미 있게 직접 작성.

**코드 수정 시 WAG 자동 업데이트:**
`agent.ts`의 write tool 실행 후, `.lua`/`.luau` 파일이 수정됐고 `wag/`가 존재하면
tool result에 리마인더 주입:
```
[WAG] {filePath} 수정됨. 관련 WAG 엔티티(스탯/드랍률/행동 변경)가 있으면 wag_read 후 업데이트.
```
시스템 프롬프트 지시와 즉시 컨텍스트 리마인더 병행으로 LLM compliance 강화.

---

## 4. WAG 인식 코드 생성

**시스템 프롬프트 레이어 순서 (업데이트):**
```
1. 기본 시스템 프롬프트 (identity + workflow + Luau standards)
2. WAG 컨텍스트 (경량 인덱스 — wag/ 있을 때만)
3. 프로젝트 지시사항 (LUANO.md)
4. 메모리
5. 진행 상황
6. 세션 핸드오프
```

**시스템 프롬프트 내 WAG 섹션 (~500 토큰):**
```
# Game Wiki (WAG)
This project has a game design wiki in the wag/ directory.
Use wag_search to find entities, wag_read to get full details.
Before implementing ANY game mechanic, read the relevant WAG entities first.
Follow [[wikilinks]] to understand entity relationships.
Write code that exactly matches WAG-defined values (HP, damage, drop rates, etc.).

[Game Wiki Index]
Monsters: slime, goblin, orc, dragon-king
Items: iron-sword, health-potion, slime-gel
Systems: drop-system, combat-system
```

**토큰 예산:** WAG 인덱스 ~500 토큰 상한. `wag_read` 결과는 `microCompact` (1500자 임계값) 통과. 태스크당 WAG 파일 2-5개 읽기 → 1000-3000 토큰 추가 (150k 예산 내 충분).

---

## 5. WAG 뷰어 — Monaco 마크다운 프리뷰

전용 패널 없이 기존 Monaco 에디터 확장. WagPanel/WagStore/WagTree 불필요.

**방식:**
- `wag/` 파일들은 기존 FileExplorer에서 정상 표시
- `.md` 파일 열 때 에디터 상단에 소스/프리뷰 토글 추가
- 프리뷰 모드에서 `[[wikilink]]` → 클릭 시 해당 파일을 새 에디터 탭에서 오픈

**Wikilink 처리:**
```tsx
// 커스텀 프로토콜 대신 data 속성 사용 (CSP 안전)
function processWikilinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_, path) => {
    const name = path.split('/').pop()
    return `[${name}](#wag:${path})`  // onClick handler가 #wag: prefix 감지
  })
}
// 클릭 핸들러: window.api.fileOpen(projectPath + '/wag/' + path + '.md')
```

**Empty state:** wag/ 없을 때 에디터 웰컴 화면 or 채팅 패널에 "게임 위키 생성" CTA 표시.

**새 컴포넌트 없음.** 기존 EditorPane에 마크다운 프리뷰 토글만 추가.

---

## 6. 기존 시스템과의 통합

**새 파일:** `electron/ai/wag.ts`

```typescript
export function buildWagIndex(projectPath: string): string
// _meta.json + INDEX.md 읽어서 시스템 프롬프트용 압축 인덱스 반환 (~500 토큰)

export function searchWag(projectPath: string, query: string, limit?: number): WagSearchResult[]
// 엔티티 이름, 태그, 내용 검색

export function readWagFile(projectPath: string, entityPath: string): string | null
// wag/<entityPath>.md 읽기

export function validateWag(projectPath: string): WagValidationResult
// 링크 일관성, 고아 파일, 백링크 누락 검사

export function parseWikilinks(content: string): string[]
// [[wikilink]] 대상 추출

export function getRelatedEntities(projectPath: string, entityPath: string, depth?: number): string[]
// wikilink BFS 탐색으로 관련 엔티티 수집 (1-2홉)

export function rebuildWagIndex(projectPath: string): void
// INDEX.md + _meta.json 재생성
```

**기존 RAG와 공존:**
- `search_docs` (기존) → Roblox API 문서 검색 (TweenService 사용법 등)
- `wag_search` (신규) → 게임 설계 위키 검색 (슬라임 스탯, 정수 효과 등)

**IPC 핸들러:** `electron/ipc/wag-handlers.ts` (신규)
- `wag:read`, `wag:search`, `wag:validate`, `wag:index`, `wag:exists`

**타입 정의:** `src/types/ipc/wag.d.ts` (신규)

---

## 7. 새 도구 정의

### `wag_read`
```typescript
{
  name: "wag_read",
  description: "Read a game wiki (WAG) entity. Returns full markdown with stats, relationships, wikilinks. Use before writing code for this entity.",
  input_schema: {
    properties: {
      path: { type: "string", description: "Entity path from wag/ (e.g. 'monsters/grade-1/slime'). No .md extension." }
    },
    required: ["path"]
  }
}
```

### `wag_search`
```typescript
{
  name: "wag_search",
  description: "Search the game wiki (WAG) by name, tag, or content. Use to find relevant entities before implementing features.",
  input_schema: {
    properties: {
      query: { type: "string", description: "Search term (e.g. 'fire essence', 'drop rate', 'boss')" },
      limit: { type: "number", description: "Max results (default: 5)" }
    },
    required: ["query"]
  }
}
```

### `wag_update`
```typescript
{
  name: "wag_update",
  description: "Rebuild WAG INDEX.md and _meta.json after creating/editing wiki files. Run after any batch of WAG changes.",
  input_schema: { properties: {}, required: [] }
}
```

**agent.ts 업데이트:**
- `READ_ONLY_TOOLS`에 `wag_read`, `wag_search` 추가
- `EXPLORATION_ONLY_TOOLS`에는 추가하지 않음 (위키 있는 프로젝트에서 항상 유용)

---

## 8. 구현 순서

**Phase 0 (MVP 검증 — 먼저 개념 증명):**
`wag_read` 단일 도구 + `sectionWag` 주입만 구현.
수동으로 5개 WAG 파일 생성 후 에이전트가 실제로 읽고 일관된 코드를 쓰는지 검증.
이게 안 되면 나머지 빌드 안 해도 됨.

| 페이즈 | 내용 | 파일 |
|--------|------|------|
| 0 | MVP 검증 | `electron/ai/wag.ts` (readWagFile만), `electron/ai/tools.ts` (wag_read만), `electron/ai/context.ts` (sectionWag) |
| 1 | WAG 코어 엔진 완성 | `electron/ai/wag.ts` (search, validate, rebuildWagIndex + 자동 백링크) |
| 2 | 에이전트 도구 + 자동 업데이트 | `electron/ai/tools.ts` (wag_search, wag_update), `electron/ai/agent.ts` (write tool 후 WAG 리마인더) |
| 3 | 생성 플로우 + 스킬 | `electron/ai/context.ts` (sectionWag 완성), `src/ai/skills.ts` (/wag 추가) |
| 4 | IPC 레이어 | `electron/ipc/wag-handlers.ts`, `electron/preload.ts`, `src/types/ipc/wag.d.ts` |
| 5 | Monaco 마크다운 프리뷰 | `src/editor/` (마크다운 프리뷰 토글 + wikilink 클릭) |
| 6 | 폴리시 | 파일 워처 wag/ 확장, 프로액티브 제안, 에러 메시지 개선 |

---

## 9. 주요 고려사항

- **토큰 예산:** 200+ 엔티티 프로젝트는 인덱스를 카테고리 + 개수만 표시로 압축. `wag_read` 결과는 microCompact에서 frontmatter + stats 섹션 보존, flavor 텍스트 truncate.
- **양방향 링크:** LLM에 위임하지 않고 `rebuildWagIndex`가 자동 삽입 (그래프 문제는 코드로 해결)
- **파일 워처:** chokidar를 `wag/` 디렉토리까지 확장 → WAG 파일 삭제/변경 시 INDEX 자동 재빌드
- **대규모 위키 성능:** 프로젝트 오픈 시 인메모리 인덱스(이름+태그+첫 줄) 로드, DB 불필요
- **프로액티브 제안:** 채팅에서 게임 디자인 키워드(monster, item, stat, ability 등) 감지 시 /wag 생성 제안
- **에러 메시지:** wag_read 미발견 시 형제 엔티티 목록 포함, wag_search 결과 없을 시 전체 카테고리 힌트

## 10. 리뷰 반영 결정 사항

| 결정 | 원안 | 변경 후 |
|------|------|---------|
| 뷰어 | 전용 WagPanel (사이드바 6번째) | Monaco 마크다운 프리뷰 토글 |
| 백링크 유지 | LLM이 기억해서 추가 | rebuildWagIndex가 자동 삽입 |
| 코드→위키 동기화 | 시스템 프롬프트 지시만 | write tool 후 즉시 리마인더 주입 |
| 구현 순서 | 코어 엔진 먼저 | MVP 검증(Phase 0) 먼저 |
| wag_update | INDEX 재빌드만 | INDEX 재빌드 + 자동 백링크 + 깨진 링크 리포트 |

---

## 진행 현황

| 항목 | 상태 |
|------|------|
| 설계 문서 | ✅ 완료 |
| 구현 | 미시작 |
