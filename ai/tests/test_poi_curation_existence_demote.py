"""POOL-P7~P14 — 지도 미검출 강등 (TRIP-683 · pool_builder ⑤ 2순위 정렬 키).

| 속성 | 내용 |
|---|---|
| POOL-P7 | **미주입 불변**: 포트를 안 주면 종전 정렬 그대로 (호출 대상 자체가 없다) |
| **POOL-P8** | **강등이지 배제가 아니다**: 오염률 0~100% 스윕에 개수·후보집합 불변 |
| **POOL-P9** | **UNVERIFIED 는 강등 대상이 아니다**: 장애가 순서를 뒤집지 않는다 |
| POOL-P10 | 키 우선순위: 영업시간 보유 > 지도 미검출 > saved_count > rating > poi_id |
| POOL-P11 | 결정론: 같은 입력·같은 fake → 같은 풀·같은 호출 장부 |
| POOL-P12 | 조회 계약: 필터 생존분만·한 번에·마감은 `config.existence_deadline_ms` |
| POOL-P13 | 포트가 계약을 깨도(결손·중복·뒤섞임·유령 id) 풀은 후보를 잃지 않는다 |
| POOL-P14 | `existence_deadline_ms ≤ 0` → `M7Config` 생성이 ValueError |
| (물림) | 실 어댑터(KakaoExistenceAdapter)와 물린 채로 P8·P9 재확인 — **부분 검증** |

U3 FD §4 PBT 표는 POOL-P1~P4 까지다. P5·P6(영업시간 보유 신호)은
`test_poi_curation_pool.py` 가 같은 작명으로 이어 붙였고, 여기 P7~P14 가 그 다음
칸이다 — FD 갱신 시 그대로 옮겨 붙일 수 있다.

**적대적 우선.** 이 신호의 위험은 "폐업을 못 잡는 것"이 아니라 **"멀쩡한 가게를
버리는 것"**이다. 실측(pool_builder ⑤ 주석)이 배제를 기각한 근거가 그것이고 —
영업 중 오탐 4.0% × 모집단 배수 36 = 잘못 버리는 305건 vs 잡는 폐업 102건 —
그래서 아래 속성의 무게중심은 성공 경로(FOUND/NOT_FOUND 순서)가 아니라
**"어떤 판정이 와도 후보가 사라지지 않는가 / 장애가 순서를 바꾸지 않는가"**다.

실 외부 호출 0건 (D37): 지도 조회는 FakeExistence(포트 fake) 또는 실 어댑터 +
FakeHttpGetJson(전송 fake), 시계는 FakeClock, now 는 tz-aware 고정값
(`datetime.now` 금지). 전송 계층 지뢰로 자작 HTTP 회귀까지 막는다(P7 마지막).
"""

from __future__ import annotations

import urllib.request
from datetime import date, datetime, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TransportMode
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.adapters.kakao_existence import KakaoExistenceAdapter
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.ports.place_existence_port import ExistenceStatus, ExistenceVerdict

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_existence import FakeExistence
from tests.fakes.fake_http_get_json import FakeHttpGetJson
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.generators.poi_curation import (
    kakao_documents,
    malformed_payloads,
    pois_with_attrs,
    pool_requests,
    sortable_pois,
)

_CFG = M7Config()
_NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)   # datetime.now 금지
_ANCHOR = GeoPoint(37.751, 128.876)
_ALL_WEEK = tuple(OpenHour(d, 540, 1260) for d in range(7))

_FOUND = ExistenceStatus.FOUND
_NOT_FOUND = ExistenceStatus.NOT_FOUND
_UNVERIFIED = ExistenceStatus.UNVERIFIED


def _build(pois, request, *, existence=None, cfg: M7Config = _CFG):
    """포트 주입은 키워드로만 — 미주입 경로(2-인자 생성)와 구분해 읽히게 한다."""
    db = InMemoryPoi(seed=tuple(pois))
    builder = (CandidatePoolBuilder(db, cfg) if existence is None
               else CandidatePoolBuilder(db, cfg, existence))
    return builder.build(request, _NOW)


