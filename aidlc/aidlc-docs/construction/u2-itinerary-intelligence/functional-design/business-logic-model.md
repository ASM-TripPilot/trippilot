# U2 Itinerary Intelligence / Solver — Business Logic Model

> **이 문서의 지위 (Q1=A · 2026-08-07 사용자 결정)**: U2는 **경계 접합 문서**다. 솔버 체인·HC 검증·LLM 게이트웨이의 내부 로직은 `ai/`가 이미 소유·구현·테스트했으므로 **재서술하지 않고 인용만** 한다. 이 문서가 소유하는 것은 **backend ↔ AI 경계 계약**과 **소유 경계**뿐이다.
> **정본 우선순위 (Q2=A)**: 설계 정본(`aidlc-docs/inception/application-design/component-methods.md`, 2026-07-12)과 실장이 어긋나면 **실장이 이긴다.** aidlc 문서를 실장에 맞춰 개정하고, 차이는 갭 `G-U2-*`로 기록한다. **단 양쪽 실장이 서로 다를 때는 이 문서가 결정한다**(Q5=A → `business-rules.md`).
> **범위**: SCOPE.md 현행 범위 = 설계 문서까지. 코드는 팀이 `ai/`·`backend/`에서 직접 개발.
> **유닛 성격**: 사용자 대면 스토리 0 — 계약·불변식·PBT 게이트로 표현되는 엔진 유닛(`unit-of-work-story-map.md` §U2 주석).

---

## 1. 소유 경계 지도 — 정본 컴포넌트가 실제로 어디 사는가

| 정본 계약(`components.md` §3) | 실장 위치 | 소유 팀 | 이 문서의 취급 |
|---|---|---|---|
| `SolverPort` | `ai/src/trippilot/c2/facade.py` `HybridSolverFacade` (+ `ortools_solver`·`llm_solver`·`fallback_solver`) | AI | 내부 — 인용만 |
| `FeasibilityValidator` | `ai/src/trippilot/c2/constraints.py` `ConstraintChecker`(HC1~HC4) | AI | 내부 — 인용만. 명칭은 BR-U2-02로 통일 |
| `PreferenceScoringPort` / `LlmGatewayPort` | `ai/src/trippilot/c1/` (gateway·gates 4·workers 4·`anthropic_adapter`) | AI | 내부 — 인용만 |
| `TravelEstimatePort` | `ai/src/trippilot/c2/travel.py` `TravelEstimator` | AI | 내부 — 인용만. 경계 노출은 표시 문자열만(BR-U2-08) |
| `CandidatePoolPort` | backend `modules/place-data` (C7 정본) ← AI `m7/pool_builder.py`가 read 소비 | **backend 소유** | 리버스 경계(§4). 상세는 U1 소관 |
| `QualityScore` | `ai/src/trippilot/domain/itinerary.py` + `c2/quality.py` | AI | 관측 지표 — O-SOLVER는 BR-U2-10~12 |
| **경계 포트** | backend `modules/itinerary-generation/domain/ScheduleAgentPort.kt` (TRIP-228) | **backend 소유** | **이 문서의 본체(§3)** |

> **핵심**: aidlc U2가 "만들 것"은 남아 있지 않다. 남은 것은 **두 팀이 마주 보는 면을 한 장으로 못 박는 일**이다.

### 1.1 인용 정본 (재서술 금지 대상)

| 대상 | 정본 문서 |
|---|---|
| 시한 인지 하이브리드 체인(OR-Tools → LLM 2차 → 규칙 폴백), 컴포넌트 6종 | `ai/aidlc-docs/construction/u2-solver/functional-design/business-logic-model.md` |
| HC1~HC4 정의, DL-1~6 시한 규칙, 결정론 규칙, PBT 게이트(U5-P1~P6·DL-P1/P2·GATE-P) | `ai/aidlc-docs/construction/u2-solver/functional-design/business-rules.md` |
| 도메인 타입(`ItineraryProblem`·`ItinerarySolution`·`SolveMode`·`Violation`·`QualityScore`) | `ai/src/trippilot/domain/itinerary.py` |
| 경계 필드 매핑 원안 | `ai/.../application-design/agent-io-contracts.md` §1.2 · `backend/docs/design/ai-backend-경계-계약-초안.md` |

---

## 2. 경계는 두 개뿐 — 굵은 경계 원칙

PR #76(2026-08-04 합의)로 확정된 그림이다. **조각 조립 경계는 두지 않는다** — backend가 M7·C1·C2를 직접 지휘하지 않는다.

