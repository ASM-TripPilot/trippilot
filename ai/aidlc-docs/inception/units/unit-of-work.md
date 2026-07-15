# Units of Work — TripPilot AI 서비스

> 6개 유닛으로 분해한 구현 단위. 각 유닛은 독립 테스트·배포 가능한 범위.

---

## U1. Domain & Ports

| 항목 | 내용 |
|---|---|
| **범위** | 공유 도메인 모델 + Port 인터페이스 + PBT Generators + Fake 어댑터 |
| **모듈** | `domain/` (poi, itinerary, travel, trigger, edit) + `ports/` (llm, travel, places, poi_db, cache) + `tests/generators/` + `tests/fakes/` |
| **산출물** | 도메인 dataclass 전체, Port Protocol 전체, Hypothesis generator, FakeLlm/FakeTravel/InMemoryPoi |
| **성공 기준** | 모든 도메인 타입 frozen·직렬화 왕복(U5-P10) 통과. Port 인터페이스에 대해 fake 구현 존재. Generator로 유효한 인스턴스 생성 확인 |
| **예상 소요** | 2~3일 |
| **리스크** | 낮음 — 외부 의존 없음, 순수 타입·인터페이스 정의 |

---

## U2. C2 Solver Core

| 항목 | 내용 |
|---|---|
| **범위** | SolverFacade + Optimizer + ConstraintChecker + TravelEstimator + FallbackScorer + RepairEngine |
| **모듈** | `c2/` 전체 |
| **산출물** | solve(), validate(), repair(), estimate_travel(), regenerate() 구현. 하드 제약 4종. 휴리스틱+지역탐색. 결정론 모드 |
| **성공 기준** | U5-P1(HC PBT+oracle), U5-P2(warm-start 멱등), U5-P3(결정론 동일출력), U5-P4(이동추정 결정성+INV-3), U5-P6(예산 단조) 전부 통과. day1 ≤ 3초(후보 50개 기준) |
| **예상 소요** | 5~7일 |
| **리스크** | 중간 — 솔버 라이브러리 선정(OR-Tools vs 자체), 5초 게이트 달성 불확실 |

---

## U3. M7 Place Data Core

| 항목 | 내용 |
|---|---|
| **범위** | CandidatePoolBuilder + PoiRepository + EntityResolver + Cache 로직 |
| **모듈** | `m7/` (candidate_pool, poi_repository, entity_resolver, cache). 웹 소싱 제외(U6) |
| **산출물** | get_candidate_pool() 6단계 필터, POI CRUD, fuzzy_match 엔티티 해소, TTL 캐싱 |
| **성공 기준** | 후보 풀 생성 정상(반경·예산·영업·품질 필터 동작), 엔티티 해소 결정론(RES-P1), frozenset O(1) 멤버십, 가격 캐싱 금지 확인 |
| **예상 소요** | 3~5일 |
| **리스크** | 낮음 — DB 어댑터는 InMemory fake로 시작 가능 |

---

## U4. C1 LLM Gateway

| 항목 | 내용 |
|---|---|
| **범위** | GatewayFacade + ClosedSetGate + TierRouter + ContextResolver + PreferenceScoringWorker |
| **모듈** | `c1/` (gateway, gate, tier_router, context, workers/preference) |
| **산출물** | call() 구현, closed-set 게이트, 티어 라우팅, 컨텍스트 주입, PreferenceScoring 워커 |
| **성공 기준** | U5-P5(closed-set 환각 0 PBT) 통과. FakeLlm으로 call→gate→result 파이프라인 동작. 타임아웃 시 폴백 신호 발행. 권한 밖 참조 → PermissionDenied |
| **예상 소요** | 4~5일 |
| **리스크** | 중간 — LLM 벤더 미확정이지만 FakeLlm으로 우회 가능 |

---

## U5. AI Orchestration & API

| 항목 | 내용 |
|---|---|
| **범위** | ItineraryOrchestrator + API Layer(routes, schemas, middleware) + 폴백 계단 통합 |
| **모듈** | `api/` + 오케스트레이션 서비스(generate, replan) |
| **산출물** | HTTP 엔드포인트(C1/C2/M7), score→solve 파이프라인, 폴백 계단(LLM실패→규칙→최소일정), 상태 전이, rate-limit, 헬스체크 |
| **성공 기준** | 생성 파이프라인 end-to-end 동작(fake 기반). 폴백 모든 단계 트리거 가능. 20초 타임아웃 동작. API 스키마 검증 통과 |
| **예상 소요** | 3~4일 |
| **리스크** | 낮음 — U2·U3·U4 완성 후 통합이므로 개별 컴포넌트 안정 |

---

## U6. Extended Features

| 항목 | 내용 |
|---|---|
| **범위** | IntentRouter + 추가 워커(Explanation·Reflection·PlaceExtraction·Conversation) + 웹 후보 소싱(sourcing/+ingest_gate) + 편집 명령 번역 |
| **모듈** | `c1/router`, `c1/workers/` (나머지 5종), `m7/sourcing/`, `m7/ingest_gate` |
| **산출물** | route() 의도 라우팅, 워커 5종, 수집 게이트 5단, 웹 소싱 파이프라인(비동기), EditCommand 번역 |
| **성공 기준** | M16-P1~P3(편집 솔버 경유·파괴적 확인·폴백) 통과. SRC-P1~P3(게이트 결손·실재·웹실패 격리) 통과. 라우터 실패 시 default_fallback |
| **예상 소요** | 5~7일 |
| **리스크** | 중간 — Places API 벤더 미확정, 자유 웹 추출 프롬프트 튜닝 필요 |

---

## 전체 요약

| Unit | 이름 | 소요 | 우선순위 |
|---|---|---|---|
| U1 | Domain & Ports | 2~3일 | P0 (선행 조건) |
| U2 | C2 Solver Core | 5~7일 | P0 |
| U3 | M7 Place Data Core | 3~5일 | P0 |
| U4 | C1 LLM Gateway | 4~5일 | P0 |
| U5 | Orchestration & API | 3~4일 | P0 |
| U6 | Extended Features | 5~7일 | P1 |
| | **Total** | **22~31일** | |