def _statuses(pois, flags, *, on=_NOT_FOUND, off=_FOUND) -> dict[PoiId, ExistenceStatus]:
    """flags 를 순환 적용한 판정표 — 오염률 0~100% 스윕의 손잡이."""
    return {p.poi_id: (on if flags[i % len(flags)] else off)
            for i, p in enumerate(pois)}


def _legacy_key(p: Poi) -> tuple:
    """**주입 전** 정렬 키 (영업시간 보유 → saved_count → rating → id).

    구현을 다시 쓴 것이 아니라 U3 FD §2 표의 '인기' 행 + TRIP-326 신호를
    테스트가 독립적으로 적은 것이다. 미주입 동작이 이 키에서 벗어나면 회귀다.
    """
    return (0 if p.open_hours else 1, -p.saved_count,
            -(p.rating or 0.0), str(p.poi_id))


def _demoted_key(missing):
    """강등 키 = 영업시간 보유 → **지도 미검출** → saved_count → rating → id."""
    def key(p: Poi) -> tuple:
        return (0 if p.open_hours else 1, 1 if p.poi_id in missing else 0,
                -p.saved_count, -(p.rating or 0.0), str(p.poi_id))
    return key


def _poi(pid: str, *, open_hours=(), saved_count=0, rating=None) -> Poi:
    return Poi(
        poi_id=PoiId(pid),
        name=pid,
        category=PoiCategory.SIGHT,
        coord=_ANCHOR,
        open_hours=open_hours,
        avg_cost=None,
        rating=rating,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
        saved_count=saved_count,
    )


def _request(**kw) -> CandidatePoolRequest:
    base = dict(
        anchor=_ANCHOR,
        dates=(date(2026, 8, 3),),
        budget=BudgetLevel.HIGH,
        transport=TransportMode.CAR,
        radius_override_km=None,
    )
    return CandidatePoolRequest(**{**base, **kw})


_POIS = st.lists(sortable_pois(), max_size=12, unique_by=lambda p: p.poi_id)
_FLAGS = st.lists(st.booleans(), min_size=1, max_size=12)


# ── POOL-P7: 미주입 불변 ────────────────────────────────────────────
#
# "포트 호출 0건"은 장부로 관찰할 수 없다 — 미주입이면 부를 **대상 자체가 없고**
# (`self._existence is None`), 몰래 부르려 해도 `None.verify` 는 AttributeError 라
# 아래 테스트가 즉시 터진다. 그래서 여기서는 "종전 정렬과 완전히 같은가"를
# 독립 오라클(_legacy_key)로 못 박는다.


@settings(max_examples=60)
@given(pois=_POIS, request=pool_requests())
def test_pool_p7_default_construction_keeps_legacy_order(pois, request) -> None:
    """미주입(2-인자 생성) 결과는 주입 전 키로 정렬돼 있다 — 신규 키 무동작."""
    pool = _build(pois, request)
    assert list(pool.pois) == sorted(pool.pois, key=_legacy_key)


@settings(max_examples=60)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_p7_explicit_none_equals_default(pois, request) -> None:
    """`existence=None` 명시와 미주입은 같은 풀 — 기본값이 곧 종전 동작이다.

    필터 탈락이 섞인 일반 분포(pois_with_attrs)로도 돌려 ①~④ 경로까지 덮는다.
    """
    db = InMemoryPoi(seed=tuple(pois))
    assert CandidatePoolBuilder(db, _CFG, None).build(request, _NOW) == _build(
        pois, request)


