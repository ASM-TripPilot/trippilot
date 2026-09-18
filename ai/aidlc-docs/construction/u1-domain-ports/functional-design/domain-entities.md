# U1 Functional Design — Domain Entities

> **확정 규칙 (플랜 Q4/Q8)**: 모든 도메인 타입은 `@dataclass(frozen=True, slots=True)` + `to_dict()/from_dict()` 직렬화 쌍.
> 시간은 timezone-aware `datetime` (여행지 로컬 타임존). domain은 외부 의존 0 (표준 라이브러리만).

---

## 0. 공통 (domain/common.py)

| 타입 | 정의 | 불변식 |
|---|---|---|
| `PoiId` | `NewType('PoiId', str)` | 비어있지 않음. M7 정본의 유일 키 |
| `ScheduleId` / `UserId` / `TraceId` | `NewType(..., str)` | — |
| `GeoPoint` | `lat: float, lng: float` | `-90≤lat≤90`, `-180≤lng≤180`. frozen |
| `BudgetLevel` | Enum: `LOW / MID / HIGH` | 필터 기준: LOW≤15000, MID≤40000, HIGH=무제한 |
| `TransportMode` | Enum: `WALK / PUBLIC / CAR` | 반경 기준: 2.0 / 10.0 / 20.0 km |

## 1. POI (domain/poi.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `PoiCategory` | Enum: 경계 8종 `FOOD / CAFE / SIGHT / NIGHT_VIEW / NATURE / CULTURE / ACTIVITY / SHOPPING` + 내부 전용 `STAY` — 정본 `ai/src/trippilot/domain/poi.py` | **정정**: `ETC` 폐기(TRIP-278 #93), 경계 3종 추가(TRIP-281 #113). 앞 8종은 백엔드 `/internal/pois` read 포트가 내보내는 경계 코드와 값·집합이 동일하다(한↔영 매핑은 백엔드가 수행) |
| `DataQuality` | Enum: `FULL / PARTIAL / MINIMAL` | MINIMAL은 후보 풀 제외 (M7 필터) |
| `PoiSource` | Enum: `SEED / PLACES_API / WEB` | WEB은 confidence 필수 |
| `OpenHour` | `day_of_week: int(0~6), open_min: int, close_min: int` | `0≤open_min<close_min≤1440+α` (자정 초과 허용, 시작일 귀속) |
| `Poi` | `poi_id, name, category, coord: GeoPoint, open_hours: tuple[OpenHour,...], avg_cost: int \| None, rating: float \| None, quality: DataQuality, source: PoiSource, confidence: float \| None` | `avg_cost=None` → 예산 필터 통과. **가격은 캐싱 금지 대상 필드** |

