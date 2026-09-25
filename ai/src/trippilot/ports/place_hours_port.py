"""PlaceHoursPort — 영업시간을 **런타임에만** 빌려오는 콘센트.

## 왜 필요한가

수집본의 영업시간 보유는 47.3% 다(2026-09-26, 파서 개선 후). 나머지 52.7% 는
TourAPI 가 **원문 자체를 안 준** 것이라 파싱으로는 못 메운다. HC1(영업시간 하드
제약)은 정보가 없으면 통과시키므로("정보 없음 ≠ 배제") 일정이 깨지지는 않지만,
**닫힌 시간에 배치될 수 있다.**

카카오·네이버 지역검색에는 영업시간 필드가 **없다**(2026-09-26 실호출 확인 —
카카오 응답은 상호·주소·좌표·전화·카테고리뿐이다). Google Places 만 준다.

## 저장하지 않는다 — 이번엔 약관이 그렇게 요구한다

Google Places 정책: *"You must not pre-fetch, cache, or store Places API content
beyond the allowed exceptions."* 예외는 **`place_id` 하나**이고 그것만 영구 저장할
수 있다. 즉 영업시간은 **받아서 판정에 쓰고 버린다** — `Poi.open_hours` 에 적재하면
약관 위반이다.

`PlaceExistencePort` 의 "저장 금지"는 우리가 택한 보수적 해석이었지만, 여기서는
**공급자가 명시적으로 금지**한다. 그래서 이 포트의 결과 타입에도 상호·주소 같은
벤더 데이터를 담을 자리를 두지 않는다 — 담을 수 있는 필드가 없으면 실수로 적재할
수도 없다.

## 돈이 나간다 — 호출 범위를 좁히는 것이 설계의 일부다

`regularOpeningHours` 는 Place Details **Enterprise** 티어다($20/1,000 · 월 1,000
무료). 그래서 두 가지를 규약으로 못 박는다:

  · **영업시간이 없는 후보에만** 묻는다 (사용자 지시, 2026-09-26)
  · 호출 상한을 넘기면 남은 것은 조용히 포기한다 — 비용 초과보다 낫다

`place_id` 는 Text Search Essentials(**무료**)로 미리 해결해 두고 저장한다. 이
포트는 그 id 를 받아 상세만 부른다 — 검색을 매번 다시 하면 비용이 두 배가 된다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from trippilot.domain.common import PoiId
from trippilot.domain.poi import OpenHour


@dataclass(frozen=True, slots=True)
class HoursQuery:
    """조회 1건. `place_id` 는 미리 해결해 둔 것 — 여기서 검색하지 않는다."""

    poi_id: PoiId
    place_id: str


@dataclass(frozen=True, slots=True)
class HoursVerdict:
    """판정 1건. **영업시간 외에는 아무것도 담지 않는다** (약관 — 저장 금지).

    `hours` 가 비었다는 것은 "그 장소가 늘 닫혀 있다"가 아니라 **"못 받았다"**
    이다. 호출측은 이것을 종전 상태(정보 없음)와 같게 다뤄야 한다 — 빈 값을
    휴무로 읽으면 장애가 폐점으로 둔갑한다.
    """

    poi_id: PoiId
    hours: tuple[OpenHour, ...] = ()
    reason: str | None = None   # 못 받았을 때만 — 예산 소진·시한 초과·응답 이상

    def __post_init__(self) -> None:
        # 상태-사유 정합 (ExistenceVerdict 와 같은 규약): 실패를 결과처럼
        # 보이게 하는 것을 타입이 막는다 (INV-4).
        if self.hours and self.reason is not None:
            raise ValueError("영업시간을 받았으면 reason 을 붙이지 않는다")
        if not self.hours and not self.reason:
            raise ValueError("영업시간이 없으면 왜 없는지 reason 이 필요하다")


class PlaceHoursPort(Protocol):
    def fetch(
        self, queries: tuple[HoursQuery, ...], *, deadline_ms: int
    ) -> tuple[HoursVerdict, ...]:
        """입력 순서대로, 입력 개수만큼 판정을 돌려준다.

        `deadline_ms` 를 넘기거나 호출 예산이 소진되면 남은 것은 `reason` 만 채워
        돌려준다 — 생성 경로의 마감을 지키는 것이 보강보다 우선이다. 예외를 경계
        밖으로 던지지 않는다 (DL-5).
        """
        ...