def test_pool_p7_builder_never_makes_its_own_transport(monkeypatch) -> None:
    """D37 — 빌더는 전송을 **자작하지 않는다** (실 HTTP 0건).

    미주입 경로의 "호출 0건"은 장부로 못 본다. 대신 전송 계층에 지뢰를 깔아,
    빌더가 환경변수 보고 어댑터를 스스로 만들어 나가는 류의 회귀를 잡는다.
    포트를 주입한 경로도 같은 지뢰 위에서 돈다 — fake 만 쓰는지 확인.
    """
    def boom(*args, **kwargs):
        raise AssertionError("실 HTTP 호출이 나갔다 (D37 위반)")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    pois = [_poi("a", saved_count=2), _poi("b", open_hours=_ALL_WEEK)]
    expected = {PoiId("a"), PoiId("b")}

    assert _build(pois, _request()).poi_ids == expected          # 미주입
    fake = FakeExistence(default=_NOT_FOUND)
    assert _build(pois, _request(), existence=fake).poi_ids == expected
    assert fake.call_count == 1


@settings(max_examples=60)
@given(pois=_POIS, request=pool_requests())
def test_pool_p7_all_found_equals_no_port(pois, request) -> None:
    """포트가 전부 FOUND 면 미주입과 **완전히 동일**한 풀 — 강등할 것이 없다."""
    fake = FakeExistence(default=_FOUND)
    assert _build(pois, request, existence=fake) == _build(pois, request)
    assert fake.call_count == (1 if pois else 0)


# ── POOL-P8: 강등이지 배제가 아니다 (핵심) ──────────────────────────


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS)
def test_pool_p8_demotion_never_drops_candidates(pois, request, flags) -> None:
    """미검출 비율 0~100% 어디서도 개수·후보집합이 미주입과 같다 (순열일 뿐).

    flags 가 전부 False 면 오염 0%, 전부 True 면 100% — 그 사이를 hypothesis 가
    쓸어낸다. 실패하면 강등이 조용히 배제로 변질된 것이다.
    """
    base = _build(pois, request)
    fake = FakeExistence(_statuses(pois, flags))
    demoted = _build(pois, request, existence=fake)

    assert len(demoted.pois) == len(base.pois)
    assert demoted.poi_ids == base.poi_ids
    assert (sorted(demoted.pois, key=lambda p: str(p.poi_id))
            == sorted(base.pois, key=lambda p: str(p.poi_id)))    # 같은 원소
    assert demoted.radius_km == base.radius_km
    assert demoted.generated_at == base.generated_at


@settings(max_examples=60)
@given(pois=_POIS, request=pool_requests())
def test_pool_p8_all_not_found_pool_is_identical(pois, request) -> None:
    """**전부 미검출이면 순서까지 미주입과 같다** — 다 같이 한 칸 밀리면 제자리다.

    "전부 폐업으로 찍히는 날"이 최악이 아니라 **무해**하다는 뜻이다. 여기서
    순서가 변한다면 신규 키가 동률 그룹을 흔들고 있다는 신호다.
    """
    assert _build(pois, request, existence=FakeExistence(default=_NOT_FOUND)) == (
        _build(pois, request))


@settings(max_examples=60)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS,
       cap=st.integers(min_value=1, max_value=12))
def test_pool_p8_count_preserved_even_when_cap_truncates(
    pois, request, flags, cap
) -> None:
    """⑥ 상한이 잘라도 **개수는 미주입과 같다** — 강등은 자리를 옮길 뿐이다.

    절단이 걸리면 살아남는 **구성원**은 달라질 수 있다(그게 강등의 목적이다).
    달라지면 안 되는 것은 개수와 "풀 밖에서 아무도 들어오지 않는다"는 것.
    """
    cfg = M7Config(max_candidates=cap)
    base = _build(pois, request, cfg=cfg)
    demoted = _build(pois, request, existence=FakeExistence(_statuses(pois, flags)),
                     cfg=cfg)

    assert len(demoted.pois) == len(base.pois)
    assert len(demoted.pois) == len(demoted.poi_ids)         # 중복 유입 0
    assert demoted.poi_ids <= _build(pois, request).poi_ids  # 유령 유입 0


