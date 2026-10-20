# AI↔백엔드 경계 — 확정 계약

> **상태**: 확정 · 구현 완료 (2026-08-11)
> **범위**: `ScheduleAgent` 포워드 경계(HTTP 시맨틱) · `/internal` POI 리버스 경계 · 자정 넘김 슬롯 포맷 · 기회 카드 경계(④, situation-awareness)
> **정본 참조**: `ai-backend-경계-계약-초안.md`(합의안, PR #76) · TRIP-228(DTO 동결) · PR #104 협의 스레드
>
> 이 문서는 **협의 요청이 아니라 결과**다. ①~③은 양팀 합의 후 구현·머지됐고, ④는 situation-awareness 정본(승인)이 정한 계약이다.
> 아직 열려 있는 것은 맨 아래 "미결 항목"에만 있다 — 그 위는 전부 확정이다.

---

## ① 포워드 경계 — ScheduleAgent HTTP 시맨틱 (TRIP-229) — **확정·구현됨**

| 항목 | 확정 내용 |
|---|---|
| **경로** | `POST /ai/v1/itinerary/generate` · `/validate` · `/repair` |
| **와이어** | snake_case. `ScheduleAgentInput/Output` 필드 동결(TRIP-228) |
| **에러 vs 폴백 이원화** | **AI 가 200 을 주면 폴백하지 않는다.** `is_fallback=true` 여도 그것은 *AI 가 이미 폴백을 마친 결과물*이므로 그대로 쓴다. 백엔드 `MinimalItineraryFallback` 은 **유효한 200 을 받지 못한 경우만**(연결 실패·5xx·역직렬화 실패) 발동한다 |
| **에러 바디** | `{ error_code, message, retryable }`. 파싱 실패해도 상태코드로 판정한다(바디 상한 8KB) |
| **재시도** | **하지 않는다.** 실패 즉시 결정론 폴백(INV-4). `retryable` 은 진단용 정보로만 남긴다 |
| **시한** | `request_meta.deadline_ms` 는 **AI 내부 계산 예산**이자 **목표치(SLO)** — 하드 제약이 아니다(아래 "시한 재정의" 절). **2026-08-21 현재 값을 싣지 않는다**(TRIP-474 — 미지정=무제한). SLO: generate 20s · validate 3s · repair 5s |
| **위반 하위 코드** | `violations[].reason_code`(선택, 2026-10-19 상황 감지 H1) — HC1 의 `CLOSED_DAY`·`OUT_OF_HOURS`·`HOLIDAY`. 없으면 null 이고 장소 감지는 `HOURS_MISMATCH` 로 읽는다(BR-SA-17). `HOLIDAY` 는 AI `HOLIDAY_CLOSURE_MODE=on` 일 때만 나온다. 백엔드는 repair 요청에 받은 그대로 되돌려 보낸다 |
| **day1 조기 노출** | 단일 호출 유지. 백엔드가 **2단계로 나눠 호출**한다(1차 day1 5s → 2차 나머지 20s). `excluded_poi_ids` 로 중복을 막는다(TRIP-293) |

**구현**: `HttpScheduleAgentAdapter` · `ScheduleAgentConfiguration`(전용 RestClient·타임아웃) · `GenerateItineraryService`(2단계) · `SecondPhaseGenerator`.

**모드 전환**: `trippilot.ai.schedule.mode=fake|http`(기본 `fake`). compose 는 `AI_SCHEDULE_MODE` 로 넘긴다.
기동 로그에 활성 경계가 찍힌다 — `일정 생성 경계 = 실 AI(http) · baseUrl=… · 구현=HttpScheduleAgentAdapter`.
**값이 아는 값(fake|http)이 아니면 조용히 fake 로 남고**, 그 경우 경고를 남긴다.

---

## ② 리버스 경계 — `/internal` POI read (TRIP-265) — **확정·구현됨**

| 항목 | 확정 내용 |
|---|---|
| **경로** | `GET /internal/pois?centerLat&centerLng&radiusKm` · `POST /internal/pois/batch-get` |
| **배치 필드** | `{ poi_ids: [] }` (snake 일관) |
| **응답** | snake_case · **ACTIVE 만**(INV-1) · 소요시간 없음(INV-3) |
| **dataQuality** | **FULL/PARTIAL 2등급 유지.** AI 3등급(MINIMAL 포함) 도입은 **U6 으로 이연** — 영업시간이 자유형 문자열이라 등급을 올려도 검증에 쓸 데이터가 없고, 수집 POI 전량이 MINIMAL 로 떨어지면 후보풀이 전멸한다. AI 쪽 `_ALLOWED_QUALITY` 는 그대로 둔다 |
| **완화책** | AI 후보 정렬 최상위 키에 "영업시간 보유 여부"를 넣는다(AI PR #132). **필터가 아니라 순위 조정**이라 희소 지역에서 POI 가 사라지지 않는다. 위험이 **줄 뿐 없어지지 않는다는 것**을 양팀이 인지한 채 U6 까지 간다 |
| **auth** | 현재 일반 JWT. **서비스 간 인증은 2라운드 안건**(아래 미결) |
| **이연** | `open-window` · `closedCheck` 는 structured 영업시간 스키마와 같은 묶음으로 U6 |

---

## ③ 자정 넘김 슬롯 (TRIP-279) — **확정·구현됨**

- **와이어**: `start_at`/`end_at`(LocalTime) + `ends_next_day`. AI 가 `ends_next_day = end.date > start.date` 로 결정론 사영한다.
- **저장**: **A안(플래그 관통)** 채택. `visit_slot.ends_next_day` 컬럼 + `CHECK` 완화(V2.8), 도메인·응답까지 3곳 관통.

---

## ④ 기회 카드 경계 — `POST /ai/v1/planb/opportunities` (situation-awareness BR-SA-22 · DEC-SA-6) — **확정·구현됨**

정본은 `aidlc/aidlc-docs/construction/situation-awareness/`(BR-SA-22 · RES-SA-09 · PERF-SA-08 · DEC-SA-8)이고, 아래는 백엔드 쪽 구현 결정이다.

| 항목 | 확정 내용 |
|---|---|
| **경로** | `POST /ai/v1/planb/opportunities`(LLM 0회). 백엔드 호출자는 `planb-detection` 의 `HttpOpportunityAdapter`(`OPPORTUNITY_PATHS`) — `HttpScheduleAgentAdapter.CALLED_PATHS` 가 아니다. 앱 표면은 `GET /api/v1/trips/{tripId}/opportunities?date=` |
| **와이어** | snake_case. 요청 `date` · `slots[1..30]{slot_key, poi_id, coord{lat, lng}}` · `planned_poi_ids[≤300]` · `request_meta`, 응답 `opportunities[≤3]{key, kind, event_name?, start?, end?, poi_id, poi_name, near_slot_key, distance_label}` · `notes[]`. 시각 필드 없음(INV-2), 거리는 문자열만(INV-3). `OpportunityBoundaryOpenApiTest` 가 `ai/docs/openapi.json` 과 요청·응답 키 정확 일치·값 모양·`kind` enum·상한을 본다 |
| **재료는 백엔드가 채운다** | 앱은 날짜만 보낸다. 슬롯 = 그 날 끝나지 않은(감시 스윕과 같은 정의) 좌표 있는 칸을 방문 순서대로 ≤ 8 — 상대가 슬롯마다 반경 조회를 하며 8회에서 끊는다. 계획 POI = 일정 전체 장소(끝난 칸 포함, 그 날에 가까운 날부터 ≤ 300) |
| **부르지 않는 경우** | 모드 off · 여행 전(D-1 포함) · 날짜가 [오늘, 종료] 밖 · 남은 슬롯 없음(빈 재료로 묻지 않는다 — 계약 `minItems: 1`). 전부 200 빈 목록이고 404 는 소유 아님뿐이다 |
| **에러 vs 폴백** | 상대의 재료 실패는 200 + `notes`(행사 실패면 요즘 인기만, 장소 조회 실패면 빈 목록) — 백엔드는 notes 를 INFO 로 남긴다. HTTP 오류·시간 초과·읽지 못하는 본문·모르는 `kind`·UUID 아닌 `poi_id` 는 어댑터가 예외로 올리고 서비스가 **빈 목록 + WARN** 으로 접는다(RES-SA-09). 재시도는 없다 |
| **2차 게이트** | 상대 판정이 1차다. 백엔드는 ≤ 3 · key·장소 유일 · `near_slot_key` ∈ 보낸 슬롯 · 장소 ∉ 일정 · 행사 카드의 이름과 그 날을 덮는 기간을 다시 보고, 어긋나면 **답 전체를** 버린다(일부만 그리면 순위·날짜당 1장이 상대 판정과 달라진다). 표시 게이트(이름 길이·연락처 꼴)는 상대 한 곳에 둔다 |
| **시한** | `request_meta.deadline_ms` = 3s(상대는 그 70% 안에서 장소 조회를 끊고 부분 결과 + note). 읽기 상한 9s = 시한 + 상대 백스톱 5s + 1s(리마인드 14s·회고 21s 와 같은 꼴 — 백스톱과 같으면 상대의 504 보다 우리 소켓이 먼저 끊긴다), 시한 + 백스톱보다 작으면 기동 실패 · 연결 1s |
| **격리** | 동시 호출 상한(격벽)·실패 뒤 쉬는 시간은 두지 않는다 — 허브 요청 스레드에서 동기로 부르고, 묶는 것은 연결 1s + 읽기 9s 상한뿐이다. 정본 RESILIENCY-10 이 격벽을 선계산 실행기(PERF-SA-06)·스케줄러 풀(PERF-SA-05)에 두고 기회 조회는 시한(PERF-SA-08)·강등(RES-SA-09·12)으로 묶었다. 같은 요청 경로의 다른 AI 호출(편집 검증 읽기 상한 62s 등)도 격벽 없이 더 오래 쥐고, 이 경로는 트랜잭션 밖이라 DB 연결을 쥐지 않는다(OSIV off). **다시 볼 조건**: 앱 기회 카드(FE-C) 출시 뒤 `기회 조회 실패` WARN 이 시간 초과로 반복될 때(AI CPU 기아 #1358 계열) — 그때 동시 상한이나 쉬는 시간을 더한다 |
| **인증·모드** | `X-Service-Token`(`SERVICE_AUTH_TOKEN`, 다른 경계와 같은 시크릿). `trippilot.ai.opportunity.mode` = `off`(기본) · `http`, env `AI_OPPORTUNITY_MODE` — 배포는 차트 고정 env `http`(시크릿 아님). 모르는 값은 기동 실패 |

---

## 미결 항목

여기 있는 것만 아직 안 정해졌다. 나머지는 위에서 확정이다.

### M1. ANYTIME must_visit 물질화 — **확정·구현됨**

- **확정**: AI 는 **날짜·시각이 확정된 고정 블록만 받는다.** ANYTIME 의 일자·시각 물질화는 **백엔드 소유**다.
- **구현**(`MustVisitMaterializer`): 조립 단계에서 ANYTIME 에 날짜·시각을 부여한다.
  - **일자에 고르게 편다** — 솔버가 날짜를 다시 고르지 못하므로(고정 블록을 `window.start.date() == day` 로 필터링),
    하루에 몰리면 일과 창(HC4)을 넘겨 체인 전 단계가 무효가 되고 생성 자체가 실패한다.
  - 가장 한산한 날(점유 블록이 적은 날) → 그 날의 가장 이른 빈 구간. 같으면 이른 날짜·이른 시각(결정론).
  - 사용자가 고정한 블록은 **건드리지 않는다**. 겹치지 않게 뒤로 민다.
  - 넣을 자리가 없으면 **보내지 않고 M2 채널로 보고한다**(`NO_FEASIBLE_SLOT`) — AI 가 거부할 모양을 보내
    요청 전체를 죽이느니, 못 넣었다는 사실을 사용자에게 알리는 편이 낫다.
- ⚠ **배분 정책은 1라운드 관측 이전에 정한 것이다.** 관측 뒤 바뀔 수 있으며, 바뀌는 지점은
  `pickDay`·`pickStart` 두 함수로 좁혀 두었다.
- 골든 픽스처(`schedule-agent-request.json`)의 `date: null` 박제도 함께 고쳤다 — 이제 물질화된 모양이 정본이다.
- **[2026-10-05 개정 · TRIP-1249] 시각은 더 이상 백엔드가 정하지 않는다.** AI 가 `fixed_blocks[].start = null` 을
  "그 날 반드시 가되 시각은 조립이 고른다"(식당은 식사 시간대)로 받는다. 09:00 부터 이른 빈 구간에 못 박던 종전
  방식은 그 시각에 닫힌 식당 하나를 조립이 영업시간 위반(409)으로 거부해 **그 날이 통째로 최소 폴백**이 되는
  원인이었다(로컬 재현). 물질화는 **날짜 배분**(한산한 날 · 그 날 체류 합 ≤ 일과 창)만 남고 `pickStart` 는 지웠다 —
  위 "가장 이른 빈 구간"·"겹치지 않게 뒤로 민다" 서술은 이 날짜로 폐기. 골든 픽스처의 물질화 블록도 `start: null` 이다.
  `MinimalItineraryFallback` 도 날짜만 있는 블록을 **그 날**에 놓는다(종전엔 어느 목록에도 안 들어 조용히 버려졌다) —
  그 날 창에 안 들어가면 뒷날로, 뒷날도 없으면(하루 여행의 저녁 고정 뒤 ANYTIME) `unplaced_must_visits`(M2)로 **보고**한다.
  하루 여행의 마무리(2차 없음)도 1차 보고를 빈 목록으로 덮지 않는다(종전 버그 — 조립 단계 `NO_FEASIBLE_SLOT` 이 COMPLETE 에서 사라졌다).
  폴백의 "변경 불가" 판정은 `start != null` 하나다 — 물질화 집합(`materializedPoiIds`)은 시각이 있는 블록이 전부 사용자 고정이 된 뒤 죽은 코드라 지웠다.
  **배포 순서: AI 먼저** — `start` 를 필수로 아는 구형 AI 는 null 을 422 로 거부해 그 호출이 최소 폴백이 된다.

### M2. 미배치 must_visit 회신 필드 — **백엔드 제안, AI 확인 대기**

기간 밖 must_visit 을 "조용히 삭제하지 말고 AI 가 실현 불가로 보고하게" 한다는 TRIP-267/PR #127 의 의도는 **달성되지 않았다.** 백엔드가 싣기만 하고 **회신 필드를 만들지 않았고**, AI 는 `problem.days` 에 없는 날짜의 고정 블록을 위반으로 세지 않고 스킵한다. 침묵 드롭 위치가 백엔드에서 AI 로 옮겨갔을 뿐이다.

제안(백엔드 → AI 확인 요청):

```jsonc
// ScheduleAgentOutput 에 추가
"unplaced_must_visits": [
  { "poi_id": "uuid", "reason_code": "OUT_OF_RANGE" }
]
```

- 빈 배열이 기본(= 전부 배치됨). **필드 부재도 빈 배열로 읽는다** — 배포 순서가 어긋나도 안 깨지게.
- `reason_code` 는 **닫힌 집합**: `OUT_OF_RANGE` | `NO_FEASIBLE_SLOT` | `WINDOW_CONFLICT`. 자유형 문자열이면 백엔드가 분기할 수 없고 화면 문구도 정할 수 없다.
- 사용자 문구는 백엔드가 만든다. AI 는 코드만 준다.

### M3. repair 응답 `explanations` 규약 — **확인 대기**

현재 AI 는 빈 dict 를 준다. 백엔드는 슬롯별 배치 근거를 `placement_reason` 으로 보관하므로, **빈 dict 를 "설명 없음"이 아니라 "변경 없음"으로 읽어 기존 값을 보존**하려 한다. AI 의도와 같은지 확인 필요. (다르면 "지우라"는 신호를 구분할 방법이 필요하다.)

### M4. validate/repair 컨텍스트 필드 — **2라운드 안건**

validate/repair 와이어에 **원 이동수단·day window 가 없어** AI 가 기본값(PUBLIC · 당일 00:00~23:59)으로 판정한다. 결과적으로 **CAR 일정 재검증 시 HC2 오탐**, **자정 슬롯 HC4 보수적 판정**이 난다. 해소하려면 요청에 컨텍스트 필드를 추가해야 하고 이는 양쪽 스키마 변경이라 2라운드 안건이다. 그때까지 1라운드에서 이 두 종류의 위반은 **버그가 아니라 이 한계로 먼저 의심**한다.

> **[개정 · 2026-10-05] repair 는 컨텍스트를 받는다(additive, 선택).** `RepairItineraryRequest` 에 generate 와 같은 스키마의 `anchors`(DayAnchorSchema[])·`time_windows`(TimeWindowSchema[])·`transport_modes`(취향 어휘 목록, 첫 인식 토큰 — 번역표 `_TRANSPORT_TOKENS`)가 붙었다. 수단은 수리의 시각 계산(HC2)과 거리 표기 모두에 쓰인다 — **repair 의 CAR HC2 오탐은 해소**. 앵커가 있는 날은 첫 구간 거리를 앵커→첫 장소로 채우고, 그 날 창도 있으면 첫 비고정 슬롯 시작을 `창 시작 + 앵커 이동` 이상으로 민다(generate 와 같은 규칙, 앞으로만). 창은 **출발 시각으로만** 쓰이고 HC4 판정 창은 종전(당일 00:00~23:59)이다. 백엔드는 편집 교체 수리에서 **첫 장소가 바뀐 날만** 앵커(generate 와 같은 출처 `RegionAnchors.dayAnchors`)와 기본 창(09:00~21:00)을 싣고, 수단은 계정 취향 그대로다. 셋 다 비면 종전 동작. **validate 는 그대로**(HC2 는 앵커→첫 슬롯 구간을 보지 않는다 — 필요 없음), validate 의 CAR HC2 오탐·자정 HC4 는 여전히 이 절의 한계다.

### M5. `/internal/pois` 서비스 간 인증 — **2라운드**

1라운드는 양쪽 시드가 정렬돼 있어 AI 가 백엔드 리버스 read 를 호출할 필요가 없다. 2라운드(실 POI 데이터)에는 사용자 JWT 가 아닌 서비스 토큰이 필요하다. 방식(고정 토큰 env 공유 / 내부망 무인증 등)은 2라운드 착수 전에 정한다.

---

## 1라운드 통합테스트 — 범위 밖으로 명시한 것

- **repair**: 백엔드에 호출자가 아직 없다 → AI 에 직접 curl 로만 검증
- **proposeSlotCandidates**: AI 쪽 경로가 없다. http 모드에서 백엔드는 `SLOT_CANDIDATES_NOT_WIRED` 로 실패하며, 이를 **503**(`UpstreamUnavailable`, `fallbackApplied=false`)으로 표면화한다 — 500 이 아니다. 후보는 지어낼 수 없고(INV-1) 빈 목록은 "주변에 없음"과 구분되지 않아 폴백하지 않는다
- **anchors 없는 여행**(숙소 미등록): AI 가 422 → 1라운드는 숙소 등록을 전제로 진행. 처리 방식은 별도 협의

## 시한 재정의 — `deadline_ms` 는 SLO 다 (2026-08-19) — **수용·구현됨**

> 출처: AI 트랙 제안(PR #104 코멘트, 2026-08-15) — 실측 TRIP-373. 백엔드 수용.

**무엇이 바뀌었나**: `deadline_ms` 는 **목표치(SLO)이자 권고값**이다. 초과는 **실패가 아니라 관측 대상**이다.

| 항목 | 재정의 후 |
|---|---|
| 의미 | AI 는 `deadline_ms` 를 권고값으로 읽고 최선을 다한다. **초과해도 5xx 가 아닌 완결 응답**을 준다(기존 "타임아웃 5xx 금지"와 같은 결) |
| SLO | day1 5s · 전체 20s · validate 3s · repair 5s — **문서·대시보드의 지향점으로 유지**(폐기 아님) |
| 백엔드 처리 | 초과 응답도 그대로 쓴다. 폴백은 여전히 "유효한 200 을 받지 못한 경우"만(에러 vs 폴백 이원화 불변) |
| 우리가 기다리는 시간 | 소켓 read 상한 = **대기 상한**(`waitCeilingMs`) + `read-timeout-margin-ms`(기본 2s). 시한을 걸면 `deadline.total-ms`, 안 걸면 610s 다. **파생**이라 한쪽만 올려 소켓이 먼저 끊는 절반 설정이 생기지 않는다. 편집(validate·repair)은 **별도 상한 60s** — 생성만큼 기다리면 편집이 막힌다(TRIP-474) |

**왜**: 실측(TRIP-373, GPT-5.6 13회)에서 취향 점수가 후보 **건당 ~0.3초 선형**이라 실전 풀 193건이 44~78초다.
하드 20s 안에서는 규칙 폴백이 대부분을 처리해 **실 LLM 경로의 품질을 검증할 방법이 없다** — 개발 단계에서는
기능을 켜고 시간을 재면서 줄이는 순서가 맞다.

**설정**(운영 기본값 = SLO, 개발에서만 상향):

| 키 | 기본값 | env(compose) |
|---|---|---|
| `trippilot.ai.schedule.deadline.day1-ms` | 5000 | `AI_SCHEDULE_DAY1_DEADLINE_MS` |
| `trippilot.ai.schedule.deadline.total-ms` | 20000 | `AI_SCHEDULE_TOTAL_DEADLINE_MS` |
| `trippilot.ai.schedule.read-timeout-margin-ms` | 2000 | (미노출 — 파생값 마진) |

- validate 3s · repair 5s 는 **어댑터 상수 그대로**다. 사용자가 화면에서 기다리는 동작이고, 실측 병목은 생성(취향 점수)이라 상향 대상이 아니다.
- 기동 로그에 값이 찍힌다 — `일정 생성 시한(권고·SLO) = day1 …ms · 전체 …ms`. SLO 초과 설정이면 **경고**를 남긴다(과도기 값이 운영에 그대로 나가는 것을 막는다).
- 상향 시 주의: `StalePartialSweeper` 는 5분 넘게 멈춘 PARTIAL 을 FAILED 로 내린다. 2차가 5분을 넘기면 진행 중인 생성이 잘린다 — 90s 대에서는 여유가 있다.

**엄격화(하드 제약 복귀) 조건**: AI 쪽 지연 최적화(프롬프트 경량화·병렬 청킹·비동기 점수·모델 교체)로
실측이 SLO 에 수렴하면 다시 조인다. 판단 근거는 AI 트랙의 아침 리허설 지연 추이.

---

### 그 뒤 — 시한 자체를 껐다 (2026-08-21, TRIP-474)

SLO 재정의만으로는 실 LLM 경로가 여전히 시간에 눌렸다. FE 연동을 위해 **값을 싣지 않기로** 했다
(AI 측 TRIP-473 에서 `deadline_ms` 를 선택 필드로 전환, 미지정=무제한).

| | 값 |
|---|---|
| AI 에 싣는 시한 | 없음(`"deadline_ms": null` 을 명시 전송) |
| 생성 대기 상한 | 612s (AI 백스톱 600s 보다 커야 우리가 먼저 안 끊는다) |
| 편집(validate·repair) 대기 상한 | 62s |
| 멈춘 생성 판정 | `max(5분, 대기 상한 + 60s)` |

**되돌리는 것은 `AI_SCHEDULE_DEADLINE_ENFORCED=true` 한 줄이다**(9월 예정, TRIP-475) — 값은 지우지 않고
껐을 뿐이고, 위 셋은 전부 파생이라 함께 돌아온다. 한쪽만 되돌리면 죽은 세션이 11분씩 사용자를 잡는다.

실측(2026-08-21 실 AI 왕복): validate 20.1s · repair 20.7s — **시한 3s·5s 를 줬는데도** 그렇다.
SLO 가 하드 제약이 아니라는 위 재정의가 실제로 그렇게 관측된다는 뜻이고, 편집 대기 상한을 60s 로 잡은 근거다.

