# AI↔백엔드 경계 — 확정 계약

> **상태**: 확정 · 구현 완료 (2026-08-11)
> **범위**: `ScheduleAgent` 포워드 경계(HTTP 시맨틱) · `/internal` POI 리버스 경계 · 자정 넘김 슬롯 포맷
> **정본 참조**: `ai-backend-경계-계약-초안.md`(합의안, PR #76) · TRIP-228(DTO 동결) · PR #104 협의 스레드
>
> 이 문서는 **협의 요청이 아니라 결과**다. 세 항목 모두 양팀 합의 후 구현·머지됐다.
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
| **시한** | `request_meta.deadline_ms` 는 **AI 내부 계산 예산**. 백엔드 소켓 read 상한 = `max_deadline_ms + 마진`(네트워크 홉이 예산에 안 잡혀서). generate 20s · validate 3s · repair 5s |
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

### M5. `/internal/pois` 서비스 간 인증 — **2라운드**

1라운드는 양쪽 시드가 정렬돼 있어 AI 가 백엔드 리버스 read 를 호출할 필요가 없다. 2라운드(실 POI 데이터)에는 사용자 JWT 가 아닌 서비스 토큰이 필요하다. 방식(고정 토큰 env 공유 / 내부망 무인증 등)은 2라운드 착수 전에 정한다.

---

## 1라운드 통합테스트 — 범위 밖으로 명시한 것

- **repair**: 백엔드에 호출자가 아직 없다 → AI 에 직접 curl 로만 검증
- **proposeSlotCandidates**: AI 쪽 경로가 없다. http 모드에서 백엔드는 `SLOT_CANDIDATES_NOT_WIRED` 로 실패하며, 이를 **503**(`UpstreamUnavailable`, `fallbackApplied=false`)으로 표면화한다 — 500 이 아니다. 후보는 지어낼 수 없고(INV-1) 빈 목록은 "주변에 없음"과 구분되지 않아 폴백하지 않는다
- **anchors 없는 여행**(숙소 미등록): AI 가 422 → 1라운드는 숙소 등록을 전제로 진행. 처리 방식은 별도 협의
