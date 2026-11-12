"""날 말 → 여행 날짜 — "2일차"·"둘째 날"·"내일"·"11월 6일"·"토요일". 순수 함수, LLM 0회.

편집 ①b(`agents/edit/day_area`)·챗봇 해석 확인(`orchestrator/dialogue/edit_day_areas`)·다시 짜기 자유입력
(`agents/planb/request_verification`)이 **같은 셈**을 쓴다 — 에이전트끼리는 import 하지 않으므로(L-2) 여기 둔다.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import date, timedelta

# 날 표현 — 순번·상대·날짜·요일. 이 밖("다음 날"·"마지막에서 두 번째")은 읽지 않는다(넘겨짚지 않는다)
DAY_WORDS = re.compile(
    r"(?P<n>\d{1,2})\s?일\s?차"
    r"|(?P<ko>첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)\s?째\s?(?:날|날짜)?"
    r"|(?P<nth>\d{1,2}|첫|두|세|네|다섯)\s?번째\s?날"
    r"|(?P<first>첫\s?날)"
    r"|(?P<last>마지막\s?날|막\s?날)"
    r"|(?P<rel>내일\s?모레|오늘|내일|모레)"
    r"|(?:(?P<m>\d{1,2})\s?월\s?)?(?P<d>\d{1,2})\s?일(?!\s?(?:차|동안|간|째))"
    r"|(?P<wd>[월화수목금토일])\s?요일"
)
_KO = {"첫": 1, "둘": 2, "두": 2, "셋": 3, "세": 3, "넷": 4, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10}
_REL = {"오늘": 0, "내일": 1, "모레": 2}
_WEEKDAYS = "월화수목금토일"


def day_of(said: str, days: Sequence[date], today: date, *, first: date | None = None) -> date | str:
    """날 말 → 여행 날 하나, 아니면 사유 코드. 순번은 여행 첫날 + N − 1(대화 `resolve_day` 와 같은 셈).

    `first` = 여행 첫날(편집 요청 `trip_start_date`) — 받은 날들이 여행 첫날부터 있지 않아도 순번을 대화와 같게 센다. 없으면 `days[0]`."""
    m = DAY_WORDS.fullmatch(said)
    if m is None:
        return "day_out_of_trip"
    g = m.groupdict()
    first, last, inside = first or days[0], days[-1], set(days)
    n = (int(g["n"]) if g["n"] else _KO[g["ko"]] if g["ko"] else
         (int(g["nth"]) if g["nth"].isdigit() else _KO[g["nth"]]) if g["nth"] else 1 if g["first"] else None)
    if n is not None:
        on = first + timedelta(days=n - 1)
    elif g["last"]:
        on = last
    elif g["rel"]:
        on = today + timedelta(days=_REL.get(g["rel"].replace(" ", ""), 2))
    elif g["d"]:
        month, day = (int(g["m"]) if g["m"] else None), int(g["d"])
        hits = [x for x in days if x.day == day and (month is None or x.month == month)]
        if len(hits) > 1:
            return "ambiguous_day"
        on = hits[0] if hits else None
    else:
        hits = [x for x in days if x.weekday() == _WEEKDAYS.index(g["wd"])]
        if len(hits) > 1:
            return "ambiguous_day"
        on = hits[0] if hits else None
    return on if on is not None and on in inside else "day_out_of_trip"
