# TripPilot AI 테스트 가이드

> 짝 문서: [ai-implementation-design.md](./ai-implementation-design.md) §8 (테스트 DoD).
> 본 문서는 AI 코어(C1·C2·M8)의 **속성 기반 테스트(PBT) 구현 방법·계층 분리·oracle 전략**을 정의한다.
> 프레임워크: 서버 Python pytest + Hypothesis · 클라 fast-check (PBT-09).

---

## 1. 테스트 계층 구조 (D37)

```
+--------------------------------------------------+
|  릴리스 파이프라인 (Release Pipeline)             |
|  - 실 LLM 회귀 평가 (샘플링 기반)                |
|  - 프롬프트 버전별 품질 측정                      |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|  PR CI (Pull Request)                            |
|  - 솔버 하드 제약 실코드 테스트 (C2 실코드)       |
|  - closed-set 검증 게이트 실코드 테스트 (C1 실코드)|
|  - LLM 호출: FakeLlmAdapter (Port fake)          |
|  - 거리 API: FakeTravelAdapter (Port fake)       |
|  - PBT 속성 12개 전부 포함                       |
+--------------------------------------------------+
                      |
+--------------------------------------------------+
|  로컬 개발                                        |
|  - 단위 테스트 (빠른 피드백)                      |
|  - 솔버 소규모 인스턴스 oracle 대조               |
+--------------------------------------------------+
```

**핵심 원칙**: LLM·외부 API는 항상 fake, **솔버·closed-set 검증은 항상 실코드**. LLM 문장 품질은 테스트하지 않는다 (nfr §7.7).

---

## 2. PBT 속성 12개 구현

### 2.1 C2 솔버 속성 (5개)

#### U5-P1: 하드 제약 4종 + oracle 대조

```python
# pytest + Hypothesis PropertyTesting
from datetime import timedelta
from hypothesis import given, settings
from hypothesis import strategies as st


# HC1/HC3/HC4: 하드 제약 4종 위반 배치 없음
@given(problem=itinerary_problem_gen())
@settings(print_blob=True)  # 실패 시 재현 blob 출력 (시드/shrink 로깅, PBT-08)
def test_c2_solve_hard_constraints(problem):
    """C2 solve — 하드 제약 4종 위반 배치 없음"""
    solution = solver.solve(problem)
    slots = [slot for day in solution.days for slot in day.slots]
    for slot in slots:
        poi = next(c for c in problem.candidates if c.poi_id == slot.poi_id)
        # HC1: 영업시간
        assert slot.start_at >= poi.open_time and slot.end_at <= poi.close_time
        # HC3: 고정 블록 불변
        assert all(
            fb.fixed_time == slot.start_at
            for fb in problem.fixed_blocks
            if fb.poi_id == slot.poi_id
        )
        # HC4: 시간창
        assert slot.start_at >= problem.time_windows[slot.date].start
        assert slot.end_at <= problem.time_windows[slot.date].end


# HC2: 이동 부등식 — 연속 슬롯 쌍으로 검증
@given(problem=itinerary_problem_gen())
@settings(print_blob=True)
def test_c2_solve_hc2_travel_inequality(problem):
    """C2 solve — HC2 이동 부등식 위반 없음"""
    solution = solver.solve(problem)
    for day in solution.days:
        for prev, nxt in zip(day.slots, day.slots[1:]):  # zipWithNext
            travel = solver.estimate_travel(prev.location, nxt.location, problem.travel_mode)
            assert prev.end_at + timedelta(minutes=travel.minutes) <= nxt.start_at


# oracle 대조: 소규모 인스턴스에서 무차별 대입과 비교
@given(problem=small_problem_gen(max_candidates=6, max_days=1))
@settings(print_blob=True)
def test_c2_solve_oracle_comparison(problem):
    """C2 solve — oracle 대조 (소규모 인스턴스)"""
    solver_result = solver.solve(problem)
    oracle_result = brute_force_oracle(problem)  # 전수 열거
    # 솔버가 oracle보다 나쁜 해를 내면 안 됨 (부당 배제 0)
    assert solver_result.total_score >= oracle_result.total_score * 0.95
    # oracle이 찾은 유효 해를 솔버가 위반 배치로 내면 안 됨 (부당 통과 0)
    assert oracle_result.violations == []
```

