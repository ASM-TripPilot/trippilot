# U1 Functional Design — Business Rules

> U1이 타입·인터페이스 수준에서 **강제하거나 준비**하는 규칙 명세.
> "강제" = 타입 시스템/생성자 검증으로 위반이 불가능. "준비" = 상위 유닛이 지킬 계약을 타입으로 표현.

---

## 1. 4대 불변식의 U1 책임 범위

| 불변식 | U1에서 강제 | 상위 유닛에 준비 |
|---|---|---|
| **INV-1** (closed-set) | `CandidatePool.poi_ids` frozenset — 생성 시 `poi_ids == {p.poi_id for p in pois}` post-init 검증 | `GateDropEvent` 타입 — U4 게이트가 드롭 계측에 사용. `polluted_scored_pois` generator — U5-P5 적대적 PBT 재료 |
| **INV-2** (솔버 검증값만) | `ItinerarySolution.solver_run` 필드 — 어느 solve_mode를 거쳤는지 기록 | `Violation` 타입 + SolverPort 계약 (None=해 없음, 체인 진행) |
| **INV-3** (소요시간 미표시) | **`TravelEstimate.to_public_dict()`가 `internal_minutes`를 구조적으로 제외** — 직렬화 경로가 분리되어 있어 실수로 노출 불가 | U5 API 스키마는 to_public_dict만 사용 (U5-P4에서 PBT 검증) |
| **INV-4** (결정론 폴백) | `ItineraryProblem.seed` 필수 필드. `TypedResult`: `is_fallback=True → value=None` post-init 검증 | `FallbackEvent` 타입 — 모든 폴백 전환은 이벤트 발행 의무 (§3) |

## 2. 타입 공통 규칙

| 규칙 | 내용 |
|---|---|
| **불변성** | 전 도메인 타입 `frozen=True, slots=True`. 컬렉션 필드는 `tuple`/`frozenset`만 (list/dict/set 금지 — `params`·`payload` 등 자유형 dict는 직렬화 가능 원시값만 허용) |
| **직렬화 왕복** | `from_dict(to_dict(x)) == x` — U5-P10, 관측·eval 타입 포함 전 타입 대상 |
| **시간** | tz-aware datetime만. naive datetime은 생성자에서 `ValueError`. 타임존 = 여행지 로컬 (1차 출시: `Asia/Seoul` 고정, 필드는 오프셋 보존) |
| **검증 위치** | 범위·정합 검증은 `__post_init__`에서 — 유효하지 않은 인스턴스는 존재 자체가 불가능 |
| **ID** | `NewType` 문자열. 교차 대입(PoiId ↔ ScheduleId)은 타입 체커가 차단 |
| **도메인 순수성** | domain·ports는 외부 패키지 import 금지 (표준 라이브러리만). CI에서 import-linter로 검증 (U1 Build and Test) |

## 3. [LLMOps] 관측 이벤트 발행 규칙 — NFR-7.1/7.2

**"침묵 실패 금지"(NFR-2.2)의 계측 버전. 아래 지점에서 이벤트 발행이 누락되면 규칙 위반.**

| 발행 지점 | 이벤트 | 의무 주체 (유닛) |
|---|---|---|
| 모든 LLM 호출 완료·실패·타임아웃 | `LlmCallRecord` (success 플래그 포함) | U4 GatewayFacade |
| 게이트에서 poi_id 드롭 발생 | `GateDropEvent` | U4 ClosedSetGate |
| 폴백 전환 (LLM→규칙, OR-Tools→Bedrock→규칙, 라우터→기본의도, 에이전트 폴백) | `FallbackEvent` | U2/U4/U5/U6 각자 |
| 솔버 실행 완료 | `SolverRunRecord` | U2 SolverFacade |

- `TypedResult.call_record`: U4의 call()은 성공·폴백 무관 LlmCallRecord를 결과에 첨부 — 소비 측이 계측 여부를 선택할 수 없게 함
- `TracePort.emit()`은 예외를 전파하지 않음 — 계측 실패 ≠ 비즈니스 실패
- 동일 요청 흐름의 모든 이벤트는 같은 `trace_id` 공유 (`ExecutionPlan.trace_id`에서 전파)
- **파생 지표 정의**: 환각률 = ΣGateDropEvent.dropped/total · 폴백률 = FallbackEvent 빈도/요청 수 · LLM 비용 = Σ(tokens×단가) · 솔버 통과율 = SolverRunRecord.violations_found=0 비율

## 4. [LLMOps] 프롬프트 버저닝 규칙 — NFR-7.3

| 규칙 | 내용 |
|---|---|
| 실체 관리 | 프롬프트는 저장소 내 `prompts/*.yaml` + git 버전 관리 (Q3 확정) |
| 참조 의무 | 모든 `LlmRequest`는 `PromptRef` 필수 — 버전 없는 LLM 호출은 타입상 불가능 |
| 버전 규칙 | semver. 의미 변화(지시 변경)=minor↑, 출력 스키마 변경=major↑, 오타 수정=patch↑ |
| eval 연결 | `EvalRun.prompt_refs`로 "이 점수는 어떤 프롬프트 버전의 것인가" 추적 — 프롬프트 변경 PR은 eval 회귀 실행이 원칙 (파이프라인 구현은 후속 유닛) |

## 5. [LLMOps] Eval 규칙 — NFR-7.4

| 규칙 | 내용 |
|---|---|
| 골든 케이스 | `EvalCase.expected`는 결정론 비교 가능 형태 (정확 일치 또는 메트릭 임계값) |
| 1차 메트릭 4종 | `hallucination_rate`(INV-1, 목표 0) · `hc_pass_rate`(솔버 검증 통과율) · `fallback_rate`(INV-4) · `retrieval_relevance`(PlanB RAG, 해당 시) |
| 실행 시점 | PR CI에서 실 LLM 호출 0 (NFR-4.5 준수) — eval 실행은 릴리스 전 게이트. U1은 타입만 제공 |

## 6. 기존 도메인 규칙 (component-methods.md에서 타입으로 승격)

| 규칙 | 타입 표현 |
|---|---|
| 파괴적 편집 확인 필수 | `EditOp.DESTRUCTIVE` 집합 + `EditCommand`가 destructive 또는 affected>1이면 `ApplyMode.CONFIRM_REQUIRED` — 도출 함수 `resolve_apply_mode(cmd)` 는 domain 내 순수 함수 |
| 가격 캐싱 금지 | `Poi.to_cacheable_dict()`가 `avg_cost` 제외 — CachePort에 저장되는 직렬화 경로에서 구조적 차단 |
| day window | 기본 09:00~21:00, 자정 초과 방문은 시작일 귀속 (`OpenHour` close>1440 허용으로 표현) |
| 예산은 소프트 제약 | `BudgetLevel`은 필터·가중치 입력일 뿐 — Violation 코드에 예산 없음 (HC1~HC4만) |
