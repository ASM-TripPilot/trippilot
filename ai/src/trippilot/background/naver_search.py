"""NAVER API HUB 검색 클라이언트 — 행사 웹소싱 입력 수집 (TRIP-421).

이관 계약(2026-06-25 API HUB 출시, 이관 가이드 기준):
- base `https://naverapihub.apigw.ntruss.com/search/v1/{kind}` (구 openapi.naver.com 아님)
- 헤더 `X-NCP-APIGW-API-KEY-ID`(Client ID) · `X-NCP-APIGW-API-KEY`(Client Secret)
- 파라미터(query·display)·응답 items[] 형태는 구 API와 동일 — 실 응답 드리프트는
  실키 첫 실행에서 검증한다 (TourAPI·TMAP 선례).

**하드캡이 1급 계약이다**: 사용자 요구 "정확히 무료까지만" — 클라이언트가 호출
수를 세고 상한 도달 시 CallBudgetExceeded를 던진다(호출 전 검사 — 상한 초과
호출 0건). 현재 HUB는 한도 초과 시 과금이 아니라 429지만, 향후 유료화에도
이 캡이 그대로 방어선이 된다.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from typing import Mapping, Protocol

from trippilot.domain.common import GeoPoint

_BASE = "https://naverapihub.apigw.ntruss.com/search/v1"
_KINDS = frozenset({"webkr", "blog", "news", "local"})
_TAG_RE = re.compile(r"<[^>]+>")  # 응답 title/description의 <b> 강조 태그 제거용


class CallBudgetExceeded(Exception):
    """호출 상한 도달 — 배치는 이를 받아 정상 종료(다음 실행에서 이어감)한다.

    상한은 **실행당**이다 — `calls_used` 는 인스턴스 변수라 실행이 끝나면 0 으로
    돌아간다. 스케줄이 하루 한 번이라 평소엔 실행당 = 일일이지만, 손으로 여러 번
    돌린 날은 그 횟수만큼 곱해진다(2026-08-21 실측: 수동 7회 = 천장 7배).
    """


class HttpGetJson(Protocol):
    def get_json(
        self, url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> object: ...


class UrllibHttpClient:
    """표준 라이브러리 구현 — 배치 실행용. 테스트는 fake (실 호출 0, D37)."""

    def __init__(self, timeout_sec: float = 10.0) -> None:
        self._timeout = timeout_sec

    def get_json(
        self, url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> object:
        request = urllib.request.Request(
            f"{url}?{urllib.parse.urlencode(params)}", headers=dict(headers)
        )
        with urllib.request.urlopen(request, timeout=self._timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


def strip_tags(text: str) -> str:
    return _TAG_RE.sub("", text or "")


def coord_from_local_item(item: Mapping) -> GeoPoint | None:
    """지역 검색 item의 mapx/mapy → WGS84. HUB도 구 API와 동일한 1e7 배 정수 표기.

    형식이 다르면 None — 좌표를 지어내지 않는다 (좌표 없는 행사도 유효, 부착만 제외).
    """
    try:
        lng = int(item["mapx"]) / 1e7
        lat = int(item["mapy"]) / 1e7
    except (KeyError, TypeError, ValueError):
        return None
    if not (33.0 <= lat <= 39.5 and 124.0 <= lng <= 132.0):  # 한반도 밖 = 형식 오해
        return None
    return GeoPoint(lat, lng)


class NaverSearchClient:
    """검색 1회 = HTTP 1건 = 예산 1 소모. 재시도 없음 (한도 아끼기 — TourAPI 선례)."""

    def __init__(
        self,
        http: HttpGetJson,
        client_id: str,
        client_secret: str,
        max_calls: int,
    ) -> None:
        self._http = http
        self._headers = {
            "X-NCP-APIGW-API-KEY-ID": client_id,
            "X-NCP-APIGW-API-KEY": client_secret,
        }
        self._max_calls = max_calls
        self.calls_used = 0

    def search(self, kind: str, query: str, display: int = 10) -> list[dict]:
        """items[] 반환. 상한 도달이면 호출 **전에** CallBudgetExceeded."""
        if kind not in _KINDS:
            raise ValueError(f"미지원 검색 종류: {kind} (지원: {sorted(_KINDS)})")
        if self.calls_used >= self._max_calls:
            raise CallBudgetExceeded(
                f"실행당 호출 상한 {self._max_calls} 도달 — 남은 수집은 다음 실행에서"
            )
        self.calls_used += 1
        payload = self._http.get_json(
            f"{_BASE}/{kind}", self._headers, {"query": query, "display": str(display)}
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            return []  # 형식 밖 응답 — 이 쿼리만 빈손 (배치는 계속)
        return [i for i in payload["items"] if isinstance(i, dict)]
