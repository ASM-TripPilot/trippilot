"""TRIP-1176 — OR 단계 완전 힌트 + 용량 컷 + 결정론 시간 한도.

배경(TRIP-1160 QA 6회차): 서울 첫 호출의 36%(실 LLM 점수 22호출 중 8)에서 OR 단계가
실행가능한 그리디 해가 있는데도 3초 안에 FEASIBLE 조차 못 냈다. 시간이 모자란 것이 아니라
① 힌트가 visit=1·start 만이라(3,658 변수 중 10개) CP-SAT 이 ~20ms 만에 힌트를 버렸고
② 모델 상계가 하루 용량을 몰라 '많이 방문' 가지로 갔다. 벽시계 한도라 같은 입력이 부하에
따라 다른 해·None 을 냈다(결정론 위반).

증명하는 것:
  ① 주 탐색의 힌트는 **모든 변수**를 덮고(소프트 항 보조 변수 포함) 그 자체로 실행가능하다
  ② 경로 완성이 실패하는 분기(그리디 순서가 모델과 어긋남)에서도 자기루프 아크를 다시
     힌트하지 않는다 — 이중 힌트는 MODEL_INVALID
  ③ 실 덤프(첫 3초 해 없음 인스턴스): 첫 시도에 해·HC 위반 0·같은 입력 2회 동일 해
  ④ 용량 컷은 중복 제약이다 — 소형 인스턴스(핀 포함 변형)에서 최적값을 바꾸지 않는다
  ⑤ 창 시작에 핀된 첫 방문(TRIP-1175 앵커 면제)을 컷이 잘라내지 않는다
  ⑥ 몰아 재시도(TRIP-907)의 결정론 한도는 1차 한도의 고정 배수다(벽시계 상한과 무관)
  ⑦ 그리디가 빈 날이면 힌트를 걸지 않는다 — 전-0 힌트는 모델과 모순이고 불완전하다
  ⑧ 벽시계 백스톱이 결정론 한도보다 먼저 탐색을 끊으면 경고로 남긴다(결정론 위반 관측)
"""

from __future__ import annotations

import json
from contextlib import contextmanager, nullcontext
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st
from ortools.sat.python import cp_model

from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.constraints import check_all
from trippilot.assembly_engine.ortools_assembler import OrToolsAssembler
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, SolveMode, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

from tests.generators.assembly import assembly_setups

_KST = timezone(timedelta(hours=9))
_CFG = AssemblyConfig(or_tools_limit_ms=1000, or_tools_min_ms=50)
_EST = TravelEstimator(_CFG)
_FIXTURES = Path(__file__).parent / "fixtures" / "or_full_hint"
_OK = (cp_model.OPTIMAL, cp_model.FEASIBLE)
_REAL_SOLVE = cp_model.CpSolver.Solve
_LOGGER = "trippilot.assembly_engine.ortools_assembler"


@contextmanager
def _solves():
    """CpSolver.Solve 호출마다 모델 힌트·상태·목적값을 적는다.

    completion=True 는 경로 완성용 보조 풀이(가정 리터럴로 경로를 건 풀이)다.
    """
    log: list = []

    def spy(self, model, *args, **kwargs):
        status = _REAL_SOLVE(self, model, *args, **kwargs)
        proto = model.Proto()
        log.append(SimpleNamespace(
            completion=len(proto.assumptions) > 0,
            hint_vars=list(proto.solution_hint.vars),
            n_vars=len(proto.variables),
            invalid=model.Validate(),
            status=status,
            objective=self.ObjectiveValue() if status in _OK else None,
            det=self.parameters.max_deterministic_time,
            model=model,
        ))
        return status

    with patch.object(cp_model.CpSolver, "Solve", spy):
        yield log


def _hint_is_feasible(model: cp_model.CpModel) -> bool:
    """힌트 값으로 변수를 전부 고정해도 풀리는가 = 힌트 자체가 해다."""
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.fix_variables_to_their_hinted_value = True
    solver.parameters.max_time_in_seconds = 10.0
    return solver.Solve(model) in _OK


def _poi(pid: str, cat: PoiCategory, lat: float, lng: float,
         hours: tuple[OpenHour, ...] = ()) -> Poi:
    return Poi(PoiId(pid), pid, cat, GeoPoint(lat, lng), hours,
               None, None, DataQuality.FULL, PoiSource.SEED, None)


