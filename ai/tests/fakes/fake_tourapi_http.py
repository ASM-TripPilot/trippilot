"""FakeTourApiHttp — TourAPI HTTP fake (실 호출 0, TRIP-246).

TourAPI 4.0 문서 형태의 응답 봉투를 그대로 흉내낸다 — 실 응답과의 드리프트는
실키 스모크(scripts/collect_pois.py 수동 실행)에서 검증한다. get_json 1회 =
호출 1건 기록 — 일일 호출 상한 검증의 근거가 된다.
"""

from __future__ import annotations

from collections.abc import Mapping


def envelope(items: list[dict], total_count: int, *, page_no: int = 1) -> dict:
    """정상 응답 봉투. 빈 목록이면 items가 "" 로 오는 실 API 변주를 그대로 재현."""
    return {
        "response": {
            "header": {"resultCode": "0000", "resultMsg": "OK"},
            "body": {
                "items": {"item": items} if items else "",
                "numOfRows": len(items),
                "pageNo": page_no,
                "totalCount": total_count,
            },
        }
    }


def error_envelope(code: str = "30", msg: str = "SERVICE_KEY_IS_NOT_REGISTERED_ERROR") -> dict:
    return {"response": {"header": {"resultCode": code, "resultMsg": msg}}}


def list_item(
    contentid: str,
    title: str,
    *,
    contenttypeid: str = "12",
    mapx: str = "126.4983",   # 경도 (실 API는 문자열)
    mapy: str = "33.4890",    # 위도
    addr1: str = "제주특별자치도 제주시",
    cat1: str = "A01",
    cat2: str = "A0101",
    cat3: str = "A01010400",
    firstimage: str = "",
    modifiedtime: str = "20260801120000",
) -> dict:
    return {
        "contentid": contentid, "contenttypeid": contenttypeid, "title": title,
        "addr1": addr1, "mapx": mapx, "mapy": mapy,
        "cat1": cat1, "cat2": cat2, "cat3": cat3,
        "firstimage": firstimage, "modifiedtime": modifiedtime,
    }


def intro_item(content_id: str, kind: str, hours: str, rest: str) -> dict:
    """detailIntro2 항목 — 영업시간 필드명은 contentTypeId마다 다르다."""
    fields = {
        "12": ("usetime", "restdate"),
        "14": ("usetimeculture", "restdateculture"),
        "28": ("usetimeleports", "restdateleports"),
        "38": ("opentime", "restdateshopping"),
        "39": ("opentimefood", "restdatefood"),
    }[kind]
    return {"contentid": content_id, fields[0]: hours, fields[1]: rest}


class HttpStatusError(Exception):
    """urllib.error.HTTPError의 최소 대역 — `.code` 로 상태를 노출한다.

    어댑터는 예외 타입이 아니라 `.code` 만 본다 (실행은 urllib, 테스트는 이것).
    """

    def __init__(self, code: int) -> None:
        super().__init__(f"HTTP Error {code}")
        self.code = code


class FakeTourApiHttp:
    """(kind, page_no) → 목록 봉투, content_id → 상세 봉투. 등록 없는 요청은 빈 봉투.

    다지역 테스트(TRIP-246 후속)는 (area_code, kind, page_no) 3-키도 섞어 쓸 수
    있다 — 3-키가 우선, 없으면 기존 2-키(지역 무관)로 폴백 (기존 픽스처 무수정).

    `dead_keys` 는 **그 serviceKey 로 온 요청만** 실패시킨다 (TRIP-348 키 실패 전환):
    값이 int 면 그 HTTP 상태로 예외, str 이면 그 resultCode 의 에러 봉투. 실측된 두
    가지 거부 형태 — 403 과 봉투 resultCode — 를 한 fake 로 재현하기 위한 것이다.
    """

    def __init__(
        self,
        pages: Mapping[tuple[str, int] | tuple[str, str, int], dict] | None = None,
        intros: Mapping[str, dict] | None = None,
        dead_keys: Mapping[str, int | str] | None = None,
    ) -> None:
        self._pages = dict(pages or {})
        self._intros = dict(intros or {})
        self._dead_keys = dict(dead_keys or {})
        self.calls: list[tuple[str, dict]] = []

    def get_json(self, url: str, params: Mapping[str, str]) -> object:
        self.calls.append((url, dict(params)))
        rejection = self._dead_keys.get(params.get("serviceKey", ""))
        if isinstance(rejection, int):
            raise HttpStatusError(rejection)
        if isinstance(rejection, str):
            return error_envelope(rejection)
        if url.endswith("/areaBasedList2"):
            area_key = (params["areaCode"], params["contentTypeId"],
                        int(params["pageNo"]))
            if area_key in self._pages:
                return self._pages[area_key]
            key = (params["contentTypeId"], int(params["pageNo"]))
            return self._pages.get(key, envelope([], 0))
        if url.endswith("/detailIntro2"):
            return self._intros.get(params["contentId"], envelope([], 0))
        raise AssertionError(f"예상 밖 URL: {url}")
