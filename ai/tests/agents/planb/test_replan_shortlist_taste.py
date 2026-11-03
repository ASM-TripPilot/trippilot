"""다시 짜기 후보 40곳 점수에 취향(`taste_fit`)이 들어간다 — 생성과 같은 규칙 (2026-11-02).

종전에는 `_compose_day` 가 `build_rule_score` 에 `taste` 를 넘기지 않아, "카페·자연" 취향도 40곳이 취향과
무관하게 뽑히고 취향은 구성 LLM 프롬프트 한 줄로만 닿았다.

증명하는 것 (실 LLM 0):
  ① 취향 카테고리 후보만 `taste_fit` 만큼 오르고 나머지는 그대로다
  ② 이번 요청이 카테고리 축(지시)을 정했으면 취향을 얹지 않는다(BR-U4-47 — 생성과 같다)
"""

from __future__ import annotations

import pytest

from tests.agents.planb.test_replan_composition import _FOOD, _replan, _ScriptedLlm
from trippilot.agents.planb import composition
from trippilot.api.wiring import demo_poi_seed
from trippilot.assembly_engine.scorer import taste_fit
from trippilot.domain.poi.poi import PoiCategory


def _scores(monkeypatch: pytest.MonkeyPatch, **over: object) -> dict[str, float]:
    """구성 후보를 고를 때 쓴 점수(풀 전원)를 잡는다 — 수리 경로의 두 번째 호출은 첫 호출을 덮지 않는다."""
    seen: dict[str, float] = {}
    real = composition.shortlist

    def spy(pool, **kw):
        if not seen:
            seen.update({str(p.poi_id): kw["score"](p) for p in pool.pois})
        return real(pool, **kw)

    monkeypatch.setattr(composition, "shortlist", spy)
    _replan(_ScriptedLlm([_FOOD]), **over)
    assert seen, "구성 후보 고르기가 불리지 않았다"
    return seen


def test_취향_카테고리_후보만_taste_fit_만큼_오른다(monkeypatch: pytest.MonkeyPatch) -> None:
    base = _scores(monkeypatch)
    liked = _scores(monkeypatch, preference_profile={"activities": ["자연"]})
    cat = {str(p.poi_id): p.category for p in demo_poi_seed()}
    lift = taste_fit(PoiCategory.NATURE, frozenset({PoiCategory.NATURE}))
    assert any(cat[pid] is PoiCategory.NATURE for pid in base), "풀에 자연이 있어야 의미가 있다"
    for pid, s in base.items():
        expected = lift if cat[pid] is PoiCategory.NATURE else 0.0
        assert liked[pid] - s == pytest.approx(expected), (pid, cat[pid])


def test_요청이_카테고리를_정하면_취향을_얹지_않는다(monkeypatch: pytest.MonkeyPatch) -> None:
    told = _scores(monkeypatch, directives=["INDOOR"])
    told_and_liked = _scores(monkeypatch, directives=["INDOOR"], preference_profile={"activities": ["자연"]})
    assert told_and_liked == pytest.approx(told)