def _problem(pois, *, days, fixed=(), anchor=None, end_hour=21, end_min=0, seed=7):
    d0 = days[0]
    return ItineraryProblem(
        schedule_id=ScheduleId("s-1176"), days=tuple(days),
        candidates=tuple(ScoredPoi(p.poi_id, 0.9 - 0.05 * i, False)
                         for i, p in enumerate(pois) if p.poi_id not in
                         {fb.poi_id for fb in fixed}),
        fixed_blocks=tuple(fixed), budget=BudgetLevel.MID, transport=TransportMode.PUBLIC,
        day_window=TimeWindow(datetime(d0.year, d0.month, d0.day, 9, 0, tzinfo=_KST),
                              datetime(d0.year, d0.month, d0.day, end_hour, end_min,
                                       tzinfo=_KST)),
        seed=seed, anchor=anchor)


def _main(log):
    """주 탐색 풀이(보조 풀이 제외)만."""
    return [r for r in log if not r.completion]


# ── ① 완전 힌트 — 소프트 항 보조 변수까지 ──────────────────────


def test_main_search_hint_covers_every_variable_and_is_a_solution() -> None:
    """FOOD(식사 항 b·r)·카테고리 초과(catx, 2일 → 공정 몫 3 < SIGHT 5)를 다 태운다."""
    cats = [PoiCategory.SIGHT] * 5 + [PoiCategory.FOOD] * 3
    pois = [_poi(f"h{i}", c, 37.751 + 0.004 * i, 128.876) for i, c in enumerate(cats)]
    index = {p.poi_id: p for p in pois}
    problem = _problem(pois, days=(date(2026, 8, 5), date(2026, 8, 6)))

    with _solves() as log:
        result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=4000)

    assert result is not None and check_all(result, problem, index, _EST) == []
    mains = _main(log)
    assert mains
    for r in mains:
        assert r.invalid == ""
        assert len(r.hint_vars) == len(set(r.hint_vars)), "같은 변수를 두 번 힌트했다"
        assert set(r.hint_vars) == set(range(r.n_vars)), (
            f"불완전 힌트: {len(set(r.hint_vars))}/{r.n_vars}")
        assert _hint_is_feasible(r.model)
    # 보조 변수가 실제로 있었다(meal·catx 를 안 태웠다면 이 테스트는 공허하다)
    names = {v.name for v in mains[0].model.Proto().variables}
    assert any(n.startswith("meal") for n in names)
    assert any(n.startswith("catx_") for n in names)


# ── ② 경로 완성 실패 분기 — 자기루프 이중 힌트 금지 ─────────────


def test_inconsistent_greedy_order_falls_back_without_double_hint() -> None:
    """핀 둘(10:00·15:00)을 그리디가 거꾸로 낸 것처럼 꾸며 경로 완성을 INFEASIBLE 로 만든다.

    이 분기는 방문·아크 리터럴만 힌트한다. 아크 목록 앞 k 개는 자기루프 (i,i,¬visit[i]) 라
    거기까지 힌트하면 visit 변수가 두 번 힌트돼 모델이 MODEL_INVALID 가 된다.
    """
    pois = [_poi(f"q{i}", PoiCategory.SIGHT, 37.751 + 0.004 * i, 128.876) for i in range(4)]
    index = {p.poi_id: p for p in pois}
    day = date(2026, 8, 5)
    fixed = tuple(
        FixedBlock(pois[i].poi_id,
                   TimeWindow(datetime(2026, 8, 5, h, 0, tzinfo=_KST),
                              datetime(2026, 8, 5, h + 1, 0, tzinfo=_KST)), "user_fixed")
        for i, h in ((0, 10), (1, 15)))
    problem = _problem(pois, days=(day,), fixed=fixed)
    swapped = {pois[0].poi_id: 15 * 60, pois[1].poi_id: 10 * 60}

    with patch.object(OrToolsAssembler, "_greedy_hint", lambda *a, **k: swapped), \
            _solves() as log:
        result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)

    completions = [r for r in log if r.completion]
    assert completions and all(r.status == cp_model.INFEASIBLE for r in completions)
    for r in _main(log):
        assert r.invalid == ""
        assert len(r.hint_vars) == len(set(r.hint_vars))
        assert r.hint_vars, "경로 리터럴 힌트는 남아야 한다"
    assert result is not None  # 힌트가 틀려도 해는 낸다 — 힌트는 제약이 아니다
    assert check_all(result, problem, index, _EST) == []


# ── ③ 실 덤프 회귀 ────────────────────────────────────────────


