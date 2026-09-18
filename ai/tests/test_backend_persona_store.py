"""페르소나 재조회 어댑터 — 백엔드 어휘를 접지 않고 우리 값으로 옮기는가 (TRIP-434).

실 호출 0 — `HttpJson` fake 로 응답만 넣는다(D37).
"""

from __future__ import annotations

import datetime as dt

import pytest

from trippilot.domain.common import BudgetLevel
from trippilot.domain.context import ResourceRef
from trippilot.domain.persona import (
    CompanionType,
    PersonaSummary,
    TasteTag,
    companion_from,
    taste_tags_from,
)
from trippilot.llm_gateway.adapters.backend_persona import (
    BackendPersonaStore,
    PersonaFetchError,
)

REF = ResourceRef(kind="persona", ref_id="acc-1", owner_id="acc-1")


class FakeHttp:
    def __init__(self, body: object) -> None:
        self._body = body
        self.calls: list[tuple[str, str, dict]] = []

    def request_json(self, method, url, **kw):
        self.calls.append((method, url, kw))
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def store(body: object) -> tuple[BackendPersonaStore, FakeHttp]:
    http = FakeHttp(body)
    return BackendPersonaStore(http, "http://backend:8080/", "tok"), http


# ── 어휘 접기 ────────────────────────────────────────────────────────────────

def test_parents_keeps_its_own_seat() -> None:
    """`부모님` 은 가족으로 접히지 않는다 — 접지 말라는 것이 결정이었다."""
    s, _ = store({"companion_types": ["부모님"]})
    assert s.get(REF).companion is CompanionType.PARENTS


def test_parents_with_family_is_promoted_not_dropped() -> None:
    """조합은 둘 중 하나를 버리는 대신 우리 값(3세대)으로 올라간다."""
    assert companion_from(["부모님", "가족"]) is CompanionType.MULTIGEN


def test_unset_companion_is_not_solo() -> None:
    """미설정을 SOLO 로 채우면 선택 안 한 사람을 혼자 여행자로 단정한다."""
    s, _ = store({"companion_types": []})
    assert s.get(REF).companion is None


def test_luxury_is_not_folded_into_mid() -> None:
    """예산 어휘도 같은 표를 쓴다 — 번역표가 둘이면 한쪽만 고쳐 어긋난다."""
    s, _ = store({"budget_tier": "럭셔리"})
    assert s.get(REF).budget is BudgetLevel.HIGH


def test_missing_budget_falls_back_to_mid() -> None:
    """예산만 예외 — 미인식=중간은 경계 전체의 기존 소프트 규칙이다(배제 아님)."""
    s, _ = store({})
    assert s.get(REF).budget is BudgetLevel.MID


def test_styles_map_one_to_one_onto_seven_axes() -> None:
    s, _ = store({"styles": ["휴양", "문화예술", "자연"]})
    assert set(s.get(REF).taste_tags) == {TasteTag.REST, TasteTag.CULTURE, TasteTag.NATURE}


def test_taste_tag_order_is_stable_regardless_of_input_order() -> None:
    """프롬프트 문자열이 흔들리면 같은 사용자가 요청마다 다른 캐시 키를 만든다."""
    assert taste_tags_from(["자연", "미식"]) == taste_tags_from(["미식", "자연"])


def test_unknown_labels_are_skipped_not_fatal() -> None:
    """백엔드가 축을 하나 늘려도 조회가 죽지 않는다."""
    s, _ = store({"styles": ["미식", "새로운축"], "companion_types": ["새동행"]})
    got = s.get(REF)
    assert got.taste_tags == (TasteTag.FOOD,)
    assert got.companion is None


# ── 경계·실패 ────────────────────────────────────────────────────────────────

def test_calls_internal_path_with_service_token() -> None:
    s, http = store({})
    s.get(REF)
    method, url, kw = http.calls[0]
    assert (method, url) == ("GET", "http://backend:8080/internal/users/acc-1/persona")
    assert kw["headers"]["X-Service-Token"] == "tok"


def test_transport_failure_raises_instead_of_empty_persona() -> None:
    """빈 요약으로 위장하면 '취향 없는 사람' 일정이 조용히 나간다(INV-4)."""
    s, _ = store(ConnectionError("boom"))
    with pytest.raises(PersonaFetchError):
        s.get(REF)


def test_non_object_body_raises() -> None:
    s, _ = store(["not", "an", "object"])
    with pytest.raises(PersonaFetchError):
        s.get(REF)


def test_fetched_every_call_no_caching() -> None:
    """BR-U4-07 — 캐시된 값은 '요청자 권한 하 재조회'가 아니다."""
    s, http = store({})
    s.get(REF)
    s.get(REF)
    assert len(http.calls) == 2


# ── 소비처가 미설정을 견디는가 ───────────────────────────────────────────────

def test_prompt_context_renders_unset_companion_as_misseol() -> None:
    from trippilot.domain.llm import CandidatePool
    from trippilot.llm_gateway.workers.preference import build_prompt_vars

    persona = PersonaSummary(taste_tags=(), companion=None, budget=BudgetLevel.MID)
    pool = CandidatePool(poi_ids=frozenset(), pois=(),
                         generated_at=dt.datetime(2026, 9, 19, tzinfo=dt.timezone.utc))
    ctx = build_prompt_vars(pool, persona)
    assert ctx["companion"] == "미설정"


# ── enum 전수성 — 값이 늘 때 조용히 새는 자리를 막는다 ──────────────────────
#
# 안티패턴 등재분(2026-09-19): "닫힌 집합에 값을 하나 더했으면 그 값을 **만들어 내는**
# 경로를 전부 세고 나서 끝낼 것." 여기서 새는 방식이 특히 조용하다 — 우선순위 표에서
# 빠진 값은 예외가 아니라 `None`(미설정)으로 떨어져서 **선택한 동행이 선택 안 한 것처럼
# 보인다.** 정상 동작과 구분이 안 되므로 테스트가 아니면 안 드러난다.

def test_every_companion_type_is_rankable() -> None:
    from trippilot.domain.persona import _COMPANION_PRIORITY

    missing = [c for c in CompanionType if c not in _COMPANION_PRIORITY]
    assert not missing, (
        f"우선순위 표에 없는 동행: {missing} — 다중 선택에 섞이면 조용히 미설정이 된다")


def test_every_backend_companion_label_is_translated() -> None:
    """백엔드 `PreferenceSet.COMPANION_TYPES` 정본 5종이 전부 옮겨지는가."""
    from trippilot.domain.persona import COMPANION_TOKENS

    backend = ("혼자", "커플", "친구", "가족", "부모님")
    missing = [x for x in backend if x not in COMPANION_TOKENS]
    assert not missing, f"번역표에 없는 동행 어휘: {missing} — 조용히 미설정이 된다"


def test_every_backend_style_is_translated() -> None:
    """백엔드 `PreferenceSet.STYLES` 정본 7종 ↔ 우리 7축 (전단사)."""
    from trippilot.domain.persona import TASTE_TOKENS

    backend = ("휴양", "관광", "액티비티", "미식", "쇼핑", "자연", "문화예술")
    missing = [x for x in backend if x not in TASTE_TOKENS]
    assert not missing, f"번역표에 없는 취향 어휘: {missing}"
    assert set(TASTE_TOKENS.values()) == set(TasteTag), "7축 중 도달 불가능한 값이 있다"
