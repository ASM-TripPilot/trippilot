"""TravelPort — 이동 추정 콘센트 (business-logic-model.md §2.2).

Protocol(구조적 타이핑) — 어댑터는 상속 없이 시그니처만 맞추면 된다.
실 구현(카카오→네이버→직선거리 체인)은 U2 소유. Port는 단일 계약만 정의.
동일 입력 → 동일 출력 (U5-P4 결정론).
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate


class TravelPort(Protocol):
    def estimate(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> TravelEstimate: ...
