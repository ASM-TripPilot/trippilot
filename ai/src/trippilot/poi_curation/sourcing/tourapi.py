"""TourApiAdapter — TourAPI 4.0(KorService2) PoiSourcingPort 구현 (TRIP-246).

HTTP 클라이언트는 생성자 주입 — 테스트는 fake, 실행은 UrllibHttpClient(표준
라이브러리, 새 의존 없음). 포트 계약대로 **메서드 1회 = HTTP 호출 정확히 1건**,
재시도 없음 (일일 한도 아끼기).

응답 형태는 TourAPI 4.0 문서 기준으로 고정했다 — **실 응답과의 드리프트는
실키 스모크(scripts/collect/collect_pois.py 수동/스케줄 실행)에서 검증**한다. 알려진
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
응답(HTTP 403·429, 그리고 data.go.kr 봉투의 키 관련 resultCode — 미등록·접근거부·
한도초과·기한만료)을 만나면 그 키를 **즉시 퇴출하고 다음 살아있는 키로 같은 요청을
재시도**한다. 재시도는 키 수만큼만(각 키 1회) — 무한 재시도가 아니라 "이 키로는
안 된다"의 확인이다. 전부 죽으면 HTTP를 더 쓰지 않고 즉시 실패한다.

퇴출은 **키 단위 판정에만** 쓴다. 타임아웃·5xx는 키가 아니라 그 시점 API 상태라
(실측: 같은 지역에서 살아있는 키도 함께 타임아웃) 퇴출 사유가 아니다 — 잘못 퇴출하면
멀쩡한 키를 잃는다. 429는 그 키·그 오퍼레이션의 하루 한도 소진이라 퇴출한다(#1418).
"""

from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from typing import Protocol

from trippilot.ports.poi_sourcing_port import (
    SourcedDetail,
    SourcedPage,
    SourcedPlaceRecord,
    SourcingError,
)

logger = logging.getLogger(__name__)

_BASE = "https://apis.data.go.kr/B551011/KorService2"
_OK_CODE = "0000"

# 이 키로는 앞으로도 안 된다는 신호 — 만나면 키를 퇴출하고 다음 키로 넘어간다.
# data.go.kr 공통 에러코드: 20 접근거부 · 22 한도초과 · 30 미등록 · 31 기한만료.
# (재시도로 풀리는 일시 장애 — 타임아웃·5xx — 는 여기 없다. 그건 키 문제가 아니다.)
_KEY_DEAD_CODES = frozenset({"20", "22", "30", "31"})
# HTTP 403 = 키 자체 문제(KEY2 가 매 실행 403 — 2026-10-19), HTTP 429 = **그 키의 그 오퍼레이션 하루 한도
# 소진**(한도는 오퍼레이션별 — 같은 키로 목록·detailCommon2 는 통과, 10-19 실측). 429 를 일시 장애로 두면
# 한도 끝난 키로 계속 부른다 — 10-19 정기 수집은 KEY2 몫이 KEY3 로 몰려 detailIntro2 960건이 429 였다.
# 퇴출은 이 실행 안에서만이다(다음 날 다시 쓴다).
_KEY_DEAD_HTTP = frozenset({403, 429})

# 목록 조회 키 — 옛 areaCode → 법정동 시도 코드(lDongRegnCd). KorService2 가 지역을 법정동 코드로
# 옮기면서 **수정된 항목의 areacode 칸이 비어** areaCode 로 거르면 일부만 온다. 실측(2026-10-18,
# 관광지 totalCount areaCode vs lDongRegnCd): 서울 315 vs 765 · 부산 122 vs 351 · 제주 247 vs 557,
# 음식점도 55~58%. 경복궁·해운대해수욕장·광안리해수욕장·감천문화마을·천지연폭포가 공유본에 없던 이유다
# (전부 areacode '' · lDongRegnCd 만 채워짐). 강원·전북은 특별자치도 코드(51·52)만 살아 있고(42·45 는 0),
# 세종은 다섯 자리 36110, 광주·전남은 통합(전남광주통합특별시 12)이다 — 5(광주)와 38(전남)이 같은 12 를
# 가리키므로 기본 순회에서 5 를 뺀다(`pipeline.DEFAULT_AREA_CODES`). 어댑터는 그대로 부른다 — 메서드
# 1회 = HTTP 1건이 호출 예산 계약이라 여기서 조용히 건너뛰지 않는다.
LDONG_BY_AREA: Mapping[str, str] = {
    "1": "11", "2": "28", "3": "30", "4": "27", "5": "12", "6": "26", "7": "31", "8": "36110",
    "31": "41", "32": "51", "33": "43", "34": "44", "35": "47", "36": "48", "37": "52",
    "38": "12", "39": "50",
}

