# 백엔드 ↔ AI 경계 정합성 점검 — 설계 정본 vs 실제 구현

> 조사일: 2026-08-02 · 범위: 설계 정본(`aidlc/aidlc-docs/inception/application-design/`)과
> 실제 구현(`ai/src/trippilot/`, `backend/modules/place-data`) 간 어긋남 · 철저도: thorough
> 대상 경계: AI ↔ 백엔드 (SolverPort · C7 Place Data · C1 LLM Gateway · S2 파이프라인)
> **재감사: 2026-08-06 (TRIP-283)** — 각 P 항목에 "2026-08-06 현황" 추가, 신규 발견 N1~N6 추가.
> **확정 반영: 2026-08-07 (TRIP-282 부분 이행)** — PR #104 회신으로 확정된 경계 경로·필드·프로토콜을 AI 문서에 정렬.
> 아래 원문(2026-08-02 기준)은 역사 기록으로 보존한다.

## 2026-08-06 재감사 요약

P1~P8 이후 진행(TRIP-228·259·261·264, PR #76 계약 초안 합의)으로 상당수가 해소·부분 해소됐고,
연동 차단 신규 1건(N1, 자정 넘김 슬롯)과 혼동 유발 신규 5건(N2~N6)이 확인됐다.

| # | 지점 | 2026-08-06 판정 | 잔여 작업 |
|---|---|---|---|
| P1 | POI 정본·INV-1 이중 소유 | **부분 해소** — 소유권 합의(백엔드 C7 단일 정본, AI M7 read-only) | ai `poi_db_port.py` `upsert` 제거·주석 정리 (TRIP-280) |
| P2 | 후보풀 필터 로직 불일치 | **부분 해소** — 결정1(예산 소프트 가중치·savedCount 합성 정렬 제안) 합의 | pool_builder 미조정, ai `Poi`에 saved_count/data_status 부재 (TRIP-280) |
| P3 | 카테고리 enum 불일치 | **부분 해소** — 백엔드 8종 완료(TRIP-264, V2.6) | ai enum 정합·매핑 (TRIP-281, ETC 폐기는 TRIP-278/PR #93 진행 중) + 신규: openapi PoiCategory 액티비티 누락 (TRIP-282) |
| P4 | SolverPort 계약 형태·계층 | **실질 해소** — `ScheduleAgentPort.kt` 실재화(TRIP-228) + PR #76 결정4(REST/openapi 단일 정본) 합의 | Violation 스키마 통일 (TRIP-282) |
| P5 | QualityScore 미구현 | **해소** — TRIP-259·261로 구현·배선 완료 | — |
| P6 | 별도 `solver/` 디렉토리 잔존 | **미해소** — 그대로 | 정본 문서 정리 (별도) |
| P7 | CandidatePoolPort/GroundedPlace 드리프트 | **부분 해소** — 결정4 합의 | openapi에 경계 API 미반영 (TRIP-282) |
| P8 | AI 오케스트레이션 소유 그림 충돌 | **해소(방향 확정)** — PR #76 "굵은 경계" 합의 | `ai-implementation-design.md` 구 그림 정정 (TRIP-282) |
| N1 | 자정 넘김 슬롯(HC4) 유실 | **신규 · 연동 차단** | TRIP-279 (PR #76에 AI팀 회신 게시됨) |
| N2~N6 | SolveMode 매핑표 부재 외 4건 | **신규 · 혼동 유발** | TRIP-282 |

상세는 각 P 항목의 "2026-08-06 현황"과 하단 [신규 발견 (2026-08-06)](#신규-발견-2026-08-06) 참조.
INV-3는 양쪽 실측 통과 재확인 — [어긋남 아님](#어긋남-아님-참고) 절에 기록.

---

## 2026-08-07 확정 사항 (TRIP-282 부분 이행)

PR #104(`backend/docs/design/ai-backend-경계-계약-확정.md`) 회신으로 **경계 HTTP 와이어의 일부가 확정**됐다.
확정분만 AI 문서에 정렬했고, **미확정분은 결론을 쓰지 않고 "협의 중"으로만 표기**했다.

### 확정 — AI 문서 반영 완료

| # | 확정 내용 | 근거 | 반영처 |
|---|---|---|---|
| F1 | 포워드 경계 경로 = `POST /ai/v1/itinerary/{generate\|validate\|repair}` | `/v1`만으로는 어느 서비스의 v1인지 모호 → 서비스명 접두. 리소스명은 **산출물 기준(`itinerary`)** 으로 백엔드 컨트롤러·스키마·DB 테이블과 통일 | `services.md §0`, `agent-io-contracts.md 0.1` |
| F2 | `ScheduleAgent`(행위자) ≠ `itinerary`(산출물) — 층이 달라 **에이전트명은 유지** | 위와 동일 | `services.md §0`, `agent-io-contracts.md 0.1` (각 1줄 명시) |
| F3 | 리버스 배치 read = `POST /internal/pois/batch-get`, 요청 필드 `poi_ids` | 백엔드 구현(#102) 기준. 계약 초안의 `:batchGet`·`ids`는 **미실현 표기** | `agent-io-contracts.md 0.1` |
| F4 | 리버스 반경 read = `GET /internal/pois?centerLat&centerLng&radiusKm` | 백엔드 구현(#102) | `agent-io-contracts.md 0.1` |
| F5 | 프로토콜 = **REST/JSON over HTTP 확정** (gRPC 보류, AI-D01 종결) | PR #76 결정4 | `agent-io-contracts.md §0·§7`, `api-documentation.md` 상단 |
| F6 | `/c1/*`·`/c2/*`·`/m7/*` 세분 경로 = **폐기 방향** (논리 인터페이스 참고용으로만 보존) | PR #76 "굵은 경계 — 조각 조립 경계를 두지 않는다" | `api-documentation.md` 상단 지위 강등 註 |

### 정정한 스테일 표기

| 스테일 표기 | 위치 | 정정 |
|---|---|---|
| `POST /ai/generate` | `services.md §1.1` | → `POST /ai/v1/itinerary/generate` |
| `POST /ai/route` | `services.md §2.1` | → `/ai/v1/...` (명명 규칙만 확정, 리소스명 협의 중) |
| `POST /ai/replan` | `services.md §3.1` | → `/ai/v1/...` (명명 규칙만 확정, 리소스명 협의 중) |
| "프로토콜(REST/gRPC)은 AI-D01 미확정" | `agent-io-contracts.md §0`·§7, `api-documentation.md` 상단 | → REST/JSON over HTTP 확정 (PR #76 결정4) |
| `POST .../pois:batchGet { ids[] }` | 계약 초안 표기 (AI 측 인용) | → `POST /internal/pois/batch-get { poi_ids }` |

> 본 문서 P4·P8 원문의 `POST /ai/generate` 표기는 **2026-08-02 감사 시점의 역사 기록**이며, F1이 이를 대체한다.

### 미확정 — "협의 중"으로만 표기 (결론 미기입)

| 항목 | 상태 |
|---|---|
| `dataQuality` 등급 수 (AI 3등급 MINIMAL/PARTIAL/FULL ↔ 백엔드 2등급 FULL/PARTIAL) | **AI가 MINIMAL 등급 추가를 요청, 백엔드 회신 대기.** MINIMAL은 AI 후보풀 제외 신호(좌표만·나머지 전무)로 쓰인다 |
| SolveMode 4↔3 매핑 (N2 — `RULE_FALLBACK` 목적지) | 협의 중 |
| `explanations` 키(`slot_id`) 의미·영속 (N3) | 협의 중 |
| `candidates_summary` 백엔드 포트 대응 (N4) | 협의 중 |
| `FreshnessMeta` 집계형 스키마 (N5) | 협의 중 |
| `Violation` 스키마 통일 (P4 잔여) | 협의 중 |
| day1 조기노출 방식 | 백엔드 "1차 스코프 제외" 제안에 AI 역제안 게시, **회신 대기** |
| AI 도우미·Plan-B 경계 경로 리소스명 | 명명 규칙(`/ai/v1/...`)만 확정, 리소스명 협의 중 |
| 리버스 이연 엔드포인트 (`nearby`·`open-window`·`closedCheck`) | 협의 중 (백엔드 `openingHours` 자유문자열 → structured 스키마 선행 필요) |
| 에러/폴백 이원화 · 타임아웃 · 멱등키 | 협의 중 |

---

## 요약 (2026-08-02 원문)

- 8개 어긋남 지점 전부 실제 코드/문서 라인으로 확증(오탐 0).
- **뿌리 원인 2개로 수렴**:
  1. 정본은 **C7 Place Data(POI 정본 + 후보풀)를 backend U1 단일 소유**로 배정했으나,
     AI 설계·구현이 이를 **M7으로 독립 재구현** → P1·P2·P3·P7의 공통 뿌리.
  2. **솔버·오케스트레이션의 서비스 경계 미확정** → P4·P6·P8의 공통 뿌리.
- INV-3(duration 미표시)와 이벤트 소유(백엔드)는 양쪽 정합 — 어긋남 아님.

## 검증으로 확정한 전제

- **TRIP-227 원문**: 리포지토리(전 브랜치·git 로그·PR·이슈·추적 파일)에 존재하지 않음 → Jira 전용.
  단, 그 취지("완료=아웃박스 이벤트, 백엔드 소유")와 정합한 근거는 repo에 있음
  (`backend/docs/design/숙소여행-DB스키마-설계.md:233-235`, `ai/.../ai-implementation-design.md:117,154`).
- **backend itinerary-generation/SolverPort**: 모듈·포트 미생성이나, 설계상 **M8 일정생성은 backend 소유**로 확정
  (`backend/docs/design/전체-도메인-ERD.md:22,165`, `전체-API-서피스.md:54` 밴드 h). 실제 솔버 로직은 `ai/`에 존재.

## 점검표

| # | 지점 | 판정 | 심각도 | 핵심 근거 A ↔ B |
|---|---|---|---|---|
| P1 | POI 정본·INV-1 이중 소유 | 확정 | 연동 차단 | `backend/.../PoiCollectionGate.kt:5` ↔ `ai/.../ai-architecture.md:83` |
| P2 | 후보풀 필터 로직 불일치 | 확정 | 연동 차단 | `ai/.../m7/pool_builder.py:25-56` ↔ `backend/.../PlaceDataCandidatePool.kt:23-45` |
| P3 | 카테고리 enum 불일치 | 확정 | 연동 차단 | `backend/.../Poi.kt:9` ↔ `ai/.../domain/poi.py:15-23` |
| P4 | SolverPort 계약 형태·계층 | 확정(뉘앙스) | 혼동 유발 | `aidlc/.../component-methods.md:72-102` ↔ `ai/.../ports/solver_port.py:14-15` |
| P5 | QualityScore 미구현 | 확정 | 혼동/정리 | `aidlc/.../components.md:179-182` ↔ ai grep 0건 |
| P6 | 별도 `solver/` 디렉토리 잔존 | 확정 | 문서 정리 | `aidlc/.../unit-of-work.md:53-69` ↔ 실제 `ai/` 통합 |
| P7 | CandidatePoolPort/GroundedPlace 드리프트 | 확정 | 문서 정리 | `aidlc/.../component-methods.md:130-133,32-36` ↔ `backend/.../api/CandidatePoolPort.kt:9-26` |
| P8 | AI 오케스트레이션 소유 그림 충돌 | 확정 | 혼동 유발 | `ai/.../application-design/services.md §1.1` ↔ `ai/.../ai-implementation-design.md:110,123-151` |

---

## 상세

### P1 — POI 정본 / INV-1 이중 소유 (연동 차단)

- backend: `PoiCollectionGate.kt:5-10`("수집 게이트 — INV-1 소유자"), `Poi.kt:17-21`("POI 정본 C7"),
  `PlaceDataCandidatePool.kt:14-15`(212 POI 정본 위 closed-set INV-1).
- ai: `m7/pool_builder.py:1-6`("이 출력이 INV-1 화이트리스트의 원천"), `domain/llm.py:71-90`(CandidatePool="INV-1 강제 지점"),
  `ports/poi_db_port.py:1-3`("M7 정본 저장소 … PostgreSQL/PostGIS U3 소유"), `ai-data-design.md:12-14`("M7 책임: POI 정본 관리").
- 반박 가설("ai M7은 backend 소비 스텁") 기각: AI 문서에 `place-data`/`CandidatePoolPort`/C7 소비 언급 0건,
  `ai-architecture.md:77,83`은 M7을 최하위 자기 소유 컴포넌트로 규정.
- 정본은 `components.md:77-83`에서 C7=U1(backend) 단일 소유로 못박음 → AI 쪽이 정본과 어긋남.

> **2026-08-06 현황 — 부분 해소.** 소유권 합의 완료: **백엔드 C7이 POI 단일 정본, AI M7은 read-only 소비자**.
> 잔여: `ai/src/trippilot/ports/poi_db_port.py:21`에 `upsert(self, poi: Poi) -> PoiId`가 아직 남아 있고,
> 같은 파일 docstring("M7 정본 저장소 콘센트")도 구 소유 그림 그대로 → 제거·주석 정리는 TRIP-280.

### P2 — 후보풀 필터 로직 불일치 (연동 차단)

- ai `pool_builder.py:25-56`: 반경(다일 ×0.7) → 예산 → 영업요일 → 품질(MINIMAL 제외) → rating 정렬 → 상한(5000) **6단계**.
- backend `PlaceDataCandidatePool.kt:23-45`: 카테고리 필터 + 반경(bbox+하버사인) **2단계뿐**.
- C8이 backend 후보풀을 소비하면 예산·영업·품질·인기 필터가 통째 누락.

> **2026-08-06 현황 — 부분 해소.** PR #76 결정1 합의: 예산은 하드 필터가 아닌 **소프트 가중치**로,
> 인기 정렬은 rating 단독이 아닌 **savedCount 합성 정렬**로 간다는 제안이 수용됨.
> 잔여(TRIP-280): ai `m7/pool_builder.py:25-56`은 여전히 예산 하드 필터 + rating 단독 정렬이고,
> ai `domain/poi.py:72-81` `Poi`에 `saved_count`·`data_status` 필드가 없어 결정1 반영 자체가 불가
> (backend `openapi.yaml:686` `Place`는 `savedCount`·`dataStatus` 필수).

### P3 — 카테고리 enum 불일치 (연동 차단)

- backend `Poi.kt:9`: `{명소, 맛집, 카페, 야경, 자연, 쇼핑, 문화}` (한글 7).
- ai `poi.py:15-23`: `{FOOD, CAFE, SIGHT, ACTIVITY, SHOPPING, STAY, ETC}` (영문 7).
- 값 집합 자체가 불일치 → 경계에서 카테고리 문자열 매핑 불가.

> **2026-08-06 현황 — 부분 해소.** 백엔드 쪽은 8종 완료(TRIP-264): `Poi.kt:9`
> `{명소, 맛집, 카페, 야경, 자연, 쇼핑, 문화, 액티비티}` + `V2.6__poi_activity_category.sql`.
> 잔여: ai `domain/poi.py:15-22`는 여전히 영문 7종(`ETC` 포함) → enum 정합·매핑은 TRIP-281
> (ETC 폐기는 TRIP-278/PR #93 진행 중).
> **신규 발견**: `backend/docs/design/openapi.yaml:680-682` `PoiCategory` enum이 액티비티 누락
> 7종 그대로 → 코드(`Poi.kt:9`)와 자기 문서가 어긋남 (TRIP-282).

### P4 — SolverPort 계약 형태·계층 (혼동 유발)

- 정본 `component-methods.md:72-102`: C8/C10 소유 경계 계약, 4메서드(generate/recalculate/validate/proposeSlotCandidates)
  + `Result<>` + `FallbackMode`.
- 실제 `ai/.../ports/solver_port.py:14-15`: `solve(problem) -> ItinerarySolution | None`, "체인 로직은 U2 소유" =
  하이브리드 체인 내부 전략 포트(다른 계층).
- backend엔 SolverPort 정의 없음. 실제 서비스 경계는 `POST /ai/generate`(HTTP).
- 정확한 표현: "정본 경계 계약 미실현 + 동일 이름 재사용".

> **2026-08-06 현황 — 실질 해소.** 경계 계약이 backend에 실재화됨(TRIP-228):
> `backend/modules/itinerary-generation/.../domain/ScheduleAgentPort.kt:16-19`
> (`generate`/`validate`/`repair` 3메서드, 프레임워크-free 포트, 어댑터가 HTTP 구현) —
> 정본 표기도 `backend/docs/design/ai-backend-경계-계약-초안.md`로 명시(같은 파일 :14).
> PR #76 결정4로 **REST/openapi 단일 정본** 합의 → "정본 경계 계약 미실현"은 해소.
> 잔여(TRIP-282): **Violation 스키마 불일치** — backend `ScheduleAgentPort.kt:102`
> `(type, dayIndex, slotIndex, detail?)` ↔ ai `domain/itinerary.py:46-51` `(code: HC1~HC4, slot_ref, detail)`.

### P5 — QualityScore 미구현 (혼동/정리)

- 정본 `component-methods.md:59-61`, `components.md:179-182`: composite로 2차 솔버 교체 판정하는 핵심 자료구조.
- ai 전체 grep(`QualityScore|composite|preferenceFit|routeEfficiency`) 0건.
- 근접물 `observability.py:146 SolverRunRecord`는 `elapsed_ms·violations_found·repaired` 텔레메트리일 뿐, 산출물 부착 품질점수 아님.

> **2026-08-06 현황 — 해소.** TRIP-259(도메인 타입·계산)·TRIP-261(C2 facade 배선) 완료:
> `ai/src/trippilot/domain/itinerary.py:233` `QualityScore`(preference_fit·constraint_satisfaction·
> route_efficiency·composite, 전 성분 [0,1]), `ai/src/trippilot/c2/quality.py:86-105` `compute_quality`,
> facade 모든 반환 경로 부착(`ai/src/trippilot/c2/facade.py:101`).

### P6 — 별도 `solver/` 디렉토리 잔존 (문서 정리)

- `aidlc/.../unit-of-work.md:53-69`: 코드 조직도에 backend와 나란한 `solver/` 최상위 디렉토리.
- `components.md:3,151`: "결정론적 솔버는 별도 서비스(Python)".
- 실제: `solver/` 없음. C1(게이트웨이)+C2(솔버)+M7(장소데이터)이 한 `ai/` 서비스(`ai/CLAUDE.md:3`).

> **2026-08-06 현황 — 미해소.** 그대로 (정본 문서 정리 잔여).

### P7 — CandidatePoolPort/GroundedPlace 시그니처 드리프트 (문서 정리)

- 정본 `component-methods.md:130-133`: `resolve(area, categories, filters)` + `Result<>`,
  `GroundedPlace`(32-36)에 `openingHours`·`grounded:Boolean`.
- backend `api/CandidatePoolPort.kt:9-26`: `resolve(area, categories)`(filters·Result 없음),
  `GroundedPlace`에 `distanceM`·`region` 추가, `openingHours`·`grounded` 없음.

> **2026-08-06 현황 — 부분 해소.** PR #76 결정4(REST/openapi 단일 정본) 합의로 정렬 방향은 확정.
> 잔여(TRIP-282): `backend/docs/design/openapi.yaml`에 AI 경계 API(`/ai/*`)가 아직 미반영
> (2026-08-06 grep 기준 경계 경로 0건).

### P8 — AI 오케스트레이션 소유 그림 충돌 (혼동 유발)

동일한 일정생성 흐름을 두 AI 문서가 상반되게 분해:
- `ai/.../application-design/services.md §1.1`: `[Kotlin M8] → POST /ai/generate → [ItineraryOrchestrator.generate()]`가
  m7·c1·c2 조립 → 오케스트레이터가 AI 파이썬 서비스 내부, M8은 얇은 호출자.
- `ai/.../design-artifacts/ai-implementation-design.md:110,123-151`: "M8이 오케스트레이션", KB(Kotlin M8)가
  `M7.get_candidate_pool`·`AI.score_preferences`·`AI.solve_day`를 조각 호출 → 오케스트레이터가 backend, AI는 세분 엔드포인트.
- 검증 결과(backend 설계가 M8 소유 확정)에 비추면 services.md 쪽이 정본과 어긋남.

> **2026-08-06 현황 — 해소(방향 확정).** PR #76 계약 초안에서 **"굵은 경계 — 조각 조립 경계는 두지 않는다"** 합의:
> 오케스트레이터는 AI 내부, 경계는 `POST /ai/generate` 한 호출(`ScheduleAgentPort.kt:11` "generate: 굵은 경계 —
> 한 호출로 검증된 일정"). 즉 services.md 그림 쪽으로 확정.
> 잔여(TRIP-282): `ai-implementation-design.md`의 구 그림(M8 조각 호출) 정정.

---

## 신규 발견 (2026-08-06)

### N1 — 자정 넘김 슬롯(HC4) 경계 유실 (연동 차단) — TRIP-279

- 경계 계약은 자정 넘김을 표현함: backend `ScheduleAgentPort.kt:87-91` `VisitSlotDisplay.endsNextDay`
  ("자정 넘겨 종료(HC4, 시작일 귀속)의 잠정 표현").
- 그러나 `GenerateItineraryService.kt:67`의 도메인 변환(`VisitSlot.of(s.poiId, null, slotIdx, s.startAt, s.endAt, s.isFixed)`)에서
  `endsNextDay`가 **유실**되고,
- 도메인 검증 `Itinerary.kt:42`(`endAt < startAt` → FieldError)와
  DB `V2.7__itinerary.sql:38`(`CHECK (end_at >= start_at)`)이 자정 넘김 슬롯을 **거부**한다.
- 결과: AI가 HC4 준수로 낸 자정 넘김 슬롯이 backend 저장 단계에서 깨짐. PR #76에 AI팀 회신 게시됨.

### N2~N6 — 혼동 유발 (전부 TRIP-282)

| # | 지점 | 근거 A ↔ B |
|---|---|---|
| N2 | SolveMode 4↔3 매핑표 부재 | ai `domain/itinerary.py:33-39` `{OR_TOOLS, LLM, RULE_FALLBACK, MINIMAL}` ↔ backend `Itinerary.kt:15` + `V2.7__itinerary.sql:11` `{FULL_AI, DETERMINISTIC, MINIMAL}` — `RULE_FALLBACK` 목적지 미정 |
| N3 | explanations slot_id 키 해석 불가·영속 유실 | ai `agent-io-contracts.md:64` `dict[slot_id → 이유]` ↔ backend `ScheduleAgentPort.kt:75` `Map<String, String>`(slotRef 의미 미정의) + `GenerateItineraryService.kt:63-67` 변환에서 미영속 |
| N4 | candidates_summary BE 포트 누락 | ai `agent-io-contracts.md:68` `candidates_summary: SufficiencyReport` ↔ backend `ScheduleAgentPort.kt` 대응 필드 없음(grep 0건) |
| N5 | FreshnessMeta 스키마 양쪽 상이 | ai `agent-io-contracts.md:217-222` `(source, fetched_at, cache_hit, ttl_sec, stale)` ↔ backend `ScheduleAgentPort.kt:97` `(generatedAt, degraded)` |
| N6 | validate·repair 계약 문서 부재 | backend `ScheduleAgentPort.kt:18-19`에 메서드 실재 ↔ 경계 계약 초안·openapi에 요청/응답 스키마 미기술 |

---

## 어긋남 아님 (참고)

- **INV-3 (duration 미표시)**: ai(`travel.py:55-60` public에서 internal_minutes 제외)·
  backend(`openapi.yaml:417,453`, `PoiDtos.kt:9`, `CandidatePoolPort.kt:17`) 양쪽 일관 준수.
  - **2026-08-06 실측 재확인 — 양쪽 통과.** ai: `domain/travel.py:1-7`(직렬화 경로 분리로 구조적 강제),
    `c2/quality.py:8`(품질 계산조차 internal_minutes 미사용), `QualityScore` 전 성분 무차원 [0,1].
    backend: `ScheduleAgentPort.kt:84` `VisitSlotDisplay` "duration 필드 없음(INV-3) — 거리만",
    `openapi.yaml:417,453` 유효.
- **이벤트 소유**: AI 문서가 발행 주체를 backend(KB)로 올바로 귀속(`ai-implementation-design.md:117,154`,
  `agent-io-contracts.md:328`). 단 P8의 오케스트레이션 충돌만 잔존.

## 권고 (판단 위치)

- **뿌리 1 해소**: C7 Place Data 소유를 backend 단일로 확정할지, AI M7과의 분업 경계를 재정의할지 결정.
  결정 후 카테고리 enum·필터 파이프라인·GroundedPlace 스키마를 한쪽 정본으로 통일.
- **뿌리 2 해소**: 솔버 서비스 경계(HTTP `POST /ai/generate` 단일 vs 조각 호출)와 오케스트레이터 소유(backend M8 vs AI 서비스)를
  한 문서로 확정하고 `services.md`/`ai-implementation-design.md` 중 하나를 정본으로 정렬.
- QualityScore·SolverPort 경계 계약은 backend C8/C10 구현 착수 시점에 정본 대비 재확인.

> **2026-08-06 현황 — 두 뿌리 모두 방향 확정.**
> 뿌리 1은 소유권 합의(백엔드 C7 단일 정본, AI M7 read-only), 뿌리 2는 PR #76 "굵은 경계" 합의로 판단 완료.
> 잔여 작업은 티켓으로 추적: **TRIP-279**(N1 자정 넘김), **TRIP-280**(P1·P2 ai 측 정리),
> **TRIP-281**(P3 ai enum 정합·매핑, ETC 폐기는 TRIP-278), **TRIP-282**(P4 Violation 통일 · P7 openapi 경계 API ·
> P8 구 그림 정정 · P3 openapi PoiCategory · N2~N6). QualityScore(P5)는 종결.