def _load_fixture(name: str):
    doc = json.loads((_FIXTURES / f"{name}.json").read_text())
    pois = {
        PoiId(pid): _poi(pid, PoiCategory(cat), lat, lng,
                         tuple(OpenHour(*oh) for oh in hours))
        for pid, (cat, lat, lng, hours) in doc["pois"].items()
    }
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-1176-fixture"),
        days=tuple(date.fromisoformat(d) for d in doc["days"]),
        candidates=tuple(ScoredPoi(PoiId(pid), score, is_llm)
                         for pid, score, is_llm in doc["candidates"]),
        fixed_blocks=(), budget=BudgetLevel(doc["budget"]),
        transport=TransportMode(doc["transport"]),
        day_window=TimeWindow(*(datetime.fromisoformat(t) for t in doc["day_window"])),
        seed=doc["seed"],
        anchor=None if doc["anchor"] is None else GeoPoint(*doc["anchor"]),
        excluded_poi_ids=frozenset(PoiId(x) for x in doc["excluded"]),
    )
    return problem, pois


@pytest.mark.parametrize("name", ["seoul_a", "seoul_b", "busan_a"])
def test_real_dump_solves_on_first_attempt_deterministically(name, caplog) -> None:
    """종전: 셋 다 첫 3초 해 없음(서울 둘은 15초 몰아 재시도까지 가서 18초).

    벽시계 상한은 넉넉히 둔다 — 멈춤은 결정론 시간 한도가 정하게 해서, CI 부하에서도
    '같은 입력 → 같은 해' 단언이 벽시계에 흔들리지 않게 한다.
    """
    problem, index = _load_fixture(name)
    cfg = replace(AssemblyConfig(), or_tools_limit_ms=30_000)
    est = TravelEstimator(cfg)
    asm = OrToolsAssembler(index, est, cfg)

    with _solves() as log, caplog.at_level("WARNING", logger=_LOGGER):
        first = asm.solve(problem, remaining_ms=60_000)
    assert not [r for r in caplog.records if "백스톱" in r.message], (
        "멈춘 것이 결정론 한도가 아니다 — 아래 '2회 동일' 단언이 벽시계에 기대게 된다")
    mains = _main(log)
    assert len(mains) == len(problem.days), "첫 시도에 못 풀어 재시도로 갔다"
    for r in mains:
        assert r.status in _OK
        assert set(r.hint_vars) == set(range(r.n_vars)), (
            f"불완전 힌트: {len(set(r.hint_vars))}/{r.n_vars}")
    assert first is not None and first.solve_mode is SolveMode.OR_TOOLS
    assert check_all(first, problem, index, est) == []
    assert asm.solve(problem, remaining_ms=60_000) == first


# ── ④ 용량 컷은 중복 제약 (PBT) ───────────────────────────────


@st.composite
def _small_setups(draw):
    """assembly_setups(후보 ≤8) + 하루 길이 축소(컷이 실제로 조이도록) + 핀을 창 시작으로."""
    problem, index = draw(assembly_setups())
    end_hour = draw(st.integers(min_value=11, max_value=21))
    d0 = problem.days[0]
    problem = replace(problem, day_window=TimeWindow(
        problem.day_window.start,
        datetime(d0.year, d0.month, d0.day, end_hour, 0, tzinfo=_KST)))
    if problem.fixed_blocks and draw(st.booleans()):
        (fb,) = problem.fixed_blocks
        ws = problem.day_window.start
        problem = replace(problem, fixed_blocks=(
            replace(fb, window=TimeWindow(ws, ws + timedelta(minutes=60))),))
    return problem, index


_EXACT = AssemblyConfig(or_tools_limit_ms=20_000, or_tools_min_ms=50,
                        or_tools_det_limit=50.0)


def _day1_objective(problem, index, *, cut: bool):
    asm = OrToolsAssembler(index, TravelEstimator(_EXACT), _EXACT)
    ctx = (patch.object(OrToolsAssembler, "_capacity_cut", lambda *a, **k: None)
           if not cut else nullcontext())
    with ctx, _solves() as log:
        asm._solve_day(problem, problem.days[0], set(problem.excluded_poi_ids), 20_000)
    mains = _main(log)
    if not mains:
        return "empty"  # 노드 없음 — 모델을 안 만든다
    return mains[-1].status, mains[-1].objective


