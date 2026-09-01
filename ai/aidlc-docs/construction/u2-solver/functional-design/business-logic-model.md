# U2 Functional Design — Business Logic Model (컴포넌트 · 체인 · Fake)

> U2는 U1과 달리 **비즈니스 로직이 본체**다. 컴포넌트 6종 + 시한 인지 하이브리드 체인(AI-D07).
> 전부 결정론(시드·시계 주입) — 실 외부 API 0 (D37, 실 카카오/네이버 어댑터는 후속).

---

## 1. 모듈 레이아웃

```
src/trippilot/c2/
├── facade.py            HybridSolverFacade — 시한 인지 체인 + 관측 발행
├── constraints.py       ConstraintChecker — HC1~HC4 순수 함수
├── ortools_solver.py    OrToolsSolver — 1차 (CP-SAT/Routing)
├── llm_solver.py        LlmSolver — 2차 (LlmPort 소비, 제안→검증→수리)
├── fallback_solver.py   RuleFallbackSolver — 최후 (규칙 점수, 항상 해 반환)
├── scorer.py            build_rule_score — 결정론 규칙 점수 (시드 고정)
├── travel.py            TravelEstimator — SPEED×안전계수+버퍼 (TravelPort 구현체)
└── repair.py            RepairEngine — TIME_SHIFT_ONLY 최소 조정
```

- 의존 방향: `c2 → domain·ports` 만. c2는 tests/fakes를 모름 (주입으로만 받음).
- `ortools` 패키지는 **c2 계층에서만** import (domain 순수성 유지 — test_architecture가 계속 감시).

## 2. 컴포넌트 계약

### 2.1 HybridSolverFacade — 본체

```python
class HybridSolverFacade:
    def __init__(self, chain: Sequence[SolverPort], checker, repair,
                 clock: ClockPort, trace: TracePort, config: SolverConfig): ...

    def solve(self, problem: ItineraryProblem, deadline_ms: int) -> ItinerarySolution: ...
    def validate(self, solution: ItinerarySolution, problem: ItineraryProblem) -> list[Violation]: ...
    def repair(self, solution, violations, problem,
               policy: MinimalChangePolicy = TIME_SHIFT_ONLY) -> RepairResult: ...
    def estimate_travel(self, from_, to, mode) -> TravelEstimate: ...   # TravelEstimator 위임
```

**시한 인지 체인 (AI-D07 §1 — 유일한 신규 알고리즘 뼈대):**

```
solve(problem, deadline_ms):
  t0 = clock.monotonic_ms()
  잔여() = deadline_ms - (clock.monotonic_ms() - t0)

  for stage in [OrTools, Llm2차, RuleFallback]:
      if 잔여() < stage.required_ms():          # 진입 전 잔여 확인
          trace.emit(FallbackEvent(stage="solver", from_mode=stage, to_mode=next, reason="deadline"))
          continue                              # 스킵 — 침묵 금지
      result = stage.solve(problem, 잔여())      # 단계에도 잔여 전파 (내부 time limit로 사용)
      if result is not None and validate(result, problem) == []:
          trace.emit(SolverRunRecord(...))       # solve_mode = stage
          return result
  # RuleFallback.required_ms() == 0 이므로 여기 도달 불가 — 항상 해 반환 (INV-4)
```

- `stage.required_ms()`: OrTools = config 최소 실행분(500ms), Llm2차 = `llm_stage_timeout_ms`(2500), RuleFallback = 0.
- **반환 시각이 deadline을 초과하지 않는다** — 신규 PBT 속성 DL-P1.
- 2차 진입 트리거(기존 설계 유지): OR-Tools 해 없음 / 타임아웃 / 품질 미달(배치율 < 후보 대비 임계).

### 2.2 ConstraintChecker (constraints.py) — 순수 함수 4종

| 함수 | 검증식 (정본 §4.2) |
|---|---|
| `check_hc1` | `slot.start_at ≥ poi.open ∧ slot.end_at ≤ poi.close` (영업시간, OpenHour 자정 초과 규칙 포함) |
| `check_hc2` | `prev.end_at + estimate(prev,next).internal_minutes ≤ next.start_at` |
| `check_hc3` | 고정 블록 시각 == 입력 시각 (불변) |
| `check_hc4` | `slot ∈ day_window`, 자정 초과 활동은 시작일 귀속 |
| `check_all` | 4종 실행 → `list[Violation]` (빈 리스트 = 유효). **예산은 검사하지 않음** (소프트) |

입력은 (solution, problem, estimator)만 — I/O 없음, 완전 순수 → oracle 전수 대조 가능(U5-P1).

### 2.3 OrToolsSolver (1차)

