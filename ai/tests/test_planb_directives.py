"""재계획 지시 사전(KB-4) — 로더 위생 · 칩 조회 · 자유 입력 매칭.

**임계 테스트에 `FakeEmbedding` 을 쓰지 않는다** — 해시→가우시안이라 의미 유사도가
없고 무관 텍스트의 코사인이 난수·음수로 나와, 실전에서 유효한 어떤 임계도 fake 에서는
"전건 컷"이 된다(TRIP-522 에서 실제로 테스트 2건이 이 이유로 깨졌다). 각도를 지정하는
`_Angles` 로만 임계를 조준한다.
"""
from __future__ import annotations

import math
from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.planb.directives import (
    DEFAULT_MATCH_THRESHOLD,
    DirectiveSpec,
    directive_documents,
    index_of,
    load_directive_file,
    load_directives,
    match_free_text,
    resolve_chips,
)
from trippilot.agents.planb.kb_retrieval import KbLoadError, index_documents
from trippilot.domain.kb import KbKind
from trippilot.domain.poi import PoiCategory

from tests.fakes.in_memory_vector_store import InMemoryVectorStore

_DICT = Path(__file__).resolve().parent.parent / "data" / "replan_directives.yaml"


class _Angles:
    """각도 → 2차원 단위벡터. 코사인 = 각도 차의 cos — 임계를 정확히 조준한다."""

    dim = 2
    model_id = "scripted-angles"
    _FAR = 3.0  # cos(3.0) ≈ -0.99 — 확실히 임계 아래

    def __init__(self, angles: dict[str, float]) -> None:
        self._angles = angles

    def embed(self, text: str) -> tuple[float, ...]:
        theta = self._angles.get(text, self._FAR)
        return (math.cos(theta), math.sin(theta))

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


def _spec(key: str, *aliases: str, enforced_by: str = "RANKING", **kw) -> DirectiveSpec:
    return DirectiveSpec(key=key, label=key.lower(), enforced_by=enforced_by,
                         aliases=aliases or ("기본",), **kw)


# ── 실제 사전 파일 ──────────────────────────────────────────────────────


def test_shipped_dictionary_loads_and_is_sane() -> None:
    specs = load_directive_file(_DICT, yaml.safe_load)
    assert len(specs) >= 20, "사전이 20종 미만 — 자유 입력이 닿을 어휘가 좁다"
    keys = {s.key for s in specs}
    # FE 칩 7종(replanScope.ts REPLAN_DIRECTIVES)은 전부 사전에 있어야 한다.
    # 없으면 그 칩이 unknown_directives 로 되돌아간다 — 사용자가 누른 것이 무시되는 셈.
    assert {"RELAX", "FILL_MORE", "INDOOR", "NEARBY", "ADD_FOOD",
            "NIGHT_VIEW", "LESS_MOVE"} <= keys


def test_shipped_categories_are_boundary_eight() -> None:
    """카테고리는 경계 8종 안에서만 — 오타가 나면 그 지시는 영영 아무것도 안 거른다."""
    valid = {c.value for c in PoiCategory}
    for spec in load_directive_file(_DICT, yaml.safe_load):
        for cat in (*spec.prefer_categories, *spec.avoid_categories):
            assert cat in valid, f"{spec.key}: 미지 카테고리 {cat!r}"


def test_shipped_solver_directives_are_marked_unwired() -> None:
    """SOLVER 는 A-4 전까지 효과가 없다 — 정본이 '동작 중'으로 읽히면 안 된다."""
    for spec in load_directive_file(_DICT, yaml.safe_load):
        if spec.enforced_by == "SOLVER":
            assert spec.unwired, f"{spec.key}: SOLVER 인데 unwired 표시가 없다"


# ── 로더 위생 ──────────────────────────────────────────────────────────


def test_loader_rejects_wrong_kb_label() -> None:
    with pytest.raises(KbLoadError, match="kb"):
        load_directives({"kb": "SITUATION", "directives": [{"key": "A"}]})


def test_loader_rejects_duplicate_key_and_alias() -> None:
    base = {"label": "x", "enforced_by": "RANKING", "aliases": ["가"]}
    with pytest.raises(KbLoadError, match="key 중복"):
        load_directives({"kb": "DIRECTIVE", "directives": [
            {"key": "A", **base}, {"key": "A", **base}]})
    # 같은 말이 두 지시를 가리키면 매칭이 그날 운에 따라 갈린다.
    with pytest.raises(KbLoadError, match="alias 중복"):
        load_directives({"kb": "DIRECTIVE", "directives": [
            {"key": "A", **base}, {"key": "B", "label": "y",
                                   "enforced_by": "RANKING", "aliases": ["가"]}]})