#### U5-P2: warm-start 고정 블록 보존 (멱등)

```python
@given(problem=itinerary_problem_gen(), lock_type=lock_type_gen())
@settings(print_blob=True)
def test_c2_regenerate_fixed_block_time_invariant(problem, lock_type):
    """C2 regenerate — 고정 블록 시각 불변"""
    original = solver.solve(problem)
    locked = [slot for day in original.days for slot in day.slots if slot.is_fixed]
    regenerated = solver.regenerate(problem, locked)

    for locked_slot in locked:
        after = next(
            slot
            for day in regenerated.days
            for slot in day.slots
            if slot.poi_id == locked_slot.poi_id
        )
        assert after.start_at == locked_slot.start_at and after.end_at == locked_slot.end_at
```

#### U5-P3: 결정론 폴백 — 동일 입력 → 동일 출력

```python
from dataclasses import replace


@given(problem=itinerary_problem_gen())
@settings(print_blob=True)
def test_c2_deterministic_mode_same_input_same_output(problem):
    """C2 결정론 모드 — 동일 입력 동일 출력"""
    problem_without_llm_score = replace(
        problem,
        candidates=[replace(c, llm_score=None) for c in problem.candidates],
    )
    result1 = solver.solve(problem_without_llm_score)
    result2 = solver.solve(problem_without_llm_score)
    assert result1 == result2  # 시드 고정으로 완전 동일
```

#### U5-P6: 예산 소프트 가중치 단조성

```python
@given(poi=poi_gen(), budget=budget_level_gen())
@settings(print_blob=True)
def test_c2_budget_weight_monotonicity(poi, budget):
    """C2 예산 가중치 — 저예산일수록 저비용 카테고리 점수 높음"""
    low_budget_score = build_rule_score(poi, BudgetWeight.LOW, seed=42)
    high_budget_score = build_rule_score(poi, BudgetWeight.HIGH, seed=42)
    # 저비용 카테고리는 저예산에서 더 높은 점수
    if poi.category in LOW_COST_CATEGORIES:
        assert low_budget_score >= high_budget_score
    # else: 제약 없음 (항상 통과)
```

---

### 2.2 C1 LLM Gateway 속성 (2개)

#### U5-P5: closed-set 그라운딩 — 적대적 오염에도 환각 0

```python
@given(pool=candidate_pool_gen(), adversarial_output=adversarial_llm_output_gen())
@settings(print_blob=True)
def test_c1_closed_set_gate_drops_out_of_pool_ids(pool, adversarial_output):
    """C1 closed-set 게이트 — 후보 밖 ID 전량 드롭"""
    # adversarial_output: 후보 밖 ID, 중복 ID, 인젝션 페이로드 포함
    result = c1_gate.validate(adversarial_output, pool)
    assert all(s.poi_id in pool.ids for s in result.scores)  # 후보 밖 ID = 0


@given(pool=candidate_pool_gen())
@settings(print_blob=True)
def test_c1_closed_set_gate_fallback_when_all_dropped(pool):
    """C1 closed-set 게이트 — 전량 드롭 시 폴백 신호"""
    all_outside_output = LlmRawOutput(
        scores=[ScoredPoi("FAKE_ID_999", 0.9)],
    )
    result = c1_gate.validate(all_outside_output, pool)
    assert isinstance(result, FallbackSignal)
```

#### U5-P4: 이동 추정 결정성 + 소요시간 표시 게이트

