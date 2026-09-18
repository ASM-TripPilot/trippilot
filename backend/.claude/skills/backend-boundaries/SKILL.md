---
name: backend-boundaries
description: "TripPilot 백엔드의 경계 규칙 — 모듈 간 의존(R1)·AI 경계 계약·Flyway 마이그레이션. 모듈을 넘어 무언가를 참조하거나, 새 모듈·퍼사드·이벤트를 만들거나, `ScheduleAgentPort`·와이어 DTO·`openapi.yaml` 을 건드리거나, 마이그레이션(`V*.sql`)을 추가할 때 반드시 사용하라. '다른 모듈 걸 써야 하는데', '경계 어떻게 열지', '마이그레이션 추가', '스키마 바꿔', 'AI 계약 고쳐' 라고 하는 순간이 그 시점이다. 이 경계들은 어겨도 **컴파일이 되고 테스트도 통과하며**, 실 DB·실 상대에서만 터진다."
---

# 경계 — 모듈 · AI · 스키마

세 경계 모두 공통점이 있다. **어겨도 그 자리에서는 아무 일도 일어나지 않는다.** 컴파일이 되고, 단위 테스트가
통과하고, 실 DB 나 실 상대에 닿는 순간 터진다. 그래서 각 경계마다 "무엇으로 확인하는가"가 규칙의 절반이다.

## 모듈 경계 (R1)

**타 모듈은 `..api..` 만 참조한다.** `domain`·`application`·`adapter` 는 그 모듈 것이다.
ArchUnit `slices()` 가 빌드에서 강제하므로 어기면 CI 가 빨개진다 — 다만 **설계를 먼저 하고 규칙을 나중에 만나면
되돌리는 비용이 크다.**

필요한 것이 남의 `domain` 에 있으면 셋 중 하나다:

| 상황 | 처방 |
|---|---|
| 값을 읽기만 한다 | 그 모듈 `api` 에 **api-safe 타입**으로 조회 퍼사드를 연다. 내부 도메인 타입을 계약에 싣지 않는다 |
| 그 모듈이 **행위**를 해야 한다 | `api` 에 오퍼레이션을 연다. 호출측이 남의 내부를 조립하지 않는다 |
| 사건을 알리기만 한다 | `api/event` 에 도메인 이벤트 |

**판정 기준은 "누가 그 규칙을 소유하는가"다.** 재계획(C10)이 잠금 슬롯을 계산하려 했을 때, 슬롯 시각·고정 여부는
일정(C8)에 있었다. 그 값을 계약에 실어 내보내는 대신 **계산 자체를 C8 로 옮겼다** — 규칙이 두 모듈에 흩어지면
한쪽만 고쳐 어긋난다.

퍼사드를 열 때 계약에 싣는 것은 **경계 키**(`slotKey = "{date}#{poiId}"`)이지 물리 키가 아니다.
행이 갈려도 참조가 끊기지 않아야 한다.

**확인**: `./gradlew :app:test --tests "*ArchitectureRulesTest*" --tests "*KonsistRulesTest*"`

## AI 경계

### 계약 게이트는 수용 보증이 아니다

`ai/docs/openapi.json` 이 와이어 정본이고 AI CI 가 실서버와의 일치를 강제한다. 우리 쪽은
`AiBoundaryOpenApiTest` 가 그 파일과 우리 DTO 를 대조한다.

**그 게이트는 필드 *이름*을 지키지 *제약*을 지키지 않는다.** 이름이 전부 맞는 상태에서 실호출이
연달아 거부된 적이 있다:

| 응답 | 원인 |
|---|---|
| 422 | `trip_context.destinations` 빈 목록 — `minItems: 1` |
| 422 | `anchors` 0개 — 후보 풀을 매달 기준점이 없다 |
| 422 | 시각 없는 고정 블록 — 상대 도메인(HC3)으로 표현 불가 |
| 409 | 잠금 시각이 시간창 밖 — 고정 블록 모순 |

그래서 경계를 건드렸으면 **실물에 한 번 태운다**(`backend-verify-gates` 의 실 AI 왕복 절).

### 상대에 새 경로를 요구하기 전에

열린 경로는 셋뿐이다 — `generate`·`validate`·`repair`. 재계획은 새 경로를 만들지 않고
**잠금을 고정 블록으로 승격해 `generate` 에 태웠다.** 새 경계는 상대 팀 작업이 선행돼야 하므로,
있는 것으로 표현할 수 있는지 먼저 본다.

