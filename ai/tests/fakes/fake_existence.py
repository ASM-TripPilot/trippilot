"""FakeExistence — PlaceExistencePort 의 결정론 fake (TRIP-683).

판정표(`poi_id → ExistenceStatus`)대로 돌려주고, 호출 1건마다
`(queries, deadline_ms)` 를 `calls` 에 적는다. **호출 장부가 정본**이다 —
"포트를 주입하지 않으면 아예 부르지 않는다", "마감이 config 값 그대로 넘어간다"
같은 성질은 결과가 아니라 장부로만 관찰된다.

기본 동작은 **계약을 지키는** 구현이다(`place_existence_port` 독스트링):
입력 순서대로, 입력 개수만큼, 예외 없이. UNVERIFIED 에는 사유를 붙인다
(Verdict 의 상태-사유 정합을 타입이 강제한다).

계약을 깨는 포트를 시험할 때는 `mangle` 에 판정열 변형 함수를 준다 —
결손·중복·순서 뒤섞임·유령 poi_id 를 만들어, 호출측(⑤ 정렬)이 그 사고에도
후보를 잃지 않는지를 별도 속성으로 증명한다. 실 HTTP 는 어디에도 없다 (D37).
"""

from __future__ import annotations

from collections.abc import Callable

from trippilot.domain.common import PoiId
from trippilot.ports.place_existence_port import (
    ExistenceQuery,
    ExistenceStatus,
    ExistenceVerdict,
)

_UNVERIFIED_REASON = "fake_unverified"


class FakeExistence:
    """PlaceExistencePort Protocol 만족 (상속 불필요)."""

    def __init__(
        self,
        statuses: dict[PoiId | str, ExistenceStatus] | None = None,
        *,
        default: ExistenceStatus = ExistenceStatus.FOUND,
        mangle: Callable[
            [tuple[ExistenceVerdict, ...]], tuple[ExistenceVerdict, ...]
        ] | None = None,
    ) -> None:
        self._statuses = {str(k): v for k, v in (statuses or {}).items()}
        self._default = default
        self._mangle = mangle
        self.calls: list[tuple[tuple[ExistenceQuery, ...], int]] = []
        self.returned: list[ExistenceVerdict] = []

    @property
    def call_count(self) -> int:
        return len(self.calls)

    @property
    def queried_ids(self) -> list[PoiId]:
        """전 호출에 실린 poi_id 를 호출 순서대로 이어붙인 것."""
        return [q.poi_id for queries, _ in self.calls for q in queries]

    @property
    def not_found_ids(self) -> frozenset[PoiId]:
        """**실제로 돌려준** NOT_FOUND 집합 — mangle 로 빠진 것은 여기에도 없다."""
        return frozenset(
            v.poi_id for v in self.returned if v.status is ExistenceStatus.NOT_FOUND
        )

    def verify(
        self, queries: tuple[ExistenceQuery, ...], *, deadline_ms: int
    ) -> tuple[ExistenceVerdict, ...]:
        self.calls.append((tuple(queries), deadline_ms))
        out = tuple(self._verdict(q) for q in queries)
        if self._mangle is not None:
            out = self._mangle(out)
        self.returned.extend(out)
        return out

    def _verdict(self, q: ExistenceQuery) -> ExistenceVerdict:
        status = self._statuses.get(str(q.poi_id), self._default)
        reason = _UNVERIFIED_REASON if status is ExistenceStatus.UNVERIFIED else None
        return ExistenceVerdict(q.poi_id, status, reason)
