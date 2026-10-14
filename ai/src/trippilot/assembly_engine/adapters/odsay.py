"""OdsayTransitAdapter — ODsay 대중교통 길찾기 TravelTimePort 구현 (대중교통 전용).

TMAP 대중교통 상품(`/transit/routes`)이 미구독 403 이라 대중교통 실측만 ODsay 로 받는다
(2026-10-14 사용자 결정 — 카카오모빌리티·네이버 지도는 대중교통 경로 API 를 열어 두지 않았다:
카카오는 자동차 길찾기만 공개·도보는 제휴 전용, 네이버 Directions 5/15 는 자동차뿐).
자동차·보행은 그대로 TMAP(`tmap.py`) — 수단별 1차 선택은 `chained_travel.ByModeTravelTime`.

GET `https://api.odsay.com/v1/api/searchPubTransPathT?SX=경도&SY=위도&EX=경도&EY=위도&apiKey=…`.
응답 `result.path[].info` 중 `totalTime`(**분** — TMAP 은 초라 단위가 다르다)·`totalDistance`(미터),
첫 경로(추천순, OPT 기본 0). 응답 형태는 ODsay 문서 기준으로 고정했다 — 실 응답과의 드리프트는
실키 첫 실행에서 검증한다(TourAPI·TMAP 어댑터 선례).

오류는 HTTP 200 본문으로 온다 — `error` 객체/배열(`code`·`msg`) 또는 `errorCode`. 어느 쪽이든
TravelTimeError 로 승격하되 원인(`OdsayApiError.code`)을 `__cause__` 에 남긴다 — 체인이 하버사인으로
폴백하면서 원인별 첫 1회 경고에 코드가 실린다(-98 출발·도착 700m 이내, -99 결과 없음,
6 서비스 지역 아님, -8/-9 파라미터, 500 서버). 700m 이내 짧은 구간은 ODsay 가 거부하므로
하버사인 추정이 정상 경로다 — 그 코드의 경고 한 줄은 고장이 아니다.

메서드 1회 = HTTP 호출 정확히 1건, 재시도 없음(일일 한도 아끼기). 키는 **쿼리 파라미터**라
TMAP(헤더)과 달리 URL 에 실린다 — 예외 메시지에 URL·원문을 싣지 않는다(종류만).
"""

from __future__ import annotations

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.poi_curation.sourcing.tourapi import HttpGetJson
from trippilot.ports.travel_time_port import MeasuredTravel, TravelTimeError

_BASE = "https://api.odsay.com/v1/api/searchPubTransPathT"
_SOURCE = "odsay_transit"


class OdsayApiError(Exception):
    """본문 오류 — `code` 는 ODsay 오류 코드 문자열(-98·-99·6·500 …). 체인 경고 키에 실린다."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class OdsayTransitAdapter:
    """TravelTimePort 구현 — 대중교통 좌표쌍 1건 → 실이동 소요분·거리 (조회 전용)."""

    def __init__(self, http: HttpGetJson, api_key: str) -> None:
        self._http = http
        self._api_key = api_key

    def measure(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> MeasuredTravel:
        if mode is not TransportMode.PUBLIC:
            raise TravelTimeError(f"ODsay 는 대중교통 전용 — {mode.name} 미지원")
        # ODsay 좌표는 X=경도, Y=위도.
        params = {
            "SX": str(from_.lng), "SY": str(from_.lat),
            "EX": str(to.lng), "EY": str(to.lat),
            "apiKey": self._api_key,
        }
        try:
            payload = self._http.get_json(_BASE, params)
        except Exception as e:  # urllib·JSON 파싱 등 — 키가 URL 에 있으니 원문은 싣지 않는다
            raise TravelTimeError(
                f"searchPubTransPathT 호출 실패: {type(e).__name__}"
            ) from e
        total_minutes, total_distance_m = self._totals(payload)
        return MeasuredTravel(
            real_minutes=round(total_minutes, 1),
            distance_km=round(total_distance_m / 1000.0, 3),
            source=_SOURCE,
            approximated=False,
        )

    @staticmethod
    def _totals(payload: object) -> tuple[float, float]:
        """result.path[].info 중 totalTime·totalDistance 있는 첫 경로 — 없으면 형식 오류로 승격."""
        if not isinstance(payload, dict):
            raise TravelTimeError("searchPubTransPathT 응답이 JSON 객체가 아님")
        error = payload.get("error")
        if isinstance(error, list):
            error = error[0] if error and isinstance(error[0], dict) else {"code": "?"}
        if isinstance(error, dict):
            code = str(error.get("code", error.get("errorCode", "?")))
            message = str(error.get("msg") or error.get("message") or "")
            raise TravelTimeError(f"searchPubTransPathT 오류 {code}") from OdsayApiError(code, message)
        if payload.get("errorCode") is not None and not payload.get("result"):
            code = str(payload["errorCode"])
            raise TravelTimeError(f"searchPubTransPathT 오류 {code}") from OdsayApiError(code, "")
        result = payload.get("result")
        paths = result.get("path") if isinstance(result, dict) else None
        if not isinstance(paths, list):
            raise TravelTimeError("searchPubTransPathT result.path 없음")
        for path in paths:
            info = path.get("info") if isinstance(path, dict) else None
            if not isinstance(info, dict):
                continue
            minutes, distance_m = info.get("totalTime"), info.get("totalDistance")
            if _number(minutes):
                if not _number(distance_m):
                    raise TravelTimeError("searchPubTransPathT totalDistance 없음/형식 오류")
                return float(minutes), float(distance_m)
        raise TravelTimeError("searchPubTransPathT totalTime 있는 path 없음")