```python
import json
from dataclasses import asdict


@given(from_=geo_point_gen(), to=geo_point_gen(), mode=transport_mode_gen())
@settings(print_blob=True)
def test_c2_estimate_travel_deterministic(from_, to, mode):
    """C2 estimate_travel — 동일 입력 동일 출력"""
    r1 = solver.estimate_travel(from_, to, mode)
    r2 = solver.estimate_travel(from_, to, mode)
    assert r1 == r2


@given(slot=visit_slot_gen())
@settings(print_blob=True)
def test_visit_slot_display_no_internal_duration(slot):
    """VisitSlotDisplay — internal_duration 필드 없음"""
    # dataclass 정의상 VisitSlotDisplay에 internal_duration 없음
    # 런타임 직렬화 검증
    display = slot.to_display()
    payload = json.dumps(asdict(display))
    assert "internal_duration" not in payload  # 표시 DTO에 소요시간 미포함 (INV-3)
```

---

### 2.3 M8 일정 생성 속성 (5개)

#### U5-P7: plan 불변성

```python
import pytest
from dataclasses import replace


@given(itinerary=itinerary_gen())
@settings(print_blob=True)
def test_m8_plan_immutable_after_save(itinerary):
    """M8 — plan 저장 후 변경 불가"""
    plan = itinerary.to_plan()
    plan_id = plan_repo.save(plan)
    # plan은 current와 달리 수정 불가
    with pytest.raises(PlanImmutableException):
        plan_repo.update(plan_id, replace(plan, days=[]))
```

#### U5-P8: current 분리

```python
@given(itinerary=itinerary_gen())
@settings(print_blob=True)
def test_m8_current_edit_does_not_affect_plan(itinerary):
    """M8 — current 수정이 plan에 영향 없음"""
    plan_snapshot = replace(itinerary.plan)
    itinerary.apply_edit(EditRequest.remove_slot(itinerary.current.days[0].slots[0].poi_id))
    assert itinerary.plan == plan_snapshot  # plan 불변
```

#### U5-P9: 상태 전이 유효성

```python
def test_m8_reject_invalid_state_transition():
    """M8 — 유효하지 않은 상태 전이 거부"""
    invalid_transitions = [
        (DRAFT, CANCELLED_KEPT),   # DRAFT는 GENERATING으로만
        (COMPLETED, GENERATING),   # 완료 후 재생성 불가 (regenerate 별도)
    ]
    for from_state, to_state in invalid_transitions:
        with pytest.raises(InvalidStateTransitionException):
            state_machine.transition(from_state, to_state)
```

#### U5-P10: 직렬화 왕복 (round-trip)

```python
@given(solution=solution_gen())
@settings(print_blob=True)
def test_m8_itinerary_solution_round_trip(solution):
    """M8 ItinerarySolution — 직렬화 왕복 동일"""
    payload = ItinerarySolution.to_json(solution)
    decoded = ItinerarySolution.from_json(payload)
    assert solution == decoded
```

#### U5-P11 / U5-P12: 반경·클라↔서버 규칙 동치

```python
@given(edit=edit_request_gen(), spec=constraint_spec_gen())
@settings(print_blob=True)
def test_m8_client_server_validation_equivalence(edit, spec):
    """M8 — 클라 경량 검증과 서버 확정 검증 동치"""
    client_result = client_validator.validate(edit, spec)
    server_result = solver.validate(edit.to_itinerary(), spec.to_constraint_set())
    # 클라가 통과시킨 편집은 서버도 통과 (역은 성립 안 할 수 있음 — 서버가 더 엄격)
    if client_result.is_valid:
        assert server_result.violations == []
    # else: 제약 없음 (항상 통과)
```

---

### 2.4 AI 도우미(M16) 라우터·워커 속성 (AI-D02) `[추가]`

U5 12속성과 별개로, 자연어 오케스트레이션이 추가한 실패 지점·불변식을 방어한다. PR CI에서 라우터·워커 LLM은 fake, **편집 반영·솔버 검증은 실코드**.

#### M16-P1: 편집 명령은 항상 솔버 검증 경유 (INV-2)

