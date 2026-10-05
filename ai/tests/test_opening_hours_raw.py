"""영업시간 원문 칸 — 영업·휴무 원문을 한 칸에 싣고 다시 가른다 (TRIP-1226).

백엔드는 `poi.opening_hours varchar(200)` 한 칸만 저장하고 AI 는 런타임에 그 칸을 다시
파싱한다(`backend_poi_db`). 휴무를 이 칸에 함께 싣지 않으면 수집 때 반영한 주간 휴무가
런타임에 사라져 휴무일에도 영업으로 읽힌다. 지키는 성질:

  ① 왕복 — 합친 칸을 가르면 쓴 그대로 나온다 (구분자가 영업 원문에 섞여 와도)
  ② 런타임 == 수집 — 잘리지 않았으면 칸의 파싱이 수집 때 (영업, 휴무) 파싱과 같다
  ③ 200자 — 언제나 상한 안이고, 넘치면 휴무를 보존하고 영업을 먼저 자른다
  ④ 하위호환 — 구분자 없는 옛 원문은 종전(휴무 없이)과 똑같이 읽힌다
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.poi_curation.sourcing.mapping import (
    _REST_SEP_DEFUSED,
    OPENING_HOURS_MAX,
    REST_SEP,
    join_opening_hours_raw,
    parse_open_hours,
    parse_opening_hours_raw,
    split_opening_hours_raw,
)

# 실물 조각 — TourAPI usetime·restdate 에 나오는 모양 + 구분자 자체(영업 원문에 섞여 와도 갈려야 한다)
_HOURS_BITS = [
    "09:00", "~", "18:00", "10:30", " - ", "22:00", "15:00~17:00", " ", "\n", "<br>", "<br />\n",
    "(", ")", "[매표소]", "준비시간 ", "상시 개방", "※ ", "평일 ", "주말 ", "휴무", ":", "휴무: ",
    REST_SEP, "\n휴무:", "매주 월요일", "…", "입장마감 ",
]
_REST_BITS = [
    "매주 ", "월요일", "화요일", "일요일", ", ", "연중무휴", "없음", "명절 당일", "첫째 주 ", " ",
    "\n", "<br>", REST_SEP, "(공휴일 제외)", "1월 1일",
]
_hours = st.lists(st.sampled_from(_HOURS_BITS), max_size=40).map("".join)
_rest = st.one_of(st.none(), st.lists(st.sampled_from(_REST_BITS), max_size=30).map("".join))


# ── 예시 ─────────────────────────────────────────────────────────────


def test_휴무는_줄을_바꿔_붙는다() -> None:
    """화면(FE 장소 상세)에 그대로 나가는 칸이라 읽히는 모양으로 — 한 줄 라벨에선 ` · ` 로 이어진다."""
    assert join_opening_hours_raw("09:00~18:00", "매주 월요일") == "09:00~18:00\n휴무: 매주 월요일"
    assert split_opening_hours_raw("09:00~18:00\n휴무: 매주 월요일") == ("09:00~18:00", "매주 월요일")


def test_휴무가_없으면_종전_모양_그대로다() -> None:
    for rest in (None, "", "  \n"):
        assert join_opening_hours_raw("09:00~18:00", rest) == "09:00~18:00"
    assert join_opening_hours_raw("가" * 250, None) == "가" * 199 + "…"   # 종전 절단 규칙


def test_영업_원문이_없으면_휴무만_싣지_않는다() -> None:
    """백엔드는 이 칸의 유무로 "영업시간 확인됨"을 판정한다 — 휴무만 실으면 확인된 것처럼 보인다."""
    assert join_opening_hours_raw(None, "매주 월요일") is None
    assert join_opening_hours_raw("", "매주 월요일") == ""


def test_해석_못_하는_휴무도_싣는다() -> None:
    """빼면 런타임이 7일 영업으로 읽는다 — 원문 칸이 수집 파싱의 입력 전부를 잃는 TRIP-1226 의 원인 그대로다.

    실으면 런타임도 수집처럼 `()`(정보 없음)다. 파서가 이 문구를 읽게 되면 재수집 없이 소급된다
    (결정·실측: data/README 「휴무를 해석 못 하는 POI」).
    """
    rest = "동절기 휴장"
    joined = join_opening_hours_raw("09:00~18:00", rest)
    assert joined == "09:00~18:00" + REST_SEP + rest
    assert parse_opening_hours_raw(joined) == parse_open_hours("09:00~18:00", rest) == ()


def test_영업_원문의_구분자는_무력화돼_휴무로_갈리지_않는다() -> None:
    """벤더가 usetime 에 `휴무:` 줄을 넣어 보내도 첫 구분자는 우리가 넣은 것이다."""
    hours = "11:00~21:00\n휴무: 매주 월요일"   # usetime 원문 — 이 줄은 파서가 휴무로 안 읽는다
    joined = join_opening_hours_raw(hours, "매주 화요일")
    got_hours, got_rest = split_opening_hours_raw(joined)
    assert got_rest == "매주 화요일"
    assert parse_opening_hours_raw(joined) == parse_open_hours(hours, "매주 화요일")
    assert [h.day_of_week for h in parse_opening_hours_raw(joined)] == [0, 2, 3, 4, 5, 6]


def test_200자를_넘으면_영업을_먼저_자르고_휴무는_보존한다() -> None:
    hours = "10:00~22:00 " + "브레이크타임 안내 " * 30
    joined = join_opening_hours_raw(hours, "매주 월요일")
    assert len(joined) == OPENING_HOURS_MAX
    got_hours, got_rest = split_opening_hours_raw(joined)
    assert got_rest == "매주 월요일" and got_hours.endswith("…")
    assert [h.day_of_week for h in parse_opening_hours_raw(joined)] == [1, 2, 3, 4, 5, 6]


def test_휴무가_길어도_영업을_절반_아래로_밀어내지_않는다() -> None:
    hours = "09:00~18:00 " + "가" * 150
    joined = join_opening_hours_raw(hours, "휴" * 300)
    got_hours, got_rest = split_opening_hours_raw(joined)
    assert len(joined) == OPENING_HOURS_MAX
    assert len(got_hours) == OPENING_HOURS_MAX // 2 and got_hours.startswith("09:00~18:00")
    assert got_rest.endswith("…")


def test_구분자_없는_옛_원문은_휴무_없이_읽는다() -> None:
    """백필 전 적재분 — 종전 런타임(`parse_open_hours(원문, None)`)과 같다."""
    assert split_opening_hours_raw("09:00~18:00") == ("09:00~18:00", None)
    assert split_opening_hours_raw(None) == (None, None)
    assert len(parse_opening_hours_raw("09:00~18:00")) == 7


# ── 성질 ─────────────────────────────────────────────────────────────


@settings(max_examples=500, deadline=None)
@given(hours=_hours, rest=_rest)
def test_pbt_합치고_가르면_쓴_그대로고_런타임이_수집과_같게_읽는다(hours: str, rest: str | None) -> None:
    joined = join_opening_hours_raw(hours, rest)
    if not hours:
        assert joined == hours
        return
    assert len(joined) <= OPENING_HOURS_MAX                                         # ③
    defused = hours.replace(REST_SEP, _REST_SEP_DEFUSED)
    r = (rest or "").strip()
    if not r or not defused.strip():
        # 실을 휴무가 없다 — 구분자 없는 종전 모양이고, 영업 원문의 구분자도 무력화돼 있다
        assert split_opening_hours_raw(joined) == (joined, None)
        if len(defused) <= OPENING_HOURS_MAX:
            assert joined == defused
            assert parse_opening_hours_raw(joined) == parse_open_hours(hours, rest)   # ②
        return
    got_hours, got_rest = split_opening_hours_raw(joined)
    if len(REST_SEP) + len(r) <= OPENING_HOURS_MAX // 2:
        assert got_rest == r                                                        # ③ 휴무 보존
    if len(defused.rstrip()) + len(REST_SEP) + len(r) <= OPENING_HOURS_MAX:         # 안 잘림
        assert (got_hours, got_rest) == (defused.rstrip(), r)                       # ①
        assert parse_opening_hours_raw(joined) == parse_open_hours(hours, rest)    # ②


@settings(max_examples=300, deadline=None)
@given(text=_hours.filter(lambda t: REST_SEP not in t))
def test_pbt_구분자_없는_원문은_종전과_똑같이_읽힌다(text: str) -> None:
    assert parse_opening_hours_raw(text) == parse_open_hours(text, None)            # ④
