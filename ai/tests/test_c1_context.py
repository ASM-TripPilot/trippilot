"""U4-04 — ContextResolver 권한 재조회 (D31, BR-U4-07) + PersonaSummary 왕복.

CTX-P1: owner ≠ principal인 ref가 하나라도 있으면 PermissionDeniedError, 부분 성공 0
        (조회 자체가 시작되지 않음 — store 접근 0회)
SER-P1: PersonaSummary 직렬화 왕복 (U5-P10 승계)
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.c1.context import ContextResolver
from trippilot.domain.common import BudgetLevel
from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag

_PRINCIPAL = Principal(user_id="u-owner")


class RecordingStore:
    """조회 호출을 기록하는 fake — '부분 성공 0'을 접근 횟수로 증명."""

    def __init__(self, data: dict[str, object] | None = None) -> None:
        self._data = data or {}
        self.get_calls: list[ResourceRef] = []

    def get(self, ref: ResourceRef) -> object | None:
        self.get_calls.append(ref)
        return self._data.get(ref.ref_id)


def _refs(owners: list[str]) -> tuple[ResourceRef, ...]:
    return tuple(
        ResourceRef(kind="persona", ref_id=f"r{i}", owner_id=o)
        for i, o in enumerate(owners)
    )


# ── CTX-P1: 권한 위반 = 즉시 예외 · 부분 성공 0 ──────────────


@given(
    owners=st.lists(
        st.sampled_from(["u-owner", "u-intruder"]), min_size=1, max_size=6
    )
)
def test_ctx_p1_any_foreign_owner_denies_all(owners: list[str]) -> None:
    store = RecordingStore({f"r{i}": f"v{i}" for i in range(len(owners))})
    resolver = ContextResolver(store)
    refs = _refs(owners)

    if "u-intruder" in owners:
        with pytest.raises(PermissionDeniedError):
            resolver.resolve_many(_PRINCIPAL, refs)
        assert store.get_calls == []  # 부분 성공 0 — 조회 시작 자체가 없음
    else:
        values = resolver.resolve_many(_PRINCIPAL, refs)
        assert values == tuple(f"v{i}" for i in range(len(owners)))
        assert len(store.get_calls) == len(owners)


def test_missing_resource_is_lookup_error_not_permission() -> None:
    resolver = ContextResolver(RecordingStore({}))  # 빈 저장소
    ref = ResourceRef(kind="persona", ref_id="r0", owner_id="u-owner")
    with pytest.raises(LookupError):
        resolver.resolve(_PRINCIPAL, ref)


def test_single_resolve_returns_value() -> None:
    resolver = ContextResolver(RecordingStore({"r0": "persona-v"}))
    ref = ResourceRef(kind="persona", ref_id="r0", owner_id="u-owner")
    assert resolver.resolve(_PRINCIPAL, ref) == "persona-v"


# ── SER-P1: PersonaSummary 직렬화 왕복 ───────────────────────


def personas() -> st.SearchStrategy[PersonaSummary]:
    return st.builds(
        PersonaSummary,
        taste_tags=st.lists(
            st.sampled_from(list(TasteTag)), unique=True, max_size=7
        ).map(tuple),
        companion=st.sampled_from(list(CompanionType)),
        budget=st.sampled_from(list(BudgetLevel)),
    )


@given(personas())
def test_ser_p1_persona_roundtrip(p: PersonaSummary) -> None:
    assert PersonaSummary.from_dict(p.to_dict()) == p