def test_loader_rejects_empty_aliases() -> None:
    """alias 가 없으면 자유 입력이 그 지시에 영영 닿지 못한다."""
    with pytest.raises(KbLoadError, match="자유 입력이 닿을 수 없다"):
        load_directives({"kb": "DIRECTIVE", "directives": [
            {"key": "A", "label": "x", "enforced_by": "RANKING", "aliases": []}]})


def test_prompt_directive_needs_a_category_axis() -> None:
    """PROMPT 인데 카테고리가 없으면 모델에게 줄 판별 축이 없다 — 지시가 무력해진다."""
    with pytest.raises(ValueError, match="categories"):
        DirectiveSpec(key="A", label="x", enforced_by="PROMPT", aliases=("가",))


def test_non_prompt_directive_must_not_carry_categories() -> None:
    """아무도 안 읽는 값을 두면 다음 사람이 동작한다고 믿는다."""
    with pytest.raises(ValueError, match="카테고리"):
        DirectiveSpec(key="A", label="x", enforced_by="SOLVER", aliases=("가",),
                      prefer_categories=("CAFE",))


# ── 칩 경로 ────────────────────────────────────────────────────────────


def test_chips_resolve_and_unknown_comes_back() -> None:
    """모르는 키를 **버리지 않는 것**이 이 함수의 절반이다 (조용한 무시 금지)."""
    specs = (_spec("INDOOR", "안에서", enforced_by="PROMPT",
                   prefer_categories=("CAFE",)), _spec("NEARBY", "근처"))
    known, unknown = resolve_chips(["INDOOR", "NEW_CHIP", "NEARBY"], specs)
    assert [s.key for s in known] == ["INDOOR", "NEARBY"]
    assert unknown == ("NEW_CHIP",)


def test_chips_preserve_order_and_fold_duplicates() -> None:
    specs = (_spec("A", "가"), _spec("B", "나"))
    known, unknown = resolve_chips(["B", "A", "B"], specs)
    assert [s.key for s in known] == ["B", "A"]
    assert unknown == ()


# ── 자유 입력 매칭 ──────────────────────────────────────────────────────


def _loaded_store(specs, angles):
    """사전을 실제로 적재한 스토어 — 검색 경로를 그대로 탄다."""
    emb, store = _Angles(angles), InMemoryVectorStore()
    index_documents(directive_documents(specs), emb, store)
    return emb, store


def test_free_text_matches_alias_above_threshold() -> None:
    specs = (_spec("INDOOR", "비 피해서", enforced_by="PROMPT",
                   prefer_categories=("CAFE",)),)
    # 발화와 alias 를 같은 각도에 두면 코사인 1.0
    emb, store = _loaded_store(specs, {"비 피해서": 0.0, "indoor": 1.5, "비 오니까 안으로": 0.0})
    assert [s.key for s in match_free_text("비 오니까 안으로", specs, emb, store)] == ["INDOOR"]


def test_free_text_below_threshold_is_dropped() -> None:
    """닮지 않은 것을 억지로 고르면 사용자가 말하지 않은 방향으로 후보가 틀어진다."""
    specs = (_spec("INDOOR", "비 피해서", enforced_by="PROMPT",
                   prefer_categories=("CAFE",)),)
    # 각도차 1.0 → cos ≈ 0.54 < 0.82
    emb, store = _loaded_store(specs, {"비 피해서": 0.0, "indoor": 0.0, "전혀 다른 말": 1.0})
    assert match_free_text("전혀 다른 말", specs, emb, store) == ()


def test_free_text_picks_multiple_directives() -> None:
    """한 발화에 지시가 여럿 실릴 수 있다 — '실내로 하고 이동도 줄여줘'."""
    specs = (_spec("INDOOR", "안에서", enforced_by="PROMPT", prefer_categories=("CAFE",)),
             _spec("LESS_MOVE", "이동 짧게"))
    emb, store = _loaded_store(specs, {
        "안에서": 0.0, "indoor": 0.0, "이동 짧게": 0.05, "less_move": 0.05, "발화": 0.02})
    assert {s.key for s in match_free_text("발화", specs, emb, store)} == {"INDOOR", "LESS_MOVE"}


