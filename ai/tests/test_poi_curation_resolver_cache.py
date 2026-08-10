"""U3 — 엔티티 해소(RES-P1/P2) + 캐시 정책(CACHE-P1/P2).

해소: "성심땅"→"성심당" 오타 매칭이 결정론 fuzzy로 되는지 (AI-D04 실증).
캐시: 가격이 캐시에 저장된 적 0건(구조 차단) + TTL 만료 시 원본 재조회.
"""

from __future__ import annotations

from datetime import date

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi_curation import EntityMatch, MatchDecision
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.cached_repo import CachedPoiRepository
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.entity_resolver import fuzzy_match, similarity

from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.spy_cache import SpyCache
from tests.generators.poi_curation import pois_with_attrs

_CFG = M7Config()


def _poi(pid: str, name: str, cost: int | None = None) -> Poi:
    return Poi(PoiId(pid), name, PoiCategory.FOOD, GeoPoint(36.33, 127.43),
               (OpenHour(0, 540, 1260),), cost, 4.5,
               DataQuality.FULL, PoiSource.SEED, None)


_POIS = [_poi("p1", "성심당"), _poi("p2", "테라로사"), _poi("p3", "안목해변")]


# ── RES: 엔티티 해소 ─────────────────────────────────────────
def test_exact_match_is_auto_with_full_confidence() -> None:
    m = fuzzy_match("성심당", _POIS, _CFG)
    assert m.decision is MatchDecision.AUTO
    assert m.poi_id == PoiId("p1") and m.confidence == 1.0


def test_typo_seongsimddang_resolves_to_seongsimdang() -> None:
    """AI-D04의 그 예시 — '성심땅' 오타."""
    m = fuzzy_match("성심땅", _POIS, _CFG)
    assert m.poi_id == PoiId("p1")           # 유령이 아니라 실제 항목으로
    assert m.decision is not MatchDecision.UNRESOLVED
    assert m.confidence >= _CFG.match_confirm


def test_gibberish_is_unresolved() -> None:
    m = fuzzy_match("zzqqxx임의문자열", _POIS, _CFG)
    assert m.decision is MatchDecision.UNRESOLVED
    assert m.poi_id is None                  # → 웹 소싱(U6)으로 위임될 신호


# RES-P1 — 결정론
@settings(max_examples=40)
@given(name=st.text(min_size=1, max_size=15),
       pois=st.lists(pois_with_attrs(), max_size=8, unique_by=lambda p: p.poi_id))
def test_fuzzy_match_is_deterministic(name, pois) -> None:
    assert fuzzy_match(name, pois, _CFG) == fuzzy_match(name, pois, _CFG)


# RES-P2 — decision과 confidence 임계 정합
@settings(max_examples=40)
@given(name=st.text(min_size=1, max_size=15),
       pois=st.lists(pois_with_attrs(), max_size=8, unique_by=lambda p: p.poi_id))
def test_decision_consistent_with_thresholds(name, pois) -> None:
    m = fuzzy_match(name, pois, _CFG)
    if m.decision is MatchDecision.AUTO:
        assert m.confidence >= _CFG.match_auto
    elif m.decision is MatchDecision.CONFIRM:
        assert _CFG.match_confirm <= m.confidence < _CFG.match_auto
    else:
        assert m.confidence < _CFG.match_confirm or not pois
    # 직렬화 왕복 (U5-P10 승계)
    assert EntityMatch.from_dict(m.to_dict()) == m


# 유사도 기본 성질
@given(s=st.text(max_size=15))
def test_similarity_identity(s) -> None:
    assert similarity(s, s) == 1.0


# ── CACHE: 캐시 정책 ─────────────────────────────────────────
class _CountingSource(InMemoryPoi):
    def __init__(self, seed=()):
        super().__init__(seed)
        self.calls = 0

    def find_by_ids(self, ids):
        self.calls += 1
        return super().find_by_ids(ids)


# CACHE-P1 — 어떤 조회 시퀀스에도 avg_cost가 캐시에 저장된 적 없음
@settings(max_examples=30)
@given(pois=st.lists(pois_with_attrs(), min_size=1, max_size=8,
                     unique_by=lambda p: p.poi_id),
       picks=st.lists(st.integers(0, 7), min_size=1, max_size=6))
def test_price_never_stored_in_cache(pois, picks) -> None:
    spy = SpyCache()
    repo = CachedPoiRepository(_CountingSource(tuple(pois)), spy, _CFG)
    for k in picks:
        pid = pois[k % len(pois)].poi_id
        repo.find_by_ids(frozenset({pid}))
        repo.get_open_window(pid, date(2026, 8, 3))
    for _key, value in spy.set_calls:
        assert "avg_cost" not in value       # 구조 차단 확인 (G195)


# CACHE-P2 — TTL 이내 캐시 히트, 만료 후 원본 재조회 + 히트는 가격 없음
def test_ttl_hit_then_expiry_refetch() -> None:
    src = _CountingSource((_poi("p1", "성심당", cost=8000),))
    spy = SpyCache()
    repo = CachedPoiRepository(src, spy, _CFG)
    ids = frozenset({PoiId("p1")})

    first = repo.find_by_ids(ids)
    assert src.calls == 1 and first[0].avg_cost == 8000   # 미스 → 원본 (가격 있음)

    second = repo.find_by_ids(ids)
    assert src.calls == 1                                  # TTL 내 → 캐시 히트
    assert second[0].avg_cost is None                      # 히트엔 가격 없음 — 원본 조회 필요 명시

    spy.advance(_CFG.poi_ttl_sec)                          # 논리 시계로 만료
    third = repo.find_by_ids(ids)
    assert src.calls == 2 and third[0].avg_cost == 8000    # 만료 → 원본 재조회
