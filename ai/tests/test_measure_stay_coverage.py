"""숙소 커버리지 측정의 **호출 예산**을 못 박는다 (숙소콘텐츠-수집-설계.md 칸 0).

이 리포는 TourAPI 호출 예산을 1급 규칙으로 둔다(`sourcing/pipeline.py` 머리말 — 수집
파이프라인은 `_CallBudget` 로 강제한다). 측정 스크립트는 그 파이프라인을 **안 거치고**
어댑터를 직접 부르므로, 막는 책임이 스크립트에 있다.

안 막으면 둘이 같이 깨진다. 키가 전부 소진되면 어댑터의 `_next_alive` 가
*"전부 죽었으면 start 그대로(**부르는 쪽이 막는다**)"* 로 돌려주는데, 안 막으면 죽은 키로
계속 때린다. 그리고 같은 하루를 쓰는 POI 수집 몫까지 태운다.

**지역 경계가 함정이다.** 페이지 루프만 막으면 다음 지역의 첫 페이지가 검사 없이 나가서
지역 수만큼 초과한다 — 실측으로 예산 3·6·9 에서 매번 1건씩 넘겼다. 그래서 가드가 둘이다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from measure_stay_coverage import measure  # noqa: E402
from trippilot.ports.poi_sourcing_port import SourcedPage, SourcedPlaceRecord  # noqa: E402

AREAS = [str(i) for i in range(1, 18)]  # 광역 17개 — 전국이 기본이다
PAGES_PER_AREA = 3  # total_count 250 · ROWS 100 → 3페이지
# 정본 대역. 예산만 재므로 한 건이면 충분하다 — 1.6MB 시드를 읽지 않는 것이 요점이다.
OURS = [("제주 오션 리조트", 33.246, 126.562)]


class CountingAdapter:
    """호출 수만 센다. 지역마다 250건(=3페이지) 있다고 답한다."""

    def __init__(self) -> None:
        self.calls = 0

    def fetch_page(self, area: str, kind: str, page_no: int, rows: int) -> SourcedPage:
        self.calls += 1
        n = rows if rows > 1 else 1
        records = tuple(
            SourcedPlaceRecord(
                source_ref=f"{area}-{page_no}-{i}", kind=kind, name=f"숙소{i}",
                address=None, lat=33.4, lng=126.5, category_codes=(),
                image_url="http://img" if i % 2 == 0 else None, modified_at=None,
            )
            for i in range(n)
        )
        return SourcedPage(records=records, total_count=250)


@pytest.mark.parametrize(
    "budget",
    # 지역 경계에 **딱 걸리는** 값들(3·6·9)을 반드시 포함한다 — 페이지 가드만 있을 때
    # 이 값들에서 정확히 1건씩 넘쳤다. 넉넉한 값과 1건짜리 극단도 함께 본다.
    [1, 2, 3, 5, 6, 9, 10, 51, 3000],
)
def test_호출이_예산을_넘지_않는다(budget: int) -> None:
    adapter = CountingAdapter()

    measure(adapter, AREAS, count_only=False, max_calls=budget, ours=OURS)

    assert adapter.calls <= budget


def test_예산이_모자라면_잘린_사실을_값으로_낸다() -> None:
    """조용히 자르면 부분 스캔의 비율이 전체인 양 읽혀 판정선(30%/10%)이 거짓 근거로 돈다.

    숙소 검색이 `truncated` 로 막는 것과 같은 함정이다.
    """
    adapter = CountingAdapter()

    result = measure(adapter, AREAS, count_only=False, max_calls=10, ours=OURS)

    assert result["budget_exhausted"] is True
    assert result["areas_scanned"] < len(AREAS)
    assert result["max_calls"] == 10


def test_예산이_넉넉하면_전국을_다_훑고_잘리지_않는다() -> None:
    adapter = CountingAdapter()

    result = measure(adapter, AREAS, count_only=False, max_calls=3000, ours=OURS)

    assert result["budget_exhausted"] is False
    assert result["areas_scanned"] == len(AREAS)
    assert adapter.calls == len(AREAS) * PAGES_PER_AREA


def test_총건수만_재면_지역당_1회다() -> None:
    """`count_only` 는 규모부터 보려는 싼 경로다 — 17회여야 의미가 있다."""
    adapter = CountingAdapter()

    result = measure(adapter, AREAS, count_only=True, max_calls=3000, ours=OURS)

    assert adapter.calls == len(AREAS)
    assert result["budget_exhausted"] is False


def test_시드_파서가_정본을_읽는다() -> None:
    """`R__seed_stay.sql` 은 **생성물**이라 형식이 바뀔 수 있다.

    파서가 0건을 읽으면 매칭률이 전부 0 이 되고 "TourAPI 가 우리 숙소를 못 덮는다"는
    **거짓 결론**이 나온다 — 스크립트는 예외 없이 끝나므로 아무도 못 본다.
    그래서 건수를 단정하지 않고(시드는 갱신된다) **규모와 모양**만 본다.
    """
    from measure_stay_coverage import load_ours

    ours = load_ours()

    assert len(ours) > 10_000, f"정본이 갑자기 줄었다: {len(ours)}"
    name, lat, lng = ours[0]
    assert name and 32.9 <= lat <= 38.7 and 124.5 <= lng <= 132.0
