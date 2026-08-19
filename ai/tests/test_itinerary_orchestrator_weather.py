"""TRIP-383·406 — 오케스트레이터 날씨 경로 (InfoCollector→WeatherProvider 경유, fake만).

TRIP-406부터 _build(weather=포트)는 실배선과 동일하게 Provider→InfoCollector로
감싸 주입한다 — 아래 4계약은 전환 후에도 그대로 성립해야 한다.

증명하는 것:
  ① 주입 + 조회 성공: 예보가 **요청 날짜로 한정**되어 problem.daily_rain_prob에
     실리고, 정상 조회는 강등이 아니다 (SUCCESS 유지)
  ② 조회 실패: 무보정(problem은 None) + Degradation(stage=weather) + FallbackEvent
     — 일정은 그대로 나온다 (침묵 금지, INV-4: 날씨 실패 ≠ 생성 실패)
  ③ 미주입(기본 None): 기능 부재 — 무보정 + 강등 0 (기존 조립 회귀 없음,
     ⑤ 설명 워커의 "미배선 = 기능 부재" 선례와 동일)
  ④ 빈 예보(지평 밖 등): problem은 None — 강등 아님 (정보 없음 ≠ 실패)
"""

from __future__ import annotations

from datetime import date

from trippilot.domain.observability import FallbackEvent

from tests.test_itinerary_orchestrator import (
    _DAY1,
    _NOW,
    _TRACE_ID,
    _build,
    _request,
)
from trippilot.orchestrator.itinerary_orchestrator import GenerationStatus

_OTHER_DAY = date(2026, 8, 20)  # 요청 날짜 밖


class _FakeWeather:
    """준비된 예보 회신 + 호출 기록. 실 HTTP 0건."""

    def __init__(self, forecast) -> None:
        self._forecast = forecast
        self.calls: list = []

    def daily_forecast(self, coord, days):
        self.calls.append((coord, tuple(days)))
        return self._forecast


class _FailingWeather:
    def daily_forecast(self, coord, days):
        raise TimeoutError("kma timeout")


def _weather_events(trace) -> list[FallbackEvent]:
    return [e for e in trace.of_type(FallbackEvent)
            if e.component == "orchestrator.itinerary" and e.stage == "weather"]


# ── ① 주입 + 조회 성공 ───────────────────────────────────────────────


def test_forecast_lands_on_problem_filtered_to_request_days() -> None:
    weather = _FakeWeather({_DAY1: 80, _OTHER_DAY: 90})
    orchestrator, trace, sink = _build(weather=weather)

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.SUCCESS  # 정상 조회는 강등이 아니다
    assert sink.problems[0].daily_rain_prob == {_DAY1: 80}  # 요청 날짜만
    assert weather.calls == [(sink.problems[0].anchor, (_DAY1,))]
    assert _weather_events(trace) == []


# ── ② 조회 실패 — 무보정 + 강등 기록 (침묵 금지) ─────────────────────


def test_forecast_failure_degrades_but_still_generates() -> None:
    orchestrator, trace, sink = _build(weather=_FailingWeather())

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.DEGRADED
    assert outcome.solution is not None  # 날씨 실패가 생성 실패가 되면 안 된다
    assert any(d.stage == "weather" and "weather_error" in d.reason
               for d in outcome.degradations)
    assert sink.problems[0].daily_rain_prob is None  # 무보정
    events = _weather_events(trace)
    assert len(events) == 1
    assert events[0].reason.startswith("weather_error: TimeoutError")


# ── ③ 미주입 — 기능 부재 (강등 0, 기존 회귀 없음) ────────────────────


def test_unwired_weather_is_absence_not_degradation() -> None:
    orchestrator, trace, sink = _build()  # weather 미주입 (기본 None)

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.SUCCESS
    assert outcome.degradations == ()
    assert sink.problems[0].daily_rain_prob is None
    assert _weather_events(trace) == []


# ── ④ 빈 예보 — None으로 수렴 (강등 아님) ────────────────────────────


def test_empty_forecast_yields_no_adjust_without_degradation() -> None:
    orchestrator, trace, sink = _build(weather=_FakeWeather({}))

    outcome = orchestrator.generate(_request(), 20_000, _TRACE_ID, _NOW)

    assert outcome.status is GenerationStatus.SUCCESS
    assert sink.problems[0].daily_rain_prob is None
    assert _weather_events(trace) == []