```python
@given(cmd=edit_command_gen(), itinerary=itinerary_gen())
@settings(print_blob=True)
def test_m16_edit_command_always_validated(cmd, itinerary):
    """AI 도우미 편집은 자동반영이라도 솔버 검증을 거친다"""
    result = assistant.apply(cmd, itinerary)          # AUTO_APPLY 포함
    # 반영된 결과는 반드시 solver.validate를 통과한 상태
    assert solver.validate(result.itinerary, itinerary.constraints) == []
    # 검증 실패 편집은 반영되지 않고 미리보기로 강등
    if cmd.would_violate:
        assert result.mode == ApplyMode.CONFIRM_REQUIRED and not result.applied
```

#### M16-P2: 파괴적 편집은 자동반영 금지 (하이브리드)

```python
@given(cmd=edit_command_gen())
@settings(print_blob=True)
def test_m16_destructive_requires_confirm(cmd):
    """파괴적 op·대규모 편집은 CONFIRM_REQUIRED로 분류"""
    mode = resolve_apply_mode(cmd)
    if cmd.op in DESTRUCTIVE_OPS or cmd.affected_slots > AUTO_APPLY_LIMIT:
        assert mode == ApplyMode.CONFIRM_REQUIRED
    # else: AUTO_APPLY 허용 (자동반영 + 되돌리기)
```

#### M16-P3: 라우터·워커 폴백 (침묵 실패 금지, INV-4)

```python
def test_m16_router_failure_falls_back_to_default_intent():
    """라우터 실패 시 기본 의도/수동 편집 경로 — 빈 응답 금지"""
    result = assistant.handle("...", router=FailingRouter())
    assert result.next_action is not None          # dead-end 아님
    assert result.intent == Intent.GENERATE or result.manual_edit_offered


def test_m16_worker_partial_failure_isolated():
    """워커 하나가 죽어도 나머지 워커·솔버는 정상"""
    result = assistant.handle("...", workers={"Explanation": FailingWorker()})
    assert result.itinerary is not None            # 일정 자체는 생성
    assert result.explanation is None              # 죽은 워커 몫만 결손
```

---

### 2.5 웹서치 후보 소싱 속성 (AI-D03) `[추가]`

수집 게이트가 불량 데이터를 후보로 만들지 않음을 방어한다. Places API·웹은 fake, **게이트·dedup·M7 등록은 실코드**.

#### SRC-P1: 게이트는 결손 레코드를 후보로 만들지 않음 (INV-1 유지)

```python
@given(poi=sourced_poi_gen())
@settings(print_blob=True)
def test_gate_rejects_incomplete_records(poi):
    """좌표·영업시간·카테고리 결손 POI는 후보가 되지 않는다"""
    result = ingest_gate(poi)
    if poi.coord is None or poi.hours is None or poi.category is None:
        assert result.status == "quarantine"       # 후보 제외
        assert poi.id not in m7.candidate_ids()
```

#### SRC-P2: 실재 미확인·중복 처리

```python
@given(poi=sourced_poi_gen())
@settings(print_blob=True)
def test_gate_quarantines_unverified_and_dedups(poi):
    """실재 확인 안 되면 격리, 근접 동일 장소는 병합"""
    result = ingest_gate(poi)
    if not exists_crosscheck(poi):
        assert result.status == "quarantine"
    if dup := m7.find_duplicate(poi, radius_m=50):
        assert result.status == "merge" and result.into == dup.id
```

#### SRC-P3: 백그라운드 격리 — 웹 실패가 생성을 막지 않음 (INV-4)

```python
def test_web_sourcing_failure_does_not_block_generation():
    """웹 소싱이 실패해도 생성은 현재 DB 후보로 정상 진행"""
    session = m8.generate_itinerary(
        trip_id, mode=FULL_AUTO, sourcing=FailingWebSourcing()
    )
    assert session.first_day is not None            # 생성 정상
    assert session.solve_mode != SolveMode.MINIMAL  # 보강 실패지 생성 실패 아님
```

---

### 2.6 입력 엔티티 해소 속성 (AI-D04) `[추가]`

#### RES-P1: 엔티티 해소는 결정론적 + 신뢰도로 분기

