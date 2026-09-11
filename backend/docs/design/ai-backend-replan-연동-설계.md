# 백엔드가 AI `/ai/v1/itinerary/replan` 을 호출한다 (설계 확정)

> 상태: 설계 확정, 구현 미착수 · 작성 2026-09-12
> 근거는 전부 `origin/develop`(`3c7dd420`) 실측이다 — 이 문서의 파일·심볼·컬럼·기본값은 작성 시점에 코드와 마이그레이션에서 확인한 것이고, 인셉션 문서에서 옮겨 적은 것이 아니다.
> 범위: **AI 와 백엔드 양쪽.** 새 경계 1개 + 백엔드 어댑터 전환. FE 변경 0.
> 선례: [`ai-backend-alternatives-연동-설계.md`](./ai-backend-alternatives-연동-설계.md) — 같은 방식으로 문서를 먼저 쓰고 양쪽이 맞춰 갔다.

---

## 0. 한 줄 요약

재계획(i04→i06)이 지금은 `/ai/v1/itinerary/generate` 를 재사용한다. 그 경로는 **RAG 를 안 타고, 사용자 취향을 중립으로 덮고, 재계획 사유·지시·자유입력을 버린다.** 전용 경계 `/ai/v1/itinerary/replan` 을 열어 PlanBAgent 가 소유하게 하고, **백엔드가 이미 DB 에 갖고 있는 값을 전부 실어 보낸다.**

---

## 1. 왜 `generate` 재사용을 그만두나

`HttpScheduleAgentAdapter.replan()` 은 `ScheduleAgentInput` 을 만들어 `GENERATE_PATH` 로 보낸다. 그 결과 셋이 무너진다.

### ① RAG 를 안 탄다

`generate` 는 ScheduleAgent 가 받고, ScheduleAgent 는 KB 검색을 하지 않는다. **"비 오면 실내 우선" 같은 상황 지식(KB-3 24건)이 재계획에 하나도 반영되지 않는다.** Plan-B 의 핵심이 RAG 인데 정작 재계획이 그걸 안 쓴다.

### ② 사용자 취향을 중립으로 덮는다

```kotlin
// HttpScheduleAgentAdapter.replan()
preferenceProfile = NEUTRAL_PREFERENCES,   // 전 필드 빈 값
tripContext = TripContext(destinations, targetDate, targetDate, null, null),
//                                                       companion ↑    ↑ budget
```

`trip.preference_snapshot`(취향 7축)·`trip.companion_type`·`trip.budget_total` 이 DB 에 있는데 **재계획은 안 읽는다.** 처음 일정은 취향으로 만들고 다시 짤 땐 "아무 취향 없는 사람"으로 만드는 셈이다.

### ③ 재계획 의도가 통째로 버려진다

`replan_session` 에 `reasons text[]` · `directives text[]` · `free_text varchar(500)` 이 **이미 저장돼 있다**(V2.17). 어댑터 주석이 그 사실을 인정한다 — *"상대 요청 계약에 실을 자리가 없다"*. 자리를 만드는 것이 이 문서의 본론이다.

### 기각: `generate` 에 선택 필드를 추가한다

처음 생성에는 의미 없는 필드가 스키마에 남고, 무엇보다 **RAG 문제가 안 풀린다**(경로 주인이 ScheduleAgent 그대로). ①이 해결 안 되면 나머지를 고쳐도 Plan-B 가 아니다.

### 유지: 창을 좁히지 않고 잠금으로 표현한다

`PARTIAL_SLOTS` 여도 `time_window` 는 하루 전체다. 창을 "지금부터"로 좁혔더니 **오전에 잠긴 고정 블록이 창 밖이 되어 409 로 거부된 실측**이 어댑터 주석에 남아 있다. 이 결정은 새 경계에서도 그대로 간다.

---

## 2. 요청 매핑표 — `ReplanInput` + DB → AI `ReplanRequest`

### 지금도 나가는 것 (그대로)

