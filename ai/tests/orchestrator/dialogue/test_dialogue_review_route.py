"""TRIP-1705 — 일정 검토 질문("내일 일정에서 무리한 부분 있어?")은 BE 진행 검토 카드로 간다(FRAME SHOW_SCHEDULE, DEC-U8-14 · BR-AO-35).

문제는 솔버가 표기한 위반·구조적 사실뿐이다(BR-U8-14) — AI 스냅샷에는 위반 표기가 없으니 AI 가 판정하지 않고 BE 처리기에 넘긴다.
종전: 분류 null → 계획 gap OTHER → 지식 즉답(개발 서버 재현: "하루 7곳이라 꽤 빡빡한 편이에요" — 내일은 5곳) 또는 범위 밖 카드.
"""

from __future__ import annotations

import json

import pytest

from tests.orchestrator.dialogue.test_dialogue_orchestrator import _NO_TRIP, _build, _canned, _input
from trippilot.domain.dialogue.intent import Intent
from trippilot.domain.llm.llm import LlmFeature
from trippilot.orchestrator.dialogue import dialogue_orchestrator
from trippilot.orchestrator.dialogue.dialogue_orchestrator import RETRY_TEXT
from trippilot.orchestrator.intent.intent_router import normalize

_PLAN_OTHER = json.dumps({"calls": [], "refused": False, "gap": "OTHER"})
# 개발 서버(2026-11-02, dialogue_knowledge 0.1.2)가 실제로 낸 지식 답 — 사실이 아닌 판정이다
_KNOWLEDGE_JSON = json.dumps({"text": "일정 자체를 보면 하루 7곳이라 꽤 빡빡한 편이에요. 특히 이동이 많은 날은 체력이 금방 떨어질 수 "
                                      "있으니 중간중간 쉬는 시간을 넉넉히 두는 게 좋아요. 세부 시간이나 동선은 일정 화면에서 함께 "
                                      "확인해 볼 수 있어요.", "footnote": None}, ensure_ascii=False)


def _null_build():
    """분류 null → 계획 gap OTHER → 지식 즉답까지 조립된 운영 꼴 — 종전엔 이 길로 판정을 지어냈다."""
    return _build({**_canned(None, plan=_PLAN_OTHER), LlmFeature.DIALOGUE_KNOWLEDGE: _KNOWLEDGE_JSON},
                  with_planner=True, with_knowledge=True)


@pytest.mark.parametrize("utterance", ["내일 일정에서 무리한 부분 있어?", "일정 짠 거 괜찮은지 봐줘", "둘째 날 동선 빠듯하지 않아?"])
def test_review_question_the_classifier_closed_is_framed_for_the_backend_review_card(utterance: str) -> None:
    b = _null_build()
    out = b.orch.turn(_input(utterance))
    assert out.outcome == "FRAME" and out.answer is None and out.clarify is None
    (frame,) = out.frames
    assert frame.intent is Intent.SHOW_SCHEDULE and frame.missing == () and dict(frame.arguments) == {}
    assert frame.match_route == "LLM_DIRECT"  # BE 관측 칸 — 버튼(ACTION)이 아니라 말로 온 검토
    assert b.llm.features() == ["DIALOGUE_INTENT"] and out.llm_calls == 1  # 계획·지식 LLM 을 부르지 않는다 — 판정은 솔버 표기(BR-U8-14)


def test_review_question_with_an_invented_label_is_framed_like_a_null_classification() -> None:
    """분류가 목록 밖 라벨("REVIEW_SCHEDULE")을 지어내도, 범위 밖 라벨로 닫아도 판단은 한 것이다(`_plannable` — 계획 단계와 같은 입구)."""
    for label in ("REVIEW_SCHEDULE", "OUT_OF_SCOPE"):
        b = _build({LlmFeature.DIALOGUE_INTENT: json.dumps({"intent": label, "slots": {}, "confidence": 0.8}),
                    LlmFeature.DIALOGUE_PLAN: _PLAN_OTHER}, with_planner=True)
        out = b.orch.turn(_input("내일 일정에서 무리한 부분 있어?"))
        assert out.outcome == "FRAME" and out.frames[0].intent is Intent.SHOW_SCHEDULE, label
        assert b.llm.features() == ["DIALOGUE_INTENT"], label


def test_review_wording_on_a_show_schedule_classification_is_framed_but_plain_show_stays_an_answer() -> None:
    shown = json.dumps({"intent": "SHOW_SCHEDULE", "slots": {"date": "내일"}, "confidence": 0.7}, ensure_ascii=False)
    b = _build({**_canned(Intent.SHOW_SCHEDULE), LlmFeature.DIALOGUE_INTENT: shown})
    out = b.orch.turn(_input("내일 일정 검토해줘"))
    assert out.outcome == "FRAME" and out.frames[0].intent is Intent.SHOW_SCHEDULE
    assert dict(out.frames[0].arguments) == {"date": "내일"} and out.frames[0].confidence == 0.7  # 분류의 인자·신뢰도 그대로
    assert b.llm.features() == ["DIALOGUE_INTENT"]  # 일정 목록 답변 LLM 을 부르지 않는다
    plain = _build(_canned(Intent.SHOW_SCHEDULE, date="내일")).orch.turn(_input("내일 일정 보여줘"))
    assert plain.outcome == "ANSWER" and plain.frames[0].intent is Intent.SHOW_SCHEDULE  # 일정 보기는 종전 그대로


