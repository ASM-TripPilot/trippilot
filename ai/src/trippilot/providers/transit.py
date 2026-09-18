"""TransitProvider — 이동 정보 수집 + 지연 트리거 판정 (agent-structure-v2 §2, TRIP-410).

v2 4상자 파이프라인 2단 Provider. LLM 0회.
내부적으로 TransitRequest/TransitInfo v2 도메인 타입을 사용하되,
Provider Protocol (fetch(params: dict) → InfoPacket)은 유지한다.

이동 추정 어댑터 체인을 경유해 거리·소요시간을 반환한다.
현재 실 어댑터: TravelEstimator(하버사인×우회계수, confidence=LOW).
지연 판정(예정 대비 30분+)은 규칙 로직 — LLM 0회.

INV-3 준수: internal_minutes는 내부 판정용이며 사용자 표시에 노출하지 않는다.
TTL: 실시간 요청 10분 / 매트릭스 캐시 24h.
"""

from __future__ import annotations

from trippilot.domain.freshness import FreshnessMeta, InfoPacket, ProviderKind, ProviderStatus
from trippilot.domain.transit import (
    Confidence,
    DelayTrigger,
    TransitInfo,
    TransitPurpose,
    TransitRequest,
)
from trippilot.ports.travel_port import TravelPort

# source → Confidence 매핑. 실 API 어댑터 추가 시 여기에 등록.
_SOURCE_CONFIDENCE: dict[str, Confidence] = {
    "tmap_car": Confidence.HIGH,
    "tmap_pedestrian": Confidence.HIGH,
    "tmap_transit": Confidence.HIGH,
    "kakao_mobility": Confidence.HIGH,
    "naver": Confidence.MID,
    "haversine_x_detour": Confidence.LOW,
}


def _confidence_from_source(source: str) -> Confidence:
    """source 문자열에서 신뢰도 등급 결정. 미등록이면 LOW."""
    return _SOURCE_CONFIDENCE.get(source, Confidence.LOW)


def _format_distance_range(distance_km_range: tuple[float, float]) -> str:
    """거리 범위를 표시용 문자열로 변환 ("약 1.2km")."""
    low, high = distance_km_range
    avg_km = (low + high) / 2
    if avg_km < 1.0:
        return f"약 {int(avg_km * 1000)}m"
    return f"약 {avg_km:.1f}km"


class TransitProvider:
    """Orchestrator InfoCollector가 호출하는 이동 정보 수집 Provider.

    LLM 0회. TravelPort 어댑터 체인을 경유한다.

    Provider Protocol(fetch(params: dict) → InfoPacket) 호환 유지.
    내부에서 params → TransitRequest 변환 후 v2 타입으로 처리한다.
    """

    DELAY_TRIGGER_MINUTES = 30  # 예정 대비 이 이상 지연이면 트리거

    def __init__(self, port: TravelPort, ttl_sec: int = 600) -> None:
        self._port = port
        self._ttl_sec = ttl_sec  # 기본 10분

    def fetch(self, params: dict) -> InfoPacket:
        """이동 정보 수집. 실패 시 예외 없이 상태값 반환 (INV-4).

        params에서 TransitRequest를 조립하고 v2 타입 기반으로 처리한다.
        params keys: origin, destination, mode, now, expected_minutes, purpose(선택)
        """
        request = self._build_request(params)
        return self._fetch_typed(request)

    def fetch_typed(self, request: TransitRequest) -> InfoPacket:
        """v2 타입 직접 호출 — 새 코드에서 사용. Protocol 외 확장 메서드."""
        return self._fetch_typed(request)

    def _build_request(self, params: dict) -> TransitRequest:
        """dict params → TransitRequest 변환."""
        from trippilot.domain.common import GeoPoint, TransportMode
        from trippilot.domain.serialization import from_iso

        origin = params["origin"]
        if isinstance(origin, dict):
            origin = GeoPoint.from_dict(origin)

        destination = params["destination"]
        if isinstance(destination, dict):
            destination = GeoPoint.from_dict(destination)

        mode = params["mode"]
        if isinstance(mode, str):
            mode = TransportMode(mode)

        now = params["now"]
        if isinstance(now, str):
            now = from_iso(now)

        purpose_raw = params.get("purpose", "info_display")
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

    def _fetch_typed(self, request: TransitRequest) -> InfoPacket:
        """v2 내부 구현 — TransitRequest → InfoPacket(TransitInfo schema)."""
        try:
            estimate = self._port.estimate(
                request.origin, request.destination, request.mode
            )
        except Exception:
            return InfoPacket(
                provider=ProviderKind.TRANSIT,
                status=ProviderStatus.UNAVAILABLE,
                data={},
                freshness=None,
            )

        # 지연 트리거 판정 — 규칙 로직 (LLM 0회)
        delay_trigger: DelayTrigger | None = None
        if request.expected_minutes is not None:
            delay = estimate.internal_minutes - request.expected_minutes
            if delay >= self.DELAY_TRIGGER_MINUTES:
                delay_trigger = DelayTrigger(
                    delay_minutes=delay,
                    threshold_minutes=self.DELAY_TRIGGER_MINUTES,
                )

        confidence = _confidence_from_source(estimate.source)
        # 거리 미터 변환: range 평균값 기준
        low_km, high_km = estimate.distance_km_range
        distance_m = int(round((low_km + high_km) / 2 * 1000))

        freshness = FreshnessMeta(
            source=estimate.source,
            fetched_at=request.now,
            cache_hit=False,
            ttl_sec=self._ttl_sec,
            stale=False,
        )

        transit_info = TransitInfo(
            distance_m=distance_m,
            distance_range=_format_distance_range(estimate.distance_km_range),
            internal_minutes=estimate.internal_minutes,
            confidence=confidence,
            source=estimate.source,
            delay_trigger=delay_trigger,
            freshness=freshness,
        )

        return InfoPacket(
            provider=ProviderKind.TRANSIT,
            status=ProviderStatus.OK,
            data=transit_info.to_dict(),
            freshness=freshness,
        )