```
┌─────────────────────────── backend (Kotlin 모듈러 모놀리스) ───────────────────────────┐
│  C6 Trip · C4 RegisteredStay · C2 Profile ──▶ M8 itinerary-generation                  │
│                                                    │                                    │
│                                    ScheduleAgentPort│(포워드 · 굵은 경계 1호출)          │
│  C7 place-data (POI 정본 · INV-1 게이트) ◀──────────┼─────┐                             │
└────────────────────────────────────────────────────┼─────┼─────────────────────────────┘
                                                     │     │ (리버스 · read 5종)
                                    ┌────────────────▼─────┴──────────────────┐
                                    │  ai (Python) — Orchestrator 내부 소유    │
                                    │  C1 LLM Gateway · C2 Solver · M7 Pool    │
                                    └──────────────────────────────────────────┘
```

| 방향 | 이름 | 호출자 → 응답자 | 용도 |
|---|---|---|---|
| 포워드 | **ScheduleAgent** | backend → AI | 일정 생성 한 번 호출 → 검증된 일정 |
| 리버스 | **POI 정본 read** | AI(M7) → backend | 후보풀 빌드용 POI 읽기 (write 없음) |

- **오케스트레이션은 AI 내부**(`services.md` 그림 확정, P8 해소). backend M8은 굵은 호출자 + 응답 이후 소유자.
- `camelCase ↔ snake_case` 변환은 backend M8 소유.
- 프로토콜 = **REST/JSON + 공유 `openapi.yaml` 양방향 코드젠**(결정 4). gRPC 보류.

---

## 3. 포워드 계약 — ScheduleAgent (경계 정본)

실장 = `backend/modules/itinerary-generation/src/main/kotlin/.../domain/ScheduleAgentPort.kt`. **3메서드 확정**(Q3=A).

```kotlin
interface ScheduleAgentPort {
    fun generate(input: ScheduleAgentInput): ScheduleAgentOutput          // 굵은 경계
    fun validate(solution: ScheduleAgentOutput): List<Violation>          // 편집 재검증
    fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult  // 최소 조정
}
```

### 3.1 요청 — `ScheduleAgentInput`

| 경계 필드 (camel) | AI (snake) | backend 원본 |
|---|---|---|
| `tripId` | `trip_id` | `trip.trip_id` |
| `generationMode` | `generation_mode` | d11 추천 강도 (`FULLY_AI` \| `CO_PLAN`) |
| `tripContext{destinations, startDate, endDate, companionType, budgetLevel}` | `trip_context` | `trip_destination` · `trip.start/end_date` · `companion_type` · `budget_tier` |
| `anchors: [{date, lat, lng}]` | `anchors` | `trip_base_day` 해석 = day별 거점 (C4) |
| `timeWindows: [{date, start, end}]` | `time_windows` | 기본 09:00–21:00 |
| `fixedBlocks: [{poiId, date?, start?, dwellMin?}]` | `fixed_blocks` | `must_visit` (ANYTIME / FIXED) |
| `preferenceProfile` 7축 + `petFriendly` | `preference_profile` | `profile.preference_set` 스냅숏 |
| `recommendationStrength` | `recommendation_strength` | d11 |
| `requestMeta{requestId, requestedAt, deadlineMs}` | `request_meta` | 지연 예산 전파(IO-1) — day1 5s / 전체 20s |

- **`deadlineMs`는 호출자 소유**(DL-6): AI는 값을 모르고 파라미터로만 받는다. day1 5,000ms · Plan-B 10,000ms · 재생성/백그라운드 관대.

### 3.2 응답 — `ScheduleAgentOutput`

| 경계 필드 | 의미 | 불변식 |
|---|---|---|
| `days[].slots[]` = `VisitSlotDisplay{poiId, startAt, endAt, endsNextDay, distanceRange?, isFixed}` | 표시용 슬롯 | 시각·순서 = 솔버 검증값만(**INV-2**) · duration 필드 없음(**INV-3**) |
| `day1ReadyAt` | day1 조기 노출 트리거 | — |
| `explanations{slotKey → 이유}` | 배치 이유 텍스트 | 시각·소요시간 언급 금지. 키 규약 = **BR-U2-04** |
| `solveMode` (FULL_AI \| DETERMINISTIC \| MINIMAL) + `isFallback` | 강등 표기 | 침묵 실패 금지(**INV-4**, IO-2). AI 4종 → 경계 3종 매핑 = **BR-U2-03** |
| `freshness{generatedAt, degraded}` | 데이터 신선도 집계 | 스키마 = **BR-U2-06** |
| `candidatesSummary` | 후보 충분성(LOW면 "일부 추천 빠짐" 안내) | **신설** = BR-U2-05 |