def test_review_route_leaves_change_requests_trip_less_turns_and_failures_alone() -> None:
    replan = _build(_canned(Intent.REPLAN)).orch.turn(_input("비 와서 내일 일정 무리일 것 같은데 다시 짜줘"))
    assert replan.outcome == "ANSWER" and replan.frames[0].intent is Intent.REPLAN  # 바꿔 달라는 말은 그 의도 몫
    edit = _build(_canned(Intent.EDIT_SCHEDULE, day="둘째 날", target="카페")).orch.turn(_input("둘째 날 일정 빡빡해서 카페 하나 빼줘"))
    assert edit.outcome == "FRAME" and edit.frames[0].intent is Intent.EDIT_SCHEDULE
    weather = _build(_canned(Intent.GET_WEATHER)).orch.turn(_input("내일 일정대로 가도 날씨 괜찮아?"))
    assert weather.outcome == "ANSWER" and weather.frames[0].intent is Intent.GET_WEATHER  # 검토 꼴이어도 다른 의도는 그대로
    general = _null_build().orch.turn(_input("하루에 7곳 가면 무리야?"))
    assert general.outcome != "FRAME"  # 내 일정을 가리키지 않는 말 — 지식 즉답 몫
    planning = _null_build().orch.turn(_input("여행 일정 짤 때 하루 몇 군데가 괜찮아?", snapshot=_NO_TRIP))
    assert planning.outcome != "FRAME"  # 여행 없이 묻는 일반 계획 질문 — 지식 즉답 몫(BR-AO-34)
    failed = _build({LlmFeature.DIALOGUE_INTENT: RuntimeError("vendor down")}).orch.turn(_input("내일 일정에서 무리한 부분 있어?"))
    assert failed.outcome == "ANSWER" and failed.answer.text == RETRY_TEXT  # 인프라 실패는 종전 다시 시도
    broken = _build({LlmFeature.DIALOGUE_INTENT: "not json at all"}).orch.turn(_input("내일 일정에서 무리한 부분 있어?"))
    assert broken.outcome == "OUT_OF_SCOPE"  # 깨진 출력은 판단이 아니다 — 2‴ 와 같은 입구라 종전 범위 밖


def test_review_question_without_a_trip_is_framed_so_the_backend_says_why(caplog) -> None:
    """검토할 일정이 없으면 이유가 있는 안내다(AC2·INV-4) — FRAME 을 넘기면 BE 가 여행 없는 일정 보기에 "먼저 여행을 만들거나…"로 답한다.
    종전엔 지식 즉답이 일반론으로 판정했다. 넘긴 턴은 로그로 센다(BE 저장 칸은 일정 보기와 같아 따로는 못 센다)."""
    with caplog.at_level("INFO"):
        out = _null_build().orch.turn(_input("내일 일정에서 무리한 부분 있어?", snapshot=_NO_TRIP))
    assert out.outcome == "FRAME" and out.frames[0].intent is Intent.SHOW_SCHEDULE
    (event,) = [json.loads(r.getMessage().split(" ", 1)[1]) for r in caplog.records
                if r.getMessage().startswith("dialogue_review_routed ")]
    assert event["classified"] is None and event["trip"] is False


@pytest.mark.parametrize("text,want", [
    ("내일 일정에서 무리한 부분 있어?", True), ("내일 일정 너무 빡빡하지 않아?", True), ("2일차 일정 괜찮아?", True),
    ("2일차 일정 괜찮아？", True), ("일정 문제없어?", True), ("내일 일정 체크해줘", True), ("일정이 빼곡한데 무리 없을까?", True),
    ("첫째 날 동선 괜찮을지 봐줘", True),
    # 반박 리뷰가 찾은 놓침(2026-11-03) — 일정 표지가 없거나 '문제점'·'괜찮은 거야'
    ("무리한 곳 있어?", True), ("내일 무리한 곳 있어?", True), ("내일 너무 무리한 거 아냐?", True), ("일정에 문제점 있어?", True),
    ("내 일정 괜찮은 거야?", True), ("검토해줘", True), ("점검해줘", True),
    ("내일 일정 보여줘", False), ("일정 너무 빡빡해서 하나 빼줘", False), ("비 와서 내일 일정 무리일 것 같은데 다시 짜줘", False),
    ("아니 일정 괜찮아", False), ("일정에 체크인 몇 시야?", False), ("하루에 7곳 가면 무리야?", False),
    ("내일 날씨 괜찮아?", False), ("해녀의집 괜찮아?", False),
    ("오늘 일정 마무리 어떻게 해?", False), ("코스모스 괜찮아?", False), ("어제 일정 힘들지만 재밌었어", False),
    # 반박 리뷰가 찾은 오탐(2026-11-03) — 일반 질문·허락 묻기·주제 질문·문제 알림·묻지 않는 말·만들어 달라는 말
    ("여행 일정 짤 때 하루 몇 군데가 괜찮아?", False), ("여행 계획 짤 때 하루에 몇 곳이 무리 없어?", False),
    ("계획 없이 가도 괜찮을까?", False), ("혼자 여행 계획인데 괜찮을까?", False), ("일정 끝나고 술 마셔도 괜찮을까?", False),
    ("점심에 짠 거 먹어도 괜찮을까?", False), ("일정 중에 주차 문제는 없어?", False), ("일정에 문제가 생겼어", False),
    ("오늘 무리했더니 피곤해", False), ("제주 3박4일 일정 빡빡하지 않아?", False),
    ("아이 동반 여행인데 빡빡하지 않게 일정 부탁해요", False),
])
def test_asks_review_needs_a_review_cue_a_schedule_cue_and_no_change_request(text: str, want: bool) -> None:
    assert dialogue_orchestrator.asks_review(normalize(text)) is want  # `_core` 처럼 정리한 말로 묻는다(전각 '？'도 NFKC 로 같다)
