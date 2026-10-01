"""ChainedTravelAdapter — TravelPort 폴백 체인 구현 (TRIP-422).

v2 설계(agent-structure-v2 §2 Provider 규칙 로직): 실경로 API → 하버사인 추정 폴백.
(구 인용 `agent-hierarchy-design §3.3`은 v2가 폐기한 v1 문서였다 — TRIP-530.)
현재 체인: TMAP(실측, confidence=HIGH) → TravelEstimator(하버사인, confidence=LOW).

TravelPort Protocol 만족 — 어셈블리·TransitProvider 모두 이 어댑터를 주입받으면
별도 코드 변경 없이 실경로 정확도를 얻는다.

동작:
1. TravelTimePort.measure() 호출 (TMAP 실측)
2. MeasuredTravel → TravelEstimate 변환 (is_estimated=False, source 유지)
3. 실패(TravelTimeError 또는 기타 예외) 시 TravelPort 폴백으로 전환
4. 폴백도 실패하면 예외 그대로 상위 전파 (INV-4: 침묵 실패 금지)

벤더 실패는 (수단, 예외 종류, 원인 종류, HTTP 상태)별 **첫 1회만** WARNING 으로 남긴다
(TRIP-1179) — 대중교통 상품 미구독 403 이 매 호출 조용히 추정으로 바뀌어 운영자가 볼
수단이 없었다. 수단만 키로 삼으면 첫 실패가 타임아웃일 때 뒤이은 403 이 끝까지 안
보인다. 키는 헤더라 로그에 안 싣고, 메시지도 싣지 않는다(종류·HTTP 상태만).
"""

from __future__ import annotations

import logging
import threading

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate
from trippilot.ports.travel_port import TravelPort
from trippilot.ports.travel_time_port import TravelTimePort

_log = logging.getLogger(__name__)


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
        self._warned: set[tuple] = set()   # (수단, 예외, 원인, 상태) — 조합 수가 작다
        self._lock = threading.Lock()  # 조립 뒤 거리는 스레드풀에서 부른다

    @property
    def fallback(self) -> TravelPort:
        """폴백 추정기 — 조립 뒤 거리 시한(api/route_budget)이 못 끝난 구간을 같은 값으로 채운다."""
        return self._fallback

    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate:
        """TMAP 실측 시도 → 실패 시 하버사인 폴백."""
        try:
            measured = self._primary.measure(from_, to, mode)
        except Exception as e:
            # TMAP 실패 → 폴백 (INV-4: 폴백이 있으니 여기선 삼키되 원인별 첫 1회는 남긴다)
            self._warn_once(mode, e)
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

    def _warn_once(self, mode: TransportMode, error: Exception) -> None:
        cause = error.__cause__
        status = getattr(cause, "code", None) or getattr(error, "code", None)
        key = (mode, type(error).__name__,
               type(cause).__name__ if cause is not None else None, status)
        with self._lock:
            if key in self._warned:
                return
            self._warned.add(key)
        _log.warning(
            "travel_primary_failed mode=%s error=%s cause=%s status=%s "
            "— 하버사인 추정으로 대체, 같은 원인의 이후 실패는 로그 생략",
            mode.name, *key[1:],
        )