| AI 필드 | 백엔드 원천 | 비고 |
|---|---|---|
| `trip_id` | `replan_session.trip_id` | |
| `trip_context.destinations` | `trip_destination.region` | 비면 AI 가 422 (실측) |
| `target_date` | `replan_session.from_instant` → Asia/Seoul 파생 | 컬럼 아님 |
| `anchor` | `replan_session.origin_lat/lng` (없으면 `trip_base_day` 숙소) | 기준점 사다리 BR-U4-19 |
| `locked_blocks` | `visit_slot.is_fixed` + `visit_check` 완료 + `from_instant` 이전 | 시각 포함 — 시각 없는 블록은 AI 가 거부(422 실측) |
| `excluded_poi_ids` | `replan_session.excluded_poi_ids` | |
| `request_meta` | 런타임 | **`deadline_ms` 는 §6 참조** |

### 새로 실어야 하는 것 — **DB 에 이미 있다. 읽어서 보내면 된다**

| AI 필드 | 백엔드 원천 | 지금 |
|---|---|---|
| `preference_profile` | `trip.preference_snapshot jsonb` | **중립으로 덮음** |
| `trip_context.companion_type` | `trip.companion_type` | `null` 하드코딩 |
| `trip_context.budget_level` | `trip.budget_total` → 등급 변환 | `null` 하드코딩 |
| `scope` | `replan_session.scope` (`PARTIAL_SLOTS`\|`FULL_DAY`) | 잠금으로만 표현 |
| `from_instant` | `replan_session.from_instant` | 잠금 계산에만 씀 |
| `reasons` | `replan_session.reasons text[]` → **AI 어휘로 번역**(§3) | 안 보냄 |
| `directives` | `replan_session.directives text[]` | 안 보냄 |
| `free_text` | `replan_session.free_text varchar(500)` | 안 보냄 |
| `current_slots` | `visit_slot.*` + `placement_reason` | 안 보냄 |
| `saved_places` | `saved_place(account_id, poi_id)` | 재계획 경로가 안 읽음 |

### 미루는 것 1개

| 값 | 왜 미루나 |
|---|---|
| `trigger` (강수확률·감지 사유) | `plan_b_trigger.*` 에 다 있으나 **C10(recalculation)→C9(planb-detection) 모듈 의존이 없다.** `ReplanSessionService.changeReason` 주석이 그 포기를 명시한다. 사용자가 고른 `reasons` 로 1차는 충분하다고 보고, 의존 추가는 별건 |

`ReplanRequest.trigger` 는 **선택 필드로 자리만 만들어 둔다**(`null` 허용). 나중에 백엔드가 배선하면 계약 변경 없이 켜진다.

---

## 3. 어휘 번역은 백엔드가 한다

FE 와 AI 가 서로 다른 코드 체계를 쓴다. **번역 지점은 백엔드 어댑터 한 곳**이다.

| FE (`replanScope.ts`) | AI `reason` |
|---|---|
| `WEATHER` | `weather` |
| `TEMP_CLOSED` | `closed` |
| `SLOW_MOVE` | `delay` |
| `LOW_ENERGY` | `fatigue` |
| `FULLY_BOOKED` | `fully_booked` ← **신규** |
| `JUST_CHANGE` | `none` |

`FULLY_BOOKED`(예약 마감)는 `canceled`(예약 취소)와 **다른 사유다.** 정본 3곳(`PRD 07-PlanB재계획.md`·`u4 plan:35`·`business-logic-model:70`)이 둘을 한 항목으로 묶어 놨는데, FE 는 이미 갈라 놨다 — 문서가 낡았고 이 작업에서 함께 정정한다.

`directives` 는 **번역하지 않는다.** FE 키(`INDOOR`·`LESS_MOVE` …)를 그대로 보내고 AI 사전이 그 키를 안다. 사전은 FE 칩(7종)보다 넓고(20~30종), 칩에 없는 것은 **자유입력으로 닿는다** — 의도된 분업이다. AI 가 모르는 키는 `unknown_directives` 로 응답에 실어 되돌린다(조용한 무시 금지).

---

## 4. 요청 스키마 (AI 측 정의)