### 계약을 바꿀 때 함께 손대는 것

하나라도 빠지면 컴파일은 되고 런타임에 터진다:

1. `ScheduleAgentPort` 의 입출력 타입
2. `FakeScheduleAgent` — 기본 모드라 **여기가 안 맞으면 로컬 전체가 조용히 틀린다**
3. `HttpScheduleAgentAdapter` — 실 와이어 매핑
4. 테스트 대역(`StubScheduleAgent` 등)
5. `AiBoundaryOpenApiTest` 가 보는 스키마 이름

### 정본 모양이 실 계약과 다를 때

U4 정본은 `lockedSlotKeys: List<String>` 이라고 적었지만 상대는 시각 없는 고정 블록을 거부한다.
**정본은 "무엇이 필요한가"를 정하지 "어떤 타입으로 보내는가"까지 정하지 않는다** — 바꾸고 이탈을 기록했다.

## 마이그레이션 (Flyway)

**SQL-first · forward-only.** `backend/app/src/main/resources/db/migration/V*.sql` 이 스키마 정본이고,
`R__*.sql` 은 체크섬이 바뀌면 재실행되는 시드다.

### 번호는 열린 PR 을 보고 정한다

머지 안 된 PR 이 쓰고 있는 번호를 피한다. 확인 없이 다음 번호를 집으면 **두 PR 이 같은 번호로 충돌**한다.

```bash
gh pr list --state open --json number,files --jq \
  '.[] | {n:.number, m:[.files[].path | select(contains("db/migration"))]} | select(.m|length>0)'
```

비어 있으면 `ls db/migration/V*.sql | sort -t. -k1,1n -k2,2n | tail -1` 다음 번호. 파일 상단 주석에
**왜 그 번호인지** 한 줄 남긴다(예: "V2.21 은 미머지 PR 이 쓰고 있어 V2.22").

### 실 DB 에서만 드러나는 것

새 테이블·제약을 추가했으면 Testcontainers IT 를 함께 쓴다. 인메모리 Fake 는 아래를 **원리적으로** 못 본다:

- **부분 유니크 인덱스** — 도메인 `isOpen`/`isRunning` · 영속 상수 · DB 인덱스가 **같은 집합**인가.
  하나만 어긋나면 앱이 "없다"고 보고 INSERT 해 사용자에게 500 이 나간다
- **쓰기 순서** — 한 트랜잭션에서 "닫고 열기"는 JPA 가 UPDATE 를 커밋까지 미뤄 INSERT 가 먼저 나간다.
  `saveAndFlush` 가 필요한 자리인지는 실 DB 만 안다
- **복합 PK 덮어쓰기** — Fake 는 Map 이라 언제나 덮어쓴다. "하루 1행"은 DB 가 보장한다
- **CHECK 어휘** — enum 은 대문자, CHECK 는 소문자인 테이블이 있다. 변환이 어긋나면 저장 자체가 실패한다
- **CASCADE 와 FK 방향** — 편집이 행 교체(DELETE→INSERT)라면 CASCADE 가 이력을 지운다.
  이력을 남겨야 하는 참조는 FK 를 걸지 않는 선택도 있다(근거를 주석에)

### 엔티티 주의

- JPA `@Entity` 는 **일반 `class`** 로 쓴다. `data class` 의 `equals/hashCode` 는 전 필드를 비교해
  상태가 바뀌면 컬렉션 멤버십이 깨진다. **ID 클래스(`@Embeddable`·`@IdClass`)는 반대로 `data class` 가 맞다**
- 엔티티를 API 응답으로 내보내지 않는다 — 응답 DTO 를 따로 둔다

## 확인 명령

```bash
cd backend
./gradlew :app:test --tests "*ArchitectureRulesTest*" --tests "*KonsistRulesTest*"   # 모듈 경계
./gradlew :app:test --tests "*OpenApiContractIT*"                                     # 우리 API 계약
./gradlew :modules:itinerary-generation:test --tests "*AiBoundaryOpenApiTest*"        # AI 계약 이름
./gradlew :app:test --tests "*SchemaMigrationIT*"                                     # 마이그레이션
```

## 관련

- `backend/.claude/skills/backend-verify-gates/` — 실 AI 왕복·실 DB IT 절차
- `docs/conventions/anti-patterns.md` — 경계 관련 누적 규칙
