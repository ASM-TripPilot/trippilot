"""generate 응답의 LLM 신호 — `scoring_mode`·`degradations` 사영.

FE 가 `solve_mode`(항상 OR_TOOLS)만 보고 "LLM 이 안 돈다"고 판단했다 — 취향 점수를 LLM 이
매겼는지는 내부(`GenerationOutcome.scoring_mode`·`degradations`)에만 있었다. 그 값을 새 상태
없이 사영한다. 실 조립 + fake 어댑터(실 호출 0).
"""

from __future__ import annotations

import re

from trippilot.api.schemas import ItineraryPayload

from tests.fakes.fake_llm import FailingLlm
from tests.test_e2e_boundary import (
    _BANNED_TOKENS,
    RoutingLlm,
    _explanations_json,
    _request,
    _scores_json,
    _validate_body,
    make_client,
)

_IDS = tuple(f"p{i}" for i in range(1, 7))


def _generate(llm: object) -> dict:
    with make_client(llm=llm) as client:
        response = client.post("/ai/v1/itinerary/generate", json=_request())
    assert response.status_code == 200, response.text
    return response.json()


def test_llm_scores_all_candidates_reports_llm_and_no_degradations() -> None:
    body = _generate(RoutingLlm(_scores_json(*_IDS), _explanations_json(*_IDS)))
    assert body["scoring_mode"] == "LLM"
    assert body["degradations"] == []


def test_llm_failure_reports_rule_with_stage_coded_reason() -> None:
    body = _generate(FailingLlm())
    assert body["scoring_mode"] == "RULE"
    assert "llm:c1_fallback" in body["degradations"]
    # 코드만 — 자유 문장·예외 메시지·시한 값(`deadline:remaining=...ms`의 꼬리) 금지
    for code in body["degradations"]:
        assert re.fullmatch(r"[a-z_]+:[a-z0-9_]+", code), code


def test_partial_llm_scores_with_rule_backfill_reports_mixed() -> None:
    body = _generate(RoutingLlm(_scores_json(*_IDS[:3]), _explanations_json(*_IDS)))
    assert body["scoring_mode"] == "MIXED"


def test_signal_fields_carry_no_time_or_duration_tokens() -> None:
    body = _generate(FailingLlm())
    text = str({"scoring_mode": body["scoring_mode"], "degradations": body["degradations"]})
    for banned in _BANNED_TOKENS:
        assert banned not in text


def test_old_consumer_payload_without_signal_fields_still_parses_and_validates() -> None:
    """백엔드는 아직 두 필드를 모른다 — 빠진 본문이 validate 로 되돌아와도 200, 기본값은 모름."""
    body = _generate(RoutingLlm(_scores_json(*_IDS), _explanations_json(*_IDS)))
    old = {k: v for k, v in body.items() if k not in {"scoring_mode", "degradations"}}
    parsed = ItineraryPayload.model_validate(old)
    assert parsed.scoring_mode is None and parsed.degradations == []
    with make_client() as client:
        assert client.post(
            "/ai/v1/itinerary/validate", json=_validate_body(old)
        ).status_code == 200
