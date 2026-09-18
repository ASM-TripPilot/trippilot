"""TmapRouteAdapter — TMAP 경로 API TravelTimePort 구현 (TRIP-382).

HTTP 클라이언트는 생성자 주입 — 테스트는 fake, 실행은 UrllibHttpClient(표준
라이브러리, 새 의존 없음). **메서드 1회 = HTTP 호출 정확히 1건**, 재시도 없음
(일일 한도 아끼기 — TourApiAdapter 선례).

응답 형태는 TMAP 문서 기준으로 고정했다 — POST, 헤더 `appKey`. 자동차·보행은
`/tmap/routes[/pedestrian]` 응답 `features[].properties` 중 `totalTime`(초)·
`totalDistance`(미터). 대중교통(TRIP-405)은 별도 상품 `/transit/routes` 응답
`metaData.plan.itineraries[]` 중 `totalTime`(초) — 거리는 `totalDistance` 우선,
없으면 `legs[].distance` 합산. **실 응답과의 드리프트는 실키 첫 실행
(scripts/smoke_itinerary.py 수동/스케줄)에서 검증**한다 (TourAPI 어댑터
선례 — 픽스처는 문서 기준, 실키 스모크가 계약을 확정).

실패 시 다른 수단으로 조용히 폴백하지 않는다 — TravelTimeError 승격(INV-4).
(v1의 PUBLIC→보행 근사는 TRIP-405에서 제거 — 실측 2일치에서 장거리 −50~60%
편향 확인, 근사가 캘리브레이션 재료로 부적합.)
"""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Mapping
from typing import Protocol

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.ports.travel_time_port import MeasuredTravel, TravelTimeError

_BASE = "https://apis.openapi.sk.com"

# 수단 → (엔드포인트 경로, source 표기) — 근사 없음, 전 수단 실측 (TRIP-405)
_ROUTE: Mapping[TransportMode, tuple[str, str]] = {
    TransportMode.CAR: ("/tmap/routes", "tmap_car"),
    TransportMode.WALK: ("/tmap/routes/pedestrian", "tmap_pedestrian"),
    TransportMode.PUBLIC: ("/transit/routes", "tmap_transit"),
}


class HttpPostJson(Protocol):
    """POST(JSON body) + JSON 파싱 1건. 실패는 예외로 (어댑터가 TravelTimeError로 감싼다)."""

    def post_json(
        self, url: str, headers: Mapping[str, str], body: Mapping[str, object]
    ) -> object: ...


class UrllibHttpClient:
    """표준 라이브러리 구현 — 스크립트 실행용. 테스트에서는 사용하지 않는다(실 호출 0)."""

    def __init__(self, timeout_sec: float = 10.0) -> None:
        self._timeout = timeout_sec

    def post_json(
        self, url: str, headers: Mapping[str, str], body: Mapping[str, object]
    ) -> object:
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", **headers},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self._timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


class TmapRouteAdapter:
    """TravelTimePort 구현 — 좌표쌍 1건 → 실이동 소요분·거리 (조회 전용)."""

    def __init__(self, http: HttpPostJson, app_key: str) -> None:
        self._http = http
        self._app_key = app_key

    def measure(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> MeasuredTravel:
        path, source = _ROUTE[mode]
        # TMAP 좌표는 X=경도, Y=위도 (문자열).
        body: dict[str, object] = {
            "startX": str(from_.lng),
            "startY": str(from_.lat),
            "endX": str(to.lng),
            "endY": str(to.lat),
        }
        if mode is TransportMode.PUBLIC:
            body["count"] = 1  # 최적 경로 1건이면 충분 — 응답 절약
        else:
            # 자동차·보행 API 필수 필드. 보행 start/endName은 표기용이라 고정 라벨.
            body.update({"version": "1", "startName": "start", "endName": "end"})
        try:
            payload = self._http.post_json(
                f"{_BASE}{path}", {"appKey": self._app_key}, body
            )
        except Exception as e:  # urllib·JSON 파싱 등 — 원인 보존해 상위 로그로
            raise TravelTimeError(f"{path} 호출 실패: {type(e).__name__}: {e}") from e
        if mode is TransportMode.PUBLIC:
            total_time_sec, total_distance_m = self._transit_totals(payload, path)
        else:
            total_time_sec, total_distance_m = self._totals(payload, path)
        return MeasuredTravel(
            real_minutes=round(total_time_sec / 60.0, 1),
            distance_km=round(total_distance_m / 1000.0, 3),
            source=source,
            approximated=False,
        )

    @staticmethod
    def _totals(payload: object, path: str) -> tuple[float, float]:
        """features[].properties 중 totalTime 있는 첫 항목 — 없으면 형식 오류로 승격."""
        if not isinstance(payload, dict):
            raise TravelTimeError(f"{path} 응답이 JSON 객체가 아님")
        features = payload.get("features")
        if not isinstance(features, list):
            raise TravelTimeError(f"{path} features 없음")
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties")
            if not isinstance(props, dict):
                continue
            time_sec = props.get("totalTime")
            dist_m = props.get("totalDistance")
            if isinstance(time_sec, (int, float)) and not isinstance(time_sec, bool):
                if not (isinstance(dist_m, (int, float)) and not isinstance(dist_m, bool)):
                    raise TravelTimeError(f"{path} totalDistance 없음/형식 오류")
                return float(time_sec), float(dist_m)
        raise TravelTimeError(f"{path} totalTime 있는 feature 없음")

    @staticmethod
    def _transit_totals(payload: object, path: str) -> tuple[float, float]:
        """metaData.plan.itineraries[] 중 totalTime 있는 첫 경로 (TRIP-405).

        거리는 totalDistance 우선, 없으면 legs[].distance 합산 — 문서상 경로별
        거리 표기가 갈려 방어적으로 둘 다 받는다. 시간도 거리도 없으면 형식
        오류로 승격 (조용한 0 반환 금지).
        """
        if not isinstance(payload, dict):
            raise TravelTimeError(f"{path} 응답이 JSON 객체가 아님")
        plan = payload.get("metaData", {})
        plan = plan.get("plan", {}) if isinstance(plan, dict) else {}
        itineraries = plan.get("itineraries") if isinstance(plan, dict) else None
        if not isinstance(itineraries, list):
            # 경로 없음·상품 미활성 등은 result.message로 온다 — 사유 보존
            detail = payload.get("result")
            raise TravelTimeError(f"{path} itineraries 없음 (result={detail})")
        for itinerary in itineraries:
            if not isinstance(itinerary, dict):
                continue
            time_sec = itinerary.get("totalTime")
            if not (isinstance(time_sec, (int, float)) and not isinstance(time_sec, bool)):
                continue
            dist_m = itinerary.get("totalDistance")
            if not (isinstance(dist_m, (int, float)) and not isinstance(dist_m, bool)):
                legs = itinerary.get("legs")
                dist_m = sum(
                    leg["distance"] for leg in legs
                    if isinstance(leg, dict)
                    and isinstance(leg.get("distance"), (int, float))
                    and not isinstance(leg.get("distance"), bool)
                ) if isinstance(legs, list) else 0
                if not dist_m:
                    raise TravelTimeError(f"{path} 거리 정보 없음 (totalDistance·legs 모두)")
            return float(time_sec), float(dist_m)
        raise TravelTimeError(f"{path} totalTime 있는 itinerary 없음")