def test_pool_p8_unit_all_not_found_keeps_every_candidate() -> None:
    """예제 — 전 후보가 미검출이어도 풀은 3건 그대로 (필터 아님)."""
    pois = [_poi("a"), _poi("b"), _poi("c")]
    pool = _build(pois, _request(), existence=FakeExistence(default=_NOT_FOUND))
    assert pool.poi_ids == {p.poi_id for p in pois}
    assert len(pool.pois) == 3


# ── POOL-P9: UNVERIFIED 는 강등 대상이 아니다 ──────────────────────


@settings(max_examples=60)
@given(pois=_POIS, request=pool_requests())
def test_pool_p9_all_unverified_equals_no_port(pois, request) -> None:
    """포트가 통째로 죽어(전부 UNVERIFIED) 돌아와도 순서가 미주입과 같다.

    장애를 강등으로 수렴시키면 벤더가 죽는 날 후보 순서가 통째로 뒤집힌다.
    """
    assert _build(pois, request, existence=FakeExistence(default=_UNVERIFIED)) == (
        _build(pois, request))


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS)
def test_pool_p9_partial_failure_never_reorders(pois, request, flags) -> None:
    """실패율 0~100% 스윕: FOUND·UNVERIFIED 만 섞이면 풀이 미주입과 **동일**.

    NOT_FOUND 가 한 건도 없으므로 순서가 바뀌면 UNVERIFIED 가 강등으로
    새어나온 것이다 (EXIST-P3 '장애 ≠ 폐업'의 호출측 대응 속성).
    """
    fake = FakeExistence(_statuses(pois, flags, on=_UNVERIFIED, off=_FOUND))
    assert _build(pois, request, existence=fake) == _build(pois, request)


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(),
       kinds=st.lists(st.sampled_from([_FOUND, _NOT_FOUND, _UNVERIFIED]),
                      min_size=1, max_size=12))
def test_pool_p9_unverified_ranks_with_found_not_with_not_found(
    pois, request, kinds
) -> None:
    """3상태가 임의로 섞여도 UNVERIFIED 는 FOUND 와 같은 칸에 선다.

    오라클: UNVERIFIED 를 FOUND 로 바꿔 부른 풀과 결과가 같아야 한다 —
    '모른다'가 '없다'로 기울면 여기서 갈린다.
    """
    table = {p.poi_id: kinds[i % len(kinds)] for i, p in enumerate(pois)}
    as_found = {k: (_FOUND if v is _UNVERIFIED else v) for k, v in table.items()}
    assert _build(pois, request, existence=FakeExistence(table)) == _build(
        pois, request, existence=FakeExistence(as_found))


# ── POOL-P10: 키 우선순위 ───────────────────────────────────────────


def test_pool_p10_unit_open_hours_outranks_map_miss() -> None:
    """예제 — 영업시간 보유 + 미검출이 영업시간 없음 + 검출됨보다 **앞**."""
    pool = _build(
        [_poi("z-open-missing", open_hours=_ALL_WEEK), _poi("a-none-found")],
        _request(),
        existence=FakeExistence({PoiId("z-open-missing"): _NOT_FOUND,
                                 PoiId("a-none-found"): _FOUND}),
    )
    assert [str(p.poi_id) for p in pool.pois] == ["z-open-missing", "a-none-found"]


def test_pool_p10_unit_map_miss_outranks_saved_count() -> None:
    """예제 — 같은 영업시간 그룹에서 미검출은 저장 수 999 를 이기지 못한다."""
    pool = _build(
        [_poi("a-hot-missing", saved_count=999), _poi("z-cold-found", saved_count=0)],
        _request(),
        existence=FakeExistence({PoiId("a-hot-missing"): _NOT_FOUND,
                                 PoiId("z-cold-found"): _FOUND}),
    )
    assert [str(p.poi_id) for p in pool.pois] == ["z-cold-found", "a-hot-missing"]