**응답 이후는 backend 소유**: 영속 · `poi_snapshot` 동결(확정 시 · AI는 스냅샷 안 만듦, IO-5) · day1 노출 · `ItineraryGenerated` 아웃박스 이벤트 · AI 불통 시 최소 일정 폴백(바깥 겹, `MinimalItineraryFallback.kt`).

### 3.3 `validate` / `repair` (N6 — 계약 부재 해소)

| 메서드 | 요청 | 응답 | 규칙 |
|---|---|---|---|
| `validate` | `ScheduleAgentOutput` (편집된 초안) | `List<Violation>` — 빈 리스트 = 유효 | **위반 표기만, 자동 변경 없음.** 사용자 편집을 차단하지 않는다(US-SCHED-07) |
| `repair` | `(ScheduleAgentOutput, List<Violation>)` | `RepairResult{repaired, changes[]}` | **시각·순서만 최소 조정, POI 불변**(`TIME_SHIFT_ONLY`). 고정 블록(HC3)은 repair도 못 건드림 |

- `Violation` 스키마 통일 = **BR-U2-01**.
- `repair`는 Plan-B(U4) 재정렬의 씨앗이지만, **U2 경계에서는 편집 후 최소 수리까지만** 정의한다.

---

## 4. 리버스 계약 — POI 정본 read (요약 · 정본은 U1/C7)

backend가 POI 정본을 소유하고 AI는 **read만** 한다(결정 3 — `upsert` 제외, INV-1 게이트는 backend C7).

| AI가 원하는 것 (`poi_db_port.py`) | backend 엔드포인트 |
|---|---|
| `find_by_radius(center, radius_km)` | `GET /internal/pois?centerLat&centerLng&radiusKm` |
| `find_by_ids(ids)` | `POST /internal/pois:batchGet` |
| `find_nearby(coord, radius_m, category)` | `GET /internal/pois/nearby` |
| `get_open_window(poi_id, on)` | `GET /internal/pois/{id}/open-window?on={date}` |
| `batch_check_closed(ids, on)` | `POST /internal/pois:closedCheck` |

- POI 응답에 **per-POI 비용·평점 없음**(결정 1). 예산은 trip/user 레벨 → AI는 **소프트 가중치**로만 사용(예산은 하드 제약 아님).
- 인기 정렬 = `savedCount`, 합성 정렬키 = `savedCount ↓ → dataQuality ↓ → 거점거리 ↑ → poiId ↑`(결정론).
- 카테고리 = **경계 코드 8종** `SIGHT·FOOD·CAFE·SHOPPING·NIGHT_VIEW·NATURE·CULTURE·ACTIVITY`(결정 2). `STAY`·`ETC` 없음.

---

## 5. 호출 흐름

### F-U2-1 · 일정 생성 (US-SCHED-01~05·09·10)

```
M8.generate(tripId, mode)
  ├─ 입력 집약: RegisteredStayFacade.getAnchors · TripFacade.getTripContext · UserProfileFacade(7축)
  ├─ ScheduleAgentPort.generate(input, deadlineMs)        ← 굵은 경계 · 1회
  │    └─ [AI 내부] Orchestrator → PlaceScout(M7 후보풀) → C1 선호 점수
  │         → C2 시한 인지 체인: OR-Tools → LLM 2차 → 규칙 폴백 (각 단계 HC1~HC4 통과 후에만 반환)
  ├─ 응답 검증: solveMode·isFallback 기록(침묵 실패 금지)
  ├─ day1ReadyAt 도달분 조기 노출 → 나머지 백그라운드 채움
  └─ 영속 + ItineraryGenerated 아웃박스
```

- **AI 불통·타임아웃**: backend가 바깥 겹에서 **최소 일정**(앵커 + 시각 고정 필수 방문지만) 생성 + 재시도 안내. `solveMode=MINIMAL`.

### F-U2-2 · 편집 재검증 (US-SCHED-07)

```
사용자 드래그·교체 → M8.edit(ops) → ScheduleAgentPort.validate(draft)
  → violations 표기(차단 아님) → 사용자가 [자동 조정] 선택 시에만 repair
```

### F-U2-3 · 폴백 체인 (INV-4 · US-SCHED-09)

정본 `components.md` §3.6 ↔ 실장 대조:

| 정본 폴백 단계 | 실장에서의 표현 | 경계 노출 |
|---|---|---|
| LLM 취향해석/설명 실패 → 솔버 결과 + 설명 생략 | C1 워커 실패 → 점수 기본값, `explanations` 부분 누락 | `explanations` 일부 키 부재 |
| CandidatePool 실패 → 부분 결과 + "일부 추천 빠짐" | M7 풀 축소 | `candidatesSummary.level=LOW` (BR-U2-05) |
| TravelEstimate 실패 → 직선거리(추정 표기) | `TravelEstimator` basis 강등 | `distanceRange` 문자열에 "추정" 표기(BR-U2-08) |
| Solver 전면 실패 → 최소 일정 + 재시도 | 규칙 폴백 → 그래도 실패 시 backend 바깥 겹 | `solveMode=MINIMAL`·`isFallback=true` |

> 정본의 `FallbackMode` 5종 enum은 실장에 없다 → **폐기**하고 위 3축(`solveMode`+`isFallback` / `freshness.degraded` / `candidatesSummary`)으로 대체한다(BR-U2-07, 갭 G-U2-08).

---

## 6. 불변식 집행 지점 (INV-1~4가 실제로 어디서 강제되나)

| 불변식 | 집행 지점 | 형태 |
|---|---|---|
| **INV-1** closed-set | ① backend C7 수집 게이트(`PoiCollectionGate.kt`) — POI 등록 자체를 통제 ② AI 2차 솔버 게이트 — LLM 제안 `poi_id ∉ candidates` → 드롭 + `GateDropEvent` | 이중 방벽 |
| **INV-2** 검증 시각만 | AI `HybridSolverFacade.solve` — **모든 반환 경로가 `check_all` 통과 후에만** 반환(LLM 2차 포함, 우회 경로 없음). 경계는 검증 완료값만 받는다 | 구조적 강제 |
| **INV-3** 거리만 | AI: 직렬화 경로 분리(`to_public_dict`에서 `internal_minutes` 제외) · backend: `VisitSlotDisplay`에 duration 필드 부재 | 양쪽 타입으로 강제 |
| **INV-4** 결정론적 폴백 | AI: `RuleFallbackSolver.required_ms()=0` → 항상 해 반환 · 모든 강등이 `FallbackEvent` · backend: 바깥 겹 `MinimalItineraryFallback` | 침묵 실패 경로 없음 |

- **INV-2 주의점**: `explanations`(LLM 생성 텍스트)가 시각·소요시간을 언급하면 INV-2/INV-3을 우회하게 된다 → 금지 규칙은 BR-U2-09.

---

## 7. 미개통 계약 2건 (Q3=A)

정본 `SolverPort` 4메서드 중 2개는 **현재 경계에 없다.** 부채를 지금 갚지 않고 자리만 명시한다.

| 정본 메서드 | 현재 | 개통 시점 |
|---|---|---|
| ~~`recalculate(cmd)`~~ — Plan-B 잔여 재정렬(warm-start) | **종결 (2026-08-09 · U4 DEC-U4-5)** — 아래 §7.2 | **U4에서 `replan`으로 개통.** `repair` 확장이 아니라 **ai 실장 `regenerate(problem, locked_slots)`에 백엔드 포트를 맞추는** 형태로 결정 |
| ~~`proposeSlotCandidates(query)`~~ | **개통 확정 (2026-08-07 · U3 DEC-U3-5)** | 아래 §7.1 |

> 지금 만들지 않는 이유: 소비자(U4 화면)가 확정되기 전에 시그니처를 못 박으면 그 자체가 새 드리프트원이 된다. **U2는 "없음 + 개통 시점"을 명시하는 것까지가 몫이다.**

### 7.1 `proposeSlotCandidates` — 개통 확정 (사후 정정 · 2026-08-07)

**정정 사유**: 이 문서 승인 시점에는 이 메서드를 "CO_PLAN(같이 고르기) 전용"으로 보고 U3 화면 설계 시점까지 이연했다. **그 전제가 틀렸다** — 라이브 Figma 밴드 h 실측에서 **완전 AI 경로에도 슬롯 교체가 존재**한다(`h11` 슬롯마다 "다른 후보 3 >", `h12 [완전AI] 슬롯 교체` 전용 화면). 따라서 **완전 AI·같이 고르기 공통 경계**로 확정한다.

```kotlin
fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput
```

시그니처·필드 정의는 **U3 `business-logic-model.md` §3.1**에 있다(중복 서술 금지). 경계 규칙은 BR-U2-04(`slotKey`)·BR-U2-08(거리 표시)·BR-U2-09(문구 제약)을 그대로 따르며, 후보는 closed-set(INV-1)이다.

> **이로써 `ScheduleAgentPort`는 4메서드**가 된다: `generate` · `validate` · `repair` · `proposeSlotCandidates`. openapi 반영은 BR-U2-10 절차를 따른다.

