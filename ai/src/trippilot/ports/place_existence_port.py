"""PlaceExistencePort — 후보 POI 가 지도에 실재하는지 묻는 콘센트 (TRIP-683).

수집 게이트 2단의 실재 검사는 **좌표가 한국 bbox 안인가**까지다. 폐업했거나
사라진 장소는 좌표가 멀쩡하므로 그 검사를 통과한다. 폐업 근거(LOCALDATA
인허가)는 월 1회 수동 갱신이라 그 사이에 닫은 곳은 못 잡고, FOOD·CAFE 만
덮는다. 지도 검색은 그 공백을 런타임에 메운다.

**저장하지 않는다.** 이 포트의 결과는 판정에만 쓰고 어디에도 적재하지 않는다 —
네이버·카카오 약관이 금지하는 것은 저장이고, 실시간 조회 후 화면 표시는
허용된다(카카오 공식 답변 2026-09, devtalk/t/local-api/151263). `Verdict` 에
상호·주소·좌표 같은 벤더 데이터를 담지 않는 것은 그래서다 — 담을 수 있는
필드가 없으면 실수로 적재할 수도 없다.

**"못 찾음"은 "없음"이 아니다.** 상호 변경·색인 누락·표기 차이가 전부 미검출로
나온다. 실측 참고치: 폐업은 음식점·카페 7,837건 중 210건(2.7%)인데, 주소는
맞고 이름이 안 붙은 건이 965건(12.3%)이었다 — 찾으려는 신호보다 노이즈가 크다.
그래서 상태를 셋으로 나눈다: 찾음 / 못 찾음 / 확인 실패. 호출측이 "못 찾음"을
배제로 쓸지는 정책이고, 이 포트는 판정만 돌려준다.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from trippilot.domain.common import GeoPoint, PoiId


class ExistenceStatus(Enum):
    """FOUND 만 양성 신호다. 나머지 둘을 뭉치면 장애가 폐업으로 둔갑한다."""

    FOUND = "FOUND"
    NOT_FOUND = "NOT_FOUND"
    UNVERIFIED = "UNVERIFIED"   # 호출 실패·시한 초과·예산 소진 — 모른다


@dataclass(frozen=True, slots=True)
class ExistenceVerdict:
    """판정 1건. 벤더 데이터는 담지 않는다 (위 모듈 주석 — 저장 금지)."""

    poi_id: PoiId
    status: ExistenceStatus
    reason: str | None = None   # UNVERIFIED 일 때만 — 왜 못 확인했는지

    def __post_init__(self) -> None:
        # 상태-사유 정합 (closure_check.ClosureCheckResult 와 같은 규약):
        # 실패를 결과처럼 보이게 하는 것을 타입이 막는다 (INV-4).
        if self.status is ExistenceStatus.UNVERIFIED:
            if not self.reason:
                raise ValueError("UNVERIFIED 에는 reason 이 필요하다")
        elif self.reason is not None:
            # `is not None` 이다 — truthiness 로 재면 reason="" 가 통과해
            # Verdict(p, FOUND, "") 와 Verdict(p, FOUND) 라는 두 정본이 생긴다
            # (역직렬화가 결손 필드를 "" 로 매핑하면 바로 걸린다).
            # closure_check.ClosureCheckResult 와 같은 엄격도.
            raise ValueError(f"{self.status.value} 에는 reason 을 붙이지 않는다")


@dataclass(frozen=True, slots=True)
class ExistenceQuery:
    """조회 1건. 이름만으로는 동명이 걸리므로 좌표를 함께 준다."""

    poi_id: PoiId
    name: str
    coord: GeoPoint


class PlaceExistencePort(Protocol):
    def verify(
        self, queries: tuple[ExistenceQuery, ...], *, deadline_ms: int
    ) -> tuple[ExistenceVerdict, ...]:
        """입력 순서대로, 입력 개수만큼 판정을 돌려준다.

        `deadline_ms` 를 넘기면 남은 것은 UNVERIFIED 로 채운다 — 생성 경로의
        마감을 지키는 것이 검증보다 우선이고, 빠뜨리는 것보다 "모른다"고
        말하는 편이 낫다. 예외를 경계 밖으로 던지지 않는다.
        """
        ...
