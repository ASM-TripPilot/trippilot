"""agent-foundation — 신선도 타입 PBT (business-rules §2 ENV-P1·ENV-P4).

증명하는 것:
  ① ENV-P4: InfoPacket 상태-신선도 정합 — status ∈ {OK, LOW} ∧ freshness=None인
     인스턴스는 생성 불가 (BR-AF-06, IO-6·IO-7 — 상태 전수 스윕)
  ② ENV-P1: FreshnessMeta·InfoPacket·InfoBundle 직렬화 왕복 (BR-AF-12)
  ③ tz-aware 강제: naive fetched_at은 생성 불가 (serialization.py 규칙)
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from hypothesis import given

from trippilot.domain.freshness import (
    FreshnessMeta,
    InfoBundle,
    InfoPacket,
    ProviderKind,
    ProviderStatus,
)

from tests.generators.delegation import freshness_metas, info_bundles, info_packets

_META = FreshnessMeta(
    source="KMA",
    fetched_at=datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc),
    cache_hit=False,
    ttl_sec=3600,
    stale=False,
)
_FRESHNESS_REQUIRED = {ProviderStatus.OK, ProviderStatus.LOW}


# ── ① ENV-P4: 상태 전수 스윕 ──
@pytest.mark.parametrize("status", list(ProviderStatus))
def test_freshness_required_iff_ok_or_low(status: ProviderStatus) -> None:
    # freshness 동봉은 모든 상태에서 생성 가능
    InfoPacket(provider=ProviderKind.WEATHER, status=status, data={}, freshness=_META)
    if status in _FRESHNESS_REQUIRED:
        # 성공(부분 성공 포함)인데 신선도 없음 → 생성 자체 불가
        with pytest.raises(ValueError):
            InfoPacket(
                provider=ProviderKind.WEATHER, status=status, data={}, freshness=None
            )
    else:
        # 실패 상태값만 freshness=None 허용 (IO-7)
        InfoPacket(provider=ProviderKind.WEATHER, status=status, data={}, freshness=None)


# ── ② ENV-P1: 직렬화 왕복 ──
@given(x=freshness_metas())
def test_freshness_meta_roundtrip(x: FreshnessMeta) -> None:
    assert FreshnessMeta.from_dict(x.to_dict()) == x


@given(x=info_packets())
def test_info_packet_roundtrip(x: InfoPacket) -> None:
    assert InfoPacket.from_dict(x.to_dict()) == x


@given(x=info_bundles())
def test_info_bundle_roundtrip(x: InfoBundle) -> None:
    assert InfoBundle.from_dict(x.to_dict()) == x


# ── ③ tz-aware 강제 + ttl 하한 ──
def test_naive_fetched_at_rejected() -> None:
    with pytest.raises(ValueError):
        FreshnessMeta(
            source="KMA",
            fetched_at=datetime(2026, 8, 6, 9, 0),  # naive
            cache_hit=False,
            ttl_sec=60,
            stale=False,
        )


def test_negative_ttl_rejected() -> None:
    with pytest.raises(ValueError):
        FreshnessMeta(
            source="KMA",
            fetched_at=datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc),
            cache_hit=False,
            ttl_sec=-1,
            stale=False,
        )
