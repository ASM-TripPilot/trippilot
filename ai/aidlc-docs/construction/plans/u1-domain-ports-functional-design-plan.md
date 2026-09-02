# U1 Domain & Ports — Functional Design Plan (LLMOps 반영)

> **작성**: 2026-07-14 · CONSTRUCTION Phase 첫 유닛
> **특이사항**: 사용자 커리어 목표(클라우드 LLMOps — eval 파이프라인·프롬프트 버저닝·모니터링)를
> U1 도메인 타입·Port 수준에서 선반영한다. U1은 모든 유닛의 타입 기반이므로
> 여기서 빠지면 U2~U6 전면 재작업이 필요하다.

---

## 1. 유닛 컨텍스트 요약

| 항목 | 내용 |
|---|---|
| 범위 | 공유 도메인 모델 + Port 인터페이스 + PBT Generators + Fake 어댑터 |
| 모듈 | `domain/` (poi, itinerary, travel, trigger, edit) + `ports/` (llm, travel, places, poi_db, cache) + `tests/generators/` + `tests/fakes/` |
| NFR | NFR-4.2 (fake 교체), NFR-6.3 (LLM 벤더 교체 가능) |
| PBT | U5-P10 (직렬화 왕복), Generator 유효성 |
| 성공 기준 | 모든 도메인 타입 frozen·직렬화 왕복 통과. 모든 Port에 fake 구현 존재 |

### LLMOps 확장 범위 (이번 설계에서 추가)

| 추가 항목 | 근거 |
|---|---|
| **관측 도메인 타입** — LLM 호출 기록(토큰·레이턴시·비용), 폴백 이벤트, 게이트 드롭 이벤트 | NFR-5.1~5.4 (LLM 비용·쿼터·실패율·폴백률 계측)의 타입 기반. U4/U5에서 계측 심을 때 필요 |
| **TracePort** (관측 이벤트 발행 추상) | 모든 컴포넌트가 의존할 계측 인터페이스. fake(InMemoryTrace)로 테스트 시 이벤트 검증 가능 |
| **프롬프트 버전 참조 타입** — PromptRef(prompt_id, version) | 프롬프트 버저닝 → eval 회귀의 연결 고리. LLM 호출 기록에 어떤 프롬프트 버전이 쓰였는지 남김 |
| **Eval 도메인 타입** — EvalCase / EvalRun / EvalScore | 골든 데이터셋 기반 회귀 eval 파이프라인의 타입 기반 (INV-1 환각률, 어셈블리 통과율, RAG 품질 등) |

---

## 2. 설계 단계 체크리스트

- [ ] Step A. 도메인 모델 상세 설계 — `domain-entities.md`
  - [ ] poi: Poi, PoiCategory, OpenHour, GeoPoint, DataQuality
  - [ ] itinerary: ItineraryProblem, ItinerarySolution, DaySolution, VisitSlot, FixedBlock, Violation
  - [ ] travel: TravelEstimate, TransportMode (INV-3: internal_minutes DTO 미노출 타입 수준 보장)
  - [ ] trigger: TriggerParams, TriggerEvalResult
  - [ ] edit: EditCommand, ApplyMode, Dispatch
  - [ ] llm 결과: TypedResult[T], ScoredPoi, CandidatePool
  - [ ] 에이전트 실행: ExecutionPlan, ExecutionStep, AgentCall (agent-redesign.md 반영)
  - [ ] **[LLMOps] observability: LlmCallRecord, FallbackEvent, GateDropEvent, AssemblyRunRecord**
  - [ ] **[LLMOps] prompt: PromptRef(prompt_id, version, feature)**
  - [ ] **[LLMOps] eval: EvalCase, EvalRun, EvalScore**
- [ ] Step B. Port 인터페이스 설계 — `business-logic-model.md`
  - [ ] LlmPort — invoke() 반환에 사용 토큰·레이턴시 메타 포함 (계측 가능 구조)
  - [ ] TravelPort, PlacesPort, PoiDbPort, CachePort
  - [ ] **[LLMOps] TracePort — emit(event) 이벤트 발행 추상**
  - [ ] AssemblyPort (하이브리드 체인용 — agent-redesign.md)
- [ ] Step C. 비즈니스 규칙·불변식 명세 — `business-rules.md`
  - [ ] 4대 불변식(INV-1~4)의 타입 수준 강제 지점 명세
  - [ ] frozen·직렬화 규칙, ID 규칙, 시간대 규칙
  - [ ] **[LLMOps] 관측 이벤트 필수 발행 지점 규칙 (LLM 호출·폴백·게이트 드롭 시 누락 금지)**