```python
class ReplanRequest(BoundaryModel):
    """POST /ai/v1/itinerary/replan — 하루를 다시 짠다 (i04 → i06).

    generate 와 다른 것: RAG(KB-3)를 탄다 · 재계획 의도를 받는다 · 원 일정을 컨텍스트이자 후보로 받는다.
    같은 것: 산출이 ItineraryPayload 다 — 백엔드 소비 코드가 그대로 돈다.
    """
    trip_id: str = Field(min_length=1)
    trip_context: TripContextSchema
    target_date: dt.date
    time_window: TimeWindowSchema            # 하루 전체. 좁히지 않는다 (§1)
    anchor: CoordSchema

    scope: Literal["PARTIAL_SLOTS", "FULL_DAY"]
    from_instant: dt.datetime
    locked_blocks: list[FixedBlockSchema] = []
    current_slots: list[ReplanSlotSchema] = []

    reasons: list[str] = []                  # AI 어휘 (백엔드가 번역)
    directives: list[str] = []               # FE 키 그대로
    free_text: str | None = Field(None, max_length=500)
    trigger: TriggerSchema | None = None     # 자리만 — §2

    preference_profile: PreferenceProfileSchema
    saved_places: list[SavedPlaceSchema] = []
    excluded_poi_ids: list[str] = []
    request_meta: RequestMetaSchema


class ReplanSlotSchema(BoundaryModel):
    """원 일정 슬롯 1개 — KB-1 컨텍스트이자 후보 풀 합류 대상.

    `VisitSlotDisplaySchema` 를 안 쓰는 이유: 그것은 **AI 산출물의 사영**이고 이쪽은
    **백엔드가 주는 입력**이다. 같은 모양이어도 방향이 반대라, 한쪽을 고치면 다른 쪽이
    끌려가는 결합을 만들지 않는다. `placement_reason` 도 산출물 쪽엔 없다.
    """
    poi_id: str = Field(min_length=1)
    start_at: dt.time
    end_at: dt.time
    is_fixed: bool = False
    ends_next_day: bool = False
    placement_reason: str | None = None      # visit_slot.placement_reason
```

### 판단

**`current_slots` 가 두 일을 한다.** KB-1(기존 일정 컨텍스트)이면서 **후보 풀에 합류한다.** 원 일정 POI 가 새 후보와 같은 `PREFERENCE_SCORING` 호출에 들어가므로 **같은 척도로 비교**된다 — "원래 자리보다 나은 것만 바꾼다"가 성립한다. 점수를 백엔드가 저장했다가 돌려주는 안은 기각했다(§9).

**`scope` 와 `locked_blocks` 는 중복이 아니다.** `FULL_DAY` 여도 방문 완료한 곳은 잠긴다(i05 "방문한 3곳 그대로"). `locked_blocks` = 못 건드리는 것, `scope` = 안 간 곳 중 어디까지 건드리나. 둘이 어긋나면 AI 가 잡을 수 있고 프롬프트 문구도 갈린다.

**`free_text` 상한 500 은 DB 와 같은 값이다**(`replan_session.free_text varchar(500)`). 계약이 DB 보다 좁으면 저장된 값이 경계에서 잘린다.

---

## 5. 응답 스키마

```python
class ReplanResponse(BoundaryModel):
    """재계획안 1안. 못 만들면 itinerary=null + empty_reason (200, IO-7)."""
    itinerary: ItineraryPayload | None = None
    total_distance_km: float | None = None

    is_fallback: bool
    fallback_level: int                      # 0=LLM · 1=규칙 · 2=해 없음
    notes: list[str] = []
    retrieved: dict[str, int] = {}           # KB 히트 수
    resolved_directives: list[str] = []      # 자유입력 → 해석된 지시
    unknown_directives: list[str] = []       # 모르는 지시 (조용한 무시 금지)
    empty_reason: ReplanEmptyReasonSchema | None = None


class ReplanEmptyReasonSchema(BoundaryModel):
    """왜 재계획안을 못 만들었나. **문구는 FE 소유** — 여기는 코드와 재료만 준다.

    선례: `UnplacedMustVisitSchema.reason_code`(닫힌 3값, "백엔드가 분기·화면 문구에 사용").
    자유 문장으로 두면 i18n·톤 변경이 AI 재배포가 된다.
    """
    code: Literal[
        "NO_CANDIDATE",        # 후보 풀 자체가 비었다
        "ALL_EXCLUDED",        # 후보가 제외 목록에 다 걸렸다
        "NO_FEASIBLE_SLOT",    # 후보는 있으나 HC 를 통과하는 배치가 없다
        "DIRECTIVE_CONFLICT",  # 지시끼리 모순 (예: 실내로 + 야경 코스)
        "UNKNOWN",
    ]
    params: dict[str, str] = Field(default_factory=dict)   # 예: {"from": "17:00", "filter": "INDOOR"}
```

