"""식사 칸의 '다른 후보'는 식사 후보만 (2026-10-14 부산 실측: 칼국수 칸에 기찻길·해파랑길).

  ① 식사 칸 + 비식당이 섞인 풀 — LLM 이 풀 밖 비식당을 골라도 결과 전원 식사
  ② `categories` 지정 — 그게 우선(대상 역할 필터 안 탐)
  ③ 식사 후보가 제외분뿐 — 넓히고 `alternatives_role_relaxed` 노트(INV-4)
  ④ 비식사 칸 — 식당을 빼고, 같은 분류가 모자라면 식당 아닌 전부로 채운다(2026-10-19 결정 3)
  ⑤′ 대상이 풀 밖 — 종전 동작 + `alternatives_role_unknown`
  ⑤ `target_poi_id` 없으면 `affected_reasons` 키로 대신
  ⑥ 속성: 결과 ⊆ 입력 풀(INV-1) · 식사 칸은 전원 식사 · 그 밖은 식당 0, 같은 분류만이거나 같은 분류가 모자람
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from tests.generators.poi import candidate_pools
from tests.api.test_api_alternatives import _post
from trippilot.api.wiring import build_dev_app, demo_poi_seed, restrict_pool_to_target_role
from trippilot.poi_curation.pool_builder import SAME_CATEGORY_MIN
from trippilot.ports.llm_port import LlmRequest, LlmResponse
from trippilot.domain.poi import counts_as_food

_SEED = {str(p.poi_id): p for p in demo_poi_seed()}
_FOOD = "e0000000-0000-4000-8000-000000000002"  # 제주 흑돼지거리 (FOOD)
_NATURE = "e0000000-0000-4000-8000-000000000001"  # 성산일출봉
_HALLA = "e0000000-0000-4000-8000-000000000004"  # 한라산 (NATURE) — 데모 앵커 반경 풀은 흑돼지거리·한라산 둘


class _PicksNature:
    """LlmPort — 무조건 비식당(성산일출봉)을 고른다."""

    def invoke(self, request: LlmRequest) -> LlmResponse:
        return LlmResponse(
            raw_text=json.dumps({"selections": [{"poiId": _NATURE, "reason": "바다 전망"}]},
                                ensure_ascii=False),
            input_tokens=1, output_tokens=1, latency_ms=0, model_id=request.model_id)


def _body(**over: object) -> dict:
    with TestClient(build_dev_app(llm=_PicksNature(), model_id="test-model"),
                    raise_server_exceptions=False) as client:
        r = _post(client, reason="none", **over)
    assert r.status_code == 200, r.text
    return r.json()


def _picked(body: dict) -> set[str]:
    return {p for a in body["alternatives"] for p in a["poi_ids"]}


def test_meal_slot_gets_only_food_even_if_llm_picks_nature() -> None:
    body = _body(target_poi_id=_FOOD)
    assert _picked(body) and all(counts_as_food(_SEED[p]) for p in _picked(body)), body
    assert _NATURE not in _picked(body)


def test_categories_win_over_target_role() -> None:
    body = _body(target_poi_id=_FOOD, categories=["NATURE"])
    assert {_SEED[p].category.value for p in _picked(body)} == {"NATURE"}


def test_mixed_categories_keep_user_choice_not_food_only() -> None:
    # 대상이 식사여도 사용자가 고른 종류(여기선 NATURE 포함)를 역할 필터가 덮지 않는다
    body = _body(target_poi_id=_FOOD, categories=["FOOD", "NATURE"])
    assert "NATURE" in {_SEED[p].category.value for p in _picked(body)}, body


def test_target_outside_pool_leaves_trace() -> None:
    assert "alternatives_role_unknown" in _body(target_poi_id="no-such-poi")["notes"]


def test_relaxed_when_only_excluded_food_left() -> None:
    food = [p for p, poi in _SEED.items() if counts_as_food(poi)]
    body = _body(target_poi_id=_FOOD, excluded_poi_ids=food)
    assert "alternatives_role_relaxed" in body["notes"]
    assert _picked(body) and not any(counts_as_food(_SEED[p]) for p in _picked(body))


def test_non_meal_slot_drops_food() -> None:
    # 풀(흑돼지거리·한라산)에서 같은 분류가 3곳에 못 미쳐 식당 아닌 전부(한라산)로 채운다
    assert _body()["pool_size"] == 2
    body = _body(target_poi_id=_HALLA)
    assert body["pool_size"] == 1 and _picked(body) and not any(counts_as_food(_SEED[p]) for p in _picked(body)), body


def test_affected_reasons_key_stands_in_for_target() -> None:
    body = _body(affected_reasons={_FOOD: "현지 맛집"})
    assert _picked(body) and all(counts_as_food(_SEED[p]) for p in _picked(body)), body


@given(pool=candidate_pools(), pick=st.integers(min_value=0, max_value=50), wants_food=st.booleans())
def test_role_restrict_is_closed_set_subset(pool, pick, wants_food) -> None:
    target = pool.pois[pick % len(pool.pois)] if pool.pois else None
    out, notes = restrict_pool_to_target_role(
        pool, str(target.poi_id) if target else None, frozenset(), wants_food=wants_food)
    assert out.poi_ids <= pool.poi_ids  # INV-1
    assert "alternatives_role_unknown" not in notes  # 대상은 풀에서 뽑았다
    if out is pool:
        return
    assert not notes
    if wants_food or counts_as_food(target):
        assert all(counts_as_food(p) for p in out.pois)
    else:
        assert not any(counts_as_food(p) for p in out.pois)
        non_food = tuple(p for p in pool.pois if not counts_as_food(p))
        if sum(p.category is target.category for p in non_food) >= SAME_CATEGORY_MIN:
            assert all(p.category is target.category for p in out.pois)  # 같은 분류만
        else:
            assert out.pois == non_food  # 모자라면 식당 아닌 전부로 채운다
