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
    _DURATION,
    _name_variants,
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
    assert _DURATION.search(lowered) is None
    # 선언한 모든 장소가 allowed 집합에 속함 (INV-1)
    for name in places:
        if name.strip():
            assert name.strip() in {
                v for a in CTX.allowed for v in _name_variants(a)
            }
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


def test_trailing_romanization_may_be_dropped_in_body() -> None:
    """괄호 없이 뒤에 붙는 로마자도 본문에서 뺄 수 있다 — Overture·OSM 출처의
    표기 관행(`사라오름 전망대 Sara Observatory`)이라 인정하지 않으면 그 출처의
    장소가 든 날이 통째로 드롭된다."""
    ctx = ReminderCopyContext(allowed=("사라오름 전망대 Sara Observatory",), forbidden=())
    out = ReminderCopyGate().apply(
        json.dumps({"title": "오늘의 한라산", "body": "사라오름 전망대에 올라 풍경을 담아보세요",
                    "places": ["사라오름 전망대 Sara Observatory"]}, ensure_ascii=False),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert out.error is None and out.value is not None


def test_latin_only_name_is_not_stripped_away() -> None:
    """라틴 문자가 본명인 곳까지 깎으면 이름이 사라진다 — 본문이 그 이름을
    써야만 통과한다."""
    ctx = ReminderCopyContext(allowed=("Paris Baguette Cafe",), forbidden=())
    gate = ReminderCopyGate()
    ok = gate.apply(
        json.dumps({"title": "오늘의 신제주", "body": "Paris Baguette Cafe에서 아침을 챙기세요",
                    "places": ["Paris Baguette Cafe"]}, ensure_ascii=False),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert ok.value is not None
    bad = gate.apply(
        json.dumps({"title": "오늘의 신제주", "body": "Paris에서 아침을 챙기세요",
                    "places": ["Paris Baguette Cafe"]}, ensure_ascii=False),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert bad.value is None


def test_declared_may_use_display_form_of_slot_name() -> None:
    """모델은 선언에도 줄인 이름을 쓴다 — 슬롯이 "사라오름 전망대 Sara Observatory"
    면 places 에 "사라오름 전망대" 를 싣는다. 원본만 대조하면 그 축약이 전부 "풀
    밖 장소"로 잡혀, 괄호·로마자가 붙은 장소가 든 날은 매번 기본 상수로 떨어진다.
    (실측 2026-09-16: 학생 모델이 이 형태로 선언해 5건 중 4건이 드롭됐다)"""
    ctx = ReminderCopyContext(
        allowed=("사라오름 전망대 Sara Observatory", "금룡사(제주)"), forbidden=()
    )
    out = ReminderCopyGate().apply(
        json.dumps({"title": "오늘의 제주", "body": "사라오름 전망대와 금룡사를 둘러보세요",
                    "places": ["사라오름 전망대", "금룡사"]}, ensure_ascii=False),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert out.error is None and out.value is not None


def test_display_form_relaxation_does_not_admit_new_places() -> None:
    """완화는 원본에서 파생된 표시형까지다 — 슬롯에 없는 장소는 여전히 드롭.
    표시형은 원본을 깎아 만들 뿐 새 이름을 만들지 않으므로 INV-1 은 유지된다."""
    ctx = ReminderCopyContext(allowed=("사라오름 전망대 Sara Observatory",), forbidden=())
    out = ReminderCopyGate().apply(
        json.dumps({"title": "오늘의 제주", "body": "한라산에 올라보세요",
                    "places": ["한라산"]}, ensure_ascii=False),
        ctx, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW,
    )
    assert out.value is None and out.drop_event is not None


# ── 2026-09-17 홀드아웃 실측에서 드러난 오탐·정탐 (게이트 판정 재조정) ──────────
#
# 탈락 17/30 중 12건이 부분 문자열 금지였고 대부분 소요시간을 표시하지 않았다.
# 아래 두 파라미터 묶음이 그 경계를 고정한다 — 완화가 INV-3 까지 새지 않게.


@pytest.mark.parametrize(
    "body",
    [
        "성산일출봉에서 즐거운 시간을 보내요",  # 실측 12건 중 다수
        "성산일출봉에서 특별한 시간을 보내요",  # '특별한 시간' 의 "한 시간"
        "성산일출봉에서 식사 시간을 즐겨요",  # '식사 시간' 의 "사 시간"
        "성산일출봉의 분위기를 느껴보세요",  # '분위기' 의 "분"
        "성산일출봉에서 기분 좋은 하루를",  # '기분' 의 "분"
        "성산일출봉을 충분히 둘러보세요",  # '충분히' 의 "분"
    ],
)
def test_non_duration_words_are_not_dropped(body: str) -> None:
    """소요시간을 하나도 표시하지 않는 말은 통과한다 — 기능이 꺼지지 않게."""
    out = _apply({"title": "오늘의 제주", "body": body, "places": ["성산일출봉"]})
    assert out.error is None and out.value is not None, body


@pytest.mark.parametrize(
    "body",
    [
        "성산일출봉까지 30분이면 도착해요",
        "성산일출봉까지 두 시간 걸려요",
        "성산일출봉까지 삼십분 거리예요",
        "성산일출봉까지 이동시간이 있어요",
        "성산일출봉은 시간이 걸리는 곳이에요",
    ],
)
def test_actual_duration_still_dropped(body: str) -> None:
    """수량·연어로 소요시간이 드러나면 여전히 드롭한다 (INV-3)."""
    out = _apply({"title": "오늘의 제주", "body": body, "places": ["성산일출봉"]})
    assert out.value is None and out.drop_event is not None, body


@pytest.mark.parametrize(
    ("allowed", "declared", "body"),
    [
        # 지점 접미사 — 모델은 본문에서 지점을 뗀다
        ("동적깡통구이 쌍문본점", "동적깡통구이 쌍문본점", "동적깡통구이에서 저녁을 즐겨요"),
        ("동적깡통구이 쌍문본점", "동적깡통구이", "동적깡통구이에서 저녁을 즐겨요"),
        # 지역 접두사 — 모델은 선언에서 지역을 뗀다
        ("옥천 구읍벽화마을", "구읍벽화마을", "구읍벽화마을을 걸어보세요"),
    ],
)
def test_token_level_shortening_accepted(allowed: str, declared: str, body: str) -> None:
    """공백 토큰 경계의 축약은 같은 장소로 인정한다 (실측 장소명의 13%)."""
    ctx = ReminderCopyContext(allowed=(allowed,), forbidden=())
    out = _apply({"title": "오늘의 하루", "body": body, "places": [declared]}, ctx)
    assert out.error is None and out.value is not None


def test_token_shortening_does_not_open_new_places() -> None:
    """완화는 토큰 경계에서 닫힌다 — 한 토큰 이름에서 조각이 파생되지 않는다."""
    ctx = ReminderCopyContext(allowed=("세종호수공원",), forbidden=())
    out = _apply({"title": "오늘의 하루", "body": "공원을 걸어보세요", "places": ["공원"]}, ctx)
    assert out.value is None and out.drop_event is not None