`i06` 대안 없음 화면의 `"17시 이후 실내 후보가 근처에 없어요"` 는 `{code: "NO_CANDIDATE", params: {from: "17:00", filter: "INDOOR"}}` 로 만든다.

### diff 는 AI 가 만들지 않는다

`i08` 의 `바뀐 곳 1` · `방문지 5→5` · `이동 −6.9km` 는 **`ReplanDiffService` 가 이미 백엔드에 있다.** 원 일정을 가진 쪽이 만드는 것이 맞다.

### ⚠ `total_distance_km` 는 담을 자리가 없다 — **백엔드 작업 필요**

`visit_slot` 에 **미터 컬럼이 없다.** `distance_range varchar(60)` 은 `"약 1.2km · 도보 추정"` 같은 **표시 문자열**이라 더할 수 없다. 그래서 지금 `ReplanDiffService` 가 `distanceM = null` 로 고정하고, **`ReplanImpactResponse.totalDistanceDeltaM` 은 현재 코드 경로에서 항상 null 이다** — i08 의 "이동 −6.9km" 가 나올 수 없다.

**요청**: `replan_session.draft jsonb` 에 `totalDistanceKm` 를 담는다. `ReplanProposal.toMap()` 확장이라 **마이그레이션이 필요 없다.** `visit_slot` 에 미터 컬럼을 더하는 안은 슬롯마다 값이 필요하고 기존 행의 백필 문제가 생겨 더 비싸다.

---

## 6. 마감 — 10초 → 25초

지금은 `ReplanFacadeService.REPLAN_DEADLINE_MS = 10_000L` 이다(companion, 주석 "사용자가 화면에서 기다리는 동작이라 생성(20s)보다 짧게"). 새 경계는 한 요청에 이것들을 한다:

```
자유입력 해석 (임베딩 ~200ms, 낮으면 LLM ~5s)
  → KB-3 검색 (임베딩 직렬 3회, 콜드 스타트 최대 5s)
  → 후보 풀 조립 + PREFERENCE_SCORING
  → 어셈블리 solve
```

`alternatives` 를 25초로 올린 근거(sol 중앙값 5.0s · 2단 폴백 재시도 몫)가 여기도 그대로 적용되고, **solve 가 추가로 붙는다.** 25초를 하한으로 잡고 실측 후 조정한다. 상수는 이미 `ReplanFacadeService` companion 에 있으므로 **값만 올린다** — 어댑터가 다시 정의하지 않는 배치는 `SlotCandidateService.CANDIDATES_DEADLINE_MS` 와 같다.

---

## 7. 단계별 작업 목록

### AI 측

| # | 무엇 | 비고 |
|---|---|---|
| A-1 | `fully_booked` 사유 추가 | `_REASON_KO` · KB 문서 · 테스트 · 주석. **랭킹 중립**(`_DEMOTED_BY_REASON` 미등록) |
| A-2 | `replan_directives.yaml` 사전 20~30종 + KB-4 적재 | key · label · aliases · effect |
| A-3 | `REPLAN_DIRECTIVE_TRANSLATION` 워커 4종 세트 | 목록은 **서버 주입**(`EDIT_TRANSLATION` 선례) · **인젝션 방어 필수** |
| A-4 | `ReplanRequest`/`ReplanResponse` + 라우트 + wiring | PlanBAgent 가 소유 |
| A-5 | `scripts/export_openapi.py` 재생성 | `ai/docs/openapi.json` 은 손으로 고치지 않는다 |

### 백엔드 측

