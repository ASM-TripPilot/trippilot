"""TourApiAdapter — TourAPI 4.0(KorService2) PoiSourcingPort 구현 (TRIP-246).

HTTP 클라이언트는 생성자 주입 — 테스트는 fake, 실행은 UrllibHttpClient(표준
라이브러리, 새 의존 없음). 포트 계약대로 **메서드 1회 = HTTP 호출 정확히 1건**,
재시도 없음 (일일 한도 아끼기).

응답 형태는 TourAPI 4.0 문서 기준으로 고정했다 — **실 응답과의 드리프트는
실키 스모크(scripts/collect_pois.py 수동/스케줄 실행)에서 검증**한다. 알려진
변주는 반영: 빈 목록에서 `items`가 객체가 아니라 빈 문자열 ""로 오는 것,
mapx/mapy(경도/위도)가 문자열로 오는 것.

**키링 로테이션**: 계정별 일일 한도가 독립이라 키를 여러 개 등록해 합산 사용할
수 있다. `extra_keys`를 주면 현재 키의 호출 수가 키당 상한(`calls_per_key`)에
도달할 때 다음 키로 전환하고 **수집 시퀀스는 그대로 이어간다** (병렬 아님 —
같은 페이지를 두 번 부르지 않는다). 키 순서는 (service_key, *extra_keys) 등록
순서 고정(결정론). extra_keys가 없으면 기존 단일 키 동작과 완전히 동일하다.

**죽은 키 조기 퇴출**: 호출 수로만 전환하면 **죽은 키가 뒤의 멀쩡한 키를 가린다.**
실측(2026-08-19)으로 2번 키가 403을 뱉는 동안 3번 키는 정상이었는데, 키링이 2번에
머물러 750콜 예산 중 318콜만 쓰고 6개 지역이 통째로 비었다. 키를 못 쓰게 만드는
응답(HTTP 403, 그리고 data.go.kr 봉투의 키 관련 resultCode — 미등록·접근거부·
한도초과·기한만료)을 만나면 그 키를 **즉시 퇴출하고 다음 살아있는 키로 같은 요청을
재시도**한다. 재시도는 키 수만큼만(각 키 1회) — 무한 재시도가 아니라 "이 키로는
안 된다"의 확인이다. 전부 죽으면 HTTP를 더 쓰지 않고 즉시 실패한다.

퇴출은 **키 단위 판정에만** 쓴다. 타임아웃·429는 키가 아니라 그 시점 API 상태라
(실측: 같은 지역에서 살아있는 키도 함께 타임아웃) 퇴출 사유가 아니다 — 잘못 퇴출하면
멀쩡한 키를 잃는다.
"""

from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from typing import Protocol

from trippilot.ports.poi_sourcing_port import (
    SourcedHours,
    SourcedPage,
    SourcedPlaceRecord,
    SourcingError,
)

logger = logging.getLogger(__name__)

_BASE = "https://apis.data.go.kr/B551011/KorService2"
_OK_CODE = "0000"

# 이 키로는 앞으로도 안 된다는 신호 — 만나면 키를 퇴출하고 다음 키로 넘어간다.
# data.go.kr 공통 에러코드: 20 접근거부 · 22 한도초과 · 30 미등록 · 31 기한만료.
# (재시도로 풀리는 일시 장애 — 타임아웃·429·5xx — 는 여기 없다. 그건 키 문제가 아니다.)
_KEY_DEAD_CODES = frozenset({"20", "22", "30", "31"})
_KEY_DEAD_HTTP = 403

# detailIntro2의 영업시간·휴무일 필드명은 contentTypeId마다 다르다 (TourAPI 4.0).
_INTRO_FIELDS: Mapping[str, tuple[str, str]] = {
    "12": ("usetime", "restdate"),              # 관광지
    "14": ("usetimeculture", "restdateculture"),  # 문화시설
    "28": ("usetimeleports", "restdateleports"),  # 레포츠
    "38": ("opentime", "restdateshopping"),       # 쇼핑
    "39": ("opentimefood", "restdatefood"),       # 음식점
}


class HttpGetJson(Protocol):
    """GET + JSON 파싱 1건. 실패는 예외로 (어댑터가 SourcingError로 감싼다)."""

    def get_json(self, url: str, params: Mapping[str, str]) -> object: ...


