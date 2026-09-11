"""KakaoExistenceAdapter — 카카오 로컬 키워드검색으로 실재 확인 (TRIP-683).

`PlaceExistencePort` 구현. 상호명만으로 검색하면 전국의 동명 가게가 걸리므로
**좌표를 함께 준다** — 카카오 키워드검색의 `x`·`y`·`radius` 파라미터로 그
지점 주변만 본다. 즉 "이 이름의 장소가 여기 있는가"를 묻는 것이지 "이 이름이
어딘가 있는가"가 아니다.

**결과를 저장하지 않는다.** 상호·주소·카테고리를 받아도 버리고 있다/없다만
남긴다 — 카카오 약관은 저장을 금지하고 실시간 조회·표시만 허용한다.
([[kakao-coord-storage-kept]] 의 좌표 건과 달리 여기는 애초에 적재가 없다.)

**호출 예산과 마감**을 둘 다 지킨다. 생성 경로에 끼는 검증이라 마감을 넘기면
남은 것은 UNVERIFIED 로 채우고 즉시 반환한다 — 일정을 늦게 주느니 "확인 못
했다"고 말하는 편이 낫다 (INV-4: 조용히 넘어가지 않는다).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Protocol

from trippilot.ports.place_existence_port import (
    ExistenceQuery,
    ExistenceStatus,
    ExistenceVerdict,
)

_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json"


class HttpGetJson(Protocol):
    """GET + JSON 파싱 1건 (헤더 있음 — 카카오는 Authorization 이 필요하다).

    `background.naver_search` 에 같은 모양이 있지만 그쪽을 import 하지 않는다 —
    `poi_curation` 이 상위 계층을 참조하면 L-1 을 깬다. 모듈마다 필요한 HTTP
    모양을 로컬 Protocol 로 두는 것이 이 리포의 관용이다
    (`sourcing/tourapi.py` 도 2인자판을 자체 정의한다). 구조적 타이핑이라
    같은 구현체를 양쪽에 꽂을 수 있다.
    """

    def get_json(
        self, url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> object: ...

# 좌표 주변 몇 m 까지 같은 장소로 볼 것인가. 출처 간 좌표 차이 실측
# (TourAPI × LOCALDATA 동일 가게 6,886쌍): 중앙값 7.8m · p95 52.0m · p99 163.2m.
# 300m 는 p99 를 넉넉히 덮는다 — 좁히면 좌표가 조금 어긋난 멀쩡한 가게를
# "없음"으로 찍는다. 배제 정책과 함께 쓰이므로 오탐 쪽으로 보수적이어야 한다.
_RADIUS_M = 300


class KakaoExistenceAdapter:
    """조회 1건 = HTTP 1건 = 예산 1 소모. 재시도 없음 (마감이 빠듯하다).

    **`max_calls` 는 `verify()` 1회당 상한**이다(인스턴스 수명 전체가 아니다).
    이 어댑터는 앱 수명 동안 살아 있는 `CandidatePoolBuilder` 에 꽂히므로,
    누적 예산이면 상한 소진 후 **영구히 전부 UNVERIFIED** 가 되어 강등이
    조용히 죽는다. 배치용 `KakaoLocalClient` 가 "실행당 상한"인 것과 같은
    뜻이고, 여기서는 한 생성 요청이 곧 한 실행이다.
    """

    def __init__(
        self,
        http: HttpGetJson,
        rest_api_key: str,
        *,
        max_calls: int,
        monotonic_ms: Callable[[], int],
        radius_m: int = _RADIUS_M,
    ) -> None:
        self._http = http
        self._headers = {"Authorization": f"KakaoAK {rest_api_key}"}
        self._max_calls = max_calls
        # **단조 시계여야 한다.** `time.time()*1000` 을 꽂으면 NTP 역행 한 번에
        # 차분이 음수가 되어 마감이 통째로 무력화된다(전 후보 검증 강행).
        # 코드베이스 관례는 ClockPort.monotonic_ms (assembly_engine/facade.py).
        self._monotonic_ms = monotonic_ms
        self._radius_m = radius_m
        self.calls_used = 0

    def verify(
        self, queries: tuple[ExistenceQuery, ...], *, deadline_ms: int
    ) -> tuple[ExistenceVerdict, ...]:
        started = self._monotonic_ms()
        self.calls_used = 0          # 요청 1건 = 예산 1벌 (위 주석)
        out: list[ExistenceVerdict] = []
        for i, q in enumerate(queries):
            if self._monotonic_ms() - started >= deadline_ms:
                # 남은 전부를 같은 사유로 채운다 — 빠뜨리지 않는다(개수 보존).
                out.extend(
                    ExistenceVerdict(r.poi_id, ExistenceStatus.UNVERIFIED,
                                     reason="deadline_exceeded")
                    for r in queries[i:]
                )
                break
            out.append(self._verify_one(q))
        return tuple(out)

    def _verify_one(self, q: ExistenceQuery) -> ExistenceVerdict:
        if self.calls_used >= self._max_calls:
            return ExistenceVerdict(q.poi_id, ExistenceStatus.UNVERIFIED,
                                    reason="call_budget_exhausted")
        self.calls_used += 1
        try:
            payload = self._http.get_json(_ENDPOINT, self._headers, {
                "query": q.name,
                "x": f"{q.coord.lng}",
                "y": f"{q.coord.lat}",
                "radius": str(self._radius_m),
                "size": "1",
            })
        except Exception as e:   # noqa: BLE001 — 경계 밖으로 던지지 않는다(DL-5)
            return ExistenceVerdict(q.poi_id, ExistenceStatus.UNVERIFIED,
                                    reason=f"http_error:{type(e).__name__}")
        found = _has_document(payload)
        if found is None:
            return ExistenceVerdict(q.poi_id, ExistenceStatus.UNVERIFIED,
                                    reason="malformed_response")
        return ExistenceVerdict(
            q.poi_id,
            ExistenceStatus.FOUND if found else ExistenceStatus.NOT_FOUND,
        )


def _has_document(payload: object) -> bool | None:
    """documents 가 비었는가. 응답 형식이 예상 밖이면 None(= 모른다).

    형식 밖을 False("없음")로 수렴시키지 않는다 — 벤더 응답 변경이 전 POI 를
    폐업으로 만드는 사고가 된다.
    """
    if not isinstance(payload, dict):
        return None
    docs = payload.get("documents")
    if not isinstance(docs, list):
        return None
    return bool(docs)
