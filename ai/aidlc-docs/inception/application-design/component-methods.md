# Application Design — Component Methods

> 각 컴포넌트의 구현 클래스 구조, 공개/내부 메서드 시그니처, 비즈니스 규칙을 정의한다.
> 표기: `[public]` = 외부 호출 가능 · `[internal]` = 모듈 내부 전용

---

## 1. C2 Solver Engine

### 1.1 SolverFacade — 공개 퍼사드

| 메서드 | 유형 | 시그니처 | 비즈니스 규칙 |
|---|---|---|---|
| solve | public | `(problem: ItineraryProblem) -> ItinerarySolution` | llm_score 없으면 규칙 점수 폴백. day별 독립. 시간 예산 day1≤3s. 결과 HC 통과 필수 |
| validate | public | `(itinerary, constraints) -> list[Violation]` | HC1~HC4 순서 검증, 모든 위반 수집. 빈 리스트=유효 |
| repair | public | `(itinerary, violations, policy) -> RepairResult` | POI 불변, 시각·순서만 조정. 불가 시 failed |
| estimate_travel | public | `(from_, to, mode) -> TravelEstimate` | 어댑터 체인(카카오→네이버→직선거리). 안전계수+버퍼15분. 결정론. DTO 미노출(INV-3) |
| regenerate | public | `(problem, locked_slots) -> ItinerarySolution` | locked 시각 불변(HC3). 나머지만 재배치. 멱등(U5-P2) |

### 1.2 Optimizer — 내부

| 메서드 | 시그니처 | 알고리즘 |
|---|---|---|
| construct_initial | `(candidates, fixed_blocks, day_window) -> DaySolution` | 고정 블록 시간순 배치 → 점수 내림차순 삽입(HC 위반 시 스킵) |
| local_search | `(solution, time_budget_sec) -> DaySolution` | 2-opt 교환 + or-opt 이동 → HC 재검증 → 개선 시 유지. 시간 초과 즉시 중단 |
| _objective | `(solution, budget_weight) -> float` | sum(score) + budget_fit_bonus. 예산은 소프트(하드 아님) |

### 1.3 ConstraintChecker — 내부

| 메서드 | 검증식 |
|---|---|
| check_hc1 | `visit.startAt >= poi.open AND visit.endAt <= poi.close` |
| check_hc2 | `prev.endAt + travel(prev,next).time <= next.startAt` |
| check_hc3 | `fixedBlock.time == original.time` |
| check_hc4 | `visit ∈ dayWindow (09:00~21:00)`. 자정 초과=시작일 귀속 |
| check_all | HC1~HC4 순서 실행, 모든 위반 수집 |

### 1.4 TravelEstimator — 내부

| 메서드 | 설명 |
|---|---|
| estimate | 어댑터 체인 순회. 성공 시 _apply_safety. 전부 실패 → _straight_line_fallback |
| _apply_safety | `time = dist / SPEED[mode] * 60 * SAFETY[mode] + 15`. SAFETY={PUBLIC:1.5, WALK:1.4} |
| _straight_line_fallback | `haversine * 1.3(우회계수)` → _apply_safety |

### 1.5 FallbackScorer — 내부

| 메서드 | 설명 |
|---|---|
| build_rule_scores | 전 후보에 규칙 점수. seed 고정→동일출력(INV-4). `CATEGORY_WEIGHT + rating + budget_fit - distance_penalty` |

---

## 2. C1 LLM Gateway

### 2.1 GatewayFacade — 공개 퍼사드

| 메서드 | 유형 | 시그니처 | 비즈니스 규칙 |
|---|---|---|---|
| call | public | `(feature, context_refs, prompt, schema, requester) -> TypedResult[T]` | 컨텍스트 재조회 → 티어 라우팅 → LLM 호출(2.5s timeout) → closed-set 게이트. 실패 → fallback |
| route | public | `(utterance, context_refs, requester) -> Dispatch` | call(INTENT) → 의도+슬롯 → entity_resolver → apply_mode 결정. 실패 → default_fallback |
| resolve_context | public | `(requester, refs) -> InjectedContext` | 요청자 권한 재조회. 권한 밖 → PermissionDenied(조용한 제외 금지). 내부 지표 미포함 |

### 2.2 ClosedSetGate — 내부

| 메서드 | 설명 |
|---|---|
| validate | ① OutputSchema 파싱(형식 위반 드롭) ② poi_id ∈ whitelist 교차(밖이면 드롭·계측) ③ 전량 드롭 → fallback. 코드로 보장(프롬프트 아님) |
| _check_item | poi_id 존재 + frozenset 멤버십 O(1) |
| _record_drop | 드롭 ID 수·비율 메트릭 기록 |

### 2.3 TierRouter — 내부

| Feature | Tier | 역할 |
|---|---|---|
| INTENT | 경량 | 라우터 |
| PREFERENCE_SCORING | 경량 | 워커 |
| CONVERSATION / REQUERY | 경량 | 워커 |
| EXPLANATION / REFLECTION / PLACE_EXTRACTION | 상위 | 워커 |