- CP-SAT 기반: 후보=선택 변수, 시간창(interval)=HC1·HC4, 이동시간 하한=HC2, 고정 블록=상수 고정(HC3) → **위반 해가 해 공간에서 구조적으로 배제** (INV-SOLVE1).
- `solve(problem, remaining_ms)`: OR-Tools `max_time_in_seconds = min(config.or_tools_limit_ms, remaining_ms)`.
- 목적함수: Σ(선택 슬롯 score) + 예산 소프트 가중치(U5-P6 단조 대상). `random_seed = problem.seed` 고정.
- 반환 None 조건: infeasible / 타임아웃 / 품질 미달.
- **미결 #3 해소 절차**: 첫 절편 = 후보 50·500·5,000 벤치마크 → day1 예산 내 통과 시 확정.

### 2.4 LlmSolver (2차)

```
① 프롬프트 조립: problem 요약(후보 id·영업시간·고정블록·day window) — closed-set 명시
② LlmPort.invoke (timeout = llm_stage_timeout_ms, model = 경로별: sonnet-5/opus-4-8 — AI-D07 ④, 설정값)
③ 파싱 → LlmDayProposal (실패 슬롯 드롭)
④ closed-set 필터: poi_id ∉ candidates → 드롭 + GateDropEvent (INV-1)
⑤ ItinerarySolution(solve_mode=LLM) 조립 → check_all → 위반 시 repair 1회 → 재검증   # 구 BEDROCK 개명 완료 (TRIP-256 #71)
⑥ 통과 시에만 반환, 아니면 None (체인 다음으로)
```

- LLM 출력이 검증 없이 반환되는 경로 **없음** (INV-2). 프롬프트 실체·튜닝은 U4 레지스트리와 공유(FakeLlm golden으로 개발).

### 2.5 RuleFallbackSolver (최후) + scorer.py

- `build_rule_score(poi, budget_weight, seed)` — 카테고리 가중 + 인기(saved_count) 로그 정규화 + 예산 적합 − 거리 페널티 (정본 §4.3의 평점 항 대체 — 별점 소스 없음). 시드 고정 → U5-P3.
- 구성 휴리스틱(정본 §4.3 단계 1): 고정 블록 → 점수 내림차순 삽입 → HC 위반 스킵 → 빈 슬롯 허용. **항상 해 반환** (최악 = 고정 블록만 = MINIMAL).
- 지역 탐색(2-opt/or-opt)은 잔여 ≥ `local_search_min_remaining_ms`일 때만 (정본 규칙 그대로 — 시한 인지의 원형).
- > 이 규칙 점수는 **ML 후보 1순위(A-1)의 폴백** — AI-D05. 함수 삭제 금지.

### 2.6 TravelEstimator (travel.py)

- `time = dist / speeds[mode] × safety[mode] + buffer_min` (G106·AI-D07 값, config 주입).
- 거리 원천: 1차는 haversine×detour(1.3) — 실 카카오/네이버 어댑터는 후속(K-계열), Port 뒤라 무영향.
- 동일 입력 → 동일 출력 (U5-P4). U1 `TravelPort` Protocol 구현체.

### 2.7 RepairEngine (repair.py)

- TIME_SHIFT_ONLY: 위반 슬롯의 시각만 앞뒤로 밀어 해소 시도 (POI·순서 불변). HC3 고정 블록은 건드리지 않음.
- 수리 후 반드시 `check_all` 재검증 — 통과 못 하면 `RepairResult(repaired=None)`.
- warm-start regenerate: locked_slots의 start/end 불변 보존 (U5-P2 멱등).

## 3. Fake·Generator 추가 (tests/)

| 신규 | 용도 |
|---|---|
| `FakeClock` | `monotonic_ms()` + `advance(ms)` — 시한 인지 체인을 sleep 없이 테스트 (DL-P 계열) |
| `SlowSolver` | solve 중 FakeClock을 소진시키는 스텁 — 단계 스킵·deadline 검증용 |
| `llm_day_proposals()` generator | 정상 제안 생성 |
| `adversarial_llm_proposals(pool)` | 후보 밖 id·역전 시각·중복 섞은 적대적 제안 (②차 게이트 검증 — U1 `polluted_scored_pois` 패턴 재사용) |
| `solvable_problems()` generator | 해가 존재하도록 구성된 ItineraryProblem (oracle 대조용 소규모) |

## 4. 관측 발행 의무 (U1 business-rules §3 승계)

| 지점 | 이벤트 |
|---|---|
| 매 solve 완료 (모든 단계) | `SolverRunRecord(solve_mode, elapsed_ms, violations_found, repaired)` |
| 체인 단계 스킵·강등 | `FallbackEvent(stage="solver", reason="deadline"/"infeasible"/"quality")` |
| 2차 제안 중 후보 밖 id 드롭 | `GateDropEvent` |
| 2차 LLM 호출 | `LlmCallRecord` (LlmPort 소비 규칙 그대로) |
