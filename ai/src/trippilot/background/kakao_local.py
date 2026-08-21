"""카카오 로컬 API 지오코더 — 행사 좌표 부여 보강 (TRIP-421).

네이버 지역검색(업체 DB)의 빈틈 둘을 카카오가 메운다:
- 주소검색(`/v2/local/search/address.json`) — 정식 지오코더 (주소 → 좌표 정확)
- 키워드검색(`/v2/local/search/keyword.json`) — 장소명 매칭이 강함

인증: `Authorization: KakaoAK {REST_API_KEY}` 헤더. 응답 documents[]의
x=경도·y=위도 (문자열). 실 응답 드리프트는 실키 첫 실행에서 검증 (선례 동일).

하드캡 규약은 NaverSearchClient와 동일 — 호출 전 검사, 상한 초과 호출 0건.
무료 쿼터(일 10만대)가 넉넉하지만 "정확히 무료까지만" 원칙을 캡으로 강제한다.
"""

from __future__ import annotations

from trippilot.background.naver_search import CallBudgetExceeded, HttpGetJson
from trippilot.domain.common import GeoPoint

_BASE = "https://dapi.kakao.com/v2/local/search"


def _coord_from_documents(payload: object) -> GeoPoint | None:
    """documents[0]의 x(경도)/y(위도) → GeoPoint. 형식 밖·한반도 밖은 None."""
    if not isinstance(payload, dict):
        return None
    docs = payload.get("documents")
    if not isinstance(docs, list) or not docs or not isinstance(docs[0], dict):
        return None
    try:
        lng = float(docs[0]["x"])
        lat = float(docs[0]["y"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (33.0 <= lat <= 39.5 and 124.0 <= lng <= 132.0):
        return None
    return GeoPoint(lat, lng)


class KakaoLocalClient:
    """조회 1회 = HTTP 1건 = 예산 1 소모. 재시도 없음 (한도 아끼기 — 선례 동일)."""

    def __init__(self, http: HttpGetJson, rest_api_key: str, max_calls: int) -> None:
        self._http = http
        self._headers = {"Authorization": f"KakaoAK {rest_api_key}"}
        self._max_calls = max_calls
        self.calls_used = 0

    def _get(self, endpoint: str, query: str) -> GeoPoint | None:
        if self.calls_used >= self._max_calls:
            raise CallBudgetExceeded(
                f"카카오 일일 호출 상한 {self._max_calls} 도달"
            )
        self.calls_used += 1
        payload = self._http.get_json(
            f"{_BASE}/{endpoint}", self._headers, {"query": query, "size": "1"}
        )
        return _coord_from_documents(payload)

    def address_to_coord(self, address: str) -> GeoPoint | None:
        return self._get("address.json", address)

    def keyword_to_coord(self, keyword: str) -> GeoPoint | None:
        return self._get("keyword.json", keyword)