## 2. Itinerary (domain/itinerary.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `TimeWindow` | `start: datetime, end: datetime` | tz-aware. `start < end`. 기본 day window 09:00~21:00 |
| `FixedBlock` | `poi_id, window: TimeWindow, reason: str` | HC3: 어셈블리가 시각 변경 불가 |
| `VisitSlot` | `poi_id, start_at: datetime, end_at: datetime, stay_min: int, score: float, is_llm_score: bool` | HC1/HC4 대상. tz-aware |
| `DaySolution` | `date: date, slots: tuple[VisitSlot,...], fixed_blocks: tuple[FixedBlock,...]` | slots 시간순 정렬 |
| `ItineraryProblem` | `schedule_id, days: tuple[date,...], candidates: tuple[ScoredPoi,...], fixed_blocks, budget: BudgetLevel, transport: TransportMode, day_window: TimeWindow, seed: int` | `candidates ⊆ CandidatePool` (INV-1). `seed` 고정 → 결정론(INV-4) |
| `ItinerarySolution` | `schedule_id, days: tuple[DaySolution,...], is_fallback: bool, solve_mode: SolveMode, assembly_run: AssemblyRunRecord \| None` | 반환 전 HC1~HC4 통과 필수 (INV-2) |
| `SolveMode` | Enum: `OR_TOOLS / LLM / RULE_FALLBACK / MINIMAL` (정본 `ai/src/trippilot/domain/itinerary.py`) | LLM 이라도 HC 검증 후에만 반환(코드 docstring 과 같은 표현). **정정**: 구 `BEDROCK` → `LLM` 개명 완료 (TRIP-256 #71, 2026-08-04 — 벤더 중립 AI-D06) |
| `Violation` | `code: str(HC1~HC4), slot_ref: PoiId \| None, detail: str` | 빈 리스트 = 유효 |

## 3. Travel (domain/travel.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `TravelEstimate` | `distance_km_range: tuple[float, float], internal_minutes: int, is_estimated: bool, source: str` | **INV-3: `internal_minutes`는 `to_public_dict()`에서 제외** (거리만 노출). 결정론 (U5-P4) |

## 4. Trigger (domain/trigger.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `TriggerKind` | Enum: `WEATHER / CLOSURE / DELAY / MANUAL` | — |
| `TriggerParams` | `kind, schedule_id, affected_date, payload: dict` | payload는 직렬화 가능 원시값만 |
| `TriggerEvalResult` | `should_replan: bool, scope: ReplanScope, reason: str` | — |
| `ReplanScope` | Enum: `FULL_DAY / PARTIAL_SLOTS / NONE` | — |

## 5. Edit (domain/edit.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `EditOp` | Enum: `ADD_SLOT / REMOVE_SLOT / MOVE_SLOT / REPLACE_SLOT / REORDER_DAY / CLEAR_DAY / REPLAN` | `DESTRUCTIVE = {REMOVE_SLOT, CLEAR_DAY, REORDER_DAY, REPLAN}` |
| `EditCommand` | `op: EditOp, params: dict, affected_slots: tuple[PoiId,...]` | destructive or `len(affected_slots)>1` → CONFIRM_REQUIRED |
| `ApplyMode` | Enum: `AUTO_APPLY / CONFIRM_REQUIRED` | — |
| `Dispatch` | `intent: str, slots: dict, agent: AgentKind, apply_mode: ApplyMode` | 라우터 실패 → `Dispatch.default_fallback()` |

## 6. LLM 결과 (domain/llm.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `ScoredPoi` | `poi_id, score: float, is_llm_score: bool` | `poi_id ∈ candidate_pool` (INV-1, 게이트가 강제) |
| `TypedResult[T]` | `value: T \| None, is_fallback: bool, error: str \| None, call_record: LlmCallRecord \| None` | `is_fallback=True → value=None`. **성공/폴백 무관 call_record 첨부** (NFR-7.1) |
| `CandidatePool` | `poi_ids: frozenset[PoiId], pois: tuple[Poi,...], generated_at: datetime` | frozenset O(1) 멤버십. `poi_ids == {p.poi_id for p in pois}` |

## 7. 에이전트 실행 (domain/execution.py) — agent-redesign.md 반영

| 타입 | 필드 | 불변식 |
|---|---|---|
| `AgentKind` | Enum: `SCHEDULE / PLANB / REFLECT / EDIT / ORCHESTRATOR_FAST` | — |
| `AgentCall` | `agent: AgentKind, task: str, params: dict` | — |
| `ExecutionStep` | `agents: tuple[AgentCall,...], timeout_sec: float` | step 내 병렬, step 간 순차 |
| `ExecutionPlan` | `steps: tuple[ExecutionStep,...], trace_id: TraceId` | trace_id로 전 에이전트 관측 이벤트 연결 |

## 8. [LLMOps] 관측 (domain/observability.py) — NFR-7.1

모든 이벤트 공통 필드: `trace_id: TraceId, occurred_at: datetime, component: str`

| 타입 | 고유 필드 | 용도 |
|---|---|---|
| `LlmCallRecord` | `feature: str, model_id: str, prompt_ref: PromptRef, input_tokens: int, output_tokens: int, latency_ms: int, success: bool, agent: AgentKind \| None` | NFR-5.1 비용 계측. 비용 계산은 소비 측(토큰×단가) — 단가는 도메인에 안 둠 |
| `FallbackEvent` | `stage: str(llm/assembly/router/agent), from_mode: str, to_mode: str, reason: str` | NFR-5.4 폴백률. INV-4 침묵 실패 금지 증빙 |
| `GateDropEvent` | `feature: str, dropped_ids: tuple[PoiId,...], total_count: int, dropped_count: int` | INV-1 환각률 = dropped/total 지표화 |
| `AssemblyRunRecord` | `solve_mode: SolveMode, elapsed_ms: int, violations_found: int, repaired: bool` | 어셈블리 통과율·5초 게이트 계측 |
| `TraceEvent` | = `LlmCallRecord \| FallbackEvent \| GateDropEvent \| AssemblyRunRecord` (Union) | TracePort.emit() 인자 타입 |

## 9. [LLMOps] 프롬프트 (domain/prompt.py) — NFR-7.3

| 타입 | 필드 | 불변식 |
|---|---|---|
| `PromptRef` | `prompt_id: str, version: str, feature: str` | prompt_id = 저장소 내 파일 경로 (예: `prompts/preference_scoring.yaml`). version = semver 문자열. 실체는 파일 + git 관리 |

## 10. [LLMOps] Eval (domain/evals.py) — NFR-7.4

| 타입 | 필드 | 용도 |
|---|---|---|
| `EvalCase` | `case_id: str, feature: str, input_payload: dict, expected: dict, tags: tuple[str,...]` | 골든 데이터셋 1건 |
| `EvalScore` | `metric: str, value: float, passed: bool` | metric 예: `hallucination_rate`(INV-1), `hc_pass_rate`, `fallback_rate`, `retrieval_relevance` |
| `EvalRun` | `run_id: str, prompt_refs: tuple[PromptRef,...], model_id: str, executed_at: datetime, case_results: tuple[tuple[str, tuple[EvalScore,...]],...]` | 프롬프트 버전 × 모델 조합의 회귀 결과. PromptRef로 버저닝과 연결 |

---

## 직렬화 규칙 (U5-P10)

- 모든 타입: `to_dict() -> dict` / `classmethod from_dict(d) -> Self`. `from_dict(to_dict(x)) == x` (PBT로 검증)
- datetime → ISO 8601 문자열(오프셋 포함), Enum → `.value`, frozenset/tuple → list
- `TravelEstimate`만 예외적으로 `to_public_dict()` 별도 제공 — `internal_minutes` 제외 (INV-3)
