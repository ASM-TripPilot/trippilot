"""REPLAN_REQUEST_EXTRACTION 출구 게이트 — 자유입력에서 뽑은 주장의 **형태**만 강제한다.

참·거짓은 여기서 가리지 않는다 — 그건 `agents/planb/request_verification` 이 외부 출처로
한다. 게이트는 "검증기가 읽을 수 있는 모양인가"만 본다. 항목 격리: 모양이 틀린 장소 한 건은
그 건만 버리고 나머지는 살린다(장소끼리는 독립이다). 시각이 `HH:MM` 이 아니면 그 필드만 버린다.

**빈 결과는 성공이다** — "이 문장에는 뽑을 정보가 없다"는 정상 판정이다(TRIP-260 #5 정책).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, time

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.base import GateOutcome, strip_code_fence

@dataclass(frozen=True, slots=True)
class ExtractedPlace:
    name: str
    want: str  # "visit" | "avoid"
    at: time | None = None  # "성심당은 5시에" → 17:00. 갈 곳에만 뜻이 있다


@dataclass(frozen=True, slots=True)
class ExtractedCategory:
    category: str  # 경계 카테고리 코드 8종 중 하나 (`_CATEGORIES`)
    count: int | None = None  # "두 군데" → 2. 수를 말하지 않았으면 None
    at: time | None = None  # "3시에 카페" → 15:00 — 하루 시작(start_after)이 아니라 그 종류의 방문 시각


@dataclass(frozen=True, slots=True)
class ExtractedRequest:
    """자유입력에서 뽑은 것 — 이 게이트가 **형태만** 보장한 주장. 참·거짓은 호출측 검증 몫."""

    places: tuple[ExtractedPlace, ...] = ()
    start_after: time | None = None
    end_by: time | None = None
    weather: str | None = None  # "rain" | "clear" | None
    # 종류 조건 — "카페는 두 군데만"·"카페로만". `only` 는 categories 가 있을 때만 참이다.
    categories: tuple[ExtractedCategory, ...] = ()
    only: bool = False
    # 가고 싶은 동네·지역 — "강남에서 놀고 싶어" → "강남". 장소 이름이 아니라 그 일대다
    area: str | None = None

    @property
    def empty(self) -> bool:
        return not (self.places or self.start_after or self.end_by or self.weather
                    or self.categories or self.area)



_HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
_MAX_PLACES = 5
_MAX_NAME = 40
# 경계 카테고리 8종(`domain.poi.PoiCategory` 의 STAY 제외) — 게이트는 도메인을 몰라 문자열로 둔다.
_CATEGORIES = frozenset({"FOOD", "CAFE", "SIGHT", "NIGHT_VIEW", "NATURE", "CULTURE", "ACTIVITY", "SHOPPING"})
_MAX_CATEGORIES = 4
_MAX_COUNT = 8  # 재계획 하루 방문 상한과 같은 급
_MAX_AREA = 20


def _hhmm(value: object) -> time | None:
    if not isinstance(value, str):
        return None
    m = _HHMM.match(value.strip())
    return time(int(m.group(1)), int(m.group(2))) if m else None


def _area(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > _MAX_AREA:
        return None
    return value.strip()


class ReplanRequestExtractionGate:
    """`{"places": [{"name", "want", "at"}], "start_after", "end_by", "weather",
    "categories": [{"category", "count", "at"}], "only", "area"}` 강제."""

    def apply(
        self,
        raw_text: str,
        context: object,  # noqa: ARG002 — 대조 집합 없음(검증은 호출측)
        *,
        feature: LlmFeature,  # noqa: ARG002
        trace_id: TraceId,  # noqa: ARG002
        now: datetime,  # noqa: ARG002
    ) -> GateOutcome:
        try:
            data = json.loads(strip_code_fence(raw_text))
            if not isinstance(data, dict) or not isinstance(data.get("places", []), list):
                raise ValueError('최상위가 {"places": [...], ...} 형태가 아님')
        except ValueError as e:  # JSONDecodeError 포함
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        items = data.get("places", [])

        places: list[ExtractedPlace] = []
        for item in items[:_MAX_PLACES]:
            if not isinstance(item, dict):
                continue
            name, want = item.get("name"), item.get("want")
            if (isinstance(name, str) and name.strip() and len(name.strip()) <= _MAX_NAME
                    and want in ("visit", "avoid")):
                places.append(ExtractedPlace(name=name.strip(), want=want,
                                             at=_hhmm(item.get("at")) if want == "visit" else None))
        weather = data.get("weather") if data.get("weather") in ("rain", "clear") else None
        cats: dict[str, ExtractedCategory] = {}  # 같은 종류가 두 번 오면 앞의 것
        raw_cats = data.get("categories", [])
        for item in (raw_cats if isinstance(raw_cats, list) else [])[:_MAX_CATEGORIES]:
            if not isinstance(item, dict) or item.get("category") not in _CATEGORIES:
                continue
            count = item.get("count")
            if count is not None and not (type(count) is int and 1 <= count <= _MAX_COUNT):
                continue  # 수가 이상하면 그 항목만 버린다 — 수 없이 살리면 "두 곳만"이 "무제한"이 된다
            cats.setdefault(item["category"],
                            ExtractedCategory(item["category"], count, _hhmm(item.get("at"))))
        return GateOutcome(
            value=ExtractedRequest(
                places=tuple(places),
                start_after=_hhmm(data.get("start_after")),
                end_by=_hhmm(data.get("end_by")),
                weather=weather,
                categories=tuple(cats.values()),
                only=bool(cats) and data.get("only") is True,
                area=_area(data.get("area")),
            ),
            drop_event=None,
            error=None,
        )