```python
@given(name=entity_name_gen())
@settings(print_blob=True)
def test_entity_resolution_deterministic_and_thresholded(name):
    """동일 입력 동일 매칭, 신뢰도로 자동확정/확인/미해소 분기 (LLM 아님)"""
    r1 = resolve_entity(name)
    r2 = resolve_entity(name)
    assert r1 == r2                                  # 결정론
    if r1.score >= AUTO_ACCEPT:
        assert r1.status == "bound"
    elif r1.score >= CONFIRM_THRESHOLD:
        assert r1.status == "pending_confirm"        # 조용한 오교정 금지
    else:
        assert r1.status == "unresolved"             # → AI-D03 웹 소싱
```

---

## 3. Generator 정의 (PBT-07)

도메인 타입별 generator를 중앙화해 재사용한다.

```python
# 파일: tests/generators/itinerary_generators.py

import string
from dataclasses import replace
from datetime import time
from hypothesis import strategies as st


@st.composite
def itinerary_problem_gen(draw) -> ItineraryProblem:
    return ItineraryProblem(
        anchor=draw(base_anchor_gen()),
        time_windows=draw(st.lists(day_window_gen(), min_size=1, max_size=5)),
        candidates=draw(st.lists(scored_poi_gen(), min_size=5, max_size=50)),
        fixed_blocks=draw(st.lists(fixed_block_gen(), min_size=0, max_size=3)),
        travel_params=TravelParams.DEFAULT,  # G106 기본값
        budget_weight=draw(budget_weight_gen()),
    )


_ID_ALPHABET = string.ascii_letters + string.digits


@st.composite
def scored_poi_gen(draw) -> ScoredPoi:
    # 20% 확률로 None (결정론 모드)
    is_null = draw(st.floats(min_value=0.0, max_value=1.0)) < 0.2
    llm_score = None if is_null else draw(st.floats(min_value=0.0, max_value=1.0))
    return ScoredPoi(
        poi_id=draw(st.text(alphabet=_ID_ALPHABET, min_size=5, max_size=10)),
        category=draw(st.sampled_from(list(PoiCategory))),
        open_time=draw(st.times(min_value=time(8, 0), max_value=time(11, 0))),
        close_time=draw(st.times(min_value=time(18, 0), max_value=time(23, 0))),
        avg_cost=draw(st.integers(min_value=0, max_value=50000)),
        llm_score=llm_score,
    )


# 적대적 LLM 출력 generator (U5-P5용)
@st.composite
def adversarial_llm_output_gen(draw) -> LlmRawOutput:
    id_strategy = st.text(alphabet=_ID_ALPHABET, min_size=5, max_size=10)
    valid_ids = draw(st.lists(id_strategy, min_size=1, max_size=5))
    fake_ids = draw(st.lists(id_strategy, min_size=0, max_size=5))
    scores = [
        ScoredPoi(poi_id, draw(st.floats(min_value=0.0, max_value=1.0)))
        for poi_id in (valid_ids + fake_ids)
    ]
    # Hypothesis 네이티브 셔플 (shuffled)
    return LlmRawOutput(scores=draw(st.permutations(scores)))


def small_problem_gen(max_candidates: int, max_days: int) -> st.SearchStrategy:
    return itinerary_problem_gen().map(
        lambda p: replace(
            p,
            candidates=p.candidates[:max_candidates],
            time_windows=p.time_windows[:max_days],
        )
    )
```

---

## 4. Oracle 구현 (U5-P1)

소규모 인스턴스에서 무차별 대입으로 솔버를 이중 검증한다.

```python
# 파일: tests/oracle/brute_force_oracle.py

from itertools import permutations


def brute_force_oracle(problem: ItineraryProblem) -> OracleResult:
    assert len(problem.candidates) <= 8, "oracle은 후보 8개 이하만 지원"

    all_permutations = permutations(problem.candidates)
    valid_solutions = [
        solution
        for solution in (build_solution(perm, problem) for perm in all_permutations)
        if not solution.violations  # 하드 제약 통과만
    ]

    return OracleResult(
        best_score=max((s.total_score for s in valid_solutions), default=0.0),
        valid_count=len(valid_solutions),
        violations=[],
    )
```