`resolve(feature) -> ModelConfig` — tier → model_name, max_tokens, temperature, timeout 반환

### 2.4 IntentRouter — 내부

| 메서드 | 설명 |
|---|---|
| classify | call(INTENT) → {intent, slots} → entity_resolver → apply_mode 결정 |
| _resolve_apply_mode | `DESTRUCTIVE_OPS={remove_slot, clear_day, reorder_day, replan}`. affected>1 or destructive → CONFIRM_REQUIRED |

### 2.5 Workers — 공통 구조

모든 워커: `BaseWorker.execute(gateway, refs, requester, params) -> TypedResult[T]`

| 워커 | Feature | Tier | 출력 |
|---|---|---|---|
| PreferenceScoringWorker | PREFERENCE_SCORING | 경량 | `list[ScoredPoi]` — 전 일자 1회 |
| ExplanationWorker | EXPLANATION | 상위 | `list[SlotExplanation]` — 표시용 텍스트 |
| ReflectionWorker | REFLECTION | 상위 | `Reflection(title, body, highlights)` |
| PlaceExtractionWorker | PLACE_EXTRACTION | 상위 | `list[ExtractedPoi]` — 웹→구조화(AI-D03) |
| ConversationWorker | CONVERSATION | 경량 | `ConversationResponse(text, next_action)` |
| RequeryWorker | REQUERY | 경량 | 필터/입력값 변환 DTO |

워커는 시각·순서를 확정하지 않음 (INV-2). 실패 시 해당 워커만 규칙 폴백.

---

## 3. M7 Place Data

### 3.1 CandidatePoolBuilder — 공개

| 메서드 | 유형 | 비즈니스 규칙 |
|---|---|---|
| get_candidate_pool | public | 6단계 필터(반경→예산→영업→품질→인기→상한5000). MINIMAL 제외. avg_cost=None 통과. frozenset O(1) |
| _filter_by_radius | internal | `RADIUS_KM = {WALK:2.0, PUBLIC:10.0, CAR:20.0}` |
| _filter_by_budget | internal | `LIMIT = {LOW:15000, MID:40000, HIGH:None}` |
| _filter_by_open | internal | 여행 날짜 중 하루라도 영업하면 포함 |
| _filter_by_quality | internal | ALLOWED = {FULL, PARTIAL} |

### 3.2 EntityResolver — 공개

| 메서드 | 유형 | 비즈니스 규칙 |
|---|---|---|
| resolve_entities | public | 결정론 fuzzy match. score≥0.85→bind, ≥0.6→confirm, <0.6→unresolved(→웹소싱) |
| _fuzzy_match | internal | edit-distance + 자모 유사. kind=REGION→지역목록, POI→M7 대조 |

### 3.3 IngestGate — 공개

| 메서드 | 유형 | 비즈니스 규칙 |
|---|---|---|
| validate_and_register | public | 5단: ①스키마(coord·hours·category필수) ②실재(geocode+crosscheck) ③중복(50m) ④신뢰태깅 ⑤정책(가격제거,TTL) |
| _check_schema | internal | coord·hours·category 모두 not None |
| _check_existence | internal | geocode 성공 + 가능하면 Places API 교차확인 |
| _find_duplicate | internal | 이름+좌표50m+동일카테고리 → merge |

### 3.4 PoiRepository — 공개

| 메서드 | 설명 |
|---|---|
| find_by_radius(center, radius_km) | 반경 내 POI 조회 |
| find_by_ids(ids) | ID 집합으로 일괄 조회 |
| find_nearby(coord, radius_m, category) | 근접 POI (중복 검사용) |
| upsert(poi) | 등록/갱신 → poi_id 반환 |
| get_open_window(poi_id, date) | 영업시간 (Override 우선) |
| batch_check_closed(poi_ids, date) | 당일 휴무 일괄 확인 |

### 3.5 WebSourcingService — 내부 (비동기)

| 메서드 | 설명 |
|---|---|
| source_and_ingest | ①places_port.search ②부족→_web_extract ③각 poi→ingest_gate. 실패해도 생성 무영향(INV-4) |
| _web_extract | 웹 검색→읽기→gateway.call(PLACE_EXTRACTION)→구조화 POI |

---

## 4. Domain 핵심 타입 요약

| 타입 | 핵심 필드 | 불변식 |
|---|---|---|
| GeoPoint | lat, lng | frozen |
| TravelEstimate | distance_range, internal_minutes, is_estimated | internal_minutes는 DTO 미노출(INV-3) |
| ScoredPoi | poi_id, score, is_llm_score | poi_id ∈ candidate_pool |
| TypedResult[T] | value, is_fallback, error | fallback=True 시 value=None |
| EditCommand | op, params, affected_slots | — |
| ApplyMode | AUTO_APPLY / CONFIRM_REQUIRED | DESTRUCTIVE or slots>1 → CONFIRM |
| Dispatch | intent, slots, worker_plan, apply_mode | 라우터 실패 → default_fallback() |
| CandidatePool | poi_ids(frozenset), pois, generated_at | poi_ids는 O(1) 멤버십 |
