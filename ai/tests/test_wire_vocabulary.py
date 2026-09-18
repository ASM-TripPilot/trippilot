"""경계 어휘 번역표가 백엔드 정본 어휘를 전부 덮는가.

번역표의 폴백은 **소프트**다 — 미인식 값은 거절되지 않고 기본값(MID·PUBLIC)이
된다. 배제보다 나은 선택이지만, 그래서 **어휘가 빠진 것이 증상으로 드러나지
않는다**: 저가 여행자와 럭셔리 여행자가 똑같이 중간 예산으로 걸러져도 예외도
로그도 없다(실제로 그랬다 — 둘 다 표에 없었다).

여기서 잠그는 것은 "표가 정본 어휘를 덮는다" 하나다. 정본은 백엔드
`V1.5__profile.sql` 의 CHECK 제약이고, 값이 늘면 이 테스트가 먼저 깨진다.
"""

from __future__ import annotations

import pytest

from trippilot.api.wiring import _BUDGET_TOKENS, _TRANSPORT_TOKENS
from trippilot.domain.common import BudgetLevel, TransportMode

# 백엔드 `preference_set.budget_tier` CHECK (V1.5__profile.sql) — 접지 않고 와이어에 실린다.
BACKEND_BUDGET_TIERS = ("저가", "중간", "고급", "럭셔리")


@pytest.mark.parametrize("tier", BACKEND_BUDGET_TIERS)
def test_every_backend_budget_tier_is_translated(tier: str) -> None:
    assert _BUDGET_TOKENS.get(tier.strip().upper()) is not None, (
        f"{tier!r} 가 번역표에 없다 — 조용히 MID 로 떨어진다")


def test_budget_tiers_keep_their_order() -> None:
    """네 등급이 서로 구분되는가 — 양 끝이 가운데로 무너지지 않는지 본다."""
    levels = [_BUDGET_TOKENS[t] for t in BACKEND_BUDGET_TIERS]
    assert levels[0] is BudgetLevel.LOW          # 저가
    assert levels[1] is BudgetLevel.MID          # 중간
    assert levels[2] is BudgetLevel.HIGH         # 고급
    # 럭셔리는 아직 AI 값이 없어 HIGH 와 같다(TRIP-434). 최소한 MID 는 아니어야 한다.
    assert levels[3] is not BudgetLevel.MID


def test_transport_modes_cover_the_wire_vocabulary() -> None:
    """이동수단도 같은 폴백 구조라 같이 잠근다(대중교통 기본값)."""
    for token, expected in (("도보", TransportMode.WALK),
                            ("대중교통", TransportMode.PUBLIC),
                            ("렌터카", TransportMode.CAR)):
        assert _TRANSPORT_TOKENS[token] is expected
