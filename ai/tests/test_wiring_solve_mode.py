"""TRIP-342 — validate/repair 수신부의 solve_mode 백엔드 어휘 흡수 회귀 테스트.

백엔드 `toWire()`(ScheduleAgentWire.kt)는 저장 일정을 되돌려 보낼 때 자기 도메인
3값(FULL_AI|DETERMINISTIC|MINIMAL)을 `solve_mode`에 싣는다. 수신부가 이를 흡수하지
못하면 ValueError→422가 되고, 백엔드 편집 경로에서 사용자에게 500으로 번진다.

증명하는 것:
  ① 백엔드 3값 각각으로 validate 호출 → 422가 아니다 (정상 판정 200)
  ② FULL_AI 일정이 repair 경로를 관통한다 (수리 + 재검증까지)
  ③ 미지 값("BOGUS")은 기존대로 422 — 관대하되 무한 관대는 금지

스타일·조립은 test_e2e_boundary.py와 동일(실 조립 + fake 어댑터, 실 호출 0 — D37).
"""

from __future__ import annotations

import pytest

from tests.test_e2e_boundary import _BANNED_TOKENS, _meta, _validate_body, make_client

_DAY = "2026-08-05"


def _slot(poi_id: str, start: str, end: str) -> dict:
    return {"poi_id": poi_id, "start_at": start, "end_at": end,
            "ends_next_day": False, "distance_range": None, "is_fixed": False}


def _payload(solve_mode: str, *, is_fallback: bool, slots: list[dict]) -> dict:
    return {
        "days": [{"date": _DAY, "slots": slots}],
        "day1_ready_at": None,
        "explanations": {},
        "solve_mode": solve_mode,
        "is_fallback": is_fallback,
        "freshness": None,
        "candidates_summary": None,
    }


_CLEAN = [_slot("p1", "10:00:00", "11:00:00")]  # 단독 슬롯 — HC 위반 없음
_VIOLATING = [
    _slot("p1", "10:00:00", "11:00:00"),
    _slot("p2", "11:05:00", "12:00:00"),  # 간격 5분 < 이동 소요 → HC2
]


# ── ① 백엔드 3값 흡수 — validate가 422를 내지 않는다 ─────────────────


@pytest.mark.parametrize(
    ("backend_mode", "is_fallback"),
    [
        ("FULL_AI", False),        # 정상 AI 산출 회신
        ("DETERMINISTIC", True),   # 결정론 폴백 회신 (RULE_FALLBACK 왕복)
        ("MINIMAL", True),         # 최소 보장 회신
    ],
)
def test_validate_absorbs_backend_solve_mode_vocabulary(
    backend_mode: str, is_fallback: bool
) -> None:
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/validate",
            json=_validate_body(
                _payload(backend_mode, is_fallback=is_fallback, slots=_CLEAN)
            ),
        )

    assert response.status_code != 422, response.text
    assert response.status_code == 200, response.text
    assert response.json() == {"violations": [], "unverified_slots": []}


# ── ② FULL_AI 일정의 repair 경로 관통 ────────────────────────────────


def test_repair_pierces_with_backend_full_ai_mode() -> None:
    """백엔드 어휘(FULL_AI) 일정도 수리 → 재검증 위반 0까지 관통한다."""
    with make_client() as client:
        repaired_response = client.post(
            "/ai/v1/itinerary/repair",
            json={
                "itinerary": _payload("FULL_AI", is_fallback=False, slots=_VIOLATING),
                "violations": [{"code": "HC2", "slot_ref": "p2",
                                "detail": "이동시간 부족"}],
                "request_meta": _meta(),
            },
        )
        assert repaired_response.status_code == 200, repaired_response.text
        body = repaired_response.json()
        assert body["repaired"] is not None
        # 수리는 출처를 바꾸지 않는다 — FULL_AI는 AI 어휘 OR_TOOLS로 흡수돼 나간다
        assert body["repaired"]["solve_mode"] == "OR_TOOLS"
        for banned in _BANNED_TOKENS:  # INV-3은 수리 응답에도 적용
            assert banned not in repaired_response.text

        revalidated = client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(body["repaired"])
        )
        assert revalidated.status_code == 200
        assert revalidated.json() == {"violations": [], "unverified_slots": []}


# ── ③ 미지 값은 여전히 422 (무한 관대 금지) ──────────────────────────


def test_unknown_solve_mode_still_returns_422() -> None:
    with make_client() as client:
        response = client.post(
            "/ai/v1/itinerary/validate",
            json=_validate_body(_payload("BOGUS", is_fallback=False, slots=_CLEAN)),
        )

    assert response.status_code == 422, response.text
