"""InfoCollector — Orchestrator 전속 정보 수집 하위 컴포넌트 (agent-structure-v2 §3, TRIP-406).

intent별 **정보 요구표**를 보고 등록된 Provider들을 호출해 InfoPacket 묶음을
돌려준다. 판단(점수·선택)은 하지 않는다 — 수집 지시와 상태 수렴만.

- Provider 실패는 상태값(IO-7)이 원칙이지만, 계약을 어기고 예외가 새어 나와도
  수집이 죽지 않게 UNAVAILABLE 패킷으로 수렴한다 (INV-4 — 강등 판단은 호출측).
  **단 PermissionDeniedError는 그대로 관통**한다 — 권한 위반을 상태값으로
  수렴시키면 fail-closed(TRIP-333)가 무너진다 (PersonaProvider docstring).
- 요구표에 있어도 **미등록 Provider는 건너뛴다** — 기능 부재는 실패가 아니다
  (오케스트레이터의 "미배선 = 기능 부재" 선례와 동일).
- 대형 데이터(후보 풀)는 packet에 참조 키만 온다(DL-2) — 실체는
  `resolve_pool`로 PLACE Provider에서 꺼낸다.
- 병렬 수집은 후속 — 현재 순차 호출 (Provider 3종이지만 전부 in-memory/단건 API).
- TRANSIT Provider는 v2 타입(TransitRequest)으로 직접 호출 (TRIP-423).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.context import PermissionDeniedError
from trippilot.domain.freshness import InfoPacket, ProviderKind, ProviderStatus
from trippilot.domain.llm import CandidatePool
from trippilot.domain.transit import TransitPurpose, TransitRequest
from trippilot.providers.base import Provider

# 정보 요구표 (agent-structure-v2 §3) — intent → 수집할 Provider 목록.
INFO_REQUIREMENTS: Mapping[str, tuple[ProviderKind, ...]] = {
    "GENERATE_SCHEDULE": (
        ProviderKind.PLACE,
        ProviderKind.WEATHER,
        ProviderKind.PERSONA,
        ProviderKind.EVENT,  # 행사 근접 보너스 재료 (TRIP-421)
    ),
    # TRANSIT 은 표에 남는다 (TRIP-423 이 타입 호출까지 만들었고 테스트 6건이
    # "REPLAN 은 TRANSIT 을 수집한다"를 단언한다). 다만 **호출측이 구간을 줄 때만**
    # 실제로 조회된다 — `params` 에 origin·destination 이 없으면 Provider 조립이
    # 실패해 UNAVAILABLE 패킷이 된다(기능 부재, INV-4).
    #
    # **미결 (2026-09-16) — 모은 실측이 착지할 자리가 없다.** `ItineraryProblem` 은
    # 날씨·행사에는 각각 착지 필드를 갖는데(`daily_rain_prob` TRIP-383,
    # `event_bonus` TRIP-421) **이동만 없다.** 그래서 지금 TRANSIT 을 수집해도
    # solve 로 가는 통로가 없어 모아서 버린다 — 어셈블리는 무조건
    # `travel.py` 의 `haversine_km × detour_factor`(직선 근사)로 계산한다.
    # TRANSIT 은 `TravelPort` 어댑터 체인의 **실 경로**라 근사와 다른 값이고,
    # "어셈블리가 이미 갖고 있으니 중복"은 근사와 실측을 같은 것으로 본 오류다.
    #
    # 두 갈래 — 어느 쪽이든 지금보다 정직하다 (팀 판단 대기):
    #   (1) 자리를 만든다 — `ItineraryProblem` 에 구간 실측 오버라이드
    #       (`measured_legs: Mapping[tuple[PoiId, PoiId], int] | None`)를 더하고
    #       있는 구간만 근사 대신 쓴다. `daily_rain_prob` 이 생긴 방식 그대로.
    #       비용: 어셈블리 내부 수정·회귀 범위.
    #   (2) 표시·진단 전용으로 못 박는다 — solve 에 안 넣고 응답 거리 표시와
    #       관측에만. 비용 0. 대신 "정확한 값을 모아 놓고 부정확한 값으로
    #       계산한다"가 남는다.
    # 재계획은 이미 벌어진 지연에 대응하는 경로라 실 도로 사정이 결과를 바꿀
    # 여지가 가장 크다는 점이 (1) 쪽 근거다. 결론 전까지 호출측이 안 채운다.
    "REPLAN": (
        ProviderKind.WEATHER,
        ProviderKind.TRANSIT,
        ProviderKind.PERSONA,
        ProviderKind.PLACE,
    ),
    # v2 §3 요구표 "EDIT | Place(추가/교체 의도 시)" — 2026-09-16 실체화.
    # 편집은 후보 자격 검증(INV-1)에 풀이 필요하고 그 외 수집은 없다.
    "EDIT": (ProviderKind.PLACE,),
    # v2 §3 "REFLECT | (없음)" — 회고는 백엔드가 방문 이력을 봉투에 실어 보낸다.
    # 빈 튜플을 **명시**한다: 키가 없으면 "아직 안 정한 것"과 구분되지 않는다.
    "REFLECT": (),
}


def _build_transit_request(params: dict) -> TransitRequest:
    """params dict에서 TransitRequest를 조립한다 (InfoCollector 전용).

    params keys: origin, destination, mode, now(선택), expected_minutes(선택), purpose(선택)
    """
    origin = params["origin"]
    if isinstance(origin, dict):
        origin = GeoPoint.from_dict(origin)

    destination = params["destination"]
    if isinstance(destination, dict):
        destination = GeoPoint.from_dict(destination)

    mode = params["mode"]
    if isinstance(mode, str):
        mode = TransportMode(mode)

    now = params.get("now")
    if now is None:
        now = datetime.now(timezone.utc)
    elif isinstance(now, str):
        from trippilot.domain.serialization import from_iso
        now = from_iso(now)

    purpose_raw = params.get("purpose", "delay_check")
    if isinstance(purpose_raw, str):
        purpose = TransitPurpose(purpose_raw)
    else:
        purpose = purpose_raw

    return TransitRequest(
        origin=origin,
        destination=destination,
        mode=mode,
        purpose=purpose,
        now=now,
        expected_minutes=params.get("expected_minutes"),
    )


class InfoCollector:
    def __init__(self, providers: Mapping[ProviderKind, Provider]) -> None:
        self._providers = dict(providers)

    def collect(self, intent: str, params: dict) -> dict[ProviderKind, InfoPacket]:
        """요구표의 등록 Provider들을 호출 — 패킷 묶음 반환 (요구표 밖 intent는 빈 묶음)."""
        packets: dict[ProviderKind, InfoPacket] = {}
        for kind in INFO_REQUIREMENTS.get(intent, ()):
            provider = self._providers.get(kind)
            if provider is None:  # 미등록 = 기능 부재 — 패킷 자체를 만들지 않는다
                continue
            try:
                packets[kind] = self._call_provider(kind, provider, params)
            except PermissionDeniedError:
                raise  # 보안 — 상태값 수렴 금지 (모듈 docstring)
            except Exception as e:  # Provider 계약 위반 — 수집은 계속 (INV-4)
                packets[kind] = InfoPacket(
                    provider=kind,
                    status=ProviderStatus.UNAVAILABLE,
                    data={"reason": f"{type(e).__name__}: {e}"},
                    freshness=None,
                )
        return packets

    def _call_provider(
        self, kind: ProviderKind, provider: Provider, params: dict
    ) -> InfoPacket:
        """Provider 종류별 타입 안전 호출 분기 (TRIP-423).

        TRANSIT: params → TransitRequest 조립 → fetch_typed() 호출.
        나머지: 기존대로 fetch(params: dict).
        """
        if kind is ProviderKind.TRANSIT and hasattr(provider, "fetch_typed"):
            request = _build_transit_request(params)
            return provider.fetch_typed(request)  # type: ignore[union-attr]
        return provider.fetch(params)

    def resolve_pool(self, pool_ref: str) -> CandidatePool | None:
        """PLACE 패킷의 참조 키 → 풀 실체 (DL-2). 미등록·축출이면 None."""
        place = self._providers.get(ProviderKind.PLACE)
        resolve = getattr(place, "resolve", None)
        return resolve(pool_ref) if callable(resolve) else None
