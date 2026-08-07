# Agent 입출력 계약 — Frontend IO ↔ Backend DB/API ↔ AI Agent I/O 대응

> 근거 자료: `frontend/docs/와이어프레임-화면-IO정리.md`(화면 IO), `backend/docs/design/전체-최소-스키마.dbml`·`전체-API-서피스.md`(DB·REST 카탈로그), `ai/aidlc-docs/inception/reverse-engineering/api-documentation.md`(C1/C2/M7 논리 API — 세분 경로는 폐기 방향, 0.1 참조).
> 에이전트 구조는 `agent-hierarchy-design.md`(2계층)를 따른다.

---

## 0. 계약 사슬과 네이밍 경계

```
[클라이언트]        [Kotlin 백엔드]           [Python AI 서비스]
화면 IO (d/e/f밴드)  REST /api/v1 (camelCase)   Agent I/O (snake_case)
      | 사용자 입력        | M8/M9/M12가 저장·중계        | 에이전트 실행
      v                   v                             v
   버튼/폼/자연어  →  trip·must_visit·trigger_event  →  ScheduleAgentInput 등
   슬롯카드/대안카드 ←  slot·alternative·reflection   ←  ...AgentOutput
```

| 경계 | 규칙 |
|---|---|
| 클라 ↔ 백엔드 | JSON **camelCase**, `/api/v1`, Bearer (전체-API-서피스.md 기준) |
| 백엔드 DB | **snake_case**, PK uuid, `timestamptz`(UTC) |
| 백엔드 ↔ AI 서비스 | **snake_case** DTO. 프로토콜은 **REST/JSON over HTTP 확정** (PR #76 결정4). 경계 HTTP 경로는 아래 0.1 |
| 변환 책임 | camelCase↔snake_case 매핑은 **Kotlin 쪽(M8 등)이 소유**. AI 서비스는 snake_case만 안다 |
| 표시 규칙 | 사용자 표시 DTO는 `VisitSlotDisplay` 계열만 — `internal_duration_min` 부재로 INV-3 정적 보장 |

> ⚠ **정합성 플래그**: 와이어프레임(d06 "도보시간", d17 "총 이동시간", d18·e14 "이동/체류 시간", d27·b07 "평균 이동시간")은 INV-3(거리만 표시)와 상충한다. AI 계약은 INV-3를 따르며(시간값 미제공), 해당 화면은 **거리 표기로 대체되어야 한다**. 프론트 담당자와 조율 필요 — AI 서비스는 어떤 경우에도 표시용 이동시간을 반환하지 않는다.

### 0.1 경계 HTTP 경로 (2026-08-07 확정)

경계는 **딱 두 개**(포워드 ScheduleAgent · 리버스 POI 정본 read)이고, 조각 조립 경계는 두지 않는다(PR #76 "굵은 경계").
경로 규칙: `/v1`만으로는 어느 서비스의 v1인지 모호하므로 **서비스명(`/ai`)을 접두**하고, 리소스명은 **산출물 기준(`itinerary`)** 으로 잡아
백엔드 컨트롤러·스키마·DB 테이블 명칭과 통일한다. **`ScheduleAgent`는 "만드는 행위자"의 이름, `itinerary`는 "만들어진 산출물"의 이름** —
층이 다르므로 에이전트명은 그대로 유지한다.

| 방향 | 용도 | 경로 | 지위 |
|---|---|---|---|
| 포워드 | 일정 생성 (ScheduleAgent) | `POST /ai/v1/itinerary/generate` | **확정** — 구 표기 `POST /ai/generate`·`/ai/schedule` 폐기 |
| 포워드 | 일정 검증 | `POST /ai/v1/itinerary/validate` | **확정** |
| 포워드 | 일정 수리 | `POST /ai/v1/itinerary/repair` | **확정** |
| 리버스 | POI 정본 read — 반경 (`find_by_radius`) | `GET /internal/pois?centerLat&centerLng&radiusKm` | **확정** — 백엔드 구현 기준 |
| 리버스 | POI 정본 read — 배치 (`find_by_ids`) | `POST /internal/pois/batch-get` · 요청 필드 `poi_ids` | **확정** — 계약 초안의 `:batchGet`·`ids` 표기 정정 |
| 포워드 | AI 도우미 · Plan-B | `/ai/v1/...` 명명 규칙만 확정, 리소스명 **협의 중** | 미확정 |

리버스 나머지(`nearby`·`open-window`·`closedCheck`)는 이연 — 협의 중.

---

## 1. 일정 생성 플로우 (d밴드 ↔ ScheduleAgent)

### 1.1 입력 대응표 — 화면 → DB → 에이전트 입력

| 화면 (Input) | 클라가 보내는 것 | 백엔드 저장 | ScheduleAgentInput 필드 |
|---|---|---|---|
| c01 여행 생성 | 여행지, 시작/종료일, 인원, 예산 등급 | `trip(destination, start_date, end_date, party, budget_total)` | `trip_context{destination, date_range, party, budget_level}` |
| a03~a09 온보딩 취향 + d02 목적·취향 | 목적 카드·취향 태그 다중 선택 | `preference_set(styles[], activities[], food_tastes[], budget_tier, companion_types[], pace)` | `preference_profile` (7축, NULL=미설정) |
| d03 출발·위치·페이스 | 출발 시각, 출발 위치, 페이스 | `trip_base_day(saved_stay_id, resolution)` + 세션 파라미터 | `time_windows[{date, start, end}]`, `pace` |
| (숙소 등록) | 등록 숙소 = 거점 | `saved_stay(coord, check_in/out)` | `anchor{lat, lng}` (day별 — trip_base_day 해석 결과) |
| d05~d07 필수 방문지 | POI 선택, ANYTIME/FIXED, 시각·체류 | `must_visit(poi_snapshot_id, type, fixed_date, fixed_start, dwell_min)` | `fixed_blocks[{poi_id, date?, start?, dwell_min?}]` |
| b04 찜 | 저장 장소 | `saved_place(poi_id)` | (직접 입력 아님 — PersonaAgent 경유로 선호 컨텍스트에 반영) |
| d11 추천 강도 | 추천 강도 선택 | 생성 요청 파라미터 | `generation_mode(fully_ai/co_plan)`, `recommendation_strength` |

### 1.2 ScheduleAgent I/O (snake_case)

```python
@dataclass
class ScheduleAgentInput:
    trip_id: str
    generation_mode: str                  # fully_ai | co_plan
    trip_context: TripContext             # destination, date_range, party, budget_level
    anchors: list[DayAnchor]              # day별 거점 (trip_base_day 해석 결과)
    time_windows: list[TimeWindow]        # {date, start, end}
    fixed_blocks: list[FixedBlock]        # must_visit 유래
    preference_profile: PreferenceProfile # preference_set 7축
    recommendation_strength: str | None
    request_meta: RequestMeta             # request_id, requested_at, deadline_ms

@dataclass
class ScheduleAgentOutput:
    days: list[DaySchedule]               # day별 slots (솔버 검증값, INV-2)
    day1_ready_at: str | None             # day1 우선 반환 시각 (5초 정책)
    explanations: dict[str, str]          # slot_id → 추천 이유 (시간·소요시간 언급 금지)
    solve_mode: str                       # FULL_AI | DETERMINISTIC | MINIMAL
    is_fallback: bool
    freshness: FreshnessMeta              # 사용한 데이터 신선도 집계 (→ evaluation-metrics-design.md)
    candidates_summary: SufficiencyReport # PlaceScout 충분성 보고 (LOW면 UI에 안내 가능)
```

### 1.3 출력 대응표 — 에이전트 출력 → DB → 화면

| ScheduleAgentOutput | 백엔드 저장 | REST (카탈로그) | 화면 (Output) |
|---|---|---|---|
| `days[].slots[]` | `day_schedule` + `slot(poi_snapshot_id, start_time, end_time, source_type='ai', locked)` | `GET /itineraries/{id}` | d11 슬롯 카드, d25/d26 시간표·지도 뷰 |
| day1 우선 완료 | `generation_session(status, partial jsonb)` | `GET /generation-sessions/{id}` | d09 로딩 체크리스트 → d10 "Day1 먼저 보기" |
| `explanations` | slot 부가 필드 또는 세션 | 동일 | d11 카드 추천 이유 텍스트 |
| `solve_mode=MINIMAL` / `is_fallback` | `generation_session.status` | `POST /itineraries/{id}/regenerate` 유도 | d08 충돌 안내, 재생성/조건 완화 UI |
| 슬롯 교체 후보 | (PlaceScout 재조회) | `GET /itineraries/{id}/slots/{slotId}/candidates?radius=` | d12 슬롯 교체, d14/d15 반경 후보 |
| 표시 시각·거리 | `VisitSlotDisplay{poi_id, start_at, end_at, distance_range, is_fixed}` | 모든 조회 응답 | 시각=솔버값만(INV-2), 거리만(INV-3) |

---

## 2. Plan-B 플로우 (e밴드 ↔ PlanBAgent)

### 2.1 입력 대응표

| 화면 (Input) | 클라가 보내는 것 | 백엔드 저장 | PlanBAgentInput 필드 |
|---|---|---|---|
| e07/e08 트리거 알림·칩 | (서버 발신 — 입력 아님) | `trigger_event(type: weather/delay/hours/traffic, target_slot_id, value, status)` | `trigger{type, target_slot_id, value, detected_at}` |
| e10 재계획 사유 | 사유 라디오 | `replan_session(reason: weather/closed/delay/canceled/fatigue/none)` | `reason` |
| e11 방식 3분기 | AI 맡기기 / 같이 / 직접 | `replan_session(mode: ai/manual)` | `replan_mode` (`manual`이면 에이전트 미호출) |
| e20/e21 수동 위치 | 검색·핀 드래그 (권한 거부 폴백) | `execution_state` | `current_location{lat, lng, source: gps/manual}` |
| (실행 상태) | 위치/시간 Tick | `execution_state(current_slot_id, mode)` | `execution{current_slot_id, now, rest_mode}` |

### 2.2 PlanBAgent I/O

```python
@dataclass
class PlanBAgentInput:
    trip_id: str
    replan_session_id: str
    trigger: TriggerEvent | None          # 자동 트리거 유래 (수동 요청이면 None)
    reason: str                           # weather|closed|delay|canceled|fatigue|none
    replan_mode: str                      # ai | co_pick  (manual은 에이전트 미경유)
    current_location: GeoPoint
    execution: ExecutionContext           # current_slot_id, now, rest_mode
    scope_hint: str | None                # remaining_today | single_slot | ...
    request_meta: RequestMeta             # deadline: Plan-B 10초

@dataclass
class PlanBAgentOutput:
    alternatives: list[Alternative]       # 2~3개, HC1~HC4 통과분만 생존
    empty_reason: str | None              # 대안 0개 사유 (e16 문구 근거)
    rest_mode_suggestion: RestSuggestion | None   # 폴백 계단: 휴식 모드
    before_after: DeltaSummary            # 전/후 비교 (e18)
    is_fallback: bool
    freshness: FreshnessMeta              # 날씨·교통 데이터 수집 시각 포함

@dataclass
class Alternative:
    label: str                            # "A" | "B" | "C"
    slots: list[VisitSlotDisplay]         # 솔버 검증값만 (INV-2), distance_range만 (INV-3)
    delta: DeltaSummary                   # 추가/제거/이동 슬롯, 거리 변화
    rationale: str                        # 선택 이유 (closed-set 근거)
```

### 2.3 출력 대응표

| PlanBAgentOutput | 백엔드 저장 | REST | 화면 (Output) |
|---|---|---|---|
| `alternatives[]` | `alternative(source='ai', items jsonb, deltas jsonb)` | `GET /replan-sessions/{id}` | e13(완전AI 타임라인) / e14(같이 — A/B 라디오) |
| `before_after` | `alternative.deltas` | 동일 | e18 변경 전/후 비교 + 요약 배지 |
| `empty_reason` | `replan_session.status` | 동일 | e16 "대안을 찾지 못했어요" |
| `rest_mode_suggestion` | — | `POST /trips/{id}/rest` | e17 휴식 모드 |
| 사용자 확정 | `replan_session.status: proposed→committed`, `change_log_entry(source_type='planB')` | `POST /replan-sessions/{id}/commit` / `/undo` | e19 반영 완료·되돌리기 |

> 와이어프레임은 대안 A/B 2개(e14) — 계약은 2~3개(`alternatives`)로 상한을 두되, UI는 있는 만큼만 렌더한다.

---

## 3. 회고 플로우 (f밴드 ↔ ReflectAgent)

### 3.1 I/O

```python
@dataclass
class ReflectAgentInput:
    trip_id: str
    day_date: str | None                  # None = 전체 요약 (여행 종료 트리거)
    visit_records: list[VisitRecord]      # slot_id, poi_snapshot_id, status, arrived_at/departed_at
    gps_stats: GpsStats | None            # distance_m, steps (L3 옵트인 시에만)
    photo_count: int
    plan_snapshot_ref: str | None         # 계획 대비 실제 비교용 (f02)
    style_analysis_requested: bool        # 누적 10곳 게이팅 충족 시에만 True

@dataclass
class ReflectAgentOutput:
    content: str | None                   # LLM 회고 서술 (실패 시 None)
    stats: ReflectionStats                # 방문 N곳, 이동 N km, 사진 N장 — 항상 존재
    fallback_card: bool                   # content 없음 → 통계 카드만 (INV-4)
    style_analysis: StyleAnalysis | None  # 7축 비율 (요청+게이팅 시)
    insufficiency: str | None             # empty|gps_denied — f03 상태 분기 근거
```

### 3.2 대응표

| 방향 | 화면 | DB | 계약 필드 |
|---|---|---|---|
| 입력 | (자동 트리거: 일자 경계·여행 종료) | `visit_record`, `gps_track(distance_m, steps)`, `plan_snapshot` | `visit_records`, `gps_stats`, `plan_snapshot_ref` |
| 출력 | f03 오늘의 회고 (default) | `reflection(day_date, content, stats jsonb)` → `GET·PATCH /reflections/{tripId}/{day}` | `content` + `stats` |
| 출력 | f03 error/empty/insufficient | — | `fallback_card`, `insufficiency` (3단 폴백 문구 분기) |
| 출력 | f04 여행 요약 | `trip_summary(stats jsonb)` → `GET /trips/{id}/summary` | `day_date=None` 실행 결과 |
| 출력 | f05 스타일 분석 | `style_analysis(data jsonb, sample_trip_count)` → `GET /users/{id}/style-analysis` | `style_analysis` (누적 10곳 게이팅) |

> f03의 수동 편집(PATCH)은 AI 미경유 — 백엔드 직접 처리. 재생성 시 덮어쓰기 확인은 ReflectAgent 판단 항목 유지.

---

## 4. 편집 플로우 (d24 등 ↔ EditAgent)

드래그·버튼 편집(구조화 입력)은 백엔드가 직접 처리하고 `solver.validate`만 경유한다(Fast Path 또는 M8 직접). **EditAgent는 자연어 편집 요청에만 관여한다.**

```python
@dataclass
class EditAgentInput:
    itinerary_id: str
    utterance: str                        # "저녁 맛집 하나 넣어줘"
    current_slots: list[VisitSlot]        # 내부 표현 (internal_duration_min 포함 가능 — 표시 금지)
    locked_slot_ids: list[str]
    context: EditContext                  # 선택 중인 day, 직전 대화 참조

@dataclass
class EditAgentOutput:
    edit_command: EditCommand             # add|remove|move|replace + 대상 poi_id/slot_id
    resolved_entities: list[EntityMatch]  # PlaceScout 해소 결과 + 신뢰도
    validation: ValidationResult          # HC 위반 목록 (violations[{type, slot_index, detail}])
    apply_mode: str                       # auto | confirm | preview_only
    preview: list[VisitSlotDisplay] | None
    clarification_needed: str | None      # 엔티티 애매 → 사용자 확인 질문
```

| 출력 | 백엔드/REST | 화면 |
|---|---|---|
| `apply_mode=auto` 적용 | `PATCH /itineraries/{id}/slots/{slotId}` + `change_log_entry(source_type='assistant')` | d24 저장 결과 |
| `preview` | `POST /itineraries/{id}/rebase` 계열 (before/after 델타) | d28 정리 전/후 비교 |
| `validation` 위반 | — | d08 충돌 안내 패턴 재사용 |

---

## 5. 정보 계층 에이전트 I/O (신설 — agent-hierarchy-design.md)

모든 정보 에이전트 응답은 `FreshnessMeta`를 필수 포함한다 (H-5 규칙).

```python
@dataclass
class FreshnessMeta:
    source: str            # KMA | KAKAO_MOBILITY | NAVER | M7_CACHE | PGVECTOR ...
    fetched_at: str        # 원천 수집 시각 (UTC)
    cache_hit: bool
    ttl_sec: int
    stale: bool            # TTL 초과분을 폴백으로 반환했는가
```

### PlaceScoutAgent

```python
class PlaceScoutRequest:
    anchor: GeoPoint; radius_km: float; dates: list[str]
    budget_level: str | None; categories: list[str] | None
    exclude_poi_ids: list[str]            # 방문했거나 거절된 곳
    indoor_only: bool = False             # Plan-B 우천 시
    purpose: str                          # schedule_pool | planb_alternatives | entity_resolve | single_lookup

class PlaceScoutResponse:
    pois: list[ScoredPoiCandidate]        # closed-set — 전원 M7 등록 완료 (INV-1)
    sufficiency: str                      # OK | LOW | NO_CANDIDATES
    web_sourced_count: int                # 수집 게이트 통과 신규 등록 수
    freshness: FreshnessMeta
```

### WeatherAgent — 일 단위

```python
class WeatherRequest:
    region: GeoPoint | str                # 좌표 또는 행정구역 코드
    dates: list[str]                      # 일 단위 조회
    force_refresh: bool = False           # 트리거 검증 시에만 True

class DailyWeather:
    date: str
    precipitation_prob: int               # 강수확률 %
    precipitation_type: str               # none|rain|snow|shower
    temp_min: float; temp_max: float
    advisory: str | None                  # 특보 (호우·태풍 등)
    trigger: WeatherTrigger | None        # 강수 80%↑ 등 판정 결과
    freshness: FreshnessMeta              # 예보 발표 시각 = 최신성 기준점
```

### TransitAgent

```python
class TransitRequest:
    origin: GeoPoint; destination: GeoPoint
    mode: str                             # walk | public | car
    purpose: str                          # info_display | delay_check | matrix

class TransitInfo:
    distance_m: int
    distance_range: str                   # 표시용 "약 1.2km" — duration 필드 없음 (INV-3)
    internal_minutes: int | None          # 트리거 판정 내부용 — Display 타입 제외
    confidence: str                       # HIGH(카카오) | MID(네이버) | LOW(직선×1.3)
    delay_trigger: DelayTrigger | None    # 예정 대비 30분+ 판정
    freshness: FreshnessMeta
```

### PersonaAgent

```python
class PersonaRequest:
    account_id: str
    purpose: str                          # scoring_context | alternative_sourcing | style_input
    situation_query: str | None           # 상황 → 벡터 질의 (Plan-B)

class PersonaContext:
    saved_places: list[str]               # saved_place.poi_id (대안 1순위)
    preference_vector_hits: list[VectorHit]  # pgvector 유사도 결과
    rejection_patterns: list[str]         # 거절 이력 유형
    profile: PreferenceProfile            # preference_set 7축
    cold_start: bool
    freshness: FreshnessMeta
```

### EventAgent (P2 — 인터페이스만 선정의)

```python
class EventRequest:
    region: str; date_range: tuple[str, str]

class EventInfo:
    events: list[EventPoi]                # M7 등록 게이트 통과분만 (INV-1)
    freshness: FreshnessMeta
```

---

## 6. 공통 규약

| # | 규약 | 근거 |
|---|---|---|
| IO-1 | 모든 AgentInput에 `request_meta{request_id, requested_at, deadline_ms}` — 지연 예산(day1 5s/전체 20s/Plan-B 10s/도우미 첫응답 3s) 전파 | D38, nfr §1.1 |
| IO-2 | 모든 AgentOutput에 `is_fallback` + (해당 시) `solve_mode` — 침묵 실패 금지 | INV-4 |
| IO-3 | 사용자 표시 슬롯은 `VisitSlotDisplay`만 — `internal_*` 필드 정적 배제 | INV-3, U5-P4 |
| IO-4 | 시각·순서 필드(`start_at/end_at`)는 `solver.solve/validate` 통과값만 담는다 | INV-2 |
| IO-5 | POI 참조는 `poi_id`(M7 정본) — 확정 시 백엔드가 `poi_snapshot_id`로 동결. AI 서비스는 스냅샷을 만들지 않는다 | 백엔드 4계층 모델 |
| IO-6 | 정보 에이전트 응답은 `FreshnessMeta` 필수 | 최신성 지표 (H-5) |
| IO-7 | 실패 상태값(`NO_CANDIDATES`/`WEATHER_UNKNOWN`/`COLD_START`)은 예외가 아니라 정상 응답 | 폴백 계단 |

---

## 7. 미확정·후속 항목

| 항목 | 상태 | 후속 |
|---|---|---|
| Kotlin↔Python 프로토콜 (REST vs gRPC) | **확정 — REST/JSON over HTTP** (PR #76 결정4, 2026-08-04. AI-D01 종결. gRPC는 보류) | 단일 `openapi.yaml`을 정본으로 양쪽 코드젠 (경로는 0.1) |
| AI 도우미·Plan-B 경계 경로 리소스명 | 협의 중 (명명 규칙 `/ai/v1/...`만 확정) | 확정 시 0.1 표 갱신 |
| SolveMode 4↔3 매핑 · `explanations` 키 의미 · `candidates_summary` 대응 · `FreshnessMeta` 집계형 · `Violation` 스키마 | 협의 중 (TRIP-282) | 백엔드 회신 후 본 계약 갱신 |
| `dataQuality` 등급 수 (AI 3등급 MINIMAL/PARTIAL/FULL ↔ 백엔드 2등급) | AI가 **MINIMAL 추가 요청**, 백엔드 회신 대기 | 회신 후 리버스 read 응답 스키마 확정 |
| day1 조기노출 방식 | 협의 중 (백엔드 "1차 스코프 제외" 제안에 AI 역제안 게시, 회신 대기) | 확정 시 `day1_ready_at` 시맨틱 확정 |
| AI 도우미 채팅 화면 | 와이어프레임에 부재 (M16, 타 팀 담당) | 자연어 입력의 진입점은 당분간 구조화 UI + EditAgent 자연어 편집. → `intent-matching-design.md`는 M16 합류 시 그대로 적용 |
| 와이어프레임 시간 표기 vs INV-3 | 상충 플래그 | 프론트 조율 필요. AI 계약은 시간 미제공 유지 |
| trigger_event 발행 주체 | 백엔드(M9) vs AI 정보 에이전트 | Weather/TransitAgent는 "판정"까지, 이벤트 발행·푸시는 백엔드 소유로 제안 (아웃박스 경유) |
