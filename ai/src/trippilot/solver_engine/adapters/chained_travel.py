"""ChainedTravelAdapter — TravelPort 폴백 체인 구현 (TRIP-422).

v2 설계(agent-hierarchy-design §3.3): 실경로 API → 하버사인 추정 폴백.
현재 체인: TMAP(실측, confidence=HIGH) → TravelEstimator(하버사인, confidence=LOW).

TravelPort Protocol 만족 — 솔버·TransitProvider 모두 이 어댑터를 주입받으면
별도 코드 변경 없이 실경로 정확도를 얻는다.

동작:
1. TravelTimePort.measure() 호출 (TMAP 실측)
2. MeasuredTravel → TravelEstimate 변환 (is_estimated=False, source 유지)
3. 실패(TravelTimeError 또는 기타 예외) 시 TravelPort 폴백으로 전환
4. 폴백도 실패하면 예외 그대로 상위 전파 (INV-4: 침묵 실패 금지)
"""

from __future__ import annotations

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate
from trippilot.ports.travel_port import TravelPort
from trippilot.ports.travel_time_port import TravelTimePort


class ChainedTravelAdapter:
    """TravelPort 만족 — TMAP 실측 1차, 하버사인 폴백 2차.

    생성자에 TravelTimePort(TMAP)와 TravelPort(하버사인)를 주입한다.
    """

    def __init__(
        self,
        primary: TravelTimePort,
        fallback: TravelPort,
    ) -> None:
        self._primary = primary
        self._fallback = fallback

    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate:
        """TMAP 실측 시도 → 실패 시 하버사인 폴백."""
        try:
            measured = self._primary.measure(from_, to, mode)
        except Exception:
            # TMAP 실패 → 폴백 (INV-4: 폴백이 있으니 여기선 삼킴)
            return self._fallback.estimate(from_, to, mode)

        # MeasuredTravel → TravelEstimate 변환
        # 실측이므로 범위 = 단일값 (low == high), is_estimated = False
        distance_km = round(measured.distance_km, 3)
        return TravelEstimate(
            distance_km_range=(distance_km, distance_km),
            internal_minutes=int(round(measured.real_minutes)),
            is_estimated=False,
            source=measured.source,
        )