def test_same_key_collapses_to_one() -> None:
    """같은 지시의 alias 가 여럿 걸려도 지시는 하나다."""
    specs = (_spec("INDOOR", "안에서", "실내", "비 피해", enforced_by="PROMPT",
                   prefer_categories=("CAFE",)),)
    emb, store = _loaded_store(specs, {
        "안에서": 0.0, "실내": 0.0, "비 피해": 0.0, "indoor": 0.0, "발화": 0.0})
    assert [s.key for s in match_free_text("발화", specs, emb, store)] == ["INDOOR"]


def test_max_resolved_caps_the_result() -> None:
    """넘치면 프롬프트가 모순 지시로 채워진다."""
    specs = tuple(_spec(f"K{i}", f"말{i}") for i in range(6))
    angles = {f"말{i}": 0.0 for i in range(6)}
    angles.update({f"k{i}": 0.0 for i in range(6)})
    angles["발화"] = 0.0
    emb, store = _loaded_store(specs, angles)
    assert len(match_free_text("발화", specs, emb, store, top_k=20, max_resolved=2)) == 2


def test_store_failure_returns_empty_not_raise() -> None:
    """임베딩·스토어 장애로 재계획을 죽이지 않는다 — 칩 선택분은 그대로 살아 있다 (INV-4)."""
    class _Broken:
        def upsert(self, *a, **k): raise RuntimeError("down")
        def search(self, *a, **k): raise RuntimeError("down")
        def delete(self, *a, **k): raise RuntimeError("down")

    specs = (_spec("A", "가"),)
    assert match_free_text("아무 말", specs, _Angles({}), _Broken()) == ()


def test_empty_text_skips_search_entirely() -> None:
    specs = (_spec("A", "가"),)
    emb, store = _loaded_store(specs, {"가": 0.0, "a": 0.0})
    assert match_free_text("   ", specs, emb, store) == ()


def test_orphan_document_key_is_ignored() -> None:
    """사전을 줄이고 재적재를 안 하면 적재분이 없는 키를 가리킨다 — 조용히 쓰지 않는다."""
    old = (_spec("GONE", "사라진 말"),)
    emb, store = _loaded_store(old, {"사라진 말": 0.0, "gone": 0.0, "발화": 0.0})
    now = (_spec("KEPT", "남은 말"),)  # GONE 이 사전에서 빠졌다
    assert match_free_text("발화", now, emb, store) == ()


# ── 적재 형태 ──────────────────────────────────────────────────────────


def test_documents_carry_label_and_every_alias() -> None:
    """사용자가 칩 문구를 그대로 치는 경우가 흔하다 — 라벨도 문서로 넣는다."""
    spec = _spec("A", "가", "나")
    docs = directive_documents((spec,))
    assert [d.text for d in docs] == ["a", "가", "나"]
    assert all(d.kb is KbKind.DIRECTIVE for d in docs)
    assert all(d.metadata["key"] == "A" for d in docs)


def test_document_ids_are_stable_for_idempotent_reindex() -> None:
    spec = _spec("A", "가", "나")
    assert [d.doc_id for d in directive_documents((spec,))] == \
           [d.doc_id for d in directive_documents((spec,))]


@given(st.lists(st.sampled_from(["INDOOR", "NEARBY", "NOPE", "RELAX"]), max_size=8))
@settings(max_examples=40, deadline=None)
def test_pbt_chip_resolution_partitions_input(keys) -> None:
    """아는 것 ∪ 모르는 것 = 입력의 중복 제거분. 어느 쪽으로도 새지 않는다."""
    specs = load_directive_file(_DICT, yaml.safe_load)
    known, unknown = resolve_chips(keys, specs)
    assert {s.key for s in known} | set(unknown) == set(keys)
    assert not ({s.key for s in known} & set(unknown))
    assert len(known) + len(unknown) == len(set(keys))


def test_threshold_default_is_documented_value() -> None:
    """임계를 조용히 바꾸면 매칭 품질이 말없이 달라진다 — 실측값을 못 박는다.

    0.74 의 근거는 `scripts/measure_directive_match.py` 실측이다(2026-09-12,
    정확일치 18/23 · 오검출 0/8). 바꾸려면 그 스크립트를 다시 돌린다.
    """
    assert DEFAULT_MATCH_THRESHOLD == 0.74


def test_index_of_is_readonly_view() -> None:
    table = index_of((_spec("A", "가"),))
    with pytest.raises(TypeError):
        table["B"] = _spec("B", "나")  # type: ignore[index]
