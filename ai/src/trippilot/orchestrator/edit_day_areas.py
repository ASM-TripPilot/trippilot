"""챗봇의 해석 확인 — 날마다 동네를 정한 바꾸기 말(spec 004 FR-003). LLM 0회, 순수 함수.

분류 LLM 은 "1일차는 종로 2일차는 강남구쪽으로 바꿔줘"를 한 곳 바꾸기 칸(target·replacement·position)에 뭉갠다(2026-10-22 실측 12/12 —
`target=종로·replacement=강남구`). 그 칸을 그대로 넘기지 않고, 편집 에이전트 ①b 와 **같은 해석기**(`agents/edit/day_area.py`)로 말을
다시 읽어 확인한다.

- 다 맞으면 → 확인된 인자 `{day: 첫 날 ISO, day_areas: "2026-10-24=종로;…"}` (BE 는 `day` 로 날을 고르고, 편집 에이전트는 같은 말을 같은
  해석기로 다시 읽는다 — 두 쪽이 갈리지 않는다).
- 날이 여행 밖·지난 날·같은 날 두 번·여럿에 걸리면 → 되묻기. 보기는 **그 자체로 완결된 명령문**이다
  (되묻기 답 턴에는 원문이 없고 보기 라벨이 곧 다음 발화다 — `AssistantTurnService.kt:348`). 그래서 보류 프레임을 남기지 않는다.
- 이 꼴이 아니면 None — 종전 경로.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import date, timedelta

from trippilot.agents.edit.day_area import DayAreaIssue, day_of, encode, parse_day_areas, resolve_day_areas
from trippilot.agents.planb.request_verification import KNOWN_AREAS
from trippilot.orchestrator.dialogue_handlers import TurnSnapshot

MAX_OPTIONS = 4
MAX_LABEL = 30  # BE 보기 라벨 상한(HttpDialogueInterpreter)


@dataclass(frozen=True, slots=True)
class DayAreaTurn:
    """확인 결과 — `arguments`(FRAME) 또는 `question`(되묻기) 중 하나.

    `table_only` = 모든 동네가 표 이름 — 분류가 다른 의도를 냈을 때 고쳐도 되는 근거(꼬리로만 동네라고 한 말은 분류가 편집일 때만 맡는다)."""

    arguments: dict[str, str] | None = None
    question: str | None = None
    options: tuple[str, ...] = ()
    code: str = "verified"  # verified · day_out_of_trip · past_day · duplicate_day · ambiguous_day
    table_only: bool = False


def _batchim(word: str) -> bool:
    c = word[-1] if word else ""
    return "가" <= c <= "힣" and (ord(c) - ord("가")) % 28 != 0


def _eun(word: str) -> str:
    return f"{word}{'은' if _batchim(word) else '는'}"


def _label(day_no: int, area: str, others: str = "") -> str:
    """완결된 명령문 보기 — 다른 절이 있으면 함께 싣는다(누르면 그대로 다음 발화다). '쪽으로'를 늘 둔다 — 표에 없는 동네는 꼬리가 있어야
    해석기가 다시 읽는다(2026-10-23 2차 리뷰). 상한(30자)을 넘는 보기는 부르는 쪽이 버린다."""
    return f"{others}{day_no}일차는 {area} 쪽으로 바꿔줘"


def trip_dates(snapshot: TurnSnapshot) -> tuple[date, ...]:
    """여행 날 — 여행 기간이 있으면 그 전부(슬롯 없는 날 포함), 없으면 스냅샷 일정의 날."""
    if snapshot.trip is not None and snapshot.trip.start_date <= snapshot.trip.end_date:
        n = (snapshot.trip.end_date - snapshot.trip.start_date).days + 1
        return tuple(snapshot.trip.start_date + timedelta(days=i) for i in range(n))
    return tuple(sorted(d.date for d in snapshot.days))


def _ask(issue: DayAreaIssue, days: Sequence[date], today: date) -> DayAreaTurn | None:
    """날 확인 실패 → 고정 문안 되묻기. 보기는 다른 절이 이미 정한 날을 빼고, 다른 절을 함께 실은 완결 명령문(30자 안일 때만).
    고를 날이 없으면(끝난 여행 등) None — 답할 수 없는 질문을 내지 않는다."""
    first = days[0]

    def no(on: date) -> int:
        return (on - first).days + 1

    def said_day(said: str) -> date | None:
        on = day_of(said, days, today)
        return on if isinstance(on, date) else None

    target = said_day(issue.said)
    own = [c for c in issue.clauses if issue.said in c.days or (target and any(said_day(s) == target for s in c.days))]
    rest = [c for c in issue.clauses if c not in own]
    taken = {d for c in rest for s in c.days if (d := said_day(s)) is not None and d >= today}
    # 다른 절 — 표에 없는(꼬리로 받은) 동네는 '쪽'을 붙여야 다시 읽힌다
    others = "".join(f"{no(d)}일차는 {c.area}{'' if c.key else ' 쪽'}, " for c in rest for s in c.days
                     if (d := said_day(s)) is not None and d >= today)
    if issue.code == "duplicate_day":
        areas = list(dict.fromkeys(c.area for c in own))
        options = tuple(o for o in (_label(no(target), a, others) for a in areas[:MAX_OPTIONS]) if len(o) <= MAX_LABEL) \
            if target is not None else ()
        return DayAreaTurn(question=f"{_eun(issue.said)} 어느 쪽으로 바꿀까요?", options=options, code=issue.code) if options else None
    area = own[0].area if own else issue.clauses[0].area
    open_days = [d for d in days if d >= today and d not in taken]
    if not open_days:
        return None
    if issue.code == "past_day":
        question = f"{_eun(issue.said)} 이미 지났어요. 남은 날 중 어느 날을 {area} 쪽으로 바꿀까요?"
    elif issue.code == "ambiguous_day":
        question = f"{issue.said}이 여행에 여러 번 있어요. 어느 날을 {area} 쪽으로 바꿀까요?"
    else:
        question = f"이번 여행은 {len(days)}일차까지예요. 어느 날을 {area} 쪽으로 바꿀까요?"
    options = tuple(o for o in (_label(no(d), area, others) for d in open_days[:MAX_OPTIONS]) if len(o) <= MAX_LABEL)
    return DayAreaTurn(question=question if options else "바꿀 날과 동네를 한 번에 다시 말씀해 주세요(예: 1일차는 종로 쪽으로 바꿔줘).",
                       options=options, code=issue.code)


def check_day_areas(utterance: str, snapshot: TurnSnapshot, today: date) -> DayAreaTurn | None:
    """말 → 확인된 FRAME 인자·되묻기, 이 꼴이 아니면 None. 여행·일정이 없으면 None(편집할 것이 없다 — 종전 경로가 안내한다).

    동네 이름이 여행지에서 먼지는 여기서 가리지 않는다 — 서울 '성산동'을 제주 '성산'으로 읽어 거짓 '멀어요'를 냈다(2026-10-23 리뷰).
    편집이 받은 후보 풀로 이름을 찾고, 못 찾으면 사유를 단다."""
    clauses = parse_day_areas(utterance or "", KNOWN_AREAS)
    if clauses is None or snapshot.trip is None or not snapshot.days:
        return None
    days = trip_dates(snapshot)
    got = resolve_day_areas(clauses, days, today)
    table_only = all(c.key is not None for c in clauses)
    if isinstance(got, DayAreaIssue):
        asked = _ask(got, days, today)
        return replace(asked, table_only=table_only) if asked is not None else None
    return DayAreaTurn(arguments={"day": got[0].day.isoformat(), "day_areas": encode(got)}, table_only=table_only)
