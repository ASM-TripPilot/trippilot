"""BackendPoiDb — 백엔드 `/internal/pois` 정본 read 어댑터 (TRIP-408).

POI 정본은 backend C7(place-data) 단일 소유(INV-1) — 본 어댑터는 StaticPoiDb
자리에 꽂혀 배선이 쓰는 2메서드(find_by_radius·find_by_ids)만 HTTP 로 위임한다.
와이어 계약은 상대 구현(`PoiInternalController.kt`)을 직접 열어 맞췄다
(anti-patterns.md: 계약 문서만 보고 경계 어댑터 구현 금지):

- find_by_radius → GET  /internal/pois?centerLat=&centerLng=&radiusKm=
- find_by_ids    → POST /internal/pois/batch-get  {"poi_ids": [...]}
- 인증: `X-Service-Token` 헤더 (TRIP-393, 공유 시크릿 — 비면 백엔드가 fail-closed)

응답 행은 snake_case·경계 카테고리 코드(SIGHT/FOOD/…)·ACTIVE만이다. 영업시간은
원문 문자열(structured 는 백엔드 후속)이라 수집 게이트와 같은 파서
(`sourcing.mapping.parse_open_hours`)를 재사용한다 — 파싱 불가는 open_hours=()
로 두고 지어내지 않는다(풀 빌더 ③은 정보 없음을 통과시키고 ⑤가 하위 정렬).

HTTP 실패는 예외로 올린다 — 빈 풀로 수렴시키면 "후보 없음"이라는 거짓 음성이
된다(INV-4 침묵 금지). 상위 폴백 계단은 InfoCollector 소유. 다만 실패를 **한 덩어리로
올리지는 않는다**(TRIP-436): 백엔드 응답 상태코드를 예외에 실어 경계(api/errors.py)가
책임 소재를 가르게 한다 — 4xx 는 우리가 잘못 보낸 것, 5xx·연결 실패만 상대 장애다.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from typing import Protocol

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.sourcing.mapping import parse_open_hours

logger = logging.getLogger(__name__)

_RADIUS_PATH = "/internal/pois"
_BATCH_PATH = "/internal/pois/batch-get"
_TOKEN_HEADER = "X-Service-Token"
# 백엔드 PoiSource(KAKAO_LOCAL/TOURAPI/MANUAL) → AI PoiSource.
# MANUAL=시드 입력분, 나머지 벤더 수집분은 PLACES_API. WEB 은 confidence 필수라
# (백엔드가 안 보내는 값) 매핑 대상이 아니다 — 지어내지 않는다.
_SOURCE_MAP = {"MANUAL": PoiSource.SEED}


class BackendPoiDbError(RuntimeError):
    """백엔드 POI 조회 실패 — 빈 결과로 위장하지 않는다(INV-4).

    `status`는 백엔드가 돌려준 HTTP 상태코드(연결 실패·응답 계약 위반이면 None).
    경계가 이 값으로 "우리가 잘못 보냄(4xx)" 과 "상대 장애(5xx·연결 실패)" 를
    가른다 — 뭉뚱그려 500 으로 올리면 호출측이 멀쩡한 자기 요청을 두고 상대
    장애 폴백·재시도를 태운다(TRIP-436).
    """

    def __init__(self, message: str, *, status: int | None = None,
                 retryable: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class HttpJson(Protocol):
    """어댑터가 쓰는 HTTP 콘센트 — 테스트는 fake, 실행 조립은 UrllibJsonClient."""

    def request_json(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        body: object | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> object: ...


class UrllibJsonClient:
    """표준 라이브러리 구현 — 실행 조립용. 테스트에서는 사용하지 않는다(실 호출 0)."""

    def __init__(self, timeout_sec: float = 10.0) -> None:
        self._timeout = timeout_sec

    def request_json(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        body: object | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> object:
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        data = None
        merged = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            merged["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=merged, method=method)
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


class BackendPoiDb:
    """PoiDbPort 중 배선이 쓰는 2메서드의 백엔드 HTTP 구현 (StaticPoiDb 동형)."""

    def __init__(self, http: HttpJson, base_url: str, service_token: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._headers = {_TOKEN_HEADER: service_token}

    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]:
        rows = self._call(
            "GET", _RADIUS_PATH,
            params={
                "centerLat": str(center.lat),
                "centerLng": str(center.lng),
                "radiusKm": str(radius_km),
            },
        )
        return self._to_pois(rows)

    def find_by_ids(self, ids: frozenset[PoiId]) -> tuple[Poi, ...]:
        if not ids:
            return ()
        rows = self._call(
            "POST", _BATCH_PATH,
            body={"poi_ids": sorted(str(i) for i in ids)},
        )
        return self._to_pois(rows)

    def _call(self, method: str, path: str, **kwargs: object) -> list:
        try:
            body = self._http.request_json(
                method, f"{self._base}{path}", headers=self._headers, **kwargs,  # type: ignore[arg-type]
            )
        except Exception as e:
            # HTTPError 만 상태코드를 갖는다 — 연결 실패(URLError·OSError)는 None.
            status = e.code if isinstance(e, urllib.error.HTTPError) else None
            raise BackendPoiDbError(
                f"{method} {path} 실패: {e}",
                status=status,
                retryable=status is None or status >= 500,
            ) from e
        if not isinstance(body, list):
            # 200 인데 계약 위반 — 재시도해도 같은 응답이다(상대 배포로만 고쳐진다).
            raise BackendPoiDbError(f"{method} {path} 응답이 배열이 아님: {type(body).__name__}")
        return body

    def _to_pois(self, rows: list) -> tuple[Poi, ...]:
        pois = []
        for row in rows:
            try:
                pois.append(self._to_poi(row))
            except (KeyError, ValueError, TypeError) as e:
                # 한 행의 계약 위반으로 풀 전체를 잃지 않는다 — 스킵은 로그로 드러낸다.
                logger.warning("POI 행 매핑 실패 — 스킵: %s (%s)", row.get("poi_id") if isinstance(row, Mapping) else row, e)
        return tuple(pois)

    @staticmethod
    def _to_poi(row: Mapping) -> Poi:
        return Poi(
            poi_id=PoiId(str(row["poi_id"])),
            name=row["name_ko"],
            category=PoiCategory(row["category"]),
            coord=GeoPoint(float(row["lat"]), float(row["lng"])),
            open_hours=parse_open_hours(row.get("opening_hours"), None),
            avg_cost=None,   # 백엔드 미제공 → 예산 필터 통과 (풀 빌더 ② 계약)
            rating=None,     # 백엔드 미제공 — 지어내지 않는다 (정렬은 ⑤ tie-break)
            quality=DataQuality(row["data_quality"]),
            source=_SOURCE_MAP.get(row["source"], PoiSource.PLACES_API),
            confidence=None,
        )