- [ ] Step D. PBT Generator + Fake 어댑터 설계
  - [ ] Hypothesis generator 목록 (도메인 타입별)
  - [ ] FakeLlm(시드 결정론) / FakeTravel(haversine) / InMemoryPoi / InMemoryCache / **InMemoryTrace**
- [ ] Step E. 산출물 3종 작성 → 리뷰 → 승인

---

## 3. 질문 (답변 필요 — `[Answer]:` 뒤에 작성해주세요)

### Q1. LLMOps 관측 Port 구성
관측(트레이스·메트릭) 인터페이스를 어떻게 나눌까요?
- (a) **TracePort 하나로 통합** — emit(event) 단일 메서드, 이벤트 타입으로 구분 (단순, 권장)
- (b) MetricsPort(수치) / TracePort(스팬) 분리 — OpenTelemetry 구조와 1:1 대응
- (c) U1에서는 이벤트 타입만 정의하고 Port는 U5에서

[Answer]: (a) TracePort 하나로 통합 — 확정 (2026-07-14, 사용자 승인: 전부 권장안)
### Q2. Eval 타입의 U1 포함 범위
EvalCase/EvalRun/EvalScore를 U1 도메인에 포함할까요?
- (a) **포함** — 타입만 정의 (eval 실행 로직은 추후 별도 유닛/스크립트). 타입 기반을 지금 확보 (권장)
- (b) 제외 — eval은 나중에 U7로 독립시키고 그때 타입도 정의

[Answer]: (a) 포함 — 타입만 정의. eval 실행 로직은 추후 별도 유닛 — 확정
### Q3. 프롬프트 버저닝 방식
PromptRef가 가리키는 프롬프트 실체의 관리 방식은?
- (a) **코드 저장소 내 YAML/파일 + git 버전** — prompt_id는 파일 경로, version은 semver 문자열 (단순, 권장)
- (b) DB 기반 프롬프트 레지스트리 — 런타임 교체 가능하지만 인프라 필요
- (c) LangSmith 등 외부 도구의 프롬프트 허브

[Answer]: (a) 코드 저장소 내 YAML/파일 + git 버전 — 확정
### Q4. 도메인 모델 구현 방식
- (a) **frozen dataclass + 직렬화 함수(to_dict/from_dict)** — 의존성 0, domain 최하위 계층 규칙에 부합 (권장)
- (b) pydantic BaseModel(frozen) — 직렬화·검증 공짜지만 domain이 pydantic에 의존하게 됨

[Answer]: (a) frozen dataclass + to_dict/from_dict — 확정
### Q5. Port 인터페이스 스타일
- (a) **typing.Protocol** — 구조적 타이핑, 어댑터가 상속 불필요 (권장)
- (b) abc.ABC — 명시적 상속, 미구현 메서드 즉시 에러

[Answer]: (a) typing.Protocol — 확정
### Q6. 빌드 시스템 확정 (U1 코드 생성 전 필수)
- (a) **uv** — 2026 현재 사실상 표준, 빠름 (권장)
- (b) poetry

[Answer]: (a) uv — 확정
### Q7. 에이전트 실행 타입(ExecutionPlan/AgentCall)의 U1 포함 여부
agent-redesign.md의 Orchestrator 실행 계획 타입을 U1에서 정의할까요?
- (a) **포함** — U5가 쓸 타입이지만 도메인 공유 타입이므로 U1에서 (권장)
- (b) 제외 — U5 구현 시 정의

[Answer]: (a) 포함 — U1에서 정의 — 확정
### Q8. 시간 표현 규칙
- (a) **timezone-aware datetime (여행지 로컬 타임존 명시)** — 안전 (권장)
- (b) naive datetime + 별도 timezone 필드
- (c) date + 분 단위 int (예: 540 = 09:00) — 어셈블리 연산 친화

[Answer]: (a) timezone-aware datetime (여행지 로컬 타임존) — 확정
### Q9. LLMOps 요구사항의 공식 등록
지금 추가하는 LLMOps 항목(관측 타입·TracePort·PromptRef·Eval 타입)을 requirements.md에
**NFR-7 (LLMOps)** 그룹으로 정식 등록할까요? (추적성 확보 — 권장)
- (a) **등록** (권장)
- (b) 기존 NFR-5(계측) 확장으로만 처리

[Answer]: (a) NFR-7 (LLMOps) 그룹으로 등록 — 확정 (requirements.md 반영 완료)
---

## 4. 답변 후 진행

모든 [Answer]: 작성 완료 → 산출물 3종 생성:
- `aidlc-docs/construction/u1-domain-ports/functional-design/domain-entities.md`
- `aidlc-docs/construction/u1-domain-ports/functional-design/business-logic-model.md`
- `aidlc-docs/construction/u1-domain-ports/functional-design/business-rules.md`
