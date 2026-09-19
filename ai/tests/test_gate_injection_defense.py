"""프롬프트 인젝션 산출물 방어 — 출구 게이트의 문자열 검사.

## 왜 실행 격리가 아니라 여기인가

감사(2026-09-19, 에이전트 25)에서 공격 10건이 전부 통과했는데 **피해가 하나로 수렴했다**:
「사용자에게 보이는 문장이 오염된다. 그 이상은 아니다.」

코드 실행·도구 호출·파일 접근이 없고(게이트웨이는 LLM 과 **문자열만** 주고받는다),
POI id 는 전부 닫힌 집합 교차를 통과해야 하며(INV-1), 시각·순서는 어셈블리 소유다(INV-2).
그래서 컨테이너를 더 잠가도 **오염되는 값은 똑같이 오염된다** — 막을 지점은 출구 게이트다.

## 무엇이 프롬프트에 섞이나

우리가 쓰지 않은 문자열이 프롬프트 변수로 들어간다: 웹 수집 POI 상호명(OSM 은 누구나 편집),
위키백과 발췌(KB-5), 네이버 검색 스니펫, 그리고 **우리 자신의 앞선 LLM 출력**이 백엔드
`visit_slot.placement_reason` 에 저장됐다가 되돌아오는 2차 회귀.

## 처리 방침 — 문장만 버리고 항목은 살린다

걸리면 `reason`/`text` 를 비우고 후보·슬롯은 남긴다. 호출측이 결정론 문구로 대체하므로
과잉 차단의 대가가 "이유 한 줄이 빈다" 뿐이다. 반대로 놓치면 사용자가 앱을 믿고 낯선 주소를
받아 적는다.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.alternative_selection import AlternativeSelectionGate
from trippilot.llm_gateway.gates.base import has_contact_like
from trippilot.llm_gateway.gates.explanation import ExplanationGate
from trippilot.llm_gateway.gates.reflection_nudge import ReflectionNudgeGate
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyGate
from trippilot.llm_gateway.gates.share_card_copy import (
    ShareCardCopyContext,
    ShareCardCopyGate,
)

_TID = TraceId("t-inject")
_NOW = datetime(2026, 9, 19, tzinfo=UTC)


class _Pool:
    """후보 풀 대역 — 게이트가 쓰는 것은 contains 뿐이다."""

    def __init__(self, *ids: str) -> None:
        self._ids = {PoiId(i) for i in ids}

    def contains(self, poi_id: PoiId) -> bool:
        return poi_id in self._ids


# ── 검출기 자체 ─────────────────────────────────────────────────────────

_CONTACT = [
    "예약은 book-now.example.kr 에서 하세요",
    "자세한 건 https://evil.io 참고",
    "문의 010-1234-5678",
    "메일 ticket@fake.co.kr 로 보내세요",
    "www.somewhere.net 확인",
]
_CLEAN = [
    "경복궁은 조선의 정궁이라 한 번은 볼 만합니다",
    "도보 5분 거리라 다음 일정과 이어집니다",
    "한옥마을과 가까워 동선이 자연스럽습니다",
    "비 오는 날에도 실내라 괜찮습니다",
    "아이와 함께 가기 좋은 곳입니다",
]


@pytest.mark.parametrize("text", _CONTACT)
def test_contact_like_text_is_detected(text: str) -> None:
    assert has_contact_like(text)


@pytest.mark.parametrize("text", _CLEAN)
def test_ordinary_korean_recommendation_is_not_flagged(text: str) -> None:
    """과잉 차단이 진짜 위험이다 — 평범한 추천 문장이 걸리면 모든 이유가 빈다."""
    assert not has_contact_like(text)


_DATA = Path(__file__).resolve().parent.parent / "data"


def test_no_real_poi_name_is_flagged() -> None:
    """실 말뭉치 오탐 0 — 손으로 고른 다섯 문장으로는 정규식이 넓어져도 모른다.

    게이트가 보는 것은 LLM 출력 문장이고, 그 문장에는 상호명이 그대로 들어간다.
    `.co`·`.io` 같은 짧은 TLD 를 맨 도메인으로 잡고 있어서 "○○.코"류 표기나
    영문 상호에 걸릴 여지가 실제로 있다 — 그래서 가정하지 않고 전수로 센다.
    걸리면 `_CONTACTISH` 를 좁혀라. 여기서 한 건이라도 나오면 **그 카테고리의
    모든 추천 이유가 빈칸이 된다**.
    """
    raw = json.loads((_DATA / "collected_pois.json").read_text(encoding="utf-8"))
    names = [
        p["poi"]["name"]
        for p in raw["proposals"]
        if isinstance(p.get("poi"), dict) and isinstance(p["poi"].get("name"), str)
    ]
    assert len(names) > 10_000  # 표본이 줄면 이 테스트의 의미도 준다
    assert [n for n in names if has_contact_like(n)] == []


def test_no_wiki_excerpt_sentence_is_flagged() -> None:
    """KB-5 발췌도 같은 이유 — 위키 본문이 프롬프트를 거쳐 문장에 섞인다."""
    raw = json.loads((_DATA / "place_docs.json").read_text(encoding="utf-8"))
    sentences = [
        s.strip()
        for d in raw["documents"]
        if isinstance(d.get("text"), str)
        for s in re.split(r"(?<=[.!?])\s+|\n+", d["text"])
        if len(s.strip()) > 8
    ]
    assert len(sentences) > 1_000
    assert [s for s in sentences if has_contact_like(s)] == []


# ── EXPLANATION — 이 text 는 DB 에 영속된다 ─────────────────────────────


def _explain(text: str):
    raw = '{"explanations": [{"poiId": "p1", "text": %s}]}' % repr(text).replace("'", '"')
    return ExplanationGate().apply(
        raw, _Pool("p1"), feature=LlmFeature.EXPLANATION, trace_id=_TID, now=_NOW
    )


def test_explanation_keeps_ordinary_text() -> None:
    out = _explain("경복궁은 조선의 정궁이라 한 번은 볼 만합니다")
    assert out.error is None
    assert out.value[0].text == "경복궁은 조선의 정궁이라 한 번은 볼 만합니다"


def test_explanation_blanks_contact_like_text_but_keeps_the_slot() -> None:
    """슬롯은 살리고 문장만 버린다 — 후보를 통째로 잃으면 일정이 비어 버린다."""
    out = _explain("예약은 book-now.example.kr 에서 미리 하세요")
    assert out.error is None
    assert out.value[0].poi_id == PoiId("p1")  # 슬롯은 남는다
    assert out.value[0].text == ""  # 문장만 비운다


def test_explanation_blanks_time_expressions_inv3() -> None:
    """이 text 는 백엔드 `visit_slot.placement_reason` 과 리비전 스냅샷에 **영속된다**.

    거르지 않으면 INV-3(소요시간 표시 금지) 위반이 화면과 DB 양쪽에 남는다.
    형제 게이트(alternative_selection)는 이미 같은 처리를 하고 있었다 — 이쪽만 빠져 있었다.
    """
    text = "관람에 약 40분이면 충분합니다"
    assert _TIME_EXPR.search(text)  # 공유 정규식이 실제로 잡는지 먼저 확인
    out = _explain(text)
    assert out.value[0].text == ""


def test_explanation_still_enforces_the_closed_set() -> None:
    """문장 검사를 더해도 INV-1 은 그대로다 — 풀 밖 POI 는 여전히 드롭된다."""
    raw = '{"explanations": [{"poiId": "not-in-pool", "text": "좋은 곳입니다"}]}'
    out = ExplanationGate().apply(
        raw, _Pool("p1"), feature=LlmFeature.EXPLANATION, trace_id=_TID, now=_NOW
    )
    assert out.value == ()
    assert out.drop_event is not None and out.drop_event.dropped_count == 1


# ── ALTERNATIVE_SELECTION — 앱 화면의 후보 카드 캡션 ────────────────────


def _select(reason: str):
    raw = '{"selections": [{"poiId": "p1", "reason": %s}]}' % repr(reason).replace("'", '"')
    return AlternativeSelectionGate().apply(
        raw, _Pool("p1"), feature=LlmFeature.ALTERNATIVE_SELECTION, trace_id=_TID, now=_NOW
    )


def test_alternative_reason_keeps_ordinary_text() -> None:
    out = _select("비 와도 실내라 지금 일정에 잘 맞습니다")
    assert out.value[0].reason == "비 와도 실내라 지금 일정에 잘 맞습니다"


def test_alternative_reason_blanks_contact_like_text_but_keeps_the_candidate() -> None:
    """위키 발췌가 프롬프트에 붙는 자리라(KB-5) 실제로 제3자 문장이 섞일 수 있다."""
    out = _select("입장 인증은 verify-entry.link 에서 먼저 마치세요")
    assert out.value[0].poi_id == PoiId("p1")  # 후보는 남는다
    assert out.value[0].reason == ""


def test_alternative_reason_still_blanks_time_expressions() -> None:
    """기존 INV-3 처리가 그대로인지 — 술어를 더하면서 깨뜨리지 않았는지 본다."""
    out = _select("30분 안에 도착할 수 있습니다")
    assert out.value[0].reason == ""


# ── 푸시·공유 문구 — 전량 드롭형 세 곳 ───────────────────────────────────
#
# 위 둘과 처리가 다르다: 산출이 1건이라 "문장만 비우기"가 성립하지 않는다(빈 알림을
# 보낼 수는 없다). 그래서 드롭 + 사유이고, 호출측이 결정론 기본 문구로 보낸다(INV-4).
# 과잉 차단의 대가는 "기본 문구로 간다" — 여기서도 놓치는 쪽이 비싸다.


def test_reflection_nudge_drops_a_link_bearing_push() -> None:
    """잠금화면에 앱 이름과 함께 뜨는 자리다 — 60자 상한은 `evil.io` 를 막지 못한다."""
    out = ReflectionNudgeGate().apply(
        '{"message": "여행 기록 남기러 오세요 memo-trip.io"}',
        None,
        feature=LlmFeature.REFLECTION_NUDGE,
        trace_id=_TID,
        now=_NOW,
    )
    assert out.value is None
    assert out.drop_event is not None  # 드롭 사유가 남는다 (파싱 실패와 구분)


def test_reflection_nudge_keeps_an_ordinary_push() -> None:
    out = ReflectionNudgeGate().apply(
        '{"message": "어제 여행은 어땠나요? 한 줄 남겨보세요"}',
        None,
        feature=LlmFeature.REFLECTION_NUDGE,
        trace_id=_TID,
        now=_NOW,
    )
    assert out.value == "어제 여행은 어땠나요? 한 줄 남겨보세요"


def _remind(title: str, body: str, places: list[str]):
    raw = json.dumps({"title": title, "body": body, "places": places}, ensure_ascii=False)
    return ReminderCopyGate().apply(
        raw,
        ReminderCopyContext(allowed=("경복궁",)),
        feature=LlmFeature.REMINDER_COPY,
        trace_id=_TID,
        now=_NOW,
    )


def test_reminder_copy_drops_a_link_in_the_body() -> None:
    """대조 집합으로는 못 막는 구멍 — `allowed` 는 '장소를 말해도 되는가'만 본다.

    본문은 기존 규칙(선언 정직성·INV-3·상한)을 **전부 통과**하도록 짰다 — 링크
    하나만 더한 문구다. 그래야 드롭이 새 술어 덕이라는 것이 고정된다
    (`has_contact_like` 를 상수 False 로 바꾸면 이 테스트만 통과해 버렸다).
    """
    out = _remind("경복궁 가는 날", "오늘 경복궁 예약은 confirm-kr.app 에서", ["경복궁"])
    assert out.value is None
    assert out.drop_event is not None


def test_reminder_copy_keeps_an_ordinary_reminder() -> None:
    out = _remind("경복궁 가는 날", "오늘 경복궁 일정이 있어요", ["경복궁"])
    assert out.value is not None and out.value.body == "오늘 경복궁 일정이 있어요"


def _share(caption: str, hashtags: list[str], places: list[str]):
    raw = json.dumps(
        {"share_card": {"caption": caption, "hashtags": hashtags, "places": places}},
        ensure_ascii=False,
    )
    return ShareCardCopyGate().apply(
        raw,
        ShareCardCopyContext(poi_names=("경복궁",), region="서울"),
        feature=LlmFeature.SHARE_CARD_COPY,
        trace_id=_TID,
        now=_NOW,
    )


def test_share_card_drops_a_link_in_the_caption() -> None:
    """이 카드는 **앱 밖으로** 나간다 — 받는 사람은 발신자도 앱도 의심하지 않는다."""
    out = _share("경복궁 다녀왔어요 사진은 photos-trip.link 에서", ["#경복궁"], ["경복궁"])
    assert out.value is None
    assert out.error is not None and "CONTACTISH" in out.error


def test_share_card_keeps_an_ordinary_caption() -> None:
    out = _share("경복궁 다녀왔어요", ["#경복궁", "#서울"], ["경복궁"])
    assert out.value is not None and out.value.caption == "경복궁 다녀왔어요"