def test_pool_p10_unit_tie_break_is_poi_id() -> None:
    """예제 — 모든 키가 같으면 poi_id 오름차순 (결정론의 바닥)."""
    pois = [_poi("c"), _poi("a"), _poi("b")]
    pool = _build(pois, _request(), existence=FakeExistence(default=_NOT_FOUND))
    assert [str(p.poi_id) for p in pool.pois] == ["a", "b", "c"]


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS)
def test_pool_p10_open_hours_group_is_untouched_by_map_miss(
    pois, request, flags
) -> None:
    """영업시간 보유 구간이 언제나 앞 — 미검출이 그 경계를 넘지 못한다 (P5 회귀)."""
    fake = FakeExistence(_statuses(pois, flags))
    has_none = [not p.open_hours for p in _build(pois, request, existence=fake).pois]
    assert has_none == sorted(has_none)


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS)
def test_pool_p10_map_miss_sinks_within_each_open_hours_group(
    pois, request, flags
) -> None:
    """같은 영업시간 그룹 **안에서만** 미검출이 뒤로 밀린다."""
    table = _statuses(pois, flags)
    missing = {pid for pid, s in table.items() if s is _NOT_FOUND}
    pool = _build(pois, request, existence=FakeExistence(table))

    for has_hours in (True, False):
        group = [p for p in pool.pois if bool(p.open_hours) is has_hours]
        marks = [p.poi_id in missing for p in group]
        assert marks == sorted(marks)  # 검출(False) 구간이 미검출(True)보다 앞


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS)
def test_pool_p10_secondary_keys_hold_within_subgroup(pois, request, flags) -> None:
    """(영업시간, 미검출) 부분군 안에서는 saved_count↓ → rating↓ → id↑ 유지."""
    table = _statuses(pois, flags)
    missing = {pid for pid, s in table.items() if s is _NOT_FOUND}
    pool = _build(pois, request, existence=FakeExistence(table))

    for has_hours in (True, False):
        for miss in (True, False):
            group = [p for p in pool.pois
                     if bool(p.open_hours) is has_hours
                     and (p.poi_id in missing) is miss]
            keys = [(-p.saved_count, -(p.rating or 0.0), str(p.poi_id))
                    for p in group]
            assert keys == sorted(keys)


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS)
def test_pool_p10_full_order_matches_fd_key(pois, request, flags) -> None:
    """전체 순서 = FD 표의 5단 키 정렬 (테스트가 독립적으로 적은 오라클)."""
    table = _statuses(pois, flags)
    missing = {pid for pid, s in table.items() if s is _NOT_FOUND}
    pool = _build(pois, request, existence=FakeExistence(table))
    assert list(pool.pois) == sorted(pool.pois, key=_demoted_key(missing))


# ── POOL-P11: 결정론 ────────────────────────────────────────────────


@settings(max_examples=60)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS,
       deadline=st.integers(min_value=1, max_value=30_000))
def test_pool_p11_same_input_same_pool_and_same_calls(
    pois, request, flags, deadline
) -> None:
    """같은 입력·같은 fake 두 번 → 같은 풀, 같은 호출 장부 (숨은 상태 없음)."""
    cfg = M7Config(existence_deadline_ms=deadline)

    def run():
        fake = FakeExistence(_statuses(pois, flags))
        pool = _build(pois, request, existence=fake, cfg=cfg)
        return pool, fake.calls

    assert run() == run()


# ── POOL-P12: 조회 계약 (대상·횟수·마감) ────────────────────────────


@settings(max_examples=60)
@given(pois=st.lists(sortable_pois(), min_size=1, max_size=10,
                     unique_by=lambda p: p.poi_id),
       request=pool_requests(),
       deadline=st.integers(min_value=1, max_value=100_000))
def test_pool_p12_deadline_comes_from_config(pois, request, deadline) -> None:
    """포트에 넘어간 deadline_ms == `config.existence_deadline_ms`, 호출은 1회."""
    fake = FakeExistence()
    _build(pois, request, existence=fake,
           cfg=M7Config(existence_deadline_ms=deadline))

    assert fake.call_count == 1                       # POI 마다가 아니라 일괄 1회
    assert [d for _, d in fake.calls] == [deadline]


