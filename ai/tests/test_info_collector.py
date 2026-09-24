"""TRIP-406 — WeatherProvider·InfoCollector (실 호출 0건, fake만).

증명하는 것:
  [Provider]
  ① 성공: InfoPacket(OK) — daily는 ISO 키(JSON-safe), 강수 80%↑만 트리거,
     FreshnessMeta(KMA·주입 now·TTL) 필수 동봉
  ② 실패: 예외를 던지지 않고 WEATHER_UNKNOWN + 사유 보존 + freshness 없음 (IO-7)
  [InfoCollector]
  ③ 정보 요구표 라우팅: GENERATE_SCHEDULE → WEATHER만 수집, 요구표 밖 intent는 빈 묶음
  ④ 미등록 Provider는 건너뛴다 (기능 부재 ≠ 실패 — 패킷 자체가 없음)
  ⑤ Provider가 계약을 어기고 예외를 새어 보내도 UNAVAILABLE 패킷으로 수렴 (INV-4)
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from trippilot.domain.common import GeoPoint
from trippilot.domain.freshness import InfoPacket, ProviderKind, ProviderStatus
from trippilot.domain.intent import ROUTABLE_INTENTS, Intent
from trippilot.orchestrator.info_collector import (
    INFO_REQUIREMENTS,
    InfoCollector,
    UnknownIntentError,
)
from trippilot.providers.weather import WeatherProvider

_ANCHOR = GeoPoint(35.1587, 129.1604)
_D1 = date(2026, 8, 20)
_D2 = date(2026, 8, 21)
_NOW = datetime(2026, 8, 19, 9, 0, tzinfo=timezone.utc)
_PARAMS = {"anchor": _ANCHOR, "days": (_D1, _D2), "now": _NOW}


class _FakePort:
    def __init__(self, forecast) -> None:
        self._forecast = forecast
        self.calls: list = []

    def daily_forecast(self, coord, days):
        self.calls.append((coord, tuple(days)))
        return self._forecast


class _FailingPort:
    def daily_forecast(self, coord, days):
        raise TimeoutError("kma down")


# ── ① Provider 성공 ──────────────────────────────────────────────────


def test_provider_success_packet_with_triggers_and_freshness() -> None:
    port = _FakePort({_D1: 80, _D2: 79})
    packet = WeatherProvider(port).fetch(_PARAMS)

    assert packet.provider is ProviderKind.WEATHER
    assert packet.status is ProviderStatus.OK
    assert packet.data["daily"] == {"2026-08-20": 80, "2026-08-21": 79}  # ISO 키
    assert packet.data["triggers"] == ("2026-08-20",)  # 80%가 경계 — 79는 미달
    assert packet.freshness is not None
    assert packet.freshness.source == "KMA"
    assert packet.freshness.fetched_at == _NOW
    assert port.calls == [(_ANCHOR, (_D1, _D2))]


# ── ② Provider 실패 — 상태값으로 수렴 ────────────────────────────────


def test_provider_failure_returns_status_not_exception() -> None:
    packet = WeatherProvider(_FailingPort()).fetch(_PARAMS)

    assert packet.status is ProviderStatus.WEATHER_UNKNOWN
    assert "TimeoutError" in packet.data["reason"]  # 사유 보존 (침묵 금지)
    assert packet.freshness is None


# ── ③ 요구표 라우팅 ──────────────────────────────────────────────────


def test_collector_routes_by_requirements_table() -> None:
    collector = InfoCollector(
        {ProviderKind.WEATHER: WeatherProvider(_FakePort({_D1: 10}))}
    )

    packets = collector.collect(Intent.GENERATE_SCHEDULE, _PARAMS)
    assert set(packets) == {ProviderKind.WEATHER}
    assert packets[ProviderKind.WEATHER].status is ProviderStatus.OK

    # 회고는 **빈 튜플이 명시된** 행이다 — "Provider 가 필요 없다"는 기록이다.
    assert collector.collect(Intent.GENERATE_REFLECTION, _PARAMS) == {}


def test_intent_without_a_row_raises_instead_of_returning_empty() -> None:
    """미정과 '필요 없음'을 가른다.

    전에는 표에 없는 키가 **조용히 빈 묶음**이었다. 그러면 요구표를 안 적은 의도가
    Provider 를 하나도 안 거치고 통과하고, 그 사실이 후보 0건으로만 드러나 원인까지
    3단을 거슬러야 한다(INV-4 침묵 금지). 실제로 표의 키가 `"EDIT"`·`"REFLECT"` 라
    라벨 정본(`EDIT_SCHEDULE`·`GENERATE_REFLECTION`)과 어긋나 있었고, 라우터가
    라벨로 디스패치를 끄는 순간 그 두 의도가 통째로 샜을 자리다.
    """
    collector = InfoCollector({})
    with pytest.raises(UnknownIntentError) as got:
        collector.collect(Intent.STYLE_ANALYSIS, _PARAMS)
    assert got.value.intent is Intent.STYLE_ANALYSIS


def test_every_requirement_key_is_a_real_intent_label() -> None:
    """수기 문자열이던 시절의 재발 방지 — 키가 라벨 정본과 같은 공간에 있는가."""
    assert all(isinstance(k, Intent) for k in INFO_REQUIREMENTS)


# 아직 요구표 행이 없는 의도 — 여기 있는 동안 `collect()` 는 UnknownIntentError 다.
#
# **둘은 성질이 다르다.** "아직 안 정했다"와 "정할 수가 없다"를 뭉치면 다음 사람이
# 전자인 줄 알고 아무 행이나 적는다.
#
# - `GET_POI_INFO`: PLACE Provider 가 **안 맞는다.** `PlaceProvider.fetch` 는
#   `pool_request`(앵커·날짜·예산·교통 전부 필수, 날짜는 비면 예외)를 요구하는
#   **후보풀 조립기**다. "이 장소 정보 알려줘"에는 날짜도 예산도 없고, 지어내면
#   **영업일 필터가 물어본 그 장소를 떨어뜨릴 수 있다.** 단건 조회 능력은 포트에
#   있지만(`PoiDbPort.find_by_ids`) Provider 가 안 내놓는다 — 그 경로를 여는 것이
#   선행이다.
# - `STYLE_ANALYSIS`: **처리자가 없다.** 라우팅 표는 `ReflectAgent` 를 가리키는데
#   `ReflectionKind` 에 그 종류가 없다(DAILY·TRIP_SUMMARY 둘뿐). 인자표도 "AI 에
#   처리 경로가 없다"고 적어 뒀다. 행을 적으면 처리 경로가 있다고 암시하게 된다.
_REQUIREMENTS_UNDEFINED = frozenset({
    Intent.GET_POI_INFO,   # Provider 가 안 맞는다 (단건 조회 경로 선행)
    Intent.STYLE_ANALYSIS,  # 처리자가 없다 (ReflectionKind 에 종류 없음)
})


def test_undefined_requirement_rows_stay_an_explicit_list() -> None:
    actual = frozenset(i for i in ROUTABLE_INTENTS if i not in INFO_REQUIREMENTS)
    assert actual == _REQUIREMENTS_UNDEFINED, (
        "요구표 공백이 바뀌었다 — 행을 채웠으면 위 목록에서 지우고, "
        "의도를 새로 추가했으면 행을 적거나 여기 명시할 것")


# ── ④ 미등록 Provider — 기능 부재 ────────────────────────────────────


def test_collector_skips_unregistered_provider() -> None:
    packets = InfoCollector({}).collect(Intent.GENERATE_SCHEDULE, _PARAMS)
    assert packets == {}  # 패킷 자체가 없다 — 실패 상태값도 아님


# ── ⑤ 계약 위반 예외 — UNAVAILABLE 수렴 ──────────────────────────────


def test_collector_converts_leaked_exception_to_unavailable() -> None:
    class _BrokenProvider:
        def fetch(self, params: dict) -> InfoPacket:
            raise RuntimeError("contract violation")

    packets = InfoCollector({ProviderKind.WEATHER: _BrokenProvider()}).collect(
        Intent.GENERATE_SCHEDULE, _PARAMS
    )

    packet = packets[ProviderKind.WEATHER]
    assert packet.status is ProviderStatus.UNAVAILABLE
    assert "RuntimeError" in packet.data["reason"]


# ── TRIP-407 — PlaceProvider·PersonaProvider ─────────────────────────

import pytest

from trippilot.domain.common import BudgetLevel, TransportMode
from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.persona import CompanionType, PersonaSummary
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.providers.persona import PersonaProvider
from trippilot.providers.place import PlaceProvider

_POOL_REQUEST = CandidatePoolRequest(
    anchor=_ANCHOR, dates=(_D1,), budget=BudgetLevel.MID,
    transport=TransportMode.PUBLIC,
)
_PRINCIPAL = Principal(user_id="u-owner")
_PERSONA_REF = ResourceRef(kind="persona", ref_id="p1", owner_id="u-owner")
_PERSONA = PersonaSummary(
    taste_tags=(), companion=CompanionType.SOLO, budget=BudgetLevel.MID
)


class _FakePool:
    def __init__(self, pois=("poi",)) -> None:
        self.pois = pois


class _FakeBuilder:
    def __init__(self, pool=None, error: Exception | None = None) -> None:
        self._pool = pool if pool is not None else _FakePool()
        self._error = error

    def build(self, request, now):
        if self._error is not None:
            raise self._error
        return self._pool


def test_place_provider_returns_resolvable_pool_ref() -> None:
    """풀은 참조 키로만 (DL-2) — resolve로 실체 회수."""
    pool = _FakePool()
    provider = PlaceProvider(_FakeBuilder(pool))
    packet = provider.fetch({"pool_request": _POOL_REQUEST, "now": _NOW})

    assert packet.status is ProviderStatus.OK
    assert packet.data["pool_size"] == 1
    assert provider.resolve(packet.data["pool_ref"]) is pool
    assert provider.resolve("없는-키") is None


def test_place_provider_empty_pool_is_no_candidates_with_ref() -> None:
    """빈 풀 = NO_CANDIDATES 상태값이되 ref는 있다 — 최소 일정 경로가 풀 객체를 쓴다."""
    provider = PlaceProvider(_FakeBuilder(_FakePool(pois=())))
    packet = provider.fetch({"pool_request": _POOL_REQUEST, "now": _NOW})

    assert packet.status is ProviderStatus.NO_CANDIDATES
    assert provider.resolve(packet.data["pool_ref"]) is not None


def test_place_provider_build_failure_has_no_ref() -> None:
    provider = PlaceProvider(_FakeBuilder(error=RuntimeError("db down")))
    packet = provider.fetch({"pool_request": _POOL_REQUEST, "now": _NOW})

    assert packet.status is ProviderStatus.NO_CANDIDATES
    assert "pool_ref" not in packet.data
    assert "RuntimeError" in packet.data["reason"]


class _FakeResolver:
    def __init__(self, value=None, error: Exception | None = None) -> None:
        self._value = value
        self._error = error

    def resolve(self, principal, ref):
        if self._error is not None:
            raise self._error
        return self._value


_PERSONA_PARAMS = {"principal": _PRINCIPAL, "persona_ref": _PERSONA_REF, "now": _NOW}


def test_persona_provider_roundtrips_summary() -> None:
    packet = PersonaProvider(_FakeResolver(_PERSONA)).fetch(_PERSONA_PARAMS)

    assert packet.status is ProviderStatus.OK
    assert PersonaSummary.from_dict(packet.data["persona"]) == _PERSONA
    assert packet.freshness is not None and packet.freshness.ttl_sec == 0  # 캐시 없음


def test_persona_provider_missing_is_cold_start() -> None:
    packet = PersonaProvider(
        _FakeResolver(error=LookupError("재조회 실패"))
    ).fetch(_PERSONA_PARAMS)
    assert packet.status is ProviderStatus.COLD_START

    packet = PersonaProvider(_FakeResolver({"raw": "dict"})).fetch(_PERSONA_PARAMS)
    assert packet.status is ProviderStatus.COLD_START  # 타입 위반도 비가용


def test_permission_denied_pierces_provider_and_collector() -> None:
    """보안 — 권한 위반은 상태값으로 삼키지 않는다 (fail-closed, IO-7의 명시적 예외)."""
    provider = PersonaProvider(_FakeResolver(error=PermissionDeniedError("남의 ref")))
    with pytest.raises(PermissionDeniedError):
        provider.fetch(_PERSONA_PARAMS)

    collector = InfoCollector({ProviderKind.PERSONA: provider})
    with pytest.raises(PermissionDeniedError):
        collector.collect(Intent.GENERATE_SCHEDULE, _PERSONA_PARAMS)


def test_collector_resolve_pool_delegates_to_place_provider() -> None:
    pool = _FakePool()
    provider = PlaceProvider(_FakeBuilder(pool))
    collector = InfoCollector({ProviderKind.PLACE: provider})
    packet = provider.fetch({"pool_request": _POOL_REQUEST, "now": _NOW})

    assert collector.resolve_pool(packet.data["pool_ref"]) is pool
    assert InfoCollector({}).resolve_pool("아무-키") is None  # PLACE 미등록