### 7.2 `recalculate` — `replan`으로 개통 확정 (사후 정정 · 2026-08-09 · U4)

**정정 사유**: 이 문서는 "`repair` 확장 vs 별도 경계"를 U4로 미뤘는데, **둘 다 아니었다.** U4 착수 시 `ai/`(develop) 실측에서 `HybridSolverFacade.regenerate(problem, locked_slots, deadline_ms)`가 **이미 Plan-B warm-start 그 자체**임이 확인됐다 — locked 슬롯을 `FixedBlock`으로 승격해 HC3 보호를 받게 하고 나머지만 재배치하며, `validate`가 보존을 강제하므로 위반 해는 반환 자체가 불가능하다(INV-2).

따라서 새 솔버 개념을 만들지 않고 **백엔드 포트를 ai 실장에 맞춘다**(U4 DEC-U4-5, 사용자 Q6="AI는 ai 폴더를 전적으로 따른다").

```kotlin
fun replan(input: ReplanInput): ScheduleAgentOutput   // 어댑터가 ai regenerate(problem, locked_slots)로 매핑
```

시그니처·매핑표는 **U4 `business-logic-model.md` §3.1**에 있다(중복 서술 금지).

> **이로써 `ScheduleAgentPort`는 5메서드**가 된다: `generate` · `validate` · `repair` · `proposeSlotCandidates` · `replan`.
> **이름 드리프트 기록(G-U4-4)**: 인셉션 `component-methods.md` §2는 여전히 `recalculate(cmd: RecalculateCommand)`로 적혀 있다. **실장 이름(`regenerate`)과 경계 이름(`replan`)을 정본으로** 삼고 인셉션 표기 정정을 상신한다.

---

## 8. 정본 대조표 & 갭

| ID | 갭 | 정본 쪽 | 실장 쪽 | 처리 |
|---|---|---|---|---|
| **G-U2-01** | 코드 조직도에 실재하지 않는 최상위 `solver/` 디렉토리 | `unit-of-work.md` §코드 조직도 · `components.md` "결정론적 솔버는 별도 서비스" | C1+C2+M7이 한 `ai/` 서비스 | 인셉션 표기 정정 제안(P6) |
| **G-U2-02** | **FR-SOLVER-02/03의 "Bedrock AgentCore 교체" 전제 폐기** | `requirements.md` FR-SOLVER-02·03 · `components.md` §3.1 `BedrockAgentSolverAdapter` | **AI-D06(2026-07-21): LLM 벤더 = Anthropic API 직접, Bedrock 아님**(결제 승인 경로). "Bedrock 2차 솔버"도 Anthropic 호출로 구현됨 | 재정의 = BR-U2-13 |
| **G-U2-03** | `SolverPort` 4메서드 표기 | `component-methods.md` §2 | 경계는 3메서드 | §7 반영 후 정본 개정 제안 |
| **G-U2-04** | `FeasibilityValidator` 5메서드 명명 | `component-methods.md` §3 | `ConstraintChecker` HC1~HC4 | BR-U2-02(HC 어휘 승격) |
| **G-U2-05** | `CandidatePoolPort`/`GroundedPlace` 시그니처 드리프트 | `component-methods.md` §3.4 | backend `CandidatePoolPort.kt` + 리버스 read 5종 | U1 소관 · 경계 정본은 openapi(TRIP-282) |
| **G-U2-06** | `openapi.yaml`에 `/ai/*`·`/internal/pois*` 경계 API 미반영 | 결정 4는 openapi 단일 정본 | 경계 경로 0건 | TRIP-282 |
| **G-U2-07** | `DistanceEstimate{meters, mode, basis}` vs 표시 문자열 | `component-methods.md` §1 | `distanceRange: String?` ("약 1.2km · 도보 추정") | BR-U2-08 |
| **G-U2-08** | `FallbackMode` 5종 enum | `component-methods.md` §1 | 없음 — 3축으로 표현 | BR-U2-07(폐기) |
| **G-U2-09** | `PlacementReason` 타입 | `component-methods.md` §1 `TimeSlot.reason` | `explanations: Map<String,String>` + **영속 경로 없음** | BR-U2-04(키 규약) + 영속 필요(backend 마이그레이션) |

> **G-U2-02는 인셉션 요구사항(FR-SOLVER) 본문에 닿는 갭**이다. U1의 인셉션 사후 개정(2026-07-23) 선례가 있으므로, 개정 여부는 별도 승인 사안으로 남긴다 — 이 문서는 **사실 기록 + 재정의 제안**까지만 한다.
