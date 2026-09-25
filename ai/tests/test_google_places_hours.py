"""Google Places 영업시간 어댑터 — 요일 변환·예산·약관 경계. 실 호출 0.

이 어댑터가 조용히 틀리면 **일정이 하루씩 밀리거나(요일 변환) 돈이 샌다(예산)**.
둘 다 실행해 보기 전에는 안 보이는 종류라 여기서 문다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from trippilot.domain.common import PoiId
from trippilot.poi_curation.adapters.google_places_hours import (
    GooglePlacesHoursAdapter,
    parse_regular_opening_hours,
)
from trippilot.ports.place_hours_port import HoursQuery, HoursVerdict

_OPENAPI = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"


def _payload(*periods: dict) -> dict:
    return {"regularOpeningHours": {"periods": list(periods)}}


def _period(od: int, oh: int, om: int = 0, cd: int | None = None,
            ch: int | None = None, cm: int = 0) -> dict:
    p: dict = {"open": {"day": od, "hour": oh, "minute": om}}
    if cd is not None and ch is not None:
        p["close"] = {"day": cd, "hour": ch, "minute": cm}
    return p


# ── 요일 변환 — Google 0=일요일, 우리 0=월요일 ──────────────────────

@pytest.mark.parametrize("google_day,ours", [
    (0, 6),   # 일요일 → 우리 6
    (1, 0),   # 월요일 → 우리 0
    (2, 1), (3, 2), (4, 3), (5, 4),
    (6, 5),   # 토요일 → 우리 5
])
def test_요일_번호를_우리_규약으로_옮긴다(google_day: int, ours: int) -> None:
    """**그대로 쓰면 일정이 하루씩 밀린다** — 월요일 휴무가 일요일 휴무가 된다."""
    got = parse_regular_opening_hours(
        _payload(_period(google_day, 9, 0, google_day, 18, 0)))
    assert len(got) == 1
    assert got[0].day_of_week == ours


def test_월요일_9시_18시가_그대로_읽힌다() -> None:
    (oh,) = parse_regular_opening_hours(_payload(_period(1, 9, 0, 1, 18, 0)))
    assert (oh.day_of_week, oh.open_min, oh.close_min) == (0, 540, 1080)


# ── close 부재 = 24시간 영업 ──────────────────────────────────────

def test_close_가_없으면_24시간_영업이다() -> None:
    """빈 값으로 읽으면 **늘 열린 곳이 늘 닫힌 곳이 된다.**"""
    (oh,) = parse_regular_opening_hours(_payload(_period(1, 0, 0)))
    assert (oh.open_min, oh.close_min) == (0, 1440)


# ── 자정 넘김 ────────────────────────────────────────────────────

def test_자정을_넘기면_close_가_1440_을_넘는다() -> None:
    """금 22:00 ~ 토 02:00 — `OpenHour` 계약대로 시작일에 귀속시킨다."""
    (oh,) = parse_regular_opening_hours(_payload(_period(5, 22, 0, 6, 2, 0)))
    assert (oh.day_of_week, oh.open_min, oh.close_min) == (4, 1320, 1560)


# ── 못 읽으면 () — 지어내지 않는다 ────────────────────────────────

@pytest.mark.parametrize("payload", [
    {}, {"regularOpeningHours": {}}, {"regularOpeningHours": {"periods": []}},
    {"regularOpeningHours": {"periods": "hi"}},
    _payload({"open": {"day": 9, "hour": 9}}),          # 요일 범위 밖
    _payload({"open": {"day": 1, "hour": "9"}}),        # 타입 이상
    _payload({"close": {"day": 1, "hour": 18}}),        # open 없음
    "not a dict",
])
def test_형식이_어긋나면_비운다(payload) -> None:
    assert parse_regular_opening_hours(payload) == ()


# ── 예산 — 돈이 나가는 자리 ────────────────────────────────────────

class _Http:
    def __init__(self, payload=None, raises=False):
        self.payload = payload if payload is not None else _payload(
            _period(1, 9, 0, 1, 18, 0))
        self.raises = raises
        self.calls = 0

    def get_json(self, url, headers):
        self.calls += 1
        if self.raises:
            raise RuntimeError("vendor down")
        return self.payload


def _adapter(http, *, max_calls=10, monthly=1000, clock=None):
    ticks = iter(clock or [0] * 500)
    return GooglePlacesHoursAdapter(
        http, "KEY", max_calls=max_calls, monthly_budget=monthly,
        monotonic_ms=lambda: next(ticks, 0))


def _queries(n: int) -> tuple[HoursQuery, ...]:
    return tuple(HoursQuery(PoiId(f"p{i}"), f"place{i}") for i in range(n))


def test_호출_상한을_넘기면_더_부르지_않는다() -> None:
    """**요청 1건당 상한**이다 — 넘은 것은 사유만 채워 돌려준다(개수 보존)."""
    http = _Http()
    got = _adapter(http, max_calls=3).fetch(_queries(10), deadline_ms=10_000)

    assert http.calls == 3
    assert len(got) == 10
    assert all(v.reason == "call_budget_exhausted" for v in got[3:])


def test_월_상한은_인스턴스_수명_누적이다() -> None:
    """무료 한도(월 1,000) 안에서만 쓴다는 팀 결정을 코드가 지킨다."""
    http = _Http()
    ad = _adapter(http, max_calls=100, monthly=5)
    ad.fetch(_queries(3), deadline_ms=10_000)
    got = ad.fetch(_queries(4), deadline_ms=10_000)   # 누적 3 + 2 = 5 에서 멈춤

    assert http.calls == 5
    assert got[-1].reason == "monthly_budget_exhausted"


def test_마감을_넘기면_남은_것을_사유로_채운다() -> None:
    """생성 경로의 마감이 보강보다 우선이다 — 빠뜨리지 않는다."""
    http = _Http()
    ad = _adapter(http, clock=[0, 0, 0, 9_999])
    got = ad.fetch(_queries(5), deadline_ms=1_000)

    assert len(got) == 5
    assert any(v.reason == "deadline_exceeded" for v in got)


def test_벤더_예외를_경계_밖으로_던지지_않는다() -> None:
    """영업시간을 못 채운 것이 **일정 실패가 되면 안 된다** (DL-5·INV-4)."""
    got = _adapter(_Http(raises=True)).fetch(_queries(2), deadline_ms=10_000)
    assert all(v.reason and v.reason.startswith("http_error:") for v in got)
    assert all(v.hours == () for v in got)


# ── 약관 — FieldMask 를 늘리면 요금 티어가 올라간다 ──────────────────

def test_필드마스크는_영업시간_하나뿐이다() -> None:
    """요청 필드 중 **가장 비싼 티어**로 과금된다 — 평점·사진을 더하면 올라간다."""
    http = _Http()
    _adapter(http).fetch(_queries(1), deadline_ms=10_000)
    # 어댑터가 헤더에 무엇을 싣는지 직접 확인한다
    ad = GooglePlacesHoursAdapter(http, "KEY", max_calls=1, monthly_budget=1,
                                  monotonic_ms=lambda: 0)
    assert ad._headers["X-Goog-FieldMask"] == "regularOpeningHours"  # noqa: SLF001


def test_판정에_벤더_데이터를_담을_자리가_없다() -> None:
    """Google 은 `place_id` 외 저장을 금지한다 — 담을 필드가 없으면 적재도 못 한다."""
    fields = set(HoursVerdict.__dataclass_fields__)
    assert fields == {"poi_id", "hours", "reason"}


def test_영업시간이_없으면_사유가_필요하다() -> None:
    """빈 값을 휴무로 읽으면 **장애가 폐점으로 둔갑한다** — 타입이 막는다."""
    with pytest.raises(ValueError):
        HoursVerdict(PoiId("p"))
    with pytest.raises(ValueError):
        HoursVerdict(PoiId("p"), hours=parse_regular_opening_hours(
            _payload(_period(1, 9, 0, 1, 18, 0))), reason="왜")


# ── 약관 경계를 와이어에 고정한다 (2026-09-26) ─────────────────────

def test_와이어에_영업시간_필드가_없다() -> None:
    """**이 테스트가 빨개졌다면 읽고 멈춰라 — 낡은 테스트가 아니다.**

    Google Places 정책: `place_id` 를 제외한 Places 콘텐츠는 캐시·저장 금지다.
    우리는 영업시간을 런타임에 빌려 HC1 판정에만 쓰고 버린다. 지금 그게 안전한
    이유는 **응답 스키마에 담을 자리가 없어서**이고, 그건 우연이다.

    슬롯에 영업시간을 실으면 백엔드 `poi_snapshot` 동결 저장을 타고 들어가
    약관을 위반한다. FE 가 "영업시간 보여 주세요" 할 때 이 테스트가 그 자리에서
    멈추게 하는 것이 목적이다.

    **실어야 한다면**: 우리 파서로 얻은 값(`poi.open_hours`)만 싣고 구글 보강값은
    빼야 한다 — 출처를 가리는 장치를 먼저 만들고 이 테스트를 고쳐라.
    """
    schemas = json.loads(_OPENAPI.read_text(encoding="utf-8"))["components"]["schemas"]
    offenders = {
        name: [p for p in (body.get("properties") or {})
               if "hour" in p.lower() or "opening" in p.lower()]
        for name, body in schemas.items()
    }
    found = {k: v for k, v in offenders.items() if v}
    assert not found, (
        f"와이어에 영업시간 필드가 생겼다: {found}\n"
        "Google Places 보강값은 저장 금지다(place_id 만 허용) — 이 필드를 통해 "
        "백엔드 poi_snapshot 에 동결되면 약관 위반이다.\n"
        "우리 파서 값(poi.open_hours)이면 실어도 된다 — 다만 구글 보강값과 "
        "섞이지 않게 출처를 가르는 장치를 먼저 만들어라."
    )
