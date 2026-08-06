# AI↔백엔드 경계 — 잔여 협의 3점 (계약 확정 요청)

> **상태**: 백엔드 제안 · AI팀 결정 대기
> **목적**: 경계 DTO(`ScheduleAgentInput/Output`)는 동결됐다(TRIP-228). 실 통합(TRIP-229) 전에 **HTTP 와이어·값 매핑의 잔여 미확정 3점**을 못박아, 백엔드가 계약-우선(Fake 기반)으로 병렬 착수하고 AI U5가 올라오면 **Fake→실어댑터 교체 + 공동 통합테스트**로 바로 합류하게 한다.
> **정본 참조**: `ai-backend-경계-계약-초안.md`(합의안, PR #76 머지) · TRIP-228(DTO) · TRIP-265/PR #102(리버스 read 포트) · 슬롯포맷 회신(PR #76 코멘트, JunaPark831).

---

## ① 포워드 경계 — ScheduleAgent HTTP 시맨틱 (TRIP-229) — **결정 영향 큼**

**동결됨**: `ScheduleAgentInput/Output` 필드·snake_case(228 계약테스트). `generate/validate/repair` 3메서드.

**미확정 → AI 결정 요청**:

| 항목 | 질문 | 백엔드 제안 |
|---|---|---|
| **경로** | 3메서드의 HTTP 엔드포인트? | `POST /v1/schedule/generate` · `/v1/schedule/validate` · `/v1/schedule/repair` (AI FastAPI 라우트에 맞춰 확정) |
| **에러 vs 폴백 이원화** | AI 열화와 하드 실패를 어떻게 구분해 반환? | **2단**: (a) AI 자체 열화 → `200 OK` + `isFallback=true`·`solveMode=DETERMINISTIC\|MINIMAL`(AI 내부 결정론 폴백). (b) 하드 실패(5xx·타임아웃·역직렬화) → 백엔드 `MinimalItineraryFallback`. **어떤 상황이 (a)/(b)인지 표로 확정** — 안 그러면 이중 폴백 or 실패 누락 |
| **에러 바디** | 5xx 응답 형태(코드·사유)? | `{ error_code, message, retryable }` 최소. `retryable=false`면 백엔드 즉시 폴백 |
| **타임아웃/deadline** | `RequestMeta.deadlineMs`(전체 20s, IO-1)를 누가 강제? deadline 초과 시 AI 반환물? | 백엔드 클라이언트 read-timeout = deadline+여유. AI가 deadlineMs 존중, 초과 시 best-effort + `isFallback=true` |
| **day1 조기노출** | 단일 호출 `day1ReadyAt`만? 스트리밍/별도 엔드포인트? | **1차 스코프 제외**(동기 단일 호출). async 조기반환은 후속 설계 |
| **멱등/재시도** | `requestId`가 멱등키? 재시도 정책? | requestId=멱등키. 재시도는 **네트워크/타임아웃만**, AI가 requestId로 dedupe |

**왜 중요**: 백엔드 `HttpScheduleAgentAdapter`(RestClient)의 URL·에러→예외 매핑·타임아웃·폴백 책임소재가 전부 여기서 결정. 미확정 상태로 짜면 어댑터+INV-4 폴백 로직 재작업.

---

## ② 리버스 경계 — `/internal` POI read 경로·필드·값 (TRIP-265) — **결정 영향 중**

**구현·머지됨**(#102, 백엔드가 BE-5 정의): `GET /internal/pois?centerLat&centerLng&radiusKm` · `POST /internal/pois/batch-get`. 응답 snake_case, ACTIVE만(INV-1), 소요시간 없음(INV-3).

**어긋남/미확정 → 정렬 요청**:

| 항목 | 계약 초안 | 백엔드 구현(#102) | 제안 |
|---|---|---|---|
| **batchGet 경로** | `POST .../pois:batchGet` | `POST .../pois/batch-get` | **`/batch-get`으로 계약 정렬**(Spring/openapi 친화) |
| **배치 필드** | `{ ids[] }` | `{ poi_ids: [] }` | **`poi_ids`로 정렬**(snake 일관) |
| **dataQuality 등급** ⚠️ | FULL/PARTIAL (2) | FULL/PARTIAL (2) 파생 | **AI `poi.py`는 3등급(MINIMAL/PARTIAL/FULL)** — **불일치**. MINIMAL이 후보풀 제외 신호로 필요하면 백엔드도 3등급 파생(좌표만·나머지 전무=MINIMAL) 추가. **AI 결정 요청** |
| **카테고리 코드** | 표 8종 | SIGHT/FOOD/CAFE/NIGHT_VIEW/NATURE/SHOPPING/CULTURE/ACTIVITY | 값 일치 확인 요청(전수 매핑됨) |
| **auth** | — | 일반 JWT(아무 유저, = `/api/v1/places` 동일 노출) | 전용 **서비스-auth**(서비스계정 토큰/망분리) 후속 — 필요 시점 합의 |
| **이연 엔드포인트** | nearby(반경+카테고리) · open-window · closedCheck | radius·batchGet만 | open-window·closedCheck는 **우리 `openingHours`가 자유문자열**이라 structured 스키마 선행 필요 → 후속. AI가 지금 필요하면 스키마 작업 착수 |

**왜 중요**: AI가 이 계약으로 **클라이언트 코드젠**. 경로/필드 mismatch=런타임 404/405/역직렬화 실패. **dataQuality 2↔3**은 AI 후보 필터링 동작에 직접 영향.

---

## ③ 슬롯 시각 포맷 — 자정 넘김 (TRIP-279) — **거의 확정, 확인만**

**회신 옴**(PR #76, JunaPark831): AI 원천=tz-aware datetime, **와이어=(a) `start_at/end_at`(LocalTime) + `ends_next_day`** 유지, AI가 결정론 사영(`ends_next_day = end.date > start.date`).

**남은 것**: 백엔드 **저장 방식**만(AI가 스키마 소유자에 위임).

| 옵션 | 내용 | 비용 |
|---|---|---|
| **A. 플래그 관통(제안)** | visit_slot `ends_next_day` 컬럼 + `CHECK(end≥start)` 완화, 도메인·응답 노출 | 국소적. 와이어 (a) 동결과 정합 |
| B. timestamp 전환 | 시각 `time`→`timestamp`(날짜 포함), 플래그 파생 | 도메인·DTO 타입 전반 변경 |

**백엔드 제안**: **A**. 229와 함께 3곳 관통(현재 `GenerateItineraryService`가 플래그 폐기 · `V2.7 CHECK` · 응답 DTO 부재).

---

## 결정 요청 요약

| # | AI 결정 필요 | 백엔드 결정 | 확정 시 언블록 |
|---|---|---|---|
| ① | 경로 · 에러/폴백 이원화 · 타임아웃 · 멱등 | 어댑터 구현 | 229 실 어댑터 |
| ② | **dataQuality 2↔3** · 서비스auth · 필요 엔드포인트 | 경로·필드 확정(→ 계약 정렬) | AI 클라이언트 코드젠 |
| ③ | (a)+ends_next_day 확인만 | 저장 A/B | 279 자정슬롯 |

**핵심 2개**: ①의 **에러/폴백 이원화**, ②의 **dataQuality 2↔3**이 실질 재작업을 부른다. ③은 확인 수준.

## 병렬 진행 계획 (백엔드, 이 협의와 동시)

DTO(228)는 동결이므로 백엔드는 대기 없이:
1. **FakeScheduleAgent**(계약 준수, 실 seeded poiId emit) + **HttpScheduleAgentAdapter**(경로는 설정값, 프로파일 뒤) — StubScheduleAgentAdapter 대체
2. **272 poi_snapshot 동결**(실POI Fake로 E2E) · **271 편집+validate**(Fake validate) · **279 plumbing**
3. AI U5/HTTP 도착 시 **Fake→실어댑터 교체 + 공동 통합테스트**(CI는 외부 API 전부 Fake 유지)

→ ①②③이 확정될수록 위 1~2의 재작업 리스크가 줄어든다. 특히 **①의 에러/폴백·②의 dataQuality**를 먼저 회신 주시면 가장 도움이 된다.