@settings(max_examples=25, deadline=None)
@given(setup=_small_setups())
def test_capacity_cut_never_changes_small_instance_optimum(setup) -> None:
    problem, index = setup
    with_cut = _day1_objective(problem, index, cut=True)
    without = _day1_objective(problem, index, cut=False)
    if with_cut == "empty" or without == "empty":
        assert with_cut == without
        return
    proven = (cp_model.OPTIMAL, cp_model.INFEASIBLE)
    assume(with_cut[0] in proven and without[0] in proven)  # 한도에 걸린 예시는 비교 불가
    assert with_cut == without


@pytest.mark.parametrize("name", ["seoul_a", "seoul_b", "busan_a"])
@pytest.mark.parametrize("pinned", [False, True])
def test_capacity_cut_keeps_optimum_on_real_top8(name, pinned) -> None:
    """생성기는 좌표·영업시간이 합성이다 — 실 덤프 상위 8곳(실 영업창·앵커)으로도 본다.
    pinned: 1위 후보를 창 시작 09:00 에 60분 핀(TRIP-1175 앵커 면제 경로)."""
    problem, index = _load_fixture(name)
    top = sorted((c for c in problem.candidates if c.poi_id not in problem.excluded_poi_ids),
                 key=lambda c: (-c.score, str(c.poi_id)))[:8]
    problem = replace(problem, candidates=tuple(top))
    if pinned:
        ws = problem.day_window.start
        problem = replace(problem, fixed_blocks=(FixedBlock(
            top[0].poi_id, TimeWindow(ws, ws + timedelta(minutes=60)), "must_visit"),))
    with_cut = _day1_objective(problem, index, cut=True)
    without = _day1_objective(problem, index, cut=False)
    assert with_cut[0] in (cp_model.OPTIMAL, cp_model.INFEASIBLE)
    assert with_cut == without


# ── ⑤ 창 시작 핀 첫 방문 — 컷이 자르지 않는다 ───────────────────


def test_window_start_pin_first_visit_is_not_cut_off() -> None:
    """핀(09:00~10:00, 앵커 먼 곳) → 후보 c 하나가 **딱 맞게** 들어가는 하루.

    핀은 앵커 출발을 면제받는다(TRIP-1175) — 그래서 핀으로 들어오는 이동 하한은 0 이다.
    여기에 앵커 이동이나 다른 노드에서의 이동을 얹으면(프로토타입의 inc) 하루 합이 창을
    넘어 c 를 넣은 해가 잘린다.
    """
    pin = _poi("pin", PoiCategory.CULTURE, 37.5600, 126.9800)
    c = _poi("c", PoiCategory.SIGHT, 37.5640, 126.9830)
    index = {pin.poi_id: pin, c.poi_id: c}
    t = _EST.estimate(pin.coord, c.coord, TransportMode.PUBLIC).internal_minutes
    span = 60 + t + 75  # 핀 60분 + 이동 + SIGHT 기본 체류 75분 = 창 길이 정확히
    fb = FixedBlock(pin.poi_id, TimeWindow(datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                                           datetime(2026, 8, 5, 10, 0, tzinfo=_KST)),
                    "must_visit")
    problem = _problem([pin, c], days=(date(2026, 8, 5),), fixed=(fb,),
                       anchor=GeoPoint(37.62, 126.98),  # 약 6.7km
                       end_hour=9 + span // 60, end_min=span % 60)

    result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)

    assert result is not None
    assert [s.poi_id for s in result.days[0].slots] == [pin.poi_id, c.poi_id]
    assert check_all(result, problem, index, _EST) == []


def test_det_limit_is_a_validated_config_field() -> None:
    cfg = AssemblyConfig()
    assert cfg.or_tools_det_limit == 2.0
    # 벽시계 백스톱은 운영 CPU 몫(requests 0.5)에서도 결정론 한도보다 늦게 걸려야 한다 —
    # 실측 wall/det 최대 2.92초(amd64·0.5 CPU) → 여유 포함 det 1당 3.5초.
    assert cfg.or_tools_limit_ms >= cfg.or_tools_det_limit * 3500
    with pytest.raises(ValueError):
        AssemblyConfig(or_tools_det_limit=0.0)


# ── ⑥ TRIP-907 몰아 재시도 — 결정론 한도를 키워서 돈다 ────────────


