"""REMINDER_COPY 게이트 — 길이·금지 토큰·장소 대조 (INV-1·INV-3).

증명하는 것:
  ① 통과한 문구는 title ≤20자 · body ≤60자 · 금지 토큰 없음
  ② 선언한 장소가 그날 슬롯 밖이면 드롭 (INV-1)
  ③ 선언하지 않은 다른 날 장소가 본문에 있으면 드롭 (선언 회피 차단)
  ④ 파싱 실패는 조용히 넘기지 않고 error 로 수렴 (INV-4)
  ⑤ PBT — 임의 문자열 입력에 예외 0, 통과분은 항상 규칙 전부 만족:
     모든 4개 금지 토큰 확인, 선언한 장소 본문 출현, 금지 장소 미출현
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.reminder_copy import (
    _FORBIDDEN_TOKENS,
    _MAX_BODY,
    _MAX_TITLE,
    ReminderCopyContext,
    ReminderCopyGate,
)

NOW = datetime(2026, 9, 12, 9, 0, tzinfo=timezone.utc)
TRACE = TraceId("t-1")
CTX = ReminderCopyContext(
    allowed=("성산일출봉", "우도"), forbidden=("한라산", "협재해수욕장")
)


def _apply(payload: dict, ctx: ReminderCopyContext = CTX):
    return ReminderCopyGate().apply(
        json.dumps(payload, ensure_ascii=False),
        ctx,
        feature=LlmFeature.REMINDER_COPY,
        trace_id=TRACE,
        now=NOW,
    )


def test_valid_copy_passes() -> None:
    out = _apply({"title": "오늘의 제주", "body": "성산일출봉에서 시작하는 하루예요", "places": ["성산일출봉"]})
    assert out.error is None
    assert out.value.title == "오늘의 제주"
    assert out.value.body == "성산일출봉에서 시작하는 하루예요"


def test_place_outside_day_slots_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "한라산에 오르는 날이에요", "places": ["한라산"]})
    assert out.value is None
    assert out.drop_event is not None


def test_undeclared_other_day_place_in_body_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "협재해수욕장도 좋아요", "places": []})
    assert out.value is None
    assert out.drop_event is not None


def test_declared_place_absent_from_body_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "느긋하게 걸어볼까요", "places": ["우도"]})
    assert out.value is None
    assert out.drop_event is not None


@pytest.mark.parametrize(
    "body",
    [
        "30분이면 도착해요",  # 금지 토큰: 분
        "이동시간이 걸려요",  # 금지 토큰: 시간
        "그 시각에 출발하세요",  # 금지 토큰: 시각
        "Duration of travel is short",  # 금지 토큰: duration (대소문자 무시)
    ],
)
def test_all_forbidden_tokens_dropped(body: str) -> None:
    out = _apply({"title": "오늘의 제주", "body": body, "places": []})
    assert out.value is None and out.drop_event is not None


def test_too_long_body_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "가" * (_MAX_BODY + 1), "places": []})
    assert out.value is None
    assert out.drop_event is not None


def test_boundary_title_max_length_passes() -> None:
    title = "가" * _MAX_TITLE
    out = _apply({"title": title, "body": "정상 본문이에요", "places": []})
    assert out.error is None and out.value.title == title


def test_boundary_body_max_length_passes() -> None:
    body = "가" * _MAX_BODY
    out = _apply({"title": "제목", "body": body, "places": []})
    assert out.error is None and out.value.body == body


def test_malformed_json_is_error_not_silent() -> None:
    out = ReminderCopyGate().apply(
        "not json", CTX, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW
    )
    assert out.value is None
    assert out.error is not None and out.error.startswith("parse_error")


def test_missing_context_is_error() -> None:
    out = ReminderCopyGate().apply(
        json.dumps({"title": "t", "body": "b", "places": []}),
        None,
        feature=LlmFeature.REMINDER_COPY,
        trace_id=TRACE,
        now=NOW,
    )
    assert out.value is None
    assert out.error is not None


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=200), st.text(max_size=200), st.lists(st.text(max_size=20), max_size=5))
def test_pbt_pass_implies_all_rules(title: str, body: str, places: list[str]) -> None:
    out = _apply({"title": title, "body": body, "places": places})
    if out.value is None:
        return
    # 통과한 문구는 모든 규칙을 만족한다
    assert 0 < len(out.value.title) <= _MAX_TITLE
    assert 0 < len(out.value.body) <= _MAX_BODY
    lowered = out.value.body.lower() + out.value.title.lower()
    # 모든 4개 금지 토큰 부재 확인 (INV-3)
    assert not any(t in lowered for t in _FORBIDDEN_TOKENS)
    # 선언한 모든 장소가 allowed 집합에 속함 (INV-1)
    for name in places:
        if name.strip():
            assert name.strip() in CTX.allowed
    # 선언한 모든 장소가 본문에 출현 (선언 정직성)
    # ponytail: 이 검증은 엄격히 말해 게이트가 체크하는 "name in body" 문자열 매치와 동일.
    # 더 엄격한 단어 경계 매칭이 필요하면 정규식 추가.
    for name in places:
        if name.strip():
            assert name.strip() in out.value.body
    # 금지된 장소(다른 날) 미출현 (선언 회피 차단)
    for forbidden_name in CTX.forbidden:
        assert forbidden_name not in out.value.body


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=300))
def test_pbt_arbitrary_text_never_raises(raw: str) -> None:
    ReminderCopyGate().apply(
        raw, CTX, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW
    )


def test_declared_place_may_drop_parenthetical_in_body() -> None:
    """괄호 부기는 본문에서 빼도 된다 — 수집 이름의 8.5%가 괄호를 달고 있고,
    "약수암(부산)에서" 라고 쓰는 알림은 없다. 이걸 드롭하면 그 슬롯이 든 날은
    매번 기본 문구로 떨어진다."""
    ctx = ReminderCopyContext(allowed=("약수암(부산)", "초원농원"), forbidden=())
    out = ReminderCopyGate().apply(
        json.dumps({"title": "오늘의 부산", "body": "약수암을 둘러보고 초원농원에서 식사해요",
                    "places": ["약수암(부산)", "초원농원"]}, ensure_ascii=False),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert out.error is None and out.value is not None


def test_unrelated_declared_place_still_dropped() -> None:
    """완화는 괄호 축약까지다 — 본문에 흔적도 없는 선언은 여전히 드롭."""
    ctx = ReminderCopyContext(allowed=("약수암(부산)", "초원농원"), forbidden=())
    out = ReminderCopyGate().apply(
        json.dumps({"title": "오늘의 부산", "body": "느긋하게 걸어볼까요",
                    "places": ["약수암(부산)"]}, ensure_ascii=False),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert out.value is None and out.drop_event is not None
