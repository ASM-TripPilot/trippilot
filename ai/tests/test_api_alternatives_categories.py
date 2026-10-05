"""TRIP-1065 — 대안 요청 `categories` 필터 (같이 짜기 컨셉 → 카테고리).

풀 단계에서 거르므로 LLM 선택·규칙 폴백 모두 그 안에서만 고른다.
  ① 카테고리 지정 — 제안 전원이 그 카테고리, pool_size 도 좁혀진 값
  ② 반경 안에 그 카테고리 0건 — 다른 카테고리로 채우지 않고 no_candidates
  ③ 모르는 코드만 — 400 이 아니라 필터 없음(reason 선례) · 무시한 코드는 notes 로
  ③′ 섞인 코드 — 아는 코드로만 거르고 모르는 코드는 notes 로
  ④ 속성: 결과 ⊆ 입력 풀(INV-1) · 알려진 코드면 전원 그 집합 · 없으면 풀 그대로
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from tests.generators.poi import candidate_pools
from tests.test_api_alternatives import _post
from trippilot.api.wiring import build_dev_app, demo_poi_seed, restrict_pool_to_categories
from trippilot.domain.poi import PoiCategory

_SEED_CATEGORY = {str(p.poi_id): p.category.value for p in demo_poi_seed()}


def test_categories_restrict_pool_and_proposals() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        body = _post(client, categories=["FOOD"]).json()
        baseline = _post(client).json()["pool_size"]
    picked = {p for a in body["alternatives"] for p in a["poi_ids"]}
    assert picked, body
    assert {_SEED_CATEGORY[p] for p in picked} == {"FOOD"}
    assert 0 < body["pool_size"] < baseline


def test_category_absent_in_radius_returns_empty_not_substitutes() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        body = _post(client, categories=["SHOPPING"]).json()
    assert body["alternatives"] == [] and body["pool_size"] == 0
    assert body["empty_reason"] == "no_candidates"


def test_unknown_codes_only_mean_no_filter() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        response = _post(client, categories=["식사", "STAY"])
        baseline = _post(client).json()["pool_size"]
    assert response.status_code == 200
    assert response.json()["pool_size"] == baseline
    assert "categories_ignored:식사,STAY" in response.json()["notes"]  # 침묵 금지


def test_mixed_codes_filter_by_known_and_report_unknown() -> None:
    with TestClient(build_dev_app(), raise_server_exceptions=False) as client:
        body = _post(client, categories=["FOOD", "식사"]).json()
    picked = {p for a in body["alternatives"] for p in a["poi_ids"]}
    assert picked and {_SEED_CATEGORY[p] for p in picked} == {"FOOD"}
    assert "categories_ignored:식사" in body["notes"]


_CODES = st.lists(
    st.sampled_from([c.value for c in PoiCategory] + ["식사", ""]), max_size=4)


@given(pool=candidate_pools(), codes=_CODES)
def test_restrict_is_closed_set_subset(pool, codes) -> None:
    out, ignored = restrict_pool_to_categories(pool, codes)
    assert out.poi_ids <= pool.poi_ids  # INV-1 — 풀을 넓히지 않는다
    known = {c for c in codes if c in _BOUNDARY}
    assert ignored == [c for c in codes if c not in known]
    if known:
        assert {p.category.value for p in out.pois} <= known
        assert out.poi_ids == {p.poi_id for p in pool.pois if p.category.value in known}
    else:
        assert out is pool


_BOUNDARY = {c.value for c in PoiCategory} - {PoiCategory.STAY.value}


# ── ⑤ 컨셉이 LLM 에 닿는가 — 거른 풀만 주면 "해수욕장의 대안으로 식당"이라 비운다 ──
# 2026-10-05 실측: 식사·카페 컨셉이 `llm_empty_result` → 규칙 폴백. 선택 LLM 이
# 사용자가 이 자리의 종류를 바꾸려 한다는 사실을 몰랐다.

_WANT = "바꾸길 원합니다"


def _prompt_for(**over: object) -> str:
    from tests.test_api_alternatives_place_knowledge import _PromptSpy

    spy = _PromptSpy()
    with TestClient(build_dev_app(llm=spy, model_id="test-model"),
                    raise_server_exceptions=False) as client:
        assert _post(client, **over).status_code == 200
    assert spy.prompts, "LLM 이 불리지 않았다"
    return spy.prompts[0]


def test_known_categories_reach_selection_prompt_in_korean() -> None:
    prompt = _prompt_for(categories=["FOOD", "CAFE", "식사"])
    line = next(l for l in prompt.splitlines() if _WANT in l)
    assert "맛집" in line and "카페" in line
    assert "FOOD" not in line and "식사" not in line  # 한글 정본 어휘 · 모르는 코드는 안 싣는다


def test_no_known_category_adds_no_concept_line() -> None:
    assert _WANT not in _prompt_for()
    assert _WANT not in _prompt_for(categories=["식사", "STAY"])