class UrllibHttpClient:
    """표준 라이브러리 구현 — 스크립트 실행용. 테스트에서는 사용하지 않는다(실 호출 0)."""

    def __init__(self, timeout_sec: float = 10.0) -> None:
        self._timeout = timeout_sec

    def get_json(self, url: str, params: Mapping[str, str]) -> object:
        query = urllib.parse.urlencode(params)
        with urllib.request.urlopen(f"{url}?{query}", timeout=self._timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


class _KeyRejected(Exception):
    """이 키로는 앞으로도 안 된다 — 어댑터 내부에서만 쓰이고 밖으로 새지 않는다.

    `SourcingError`(수집 실패)와 구분하는 이유: 전자는 **키를 바꾸면 풀리는** 실패라
    같은 요청을 다음 키로 다시 걸어야 하고, 후자는 그대로 상위에 올려야 한다.
    """


class TourApiAdapter:
    """PoiSourcingPort 구현. 키는 전부 **디코딩 키**를 받는다 (urlencode 1회는 여기서).

    키링: `extra_keys` 설정 시 실 HTTP 호출 수(시도 기준 — 파이프라인 예산과 동일
    기준)가 키당 `calls_per_key`에 도달하면 다음 키로 전환한다 (INFO 로그).
    마지막 키 소진 이후에도 마지막 키로 계속 호출한다 — 총 상한은 파이프라인
    `max_calls`(= 키 수 × 키당 상한)가 지킨다.
    """

    def __init__(
        self,
        http: HttpGetJson,
        service_key: str,
        *,
        extra_keys: Sequence[str] = (),
        calls_per_key: int | None = None,
        mobile_app: str = "TripPilot",
    ) -> None:
        if extra_keys and (calls_per_key is None or calls_per_key <= 0):
            raise ValueError(
                f"키 2개 이상이면 calls_per_key 양수 필요: {calls_per_key!r}")
        self._http = http
        self._keys: tuple[str, ...] = (service_key, *extra_keys)
        self._per_key = calls_per_key
        self._app = mobile_app
        self._http_calls = 0  # 시도 기준 (실패 호출 포함 — 한도 소모와 동일 기준)
        self._key_idx = 0
        self._dead: set[int] = set()  # 퇴출된 키 (403·키 관련 resultCode)

    def _take_key(self) -> str:
        """이번 HTTP 호출에 쓸 키 1건 소모. 키당 상한 도달 또는 퇴출 시 다음 키로.

        호출 수 기준으로 고른 뒤 **퇴출된 키는 건너뛴다** — 죽은 키가 뒤의 멀쩡한
        키를 가리지 않게. 살아있는 키가 없으면 부르는 쪽이 먼저 막으므로 여기선
        정상 경로만 다룬다.
        """
        if len(self._keys) > 1:
            idx = min(self._http_calls // self._per_key, len(self._keys) - 1)
            idx = self._next_alive(idx)
            if idx != self._key_idx:
                logger.info("키 전환: %d→%d, 누적 %d호출",
                            self._key_idx + 1, idx + 1, self._http_calls)
                self._key_idx = idx
        self._http_calls += 1
        return self._keys[self._key_idx]

    def _next_alive(self, start: int) -> int:
        """start부터 순환하며 첫 살아있는 키. 전부 죽었으면 start 그대로(부르는 쪽이 막는다)."""
        n = len(self._keys)
        for step in range(n):
            idx = (start + step) % n
            if idx not in self._dead:
                return idx
        return start

    def _retire(self, reason: str) -> None:
        """현재 키를 퇴출한다 — 조용히 넘어가지 않고 남은 키 수와 함께 경고로 남긴다."""
        self._dead.add(self._key_idx)
        alive = len(self._keys) - len(self._dead)
        logger.warning("키 %d 퇴출 (%s) — 남은 키 %d개",
                       self._key_idx + 1, reason, alive)

    def _common_params(self) -> dict[str, str]:
        # serviceKey는 _call이 키링에서 주입한다 (HTTP 1건 = 키 소모 1건)
        return {
            "MobileOS": "ETC",
            "MobileApp": self._app,
            "_type": "json",
        }

    def fetch_page(
        self, area_code: str, kind: str, page_no: int, rows: int
    ) -> SourcedPage:
        body = self._call(
            "areaBasedList2",
            {
                **self._common_params(),
                "areaCode": area_code,
                "contentTypeId": kind,
                "numOfRows": str(rows),
                "pageNo": str(page_no),
            },
        )
        records = tuple(
            self._to_record(item, kind)
            for item in self._items(body)
            if isinstance(item, dict)
        )
        total = body.get("totalCount")
        return SourcedPage(
            records=records,
            total_count=total if isinstance(total, int) else len(records),
        )

    def fetch_hours(self, source_ref: str, kind: str) -> SourcedHours:
        fields = _INTRO_FIELDS.get(kind)
        if fields is None:  # 매핑 없는 타입 — 없는 정보를 지어내지 않는다
            return SourcedHours(hours_raw=None, rest_raw=None)
        body = self._call(
            "detailIntro2",
            {
                **self._common_params(),
                "contentId": source_ref,
                "contentTypeId": kind,
            },
        )
        items = self._items(body)
        first = items[0] if items and isinstance(items[0], dict) else {}
        hours_key, rest_key = fields
        return SourcedHours(
            hours_raw=self._opt_str(first.get(hours_key)),
            rest_raw=self._opt_str(first.get(rest_key)),
        )

    # ── 내부 ─────────────────────────────────────────
    def _call(self, endpoint: str, params: Mapping[str, str]) -> dict:
        """HTTP 1건 + 봉투 해체 — 키가 죽으면 다음 살아있는 키로 같은 요청을 재시도.

        재시도 상한은 키 수(각 키 1회)다. 무한 재시도가 아니라 "이 키로는 안 된다"를
        확인하는 것뿐 — 일시 장애(타임아웃·429)는 재시도 없이 그대로 올린다(포트 계약).
        """
        for _ in range(len(self._keys)):
            if len(self._dead) == len(self._keys):
                raise SourcingError(f"{endpoint} 호출 불가: 등록된 키가 전부 퇴출됨")
            try:
                return self._call_once(endpoint, params)
            except _KeyRejected as e:
                self._retire(str(e))
        raise SourcingError(f"{endpoint} 호출 실패: 살아있는 키 없음 (전부 거부)")

    def _call_once(self, endpoint: str, params: Mapping[str, str]) -> dict:
        """HTTP 1건 + 봉투 해체. 비정상 봉투는 기본값 흡수가 아니라 실패로 승격(INV-4)."""
        request_params = {"serviceKey": self._take_key(), **params}
        try:
            payload = self._http.get_json(f"{_BASE}/{endpoint}", request_params)
        except Exception as e:  # urllib·JSON 파싱 등 — 원인 보존해 상위 로그로
            if getattr(e, "code", None) == _KEY_DEAD_HTTP:
                raise _KeyRejected(f"HTTP {_KEY_DEAD_HTTP}") from e
            raise SourcingError(f"{endpoint} 호출 실패: {type(e).__name__}: {e}") from e
        if not isinstance(payload, dict):
            raise SourcingError(f"{endpoint} 응답이 JSON 객체가 아님")
        header = self._dig(payload, "response", "header")
        code = header.get("resultCode") if isinstance(header, dict) else None
        if code != _OK_CODE:
            msg = header.get("resultMsg") if isinstance(header, dict) else "봉투 형식 오류"
            if code in _KEY_DEAD_CODES:
                raise _KeyRejected(f"resultCode={code} {msg}")
            raise SourcingError(f"{endpoint} resultCode={code!r}: {msg}")
        body = self._dig(payload, "response", "body")
        if not isinstance(body, dict):
            raise SourcingError(f"{endpoint} body 없음")
        return body

    @staticmethod
    def _dig(d: object, *keys: str) -> object:
        for key in keys:
            if not isinstance(d, dict):
                return None
            d = d.get(key)
        return d

    @staticmethod
    def _items(body: dict) -> list:
        """`items`는 빈 목록일 때 "" 로 오는 알려진 변주 — 방어적으로 읽는다."""
        items = body.get("items")
        if not isinstance(items, dict):
            return []
        item = items.get("item")
        if isinstance(item, list):
            return item
        return [item] if isinstance(item, dict) else []

    @classmethod
    def _to_record(cls, item: dict, kind: str) -> SourcedPlaceRecord:
        return SourcedPlaceRecord(
            source_ref=cls._opt_str(item.get("contentid")) or "",
            kind=cls._opt_str(item.get("contenttypeid")) or kind,
            name=cls._opt_str(item.get("title")) or "",
            address=cls._opt_str(item.get("addr1")),
            lat=cls._opt_float(item.get("mapy")),   # mapy = 위도
            lng=cls._opt_float(item.get("mapx")),   # mapx = 경도
            category_codes=tuple(
                c for c in (
                    cls._opt_str(item.get("cat1")),
                    cls._opt_str(item.get("cat2")),
                    cls._opt_str(item.get("cat3")),
                ) if c
            ),
            image_url=cls._opt_str(item.get("firstimage")),
            modified_at=cls._opt_str(item.get("modifiedtime")),
        )

    @staticmethod
    def _opt_str(v: object) -> str | None:
        """빈 문자열=미설정 취급 (TourAPI는 결측을 "" 로 준다)."""
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
        return None

    @staticmethod
    def _opt_float(v: object) -> float | None:
        if isinstance(v, bool):
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v)
            except ValueError:
                return None
        return None
