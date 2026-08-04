# 백엔드 ↔ AI 경계 정합성 점검 — 설계 정본 vs 실제 구현

> 조사일: 2026-08-02 · 범위: 설계 정본(`aidlc/aidlc-docs/inception/application-design/`)과
> 실제 구현(`ai/src/trippilot/`, `backend/modules/place-data`) 간 어긋남 · 철저도: thorough
> 대상 경계: AI ↔ 백엔드 (SolverPort · C7 Place Data · C1 LLM Gateway · S2 파이프라인)

## 요약

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

### P2 — 후보풀 필터 로직 불일치 (연동 차단)

- ai `pool_builder.py:25-56`: 반경(다일 ×0.7) → 예산 → 영업요일 → 품질(MINIMAL 제외) → rating 정렬 → 상한(5000) **6단계**.
- backend `PlaceDataCandidatePool.kt:23-45`: 카테고리 필터 + 반경(bbox+하버사인) **2단계뿐**.
- C8이 backend 후보풀을 소비하면 예산·영업·품질·인기 필터가 통째 누락.

### P3 — 카테고리 enum 불일치 (연동 차단)

- backend `Poi.kt:9`: `{명소, 맛집, 카페, 야경, 자연, 쇼핑, 문화}` (한글 7).
- ai `poi.py:15-23`: `{FOOD, CAFE, SIGHT, ACTIVITY, SHOPPING, STAY, ETC}` (영문 7).
- 값 집합 자체가 불일치 → 경계에서 카테고리 문자열 매핑 불가.

### P4 — SolverPort 계약 형태·계층 (혼동 유발)

- 정본 `component-methods.md:72-102`: C8/C10 소유 경계 계약, 4메서드(generate/recalculate/validate/proposeSlotCandidates)
  + `Result<>` + `FallbackMode`.
- 실제 `ai/.../ports/solver_port.py:14-15`: `solve(problem) -> ItinerarySolution | None`, "체인 로직은 U2 소유" =
  하이브리드 체인 내부 전략 포트(다른 계층).
- backend엔 SolverPort 정의 없음. 실제 서비스 경계는 `POST /ai/generate`(HTTP).
- 정확한 표현: "정본 경계 계약 미실현 + 동일 이름 재사용".

### P5 — QualityScore 미구현 (혼동/정리)

- 정본 `component-methods.md:59-61`, `components.md:179-182`: composite로 2차 솔버 교체 판정하는 핵심 자료구조.
- ai 전체 grep(`QualityScore|composite|preferenceFit|routeEfficiency`) 0건.
- 근접물 `observability.py:146 SolverRunRecord`는 `elapsed_ms·violations_found·repaired` 텔레메트리일 뿐, 산출물 부착 품질점수 아님.

### P6 — 별도 `solver/` 디렉토리 잔존 (문서 정리)

- `aidlc/.../unit-of-work.md:53-69`: 코드 조직도에 backend와 나란한 `solver/` 최상위 디렉토리.
- `components.md:3,151`: "결정론적 솔버는 별도 서비스(Python)".
- 실제: `solver/` 없음. C1(게이트웨이)+C2(솔버)+M7(장소데이터)이 한 `ai/` 서비스(`ai/CLAUDE.md:3`).

### P7 — CandidatePoolPort/GroundedPlace 시그니처 드리프트 (문서 정리)

- 정본 `component-methods.md:130-133`: `resolve(area, categories, filters)` + `Result<>`,
  `GroundedPlace`(32-36)에 `openingHours`·`grounded:Boolean`.
- backend `api/CandidatePoolPort.kt:9-26`: `resolve(area, categories)`(filters·Result 없음),
  `GroundedPlace`에 `distanceM`·`region` 추가, `openingHours`·`grounded` 없음.

### P8 — AI 오케스트레이션 소유 그림 충돌 (혼동 유발)

동일한 일정생성 흐름을 두 AI 문서가 상반되게 분해:
- `ai/.../application-design/services.md §1.1`: `[Kotlin M8] → POST /ai/generate → [ItineraryOrchestrator.generate()]`가
  m7·c1·c2 조립 → 오케스트레이터가 AI 파이썬 서비스 내부, M8은 얇은 호출자.
- `ai/.../design-artifacts/ai-implementation-design.md:110,123-151`: "M8이 오케스트레이션", KB(Kotlin M8)가
  `M7.get_candidate_pool`·`AI.score_preferences`·`AI.solve_day`를 조각 호출 → 오케스트레이터가 backend, AI는 세분 엔드포인트.
- 검증 결과(backend 설계가 M8 소유 확정)에 비추면 services.md 쪽이 정본과 어긋남.

---

## 어긋남 아님 (참고)

- **INV-3 (duration 미표시)**: ai(`travel.py:55-60` public에서 internal_minutes 제외)·
  backend(`openapi.yaml:417,453`, `PoiDtos.kt:9`, `CandidatePoolPort.kt:17`) 양쪽 일관 준수.
- **이벤트 소유**: AI 문서가 발행 주체를 backend(KB)로 올바로 귀속(`ai-implementation-design.md:117,154`,
  `agent-io-contracts.md:328`). 단 P8의 오케스트레이션 충돌만 잔존.

## 권고 (판단 위치)

- **뿌리 1 해소**: C7 Place Data 소유를 backend 단일로 확정할지, AI M7과의 분업 경계를 재정의할지 결정.
  결정 후 카테고리 enum·필터 파이프라인·GroundedPlace 스키마를 한쪽 정본으로 통일.
- **뿌리 2 해소**: 솔버 서비스 경계(HTTP `POST /ai/generate` 단일 vs 조각 호출)와 오케스트레이터 소유(backend M8 vs AI 서비스)를
  한 문서로 확정하고 `services.md`/`ai-implementation-design.md` 중 하나를 정본으로 정렬.
- QualityScore·SolverPort 경계 계약은 backend C8/C10 구현 착수 시점에 정본 대비 재확인.