| # | 무엇 | 비고 |
|---|---|---|
| B-1 | `ReplanInput` → 새 요청 매핑 (§2 의 10종 전부) | `NEUTRAL_PREFERENCES` 제거가 핵심 |
| B-2 | FE↔AI 어휘 번역표 (§3) | 어댑터 한 곳 |
| B-3 | `REPLAN_PATH` 추가 + `CALLED_PATHS` 등록 | 지금 5개(`generate`·`validate`·`repair`·`explanations`·`alternatives`). **안 넣으면 `AiBoundaryOpenApiTest` 계약 게이트가 이 경로를 안 본다** |
| B-4 | `ReplanFacadeService.REPLAN_DEADLINE_MS` 10_000 → 25_000 (§6) | 값만 |
| B-5 | `ReplanProposal.toMap()` 에 `totalDistanceKm` (§5) | 마이그레이션 불필요 |
| B-6 | `slot_candidates` 의 `reason = "none"` 하드코딩 해제 | 별건이지만 같은 번역표를 쓴다 |

### 전환 절차

**양쪽 동시.** 선개통(AI 경계만 먼저)은 `alternatives` 에서 한동안 미사용 경계로 남았던 전력이 있다. 이 문서가 계약 합의문이므로 양쪽이 각자 만들고 `LIVE_AI=1` 왕복으로 만난다.

---

## 8. 이 설계가 닫아도 남는 것

- **`i05` 부분 결과 스트리밍** — 이 경계는 단발 응답이다. SSE·청크는 별건이고, 이 스키마가 그 길을 막지는 않는다(같은 페이로드를 조각으로 보내면 된다).
- **`trigger` 배선** — §2 참조. 자리만 있고 값은 안 온다.
- **재계획 반영 시 위반 표시가 리셋된다** — `ReplanSlot` 에 `hasViolation`/`violationReason` 이 없어 `ReplanFacadeService.toSlots()`(L198 `VisitSlot.of(...)`)가 그 둘을 안 넘긴다 — 기본값(false/null)이 된다. **이 문서 밖의 백엔드 결함**이고 여기서 고치지 않는다.
- **산출 품질이 세션에 안 남는다** — `solve_mode`·`is_fallback`·`candidates_summary` 를 담을 자리가 `replan_session` 에 없다. `draft jsonb` 확장으로 같이 넣을 수 있으나 이번 범위 밖.
- **`OriginResolver` KDoc 이 낡았다** — "`LAST_VISIT` 은 항상 null" 이라 적혀 있는데 `ReplanSessionService.start()` 가 이미 좌표를 채운다. 주석만 정정하면 된다.

---

## 9. 기각한 안 — 선호 점수를 저장해 재사용

`PREFERENCE_SCORING` 이 매긴 점수(`ScoredPoi.score`)를 백엔드 DB 에 쌓아 재계획에서 재사용하는 안을 검토하고 기각했다.

**기각 사유가 "점수가 상황 의존적이라서"가 아니다** — 프롬프트를 확인하니 `taste_tags`·`companion`·`budget` 만 받고 날씨·사유를 안 받으므로, 점수는 실제로 상황 무관한 안정값이다. 기각 사유는 셋:

1. **절감이 작다.** 재계획에서 점수가 필요한 건 *새 후보* 수십 개다. 원 일정 POI 5개는 어차피 같은 호출에 묻어간다 — 아껴야 토큰 10~20%.
2. **무효화 규칙이 스키마보다 비싸다.** `trip.preference_snapshot` 이 바뀌면 쌓인 점수가 전부 낡는다. 언제 버릴지가 진짜 설계 문제이고, 그 값어치가 위의 10~20% 다.
3. **계정 파기 캐스케이드 부채.** 사용자별 데이터를 AI 쪽에 적재하면 생긴다 — 저장 장소를 벡터 대신 봉투로 받은 TRIP-512 의 셋째 근거와 같다.

**대신 KB 로 쌓을 가치가 있는 것은 수락·거절 이력이다.** 점수와 달리 봉투에 못 담기고(과거 전체), 자유 텍스트가 붙고, 취향이 변해도 "그때 이걸 거절했다"는 사실은 안 낡는다. `planb-rag-design.md` §4 인덱싱 단위에 이미 적혀 있고 KB-2 자리다 — **실사용 데이터가 생긴 뒤**의 일이다.