# detailIntro2의 영업시간·휴무일 필드명은 contentTypeId마다 다르다 (TourAPI 4.0).
_INTRO_FIELDS: Mapping[str, tuple[str, str]] = {
    "12": ("usetime", "restdate"),              # 관광지
    "14": ("usetimeculture", "restdateculture"),  # 문화시설
    "28": ("usetimeleports", "restdateleports"),  # 레포츠
    "38": ("opentime", "restdateshopping"),       # 쇼핑
    "39": ("opentimefood", "restdatefood"),       # 음식점
}

# 같은 detailIntro2 응답에서 영업시간 외에 **원문 그대로** 실어 보내는 필드 (TRIP-683 2단계).
# 표시용 문자열이라 파싱하지 않고 provenance.detail 로만 나간다 — HTTP 추가 0건.
# 채택 목록이다(배제 목록이 아니다): 제주 실측(#542)에서 실제로 채워져 오던 것만.
# `spendtime`·`spendtimeresting`(소요시간)은 채워져 와도 싣지 않는다 — INV-3.
# `usefee`·`parkingfee` 는 가격 캐싱(D13/G195)이 아니라 POI 속성이다(팀 결정) —
# `avg_cost` 로 흐르지 않고 provenance 에만 남는다. `heritage1~3` 은 "0"/"1" 플래그로,
# 문자열이 아니어도 원문 그대로다(해석은 소비처 몫).
# 28(레포츠)은 실측에서 응답 자체가 비어 있어 목록이 없다 — 원천 결손, 지어내지 않는다.
_DETAIL_FIELDS: Mapping[str, tuple[str, ...]] = {
    "12": ("parking", "heritage1", "heritage2", "heritage3", "chkbabycarriage"),
    "14": ("usefee", "parkingfee"),
    "38": ("saleitem", "fairday"),
    "39": ("firstmenu", "treatmenu", "reservationfood", "parkingfood",
           "kidsfacility", "packing"),
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
        # contentTypeId → detailIntro2 첫 응답 원문 (fetch_detail 이 채운다).
        # 관측용이라 수집 판정에는 쓰이지 않는다.
        self.intro_samples: dict[str, dict] = {}
        # contentTypeId → 본 응답 수, 그리고 필드별 "값이 있던" 횟수.
        # 표본 1건은 **필드명만** 알려준다 — 그 필드가 실제로 채워져 오는지는
        # 별개 질문이고, 쓸모를 가르는 건 후자다. 세는 데 드는 비용은 0이다.
        self.intro_seen: dict[str, int] = {}
        self.intro_filled: dict[str, dict[str, int]] = {}

    @property
    def alive(self) -> bool:
        """살아있는 키가 남았는가 — 전부 퇴출되면 이후 호출은 HTTP 없이 실패한다(`_call`)."""
        return len(self._dead) < len(self._keys)

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
        # 조회는 법정동 코드로 — 사유는 `LDONG_BY_AREA`. 표에 없는 코드는 옛 areaCode 로(하위호환).
        ldong = LDONG_BY_AREA.get(area_code, "")
        region = {"lDongRegnCd": ldong} if ldong else {"areaCode": area_code}
        body = self._call(
            "areaBasedList2",
            {
                **self._common_params(),
                **region,
                "contentTypeId": kind,
                "numOfRows": str(rows),
                "pageNo": str(page_no),
            },
        )
        records = tuple(
            self._to_record(item, kind)
            for item in self._strict_items(body, "areaBasedList2")
            if isinstance(item, dict)
        )
        total = body.get("totalCount")
        if isinstance(total, str) and total.isdigit():
            total = int(total)
        if not isinstance(total, int):
            # 건수를 모르면 레코드 수로 대신 세지 않는다 — 0건이면 그 종류가 완주로 적힌다(2026-10-30 Codex 리뷰)
            raise SourcingError(f"areaBasedList2 totalCount 형식 밖: {total!r}")
        return SourcedPage(records=records, total_count=total)

    def search_festivals(
        self, open_from: str, page_no: int, rows: int
    ) -> tuple[list[dict], int]:
        """`searchFestival2` — `open_from`(YYYYMMDD) 이후에도 열려 있는 공식 축제·행사 원문과 총 건수(전국).

        **지역 필터를 걸지 않는다** — KorService2 가 지역을 법정동 코드(`lDongRegnCd`)로 옮기면서
        `areaCode` 로 거르면 0건이 온다(실측 2026-10-18: 17개 지역 전부 0). 지역은 응답 항목의
        `lDongRegnCd` 로 읽는다(`collect_tourapi_festivals.py`).

        장소가 아니라 행사라서 `SourcedPlaceRecord` 로 바꾸지 않는다 — 원문 그대로 넘긴다.
        """
        body = self._call("searchFestival2", {
            **self._common_params(),
            "eventStartDate": open_from,
            "numOfRows": str(rows),
            "pageNo": str(page_no),
        })
        items = [i for i in self._items(body) if isinstance(i, dict)]
        total = body.get("totalCount")
        return items, total if isinstance(total, int) else len(items)

    def fetch_detail(self, source_ref: str, kind: str) -> SourcedDetail:
        fields = _INTRO_FIELDS.get(kind)
        if fields is None:  # 매핑 없는 타입 — 없는 정보를 지어내지 않는다
            return SourcedDetail(hours_raw=None, rest_raw=None)
        body = self._call(
            "detailIntro2",
            {
                **self._common_params(),
                "contentId": source_ref,
                "contentTypeId": kind,
            },
        )
        items = self._strict_items(body, "detailIntro2")
        first = items[0] if items and isinstance(items[0], dict) else {}
        # 타입별 첫 응답을 그대로 남긴다 — HTTP 추가 0건(이미 받은 것을 적을 뿐).
        # 리포에 **실 응답 기록이 없어서** 이 엔드포인트가 실제로 무엇을 주는지
        # 아무도 모른다(fake 는 우리가 읽는 필드만 흉내낸다). 스펙이 아니라
        # 실물로 판단하려면 표본이 필요하고, 표본이 남아 있어야 벤더 드리프트도
        # 잡힌다. 타입당 1건이라 로그 부담도 없다.
        if kind not in self.intro_samples:
            self.intro_samples[kind] = first
        self.intro_seen[kind] = self.intro_seen.get(kind, 0) + 1
        counts = self.intro_filled.setdefault(kind, {})
        for k, v in first.items():
            if str(v or "").strip():
                counts[k] = counts.get(k, 0) + 1
        hours_key, rest_key = fields
        detail_raw = {
            k: v for k in _DETAIL_FIELDS.get(kind, ())
            if (v := self._opt_str(first.get(k))) is not None
        }
        return SourcedDetail(
            hours_raw=self._opt_str(first.get(hours_key)),
            rest_raw=self._opt_str(first.get(rest_key)),
            detail_raw=detail_raw,
        )

    def fetch_overview(self, content_id: str) -> str | None:
        """`detailCommon2` 의 개요(`overview`) 원문 — KB-5 장소 지식 2단계 코퍼스(`collect_place_overviews.py`).

        HTTP 1건. 없으면 None. 원문 그대로 준다(`<br>`·엔티티 정리는 수집 스크립트 몫 — 어댑터는 해석하지 않는다).
        """
        body = self._call("detailCommon2", {**self._common_params(), "contentId": content_id})
        items = self._items(body)
        first = items[0] if items and isinstance(items[0], dict) else {}
        return self._opt_str(first.get("overview"))

    # ── 내부 ─────────────────────────────────────────
    def _call(self, endpoint: str, params: Mapping[str, str]) -> dict:
        """HTTP 1건 + 봉투 해체 — 키가 죽으면 다음 살아있는 키로 같은 요청을 재시도.

        재시도 상한은 키 수(각 키 1회)다. 무한 재시도가 아니라 "이 키로는 안 된다"를
        확인하는 것뿐 — 일시 장애(타임아웃·5xx)는 재시도 없이 그대로 올린다(포트 계약).
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
            if (code := getattr(e, "code", None)) in _KEY_DEAD_HTTP:
                raise _KeyRejected(f"HTTP {code}") from e
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
    def _strict_items(cls, body: dict, endpoint: str) -> list:
        """`_items` + 형식 밖 `items`(빈 목록 변주 "" 도 객체도 아님)는 실패 — 빈 성공으로 읽으면 목록은 그 종류를 완주로,
        상세는 영업시간 빈칸을 기제안 색인에 굳힌다(`pipeline` 색인 주석). 실패면 커서·색인이 남아 다음 실행이 다시 묻는다."""
        items = body.get("items")
        if items != "" and not isinstance(items, dict):
            raise SourcingError(f"{endpoint} items 형식 밖: {type(items).__name__}")
        return cls._items(body)

    @classmethod
    def _to_record(cls, item: dict, kind: str) -> SourcedPlaceRecord:
        return SourcedPlaceRecord(
            source_ref=cls._opt_str(item.get("contentid")) or "",
            kind=cls._opt_str(item.get("contenttypeid")) or kind,
            name=cls._opt_str(item.get("title")) or "",
            address=cls._opt_str(item.get("addr1")),
            lat=cls._opt_coord(item.get("mapy")),   # mapy = 위도
            lng=cls._opt_coord(item.get("mapx")),   # mapx = 경도
            # 옛 cat1~3 + 새 lclsSystm1~3 — 수정된 항목은 cat 이 비고 lcls 만 온다(`mapping._LCLS1`)
            category_codes=tuple(
                c for c in (
                    cls._opt_str(item.get(k))
                    for k in ("cat1", "cat2", "cat3", "lclsSystm1", "lclsSystm2", "lclsSystm3")
                ) if c
            ),
            image_url=cls._https(cls._opt_str(item.get("firstimage"))),
            modified_at=cls._opt_str(item.get("modifiedtime")),
        )

    @staticmethod
    def _https(url: str | None) -> str | None:
        """TourAPI 이미지는 전 건이 `http://` 다. 평문 HTTP 이미지는 iOS App Transport Security 가
        **에러 없이** 차단해 앱에 회색 자리만 남는다 — 스킴만 올린다(같은 URL 이 https 로도 200).
        """
        return "https://" + url[len("http://"):] if url and url.startswith("http://") else url

    @staticmethod
    def _opt_str(v: object) -> str | None:
        """빈 문자열=미설정 취급 (TourAPI는 결측을 "" 로 준다)."""
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
        return None

    @classmethod
    def _opt_coord(cls, v: object) -> float | None:
        """좌표 전용 — TourAPI 는 좌표 결측을 `"0"` 으로 준다. 그대로 두면 (0,0)이
        GeoPoint 를 통과한 뒤 한국 bbox 밖으로 떨어져 게이트 2단이
        `existence_out_of_service_region` 으로 계상한다 — 결측이 "권역 밖"으로
        둔갑해 통계가 원인을 숨긴다(09-10 실측: 신규 31건 전부 이 사유였다).
        결측은 결측으로 읽어 1단(`schema_missing_or_invalid_coord`)이 잡게 한다.
        적도·본초자오선에 있는 한국 POI 는 없으므로 0 을 결측으로 봐도 잃는 게 없다.
        """
        f = cls._opt_float(v)
        return None if f is None or f == 0.0 else f

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