def test_spare_retry_runs_with_a_larger_deterministic_limit() -> None:
    """결정론 한도가 탐색을 멈추므로, 같은 한도로 재시도하면 1차와 **똑같은 탐색**을 다시 돌아
    같은 None 이 나온다(측정: 실 덤프 39건 힌트 없음·det 0.1 — 같은 한도 재시도 구제 0/39,
    ×5 한도 재시도 36/39). 그래서 재시도는 한도를 고정 배수(×5)로 키운다 — 벽시계 상한
    비율로 정하면 백스톱(`or_tools_limit_ms`)을 올릴 때 재시도 탐색량이 조용히 준다.

    1차 실패를 만들려고 힌트를 끄고 한도를 아주 작게 둔다 — 운영에서 1차가 실패하는 것은
    완전 힌트가 깨지는 드문 경우(경로 완성 실패)뿐이고, 이 재시도가 그 안전장치다.
    """
    problem, index = _load_fixture("seoul_a")
    cfg = AssemblyConfig(or_tools_limit_ms=7000, or_tools_det_limit=0.1)
    asm = OrToolsAssembler(index, TravelEstimator(cfg), cfg)

    with patch.object(OrToolsAssembler, "_hint_path", lambda *a, **k: None), \
            _solves() as log:
        result = asm.solve(problem, remaining_ms=20_000)

    mains = _main(log)
    assert [r.status in _OK for r in mains] == [False, True]
    assert mains[1].det == pytest.approx(0.1 * 5)
    assert result is not None and result.solve_mode is SolveMode.OR_TOOLS
    assert check_all(result, problem, index, TravelEstimator(cfg)) == []


# ── ⑦ 그리디가 빈 날 — 힌트 없음 ────────────────────────────────


def test_empty_greedy_order_leaves_the_main_search_unhinted() -> None:
    """그리디는 영업 시작을 기다리지 않는다 — 09:00 에 닫혀 있는 두 곳(10:00~18:00)을 다
    버려 빈 날이 된다. OR 모델은 start ≥ lo 로 기다릴 수 있어 둘 다 넣는다.

    빈 순서의 경로 완성은 반드시 INFEASIBLE 이다(AddCircuit 은 깊이0 자기루프가 없어 빈
    회로를 허용하지 않는다). 그걸 부분 힌트로 내리면 '전 visit=0·전 아크=0' — 모델과
    모순이고 불완전한 힌트("The solution hint is incomplete")가 남는다. 힌트를 안 거는
    편이 낫다.
    """
    hours = tuple(OpenHour(d, 10 * 60, 18 * 60) for d in range(7))
    pois = [_poi(f"late{i}", PoiCategory.SIGHT, 37.56 + 0.01 * i, 126.98, hours)
            for i in range(2)]
    index = {p.poi_id: p for p in pois}
    problem = _problem(pois, days=(date(2026, 8, 3),))

    with _solves() as log:
        result = OrToolsAssembler(index, _EST, _CFG).solve(problem, remaining_ms=1500)

    assert not [r for r in log if r.completion], "빈 순서로 경로 완성을 돌렸다"
    (main,) = _main(log)
    assert main.invalid == ""
    assert main.hint_vars == [], "빈 그리디 순서로 힌트를 걸었다"
    assert result is not None and result.solve_mode is SolveMode.OR_TOOLS
    assert {s.poi_id for s in result.days[0].slots} == {p.poi_id for p in pois}
    assert check_all(result, problem, index, _EST) == []


# ── ⑧ 벽시계 백스톱이 먼저 끊으면 경고 ──────────────────────────


def test_wall_backstop_cutting_before_det_limit_is_logged(caplog) -> None:
    """결정론 한도가 멈춤을 정해야 '같은 입력 → 같은 해' 다. 벽시계가 먼저 끊으면(운영 CPU
    0.5 몫·동시 요청) 해가 부하에 따라 갈린다 — 조용히 넘기면 그 빈도를 모른다.

    상한(300ms)을 결정론 한도(50)보다 훨씬 짧게 둬 벽시계가 반드시 먼저 끊게 한다. 잔여도
    상한과 같게 둬 몰아 재시도는 돌지 않는다.
    """
    problem, index = _load_fixture("seoul_a")
    cfg = AssemblyConfig(or_tools_limit_ms=300, or_tools_min_ms=50, or_tools_det_limit=50.0)
    asm = OrToolsAssembler(index, TravelEstimator(cfg), cfg)

    with caplog.at_level("WARNING", logger=_LOGGER):
        asm.solve(problem, remaining_ms=300)

    assert any("백스톱" in r.message and "결정론" in r.message for r in caplog.records), (
        "벽시계가 결정론 한도 전에 끊었는데 침묵했다")