def test_pool_p12_unit_default_deadline_is_1500ms() -> None:
    """기본 마감 1,500ms — 생성 마감 25s 의 곁가지 예산 (config 정본)."""
    fake = FakeExistence()
    _build([_poi("a")], _request(), existence=fake)
    assert _CFG.existence_deadline_ms == 1_500
    assert fake.calls[0][1] == 1_500


@settings(max_examples=60)
@given(pois=st.lists(pois_with_attrs(), max_size=15, unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_p12_only_surviving_candidates_are_queried(pois, request) -> None:
    """필터(①~④)에서 떨어진 POI 는 조회하지 않는다 — 벤더 호출 예산·노출 최소화.

    반대 방향도 함께 본다: 살아남은 후보는 **빠짐없이** 조회된다(누락된 자리는
    영원히 '모름'이 되므로 강등 신호가 조용히 무동작이 된다).
    """
    base = _build(pois, request)          # 기본 상한(5,000) — 절단 없음
    fake = FakeExistence()
    _build(pois, request, existence=fake)

    assert set(fake.queried_ids) == set(base.poi_ids)
    assert len(fake.queried_ids) == len(set(fake.queried_ids))   # 중복 조회 0


@settings(max_examples=60)
@given(pois=st.lists(sortable_pois(), min_size=1, max_size=10,
                     unique_by=lambda p: p.poi_id),
       request=pool_requests())
def test_pool_p12_queries_carry_name_and_coord(pois, request) -> None:
    """조회 1건은 (poi_id, name, coord) — 이름만으로는 동명이 걸린다."""
    by_id = {p.poi_id: p for p in pois}
    fake = FakeExistence()
    _build(pois, request, existence=fake)

    for queries, _ in fake.calls:
        for q in queries:
            assert q.name == by_id[q.poi_id].name
            assert q.coord == by_id[q.poi_id].coord


@settings(max_examples=40)
@given(request=pool_requests(), deadline=st.integers(min_value=1, max_value=5_000))
def test_pool_p12_no_candidates_means_no_call(request, deadline) -> None:
    """후보가 0건이면 주입돼 있어도 부르지 않는다 — 빈 조회로 예산을 태우지 않는다."""
    fake = FakeExistence()
    pool = _build([], request, existence=fake,
                  cfg=M7Config(existence_deadline_ms=deadline))
    assert pool.pois == ()
    assert fake.calls == []


@settings(max_examples=40)
@given(pois=_POIS, request=pool_requests(), cap=st.integers(min_value=1, max_value=6))
def test_pool_p12_every_survivor_was_asked_about(pois, request, cap) -> None:
    """상한 절단이 걸려도 살아남은 후보는 전부 조회 대상이었다.

    부분집합 방향으로만 주장한다 — 구현은 현재 **절단 앞에서** 돌아 필터 생존분
    전체를 묻지만(호출 예산은 어댑터 몫), 나중에 절단 뒤로 옮겨 호출을 줄이더라도
    이 성질은 그대로여야 한다.
    """
    fake = FakeExistence()
    pool = _build(pois, request, existence=fake, cfg=M7Config(max_candidates=cap))
    assert set(pool.poi_ids) <= set(fake.queried_ids)


# ── POOL-P13: 포트가 계약을 깨도 후보를 잃지 않는다 ─────────────────


def _ghost(vs):
    """풀에 없는 poi_id 에 NOT_FOUND 를 붙여 돌려주는 사고."""
    return vs + (ExistenceVerdict(PoiId("ghost-없는곳"), _NOT_FOUND),)


_MANGLERS = {
    "empty": lambda vs: (),                       # 판정을 통째로 빼먹음
    "half": lambda vs: vs[::2],                   # 절반 결손
    "reversed": lambda vs: tuple(reversed(vs)),   # 순서 뒤집힘
    "duplicated": lambda vs: vs + vs,             # 중복 판정
    "ghost": _ghost,                              # 유령 poi_id
}


@settings(max_examples=100)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS,
       kind=st.sampled_from(sorted(_MANGLERS)))
def test_pool_p13_broken_port_contract_keeps_pool_intact(
    pois, request, flags, kind
) -> None:
    """결손·중복·뒤섞임·유령 id 어느 사고에도 개수·후보집합이 미주입과 같다.

    포트 계약(개수·순서 보존)은 어댑터가 지키지만, 호출측이 그 계약에 **매달려
    있으면** 벤더 어댑터 교체 한 번에 후보가 사라진다. 순서는 달라져도 좋다 —
    사라지는 것만 아니면 된다.
    """
    base = _build(pois, request)
    fake = FakeExistence(_statuses(pois, flags), mangle=_MANGLERS[kind])
    out = _build(pois, request, existence=fake)

    assert out.poi_ids == base.poi_ids
    assert len(out.pois) == len(base.pois)
    assert PoiId("ghost-없는곳") not in out.poi_ids
    # 순서는 **실제로 돌아온** NOT_FOUND 집합만 따른다 (빠진 자리는 '모름').
    assert list(out.pois) == sorted(out.pois, key=_demoted_key(fake.not_found_ids))


@settings(max_examples=60)
@given(pois=_POIS, request=pool_requests(), flags=_FLAGS)
def test_pool_p13_missing_verdict_is_unknown_not_demoted(pois, request, flags) -> None:
    """판정이 **빠진 자리는 '모름'** — 안 왔다고 뒤로 밀지 않는다.

    NOT_FOUND 만 골라 빼고 돌려주면 강등 근거가 0건이 되므로 풀은 미주입과 같다.
    """
    fake = FakeExistence(
        _statuses(pois, flags),
        mangle=lambda vs: tuple(v for v in vs if v.status is not _NOT_FOUND),
    )
    assert _build(pois, request, existence=fake) == _build(pois, request)


# ── POOL-P14: config 검증 ───────────────────────────────────────────


@given(bad=st.integers(max_value=0))
def test_pool_p14_nonpositive_deadline_is_rejected(bad) -> None:
    """마감 ≤ 0 은 설정 자체가 불가능 — '0ms 마감'은 전 후보 UNVERIFIED 다."""
    with pytest.raises(ValueError):
        M7Config(existence_deadline_ms=bad)


@given(good=st.integers(min_value=1, max_value=10**7))
def test_pool_p14_positive_deadline_is_kept_as_is(good) -> None:
    """양수는 그대로 보관 — 클램프·반올림 없이 포트에 그 값이 간다."""
    assert M7Config(existence_deadline_ms=good).existence_deadline_ms == good


# ── 실 어댑터와 물린 상태 (KakaoExistenceAdapter × 빌더) ────────────
#
# FakeExistence 는 **판정이 오는 경우**만 그린다. 운영에서 실제로 오는 것은
# 마감·예산에 잘린 **부분 판정**이다(어댑터는 순차 1건=1호출, 재시도 없음) —
# 그 조합에서도 후보가 사라지지 않는지는 층을 물려야만 보인다.
# 전송은 FakeHttpGetJson, 시계는 FakeClock 논리 시계 — 실 HTTP 0건 (D37).

_NONEMPTY_POIS = st.lists(sortable_pois(), min_size=1, max_size=8,
                          unique_by=lambda p: p.poi_id)


def _kakao(http, *, max_calls: int = 1_000, clock: FakeClock | None = None):
    return KakaoExistenceAdapter(
        http, "test-rest-key", max_calls=max_calls,
        monotonic_ms=(clock or FakeClock(1_000_000)).monotonic_ms,
    )


@settings(max_examples=40)
@given(pois=_NONEMPTY_POIS, request=pool_requests(),
       exc=st.sampled_from([TimeoutError("timed out"), ConnectionError("reset"),
                            OSError("dns failure"), RuntimeError("429")]))
def test_integration_transport_down_changes_nothing(pois, request, exc) -> None:
    """카카오가 죽은 날 후보 순서가 통째로 그대로 — 전송 장애 → 전부 UNVERIFIED."""
    http = FakeHttpGetJson(default=exc)
    assert _build(pois, request, existence=_kakao(http)) == _build(pois, request)
    assert len(http.calls) == len(_build(pois, request).pois)   # 던져도 호출은 나간다


@settings(max_examples=40)
@given(pois=_NONEMPTY_POIS, request=pool_requests(), junk=malformed_payloads())
def test_integration_malformed_response_changes_nothing(pois, request, junk) -> None:
    """벤더가 응답 스키마를 바꿔도 강등 0건 (EXIST-P3 의 호출측 대응)."""
    http = FakeHttpGetJson(default=junk)
    assert _build(pois, request, existence=_kakao(http)) == _build(pois, request)


@settings(max_examples=40)
@given(pois=_NONEMPTY_POIS, request=pool_requests())
def test_integration_zero_call_budget_makes_no_http_and_no_change(
    pois, request
) -> None:
    """예산 0 → HTTP 0건, 풀은 미주입과 동일 (검증이 꺼져도 생성은 돈다)."""
    http = FakeHttpGetJson(default=kakao_documents(0))
    assert _build(pois, request, existence=_kakao(http, max_calls=0)) == _build(
        pois, request)
    assert http.calls == []


@settings(max_examples=40)
@given(pois=_NONEMPTY_POIS, request=pool_requests())
def test_integration_all_missing_on_map_keeps_every_candidate(pois, request) -> None:
    """전 후보가 지도에 없어도(documents=[]) 풀은 미주입과 **완전히 동일**하다."""
    http = FakeHttpGetJson(default=kakao_documents(0))
    pool = _build(pois, request, existence=_kakao(http))
    base = _build(pois, request)
    assert pool == base
    assert len(http.calls) == len(base.pois)


@settings(max_examples=40)
@given(pois=st.lists(sortable_pois(), min_size=2, max_size=8,
                     unique_by=lambda p: p.poi_id),
       request=pool_requests(), overrun=st.integers(min_value=1, max_value=5_000))
def test_integration_partial_verification_demotes_exactly_what_was_verified(
    pois, request, overrun
) -> None:
    """마감이 첫 호출에서 날아가면 **딱 그 한 건만** 강등된다 — 나머지는 '모름'.

    운영의 기본 모양이다: 후보 수천 × 순차 호출 × 1.5s 마감이면 앞 몇 건만
    검증된다. 그때 뒤쪽이 '미검출'로 물들면(또는 검증분이 그대로면) 신호가
    거짓말이 된다.

    조회 순서는 **정렬된 순서**다 — 검증이 정렬·절단 뒤로 옮겨졌기 때문에(TRIP-683),
    마감에 잘려도 **실제로 화면에 오를 1순위 후보**가 검증된다. 옮기기 전에는
    `PoiDbPort.find_by_radius` 반환 순서(포트 계약에 규정 없음)가 검증 대상을
    정했다 — 노출되지도 않을 후보를 검증하고 있었다.
    """
    clock = FakeClock(1_000_000)
    http = FakeHttpGetJson(
        default=kakao_documents(0),                      # 응답은 전부 '없음'
        on_call=lambda: clock.advance(_CFG.existence_deadline_ms + overrun),
    )
    base = _build(pois, request)
    pool = _build(pois, request, existence=_kakao(http, clock=clock))

    assert len(http.calls) == 1                           # 초과는 1건으로 묶인다
    verified = base.pois[0].poi_id            # 정렬 1순위 = 실제로 노출될 것
    assert pool.poi_ids == base.poi_ids
    assert list(pool.pois) == sorted(pool.pois,
                                     key=_demoted_key(frozenset({verified})))