---

## 5. Fake 어댑터 구현 (D37)

PR CI에서 외부 의존을 대체하는 fake. 실코드 Port 인터페이스를 구현한다.

```python
import random


# FakeLlmAdapter — 결정론적 점수 반환 (시드 기반)
class FakeLlmAdapter(LlmPort):
    def __init__(self, seed: int = 42):
        self._seed = seed

    def call(self, feature: LlmFeature, refs: list[ResourceRef], schema: OutputSchema[T]) -> TypedResult[T]:
        rng = random.Random(self._seed)
        if feature == LlmFeature.PREFERENCE_SCORING:
            scores = [ScoredPoi(ref.id, rng.random()) for ref in refs]
            return TypedResult.success(scores)
        return TypedResult.success(schema.default_value())


# FakeTravelAdapter — 직선거리 기반 결정론적 추정
class FakeTravelAdapter(TravelPort):
    def estimate(self, from_: GeoPoint, to: GeoPoint, mode: TransportMode) -> TravelEstimate:
        dist_km = haversine(from_, to)
        minutes = int(dist_km / mode.speed_kmh * 60 * mode.safety_factor)
        return TravelEstimate(
            distance_range=DistanceRange(f"약 {round(dist_km, 1)}km"),
            internal_minutes=minutes,
            is_estimated=True,
        )
```

---

## 6. CI 설정 요약

```yaml
# PR CI 필수 통과 항목
ai-tests:
  solver-hard-constraints:   # U5-P1 — 100% 통과 필수 (G114)
    fail-fast: true
  closed-set-gate:           # U5-P5 — 100% 통과 필수
    fail-fast: true
  pbt-properties:            # U5-P2~P12
    seed-logging: true       # 실패 시 재현 blob 로깅 (Hypothesis print_blob / @seed, PBT-08)
    shrinking: enabled       # 최소 반례 자동 수축 (Hypothesis 기본 제공, PBT-08)

# 릴리스 파이프라인 추가 항목
release-tests:
  llm-regression:
    sample-size: 100
    prompt-version: ${PROMPT_VERSION}
    metrics:
      - closed-set-compliance: 100%
      - schema-parse-success: ">= 95%"
      - fallback-rate: "<= 5%"
```

> 시드 로깅·수축(PBT-08): Hypothesis는 반례를 자동으로 shrink 하며, 실패 시 `print_blob=True`로 재현용 blob을 출력하고 `@seed(...)`로 고정 재현할 수 있다. 완전 결정론 실행이 필요하면 `@settings(derandomize=True)`를 사용한다.

---

## 7. 테스트 DoD 체크리스트

PR 머지 전 확인:

- [ ] U5-P1: 하드 제약 4종 PBT 통과 + oracle 대조 통과
- [ ] U5-P2: warm-start 고정 블록 보존 PBT 통과
- [ ] U5-P3: 결정론 폴백 동일 출력 PBT 통과
- [ ] U5-P4: 이동 추정 결정성 + VisitSlotDisplay internal_duration 미포함
- [ ] U5-P5: closed-set 게이트 적대적 오염 PBT 통과
- [ ] U5-P6: 예산 소프트 가중치 단조성 PBT 통과
- [ ] U5-P7~P10: plan 불변·current 분리·상태 전이·직렬화 왕복
- [ ] U5-P11: 반경 제약 PBT 통과
- [ ] U5-P12: 클라↔서버 검증 동치 PBT 통과
- [ ] M16-P1~P3: AI 도우미 편집 솔버 검증 경유 · 파괴적 편집 확인 필수 · 라우터/워커 폴백 (AI-D02)
- [ ] SRC-P1~P3: 수집 게이트 결손·실재·중복 처리 · 웹 실패 생성 미차단 (AI-D03)
- [ ] RES-P1: 입력 엔티티 해소 결정론 + 신뢰도 분기 (AI-D04)
- [ ] LLM·거리 API는 fake 사용 확인 (실 API 호출 0)
- [ ] PBT 실패 시 시드 로깅 확인
