"""두 슬롯 사이 넣기 — 파서·자리 해소·후보 순위·기준점 삽입·재타이밍 (agents/edit/insert_between.py · commands.py).

경계 관통(번역기 우회·구간 풀·실패 사유)은 `tests/api/test_api_edit_insert_between.py` 가 본다.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import time
from dataclasses import replace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.edit.commands import EditRejected, RetimeContext, apply_command, retime_day
from trippilot.agents.edit.insert_between import (
    Shape,
    SlotRef,
    detour_km,
    parse_insert_ask,
    parse_insert_place,
    rank_on_segment,
    resolve_gap,
    segment_anchor,
)
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator, haversine_km
from trippilot.domain.common import GeoPoint, PoiId, TransportMode
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.domain.itinerary import DaySolution, VisitSlot
from trippilot.domain.poi import NIGHTLIFE_TAG, TRENDING_TAG, DataQuality, OpenHour, Poi, PoiCategory, PoiSource

KST = timezone(timedelta(hours=9))
D = date(2026, 10, 21)  # 수요일


def _poi(n: int, name: str, cat: PoiCategory, lat: float, lng: float, *, tags=(), hours=()) -> Poi:
    return Poi(PoiId(f"p{n}"), name, cat, GeoPoint(lat, lng), tuple(hours), None, None, DataQuality.FULL,
               PoiSource.SEED, None, tags=tuple(tags))


# ── 파서 ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("utterance, expected", [
    ("이태원에서 홍대로 넘어갈 때 한 군데 더 추가했으면 좋겠어", (Shape.BETWEEN, "이태원", "홍대", None)),
    ("이태원에서 홍대 갈 때 한 군데 더 넣어줘", (Shape.BETWEEN, "이태원", "홍대", None)),  # '갈'은 '가'가 아니다(한 음절)
    ("이태원에서 홍대 갈 때 중간에 들를 곳 추가", (Shape.BETWEEN, "이태원", "홍대", None)),
    ("이태원에서 홍대 넘어가는 중간에 어디 하나 끼워줘", (Shape.BETWEEN, "이태원", "홍대", None)),
    ("이태원이랑 홍대 사이에 카페 하나 넣어줘", (Shape.BETWEEN, "이태원", "홍대", PoiCategory.CAFE)),
    ("이태원 끝나고 홍대 가기 전에 한 곳 더", (Shape.BETWEEN, "이태원", "홍대", None)),
    ("홍대 가기 전에 카페 하나 넣어줘", (Shape.BEFORE, None, "홍대", PoiCategory.CAFE)),
    ("홍대 가는 길에 뭐 하나 넣자", (Shape.BEFORE, None, "홍대", None)),
    ("남산 다음에 갈 만한 곳 하나 추가해줘", (Shape.AFTER, "남산", None, None)),
    ("이태원이랑 홍대 사이에 미술관 하나 넣어줘", (Shape.BETWEEN, "이태원", "홍대", PoiCategory.ART)),  # 문화에서 갈라짐
    ("이태원에서 홍대 갈 때 박물관 하나 넣어줘", (Shape.BETWEEN, "이태원", "홍대", PoiCategory.CULTURE)),
    ("이태원에서 홍대 넘어가는 중간에 어디 하나 끼워줘", (Shape.BETWEEN, "이태원", "홍대", None)),  # '중간'을 '중'으로 자르지 않는다
    ("경리단길 바로 다음에 한 군데 더 넣어줘", (Shape.AFTER, "경리단길", None, None)),  # '바로'는 끝 말이 아니다
    ("공원 하나 경리단길 다음에 넣어줘", (Shape.AFTER, "경리단길", None, PoiCategory.NATURE)),  # 종류가 자리 말 앞에 와도
    ("지금 있는 곳에서 연남동 가는 길에 한 군데 더", (Shape.BEFORE, None, "연남동", None)),  # 출발이 지금 있는 곳 = B 앞
    ("경리단길에서 연남동까지 가는 길에 한 곳 더", (Shape.BETWEEN, "경리단길", "연남동", None)),
    ("종로 다음에 카페 하나 넣어줘", (Shape.AFTER, "종로", None, PoiCategory.CAFE)),  # '로'는 조사가 아니다
    ("공항 가기 전에 카페 하나 넣어줘", (Shape.BEFORE, None, "공항", PoiCategory.CAFE)),
])
def test_parse_reads_position_and_kind(utterance: str, expected: tuple) -> None:
    ask = parse_insert_ask(utterance)
    assert ask is not None
    assert (ask.shape, ask.frm, ask.to, ask.kind) == expected


@pytest.mark.parametrize("utterance", [
    "이태원에서 홍대로 넘어갈 때 효창공원 넣어줘",        # 이름 지목 — 번역기 몫
    "이태원에서 홍대 갈 때 효창공원 하나 넣어줘",         # 이름 뒤 "하나"도 지목이다
    "이태원에서 홍대로 넘어갈 때 한 군데 더 추가하지 마",  # 더하지 말라는 말
    "이태원이랑 홍대 사이에 한 군데 넣지 말아줘",
    "이태원에서 홍대 갈 때 한 군데 더 안 넣어도 돼",
    "이태원에서 홍대로 넘어갈 때 한 군데 빼줘",           # 빼기
    "이태원에서 홍대로 넘어갈 때 두 군데 더 넣어줘",       # 여럿
    "이태원에서 홍대로 넘어갈 때 지하철 타?",             # 더하기가 아니다
    "이태원 들렀다가 홍대 가기 전에 뭐 먹지?",            # '들렀다가'는 자리 말이지 더하기가 아니다
    "카페 하나 추가해줘",                               # 자리가 없다 — 종전 번역 경로
    "응",
    # 2026-10-22 리뷰 확정 — 낱말 표 밖의 말이 남으면 뜻을 바꾼다(번역기 몫)
    "이태원에서 홍대 갈 때 효창공원 하나 더 넣어줘",       # 이름 + '하나 더'
    "한 군데 더 넣어줘, 효창공원으로 경리단길 다음에",
    "경리단길 다음 카페 빼고 공원 하나 넣어줘",            # 교체일 수 있다
    "경복궁 보고 나서 점심 먹고 카페 하나 넣어줘",          # 다른 서술절
    "카페랑 공원 하나씩 경리단길 다음에 넣어줘",           # 여럿
    "경리단길 다음에 한 군데 더 넣진 마",
    "경리단길 다음에 한 군데 더 추가 안 해도 돼",
    "경리단길 다음에 한 곳 더 넣을 필요 없어",
    "이태원에서 홍대 갈 때 갈 만한 곳 두 군데 추가해줘",   # 여럿 — 한 곳 표현을 지나도 걸린다
    "이태원이랑 홍대 사이에 카페나 공원 하나 넣어줘",       # 종류 둘 — 고르지 않는다
    "경리단길 다음에 갈 만한 곳 다섯 군데 추가해줘",
    "이태원에서 홍대 갈 때 한 군데 더 넣을 필요는 없어",
])
def test_parse_leaves_everything_else_to_the_translator(utterance: str) -> None:
    assert parse_insert_ask(utterance) is None


def test_parse_is_bounded_on_long_unspaced_input() -> None:
    """끝 말 길이를 묶는다 — 묶기 전에는 '에서가' 반복 500자가 5.8s 동안 GIL 을 쥐었다(2026-10-22 리뷰 실측)."""
    started = time.monotonic()
    parse_insert_place("추가 " + "에서가" * 166)
    parse_insert_ask("한 군데 더 " + "에서" * 240)
    assert time.monotonic() - started < 0.5


def test_place_marks_another_clause_so_the_gap_is_not_guessed() -> None:
    place = parse_insert_place("경복궁 보고 나서 점심 먹고 카페 하나 넣어줘")
    assert place is not None and place.extra_clause
    assert resolve_gap(_REFS, place) == "ambiguous_clause"
    assert not parse_insert_place("카페는 싫고 경리단길 다음에 한 군데 더").extra_clause  # 부정은 절이 아니다


def test_negated_kind_is_excluded_not_chosen() -> None:
    """'카페 말고' 를 카페로 읽으면 사용자가 원한 것과 반대인 후보가 검증까지 통과한 채 나간다."""
    ask = parse_insert_ask("이태원 들렀다가 홍대 가기 전에 카페 말고 한 군데 더")
    assert ask is not None and ask.kind is None and ask.not_kinds == {PoiCategory.CAFE}
    ask = parse_insert_ask("홍대 가기 전에 카페는 빼고 한 곳 더")  # '빼고'는 빼기가 아니라 제외다
    assert ask is not None and ask.not_kinds == {PoiCategory.CAFE}
    ask = parse_insert_ask("이태원이랑 홍대 사이에 카페 말고 박물관 하나 넣어줘")
    assert ask is not None and ask.kind is PoiCategory.CULTURE and ask.not_kinds == {PoiCategory.CAFE}
    ask = parse_insert_ask("카페 말고 이태원에서 홍대로 넘어갈 때 한 군데 더 넣어줘")  # 부정이 자리 말 앞에 와도
    assert ask is not None and ask.frm == "이태원" and ask.not_kinds == {PoiCategory.CAFE}
    ask = parse_insert_ask("카페는 싫고 경리단길 다음에 한 군데 더")  # '싫고'도 뺄 종류 — 카페를 고르면 반대다
    assert ask is not None and ask.kind is None and ask.not_kinds == {PoiCategory.CAFE}
    place = parse_insert_place("경리단길 다음에 술 한잔할 곳 하나 넣어줘")  # 술을 말했는데 밤 규칙이 술집을 빼면 반대다
    assert place is not None and place.night
    assert parse_insert_ask("경리단길 다음에 맥주 하나 넣어줘") is None or parse_insert_place(
        "경리단길 다음에 맥주 하나 넣어줘").kind is PoiCategory.BAR


# ── 자리 해소 ───────────────────────────────────────────────────────────

GYEONGBOK = _poi(1, "경복궁", PoiCategory.SIGHT, 37.5796, 126.9770)
GYEONGNI = _poi(2, "경리단길", PoiCategory.SIGHT, 37.5385, 126.9888)            # 이태원 권역(이름엔 없음)
YEONNAM = _poi(3, "연남동 경의선숲길", PoiCategory.NATURE, 37.5600, 126.9230)   # 홍대 권역(이름엔 없음)
MANGWON = _poi(4, "망원한강공원", PoiCategory.NATURE, 37.5552, 126.8950)
_REFS = [SlotRef(p.poi_id, p.name, p.coord) for p in (GYEONGBOK, GYEONGNI, YEONNAM, MANGWON)]


def test_resolve_by_region_when_names_lack_the_area() -> None:
    gap = resolve_gap(_REFS, parse_insert_ask("이태원에서 홍대로 넘어갈 때 한 군데 더 추가했으면 좋겠어"))
    assert not isinstance(gap, str) and (gap.after, gap.before, gap.resolved_by) == (1, 2, ("region", "region"))


def test_day_end_words_land_after_the_last_slot_unless_a_slot_has_that_name() -> None:
    """공항·숙소·서울역 가기 전에, 일정 끝나고 — 종전 끝 추가가 맞던 말을 '못 알아들음'으로 바꾸지 않는다(2026-10-22 리뷰)."""
    for said in ("공항 가기 전에 카페 하나 넣어줘", "숙소 가기 전에 한 군데 더", "오늘 일정 끝나고 카페 하나 넣어줘",
                 "마지막 일정 다음에 한 곳 더 추가", "숙소 들어가기 전에 카페 하나 넣어줘", "호텔 돌아가기 전에 한 군데 더 넣어줘",
                 "효창공원을 마지막 일정 다음에 넣어줘"):
        gap = resolve_gap(_REFS, parse_insert_place(said))
        assert not isinstance(gap, str) and (gap.after, gap.before) == (3, None), said
    # '서울역'의 '서울'(반경 5km)은 하루를 다 덮는다 — 지역으로 맨 앞에 끼우지 않고 하루 끝이다
    gap = resolve_gap(_REFS, parse_insert_place("서울역 가기 전에 한 군데 더 넣어줘"))
    assert not isinstance(gap, str) and (gap.after, gap.before, gap.resolved_by) == (3, None, ("day_end",))
    station = [*_REFS, SlotRef(PoiId("s9"), "서울역", GeoPoint(37.5547, 126.9707))]
    gap = resolve_gap(station, parse_insert_place("서울역 가기 전에 한 군데 더 넣어줘"))  # 일정에 그 이름이 있으면 그 앞
    assert not isinstance(gap, str) and (gap.after, gap.before) == (3, 4)


def test_two_matching_pairs_are_ambiguous_not_the_first() -> None:
    twice = [SlotRef(PoiId(f"s{i}"), name, None) for i, name in enumerate(("이태원 거리", "홍대 앞", "이태원 시장", "홍대 놀이터"))]
    assert resolve_gap(twice, parse_insert_ask("이태원에서 홍대로 넘어갈 때 한 군데 더 넣어줘")) == "ambiguous_gap"


def test_resolve_never_invents_a_gap() -> None:
    assert resolve_gap(_REFS, parse_insert_ask("홍대에서 이태원으로 넘어갈 때 한 군데 더")) == "not_adjacent"  # 거꾸로
    assert resolve_gap(_REFS, parse_insert_ask("부산에서 홍대로 넘어갈 때 한 군데 더")) == "unresolved_from"
    gap = resolve_gap(_REFS, parse_insert_ask("경복궁 다음에 갈 만한 곳 하나 추가해줘"))
    assert not isinstance(gap, str) and (gap.after, gap.before) == (0, 1)
    gap = resolve_gap(_REFS, parse_insert_ask("경복궁 가기 전에 카페 하나 넣어줘"))
    assert not isinstance(gap, str) and (gap.after, gap.before) == (None, 0)  # 맨 앞


@given(st.lists(st.sampled_from(["이태원 거리", "홍대 앞", "경복궁", None]), min_size=1, max_size=6))
def test_resolve_gap_is_an_adjacent_named_pair_or_a_reason(names: list) -> None:
    refs = [SlotRef(PoiId(f"s{i}"), n, None) for i, n in enumerate(names)]
    gap = resolve_gap(refs, parse_insert_ask("이태원에서 홍대로 넘어갈 때 한 군데 더 넣어줘"))
    if isinstance(gap, str):
        return
    assert gap.before == gap.after + 1
    assert "이태원" in (names[gap.after] or "") and "홍대" in (names[gap.before] or "")


# ── 후보 ────────────────────────────────────────────────────────────────


def test_segment_anchor_covers_the_detour_ellipse() -> None:
    center, km = segment_anchor(GYEONGNI.coord, YEONNAM.coord, 2.0)
    d = haversine_km(GYEONGNI.coord, YEONNAM.coord)
    assert abs(km - (d + 2.0) / 2) < 1e-9
    # 우회 ≤ slack 인 점은 (초점 거리 합 ≤ d + slack 이라) 중심에서 반지름 안이다
    on_the_way = GeoPoint(37.5446, 126.9616)
    assert detour_km(GYEONGNI.coord, YEONNAM.coord, on_the_way) <= 2.0
    assert haversine_km(center, on_the_way) <= km


def test_rank_filters_and_orders_deterministically() -> None:
    hyochang = _poi(10, "효창공원", PoiCategory.NATURE, 37.5446, 126.9616)
    cafe = _poi(12, "공덕 카페", PoiCategory.CAFE, 37.5440, 126.9510)
    food = _poi(13, "마포 식당", PoiCategory.FOOD, 37.5450, 126.9500)
    far = _poi(14, "강남 카페", PoiCategory.CAFE, 37.4979, 127.0276)
    bar = _poi(15, "공덕 칵테일바", PoiCategory.FOOD, 37.5448, 126.9530, tags=(NIGHTLIFE_TAG,))
    closed = _poi(16, "수요일 휴무 전시", PoiCategory.CULTURE, 37.5420, 126.9650,
                  hours=(OpenHour(3, 600, 1200),))  # 목요일만 연다 → 수요일 휴무가 증명됨
    pool = (hyochang, cafe, food, far, bar, closed)

    def rank(**over):
        args = dict(slack_km=2.0, exclude=frozenset(), taken_names=(), kind=None, not_kinds=frozenset(), night=False,
                    day=D, holidays=None)
        return [p.name for p, _ in rank_on_segment(pool, GYEONGNI.coord, YEONNAM.coord, **{**args, **over})]

    assert rank() == ["공덕 카페", "효창공원"]  # 구간 밖·나이트라이프·휴무·먹는 곳(다른 게 있으면) 제외, 가운데 먼저
    assert rank(kind=PoiCategory.CAFE) == ["공덕 카페"]
    assert rank(not_kinds=frozenset({PoiCategory.CAFE})) == ["효창공원"]
    assert rank(exclude=frozenset({hyochang.poi_id, cafe.poi_id})) == ["마포 식당"]  # 먹는 곳은 남은 게 없을 때만
    assert "공덕 칵테일바" in rank(night=True, exclude=frozenset({hyochang.poi_id, cafe.poi_id}))  # 술집은 밤 말에만
    pub = _poi(17, "공덕 펍", PoiCategory.BAR, 37.5442, 126.9515)  # 술집 카테고리(태그 없이도) — 낮 사이엔 넣지 않는다
    assert [p.name for p, _ in rank_on_segment((pub,), GYEONGNI.coord, YEONNAM.coord, slack_km=2.0, exclude=(),
                                               taken_names=(), kind=None, not_kinds=(), night=False, day=D,
                                               holidays=None)] == []


def test_rank_key_order_and_next_door_trending_loses_to_the_middle() -> None:
    """FR-004 순서 — 끝점 옆은 '요즘 인기'여도 가운데 뒤(실데이터: B 옆 0.48km 인기 암장이 1등이었다), 그다음 인기·평판·영업시간·저장 수."""
    mid = (37.5440, 126.9510)  # 경리단길↔연남동 가운데쯤
    def at(n, name, **kw):
        return _poi(n, name, PoiCategory.SIGHT, mid[0] + n * 0.0002, mid[1], **kw)
    plain = at(40, "그냥 명소")
    saved = replace(at(41, "저장 명소"), saved_count=3)
    hours = at(42, "영업시간 명소", hours=(OpenHour(2, 540, 1200),))
    famous = at(43, "평판 명소", tags=("인기5",))
    trending = at(44, "인기 명소", tags=(TRENDING_TAG,))
    next_door = _poi(45, "연남 인기 암장", PoiCategory.ACTIVITY, 37.5577, 126.9259, tags=(TRENDING_TAG,))
    out = rank_on_segment((plain, saved, hours, famous, trending, next_door), GYEONGNI.coord, YEONNAM.coord, slack_km=2.0,
                          exclude=(), taken_names=(), kind=None, not_kinds=(), night=False, day=D, holidays=None)
    assert [p.name for p, _ in out] == ["인기 명소", "평판 명소", "영업시간 명소", "저장 명소", "그냥 명소", "연남 인기 암장"]


def test_rank_prefers_the_middle_and_drops_namesakes_of_planned_slots() -> None:
    """우회만 보면 끝점 바로 옆(우회≈0)이 늘 1등이다 — 2026-10-22 실측에서 다음 슬롯(경의선숲길)의 옆 입구가 뽑혔다."""
    next_door = _poi(20, "연남 공방", PoiCategory.SIGHT, 37.5598, 126.9236)        # B 옆집 — 우회 ≈ 0
    namesake = _poi(21, "연남동 경의선숲길 입구", PoiCategory.NATURE, 37.5597, 126.9240)  # 다음 슬롯과 같은 곳
    middle = _poi(22, "공덕 전시관", PoiCategory.CULTURE, 37.5440, 126.9510)             # 가운데 — 우회 더 큼
    args = dict(slack_km=2.0, exclude=frozenset(), kind=None, not_kinds=frozenset(), night=False, day=D, holidays=None)
    out = rank_on_segment((next_door, namesake, middle), GYEONGNI.coord, YEONNAM.coord,
                          taken_names=(GYEONGNI.name, YEONNAM.name), **args)
    assert [p.name for p, _ in out] == ["공덕 전시관", "연남 공방"]
    assert detour_km(GYEONGNI.coord, YEONNAM.coord, next_door.coord) < detour_km(GYEONGNI.coord, YEONNAM.coord,
                                                                                  middle.coord)


_pt = st.builds(GeoPoint, st.floats(37.40, 37.70), st.floats(126.80, 127.15))


@given(_pt, _pt, st.lists(_pt, max_size=25), st.sampled_from([1.0, 2.0, 5.0]))
@settings(max_examples=80)
def test_rank_keeps_only_on_the_way_and_ignores_input_order(a, b, coords, slack) -> None:
    pois = [_poi(i, f"장소{i}", PoiCategory.SIGHT, c.lat, c.lng) for i, c in enumerate(coords)]
    args = dict(slack_km=slack, exclude=frozenset({PoiId("p0")}), taken_names=(), kind=None, not_kinds=frozenset(),
                night=False, day=D, holidays=None)
    out = rank_on_segment(pois, a, b, **args)
    assert all(d <= slack + 1e-9 and p.poi_id != PoiId("p0") for p, d in out)
    assert all(abs(detour_km(a, b, p.coord) - d) < 1e-9 for p, d in out)
    assert [p.poi_id for p, _ in out] == [p.poi_id for p, _ in rank_on_segment(list(reversed(pois)), a, b, **args)]


# ── 기준점 삽입 (apply_command ADD) · 재타이밍 ─────────────────────────────


def _day(n: int, gaps: list[int]) -> DaySolution:
    slots, t = [], datetime(2026, 10, 21, 9, 0, tzinfo=KST)
    for i in range(n):
        slots.append(VisitSlot(PoiId(f"s{i}"), t, t + timedelta(minutes=60), 60, 0.0, False))
        t = t + timedelta(minutes=60 + gaps[i % len(gaps)])
    return DaySolution(D, tuple(slots), ())


def _add(**anchors: str) -> EditCommand:
    return EditCommand(EditOp.ADD_SLOT, {"targetPoiId": "x", **anchors}, ())


def test_add_anchor_lands_in_place_and_unanchored_add_still_appends() -> None:
    day = _day(3, [30])
    assert apply_command(day, _add(afterPoiId="s0")) == ("s0", "x", "s1", "s2")
    assert apply_command(day, _add(before_poi_id="s1")) == ("s0", "x", "s1", "s2")  # 변형 키도 같은 판정
    assert apply_command(day, _add()) == ("s0", "s1", "s2", "x")  # 기준 없음 = 종전 끝 추가
    for bad in (dict(afterPoiId="s9"), dict(afterPoiId="s0", after_poi_id="s1"),
                dict(afterPoiId="s0", beforePoiId="s0")):
        with pytest.raises(EditRejected):  # 모르는 기준·같은 쪽 둘·다른 틈 — 끝에 붙이지 않는다(INV-4)
            apply_command(day, _add(**bad))


@given(st.integers(2, 8), st.data())
def test_add_with_both_anchors_lands_only_between_neighbours(n: int, data) -> None:
    day = _day(n, [30])
    i, j = data.draw(st.integers(0, n - 2)), data.draw(st.integers(0, n - 1))
    order = [f"s{k}" for k in range(n)]
    if j == i + 1:
        assert list(apply_command(day, _add(afterPoiId=f"s{i}", beforePoiId=f"s{j}"))) == order[:j] + ["x"] + order[j:]
    else:
        with pytest.raises(EditRejected):
            apply_command(day, _add(afterPoiId=f"s{i}", beforePoiId=f"s{j}"))


def _ctx(order: tuple, day: DaySolution, **over) -> RetimeContext:
    coords = {p: GeoPoint(37.5 + k * 0.01, 127.0) for k, p in enumerate(order)}
    return RetimeContext(coords=coords, stay_min={s.poi_id: s.stay_min for s in day.slots},
                         estimator=TravelEstimator(AssemblyConfig()), transport=TransportMode.PUBLIC, **over)


@given(st.integers(1, 7), st.lists(st.integers(0, 120), min_size=1, max_size=7), st.data())
@settings(max_examples=60)
def test_keep_earlier_never_pulls_existing_slots_forward(n: int, gaps: list, data) -> None:
    day = _day(n, gaps)
    at = data.draw(st.integers(0, n))
    order = tuple(s.poi_id for s in day.slots)
    new_order = order[:at] + (PoiId("x"),) + order[at:]
    out = retime_day(day, new_order, _ctx(new_order, day), KST, keep_earlier=True)
    before = {s.poi_id: s.start_at for s in day.slots}
    assert all(s.start_at >= before[s.poi_id] for s in out.slots if s.poi_id in before)
    assert all(a.end_at <= b.start_at for a, b in zip(out.slots, out.slots[1:]))  # 시간순·겹침 없음


def test_not_before_floors_only_the_new_slot() -> None:
    """여행 당일 — 끼운 곳은 지금보다 앞에 두지 않는다. 있던 슬롯은 하한을 받지 않는다(지난 슬롯을 밀지 않는다)."""
    day = _day(3, [180])  # 09:00 · 13:00 · 17:00
    order = (PoiId("s0"), PoiId("x"), PoiId("s1"), PoiId("s2"))
    now = datetime(2026, 10, 21, 11, 30, tzinfo=KST)
    out = retime_day(day, order, _ctx(order, day, not_before=now), KST, keep_earlier=True)
    starts = {s.poi_id: s.start_at for s in out.slots}
    assert starts[PoiId("s0")] == day.slots[0].start_at and starts[PoiId("x")] == now
    assert starts[PoiId("s1")] >= day.slots[1].start_at
