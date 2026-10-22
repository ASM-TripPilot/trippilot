"""DialogueAnswerWorker — 도우미 답변 문장 생성, 경량 티어 (assistant-orchestrator FD DE §2.3·§2.10·§6).

오케스트레이터가 모은 Facts(확인된 사실) 로 사용자에게 보일 2~4문장을 쓴다. 시각·거리·장소명은 전부
Facts 에서 복사된 값이고 LLM 이 만드는 것은 문장(text·footnote)뿐이다 — 입력 조립(Facts·여행 요약·기억
렌더)은 호출측(orchestrator/dialogue_handlers·dialogue_orchestrator) 몫, 워커는 받은 것을 str 로 눌러
프롬프트에 싣는 것까지만 (reflection_nudge 워커와 같은 전제).

실패·게이트 드롭·시한 부족이면 폴백 TypedResult 를 그대로 반환 (BR-U4-09). 답이 비는 침묵 실패는
금지(INV-4) — 폴백 문장의 **사용**은 호출측 소유지만, 결정론 문장은 여기서 정의한다:
`fallback_answer_text(intent, facts)` (백엔드 AssistantTemplates·QueryCards·ProposalCards·IntentDispatcher
문구 이식). 전 의도 × 어떤 facts 에서도 게이트 규칙을 스스로 만족한다 (테스트가 고정).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Protocol

from trippilot.domain.common import TraceId
from trippilot.domain.intent import Intent
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gates.base import has_contact_like, has_injection_like
from trippilot.llm_gateway.gates.dialogue_answer import _DURATION_EN
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import NO_TRIP, NONE, render_history

# `$style` — 워커 모듈 상수, 설정화하지 않는다 (FD DE §6). 게이트 규칙을 말로 풀어 모델에 준다.
# 한 줄·단일 공백으로 둔다 — 워커가 `inline()` 으로 눌러 싣으므로 그래야 렌더 결과에 이 문자열이 그대로 있다.
# 2026-10-19 친근한 대화체(prompts/dialogue_answer.yaml 0.3.0): 숫자 말("두 분이"·"이 시간에는")은 공유 정규식
# `_TIME_EXPR` 가 소요 표현으로 읽는 오탐 자리라 여기서도 피하게 한다.
ANSWER_STYLE = (
    "친근한 해요체 대화, 2~4문장(어울릴 때만 내용에 맞는 공감 → 답 → 질문과 이어지는 제안 하나), 평문, 줄바꿈만 사용, "
    "마크다운·링크·연락처 금지, 소요시간·시각 추정 금지, 인원·시간 길이를 우리말 수(두 분·이 시간)로 쓰지 않기, "
    "확인된 사실에 없는 장소·수치·특징 금지"
)

# 여행이 없는데 여행이 필요한 의도 — BE AssistantTemplates.needTrip 과 같은 문구 (BR-U8-05)
NEED_TRIP_TEXT = "먼저 여행을 만들거나 숙소를 등록하면 일정을 함께 볼 수 있어요."

# 의도별 결정론 문장 — BE 화면 문장 이식(IntentDispatcher handoff·QueryCards info·AssistantTemplates);
# SHOW_SCHEDULE 의 OK 문구만 BE 에 없어 이 FD 가 신설(BLM §5 ★). 정본은 이 파일이다.
# SUGGEST_ALTERNATIVE 는 대상 이름이 들어가 함수에서 만든다 (ProposalCards.alternatives 문구).
# 넘기기 6의도(GENERATE_SCHEDULE·REGENERATE·REPLAN·회고 3종)는 사실이 없어 LLM 없이 이 문장이 그대로 나간다(BR-AO-25) —
# 안내 한 문장 + 아래 버튼으로 이끄는 제안(2026-10-19 친근한 말투). BE IntentDispatcher 원문도 같은 문장이다(한 벌).
_ANSWER_TEXT: dict[Intent, str] = {
    Intent.GET_NEXT_SLOT: "다음 장소예요.",
    Intent.GET_WEATHER: "오늘 예보예요.",
    # 일정 밖 장소·구간도 답한다(2026-10-20 — 등록 장소를 이름으로 찾는다) — "일정에 있는"·"일정에 적힌"은 그때 틀린 말이라 뺐다
    Intent.GET_DISTANCE: "두 곳 사이 거리를 찾아봤어요.",
    Intent.GET_POI_INFO: "장소 정보를 찾아봤어요.",
    # TEXT 종류라 카드가 없다 — 요약 문장 없이 "정리했어요"라 할 수 없어 일정 화면 넘기기로 (QueryCards 넘기기 꼴)
    Intent.SHOW_SCHEDULE: "일정은 일정 화면에서 확인할 수 있어요.",
    Intent.EDIT_SCHEDULE: "일정은 편집 화면에서 바꿀 수 있어요.",
    Intent.GENERATE_SCHEDULE: "일정 만들기 화면으로 안내해 드릴게요. 아래 버튼을 누르면 바로 시작해요.",
    Intent.REGENERATE: "일정은 만들기 화면에서 다시 만들 수 있어요. 아래 버튼을 누르면 바로 시작해요.",
    Intent.REPLAN: "남은 일정은 다시 짜기에서 지금 상황에 맞게 바꿀 수 있어요. 아래 버튼을 누르면 바로 시작해요.",
    Intent.GENERATE_REFLECTION: "회고는 기록 화면에서 만들 수 있어요. 아래 버튼을 누르면 기록이 열려요.",
    Intent.TRIP_SUMMARY: "여행 요약은 기록 화면에서 볼 수 있어요. 아래 버튼을 누르면 바로 열려요.",
    Intent.STYLE_ANALYSIS: "여행 스타일은 기록에서 볼 수 있어요. 아래 버튼을 누르면 바로 열려요.",
    Intent.EXPLORE_PLACES: "가 볼 만한 곳을 찾아봤어요.",
    Intent.RECOMMEND_PLACES: "가 볼 만한 곳을 골라 봤어요.",
    Intent.RECOMMEND_REGION: "취향에 맞을 만한 지역을 골라 봤어요.",
    Intent.OUT_OF_SCOPE: "그건 제가 도와드리기 어려워요.",
}

# 같은 뜻의 다른 말 — 결정론 문장이 직전 도우미 말과 똑같으면 이 중 아직 안 쓴 것으로 바꾼다(`unrepeated`). 버튼·뜻은 그대로,
# 말만 바꾼다(2026-10-22 사용자 "계속 같은 말만 내뱉는다, 너무 형식적"). 첫 문장(원문)은 BE 화면 문장과 한 벌이라 그대로 둔다.
_VARIANTS: dict[str, tuple[str, ...]] = {
    _ANSWER_TEXT[Intent.GENERATE_SCHEDULE]: ("새 일정은 만들기 화면에서 시작하면 돼요. 아래 버튼으로 바로 가 볼까요?",
                                             "일정 만들기부터 같이 해 봐요. 아래 버튼을 누르면 시작돼요."),
    _ANSWER_TEXT[Intent.REGENERATE]: ("다시 만들고 싶으면 만들기 화면에서 처음부터 짤 수 있어요. 아래 버튼으로 가 보세요.",
                                      "마음에 안 들면 새로 짜 봐요. 아래 버튼을 누르면 다시 만들기가 열려요."),
    _ANSWER_TEXT[Intent.REPLAN]: ("상황이 바뀌었으면 다시 짜기로 남은 일정을 맞춰 볼 수 있어요. 아래 버튼으로 시작해요.",
                                  "남은 일정은 지금 상황에 맞춰 다시 짤 수 있어요. 아래 버튼을 눌러 보세요."),
    _ANSWER_TEXT[Intent.GENERATE_REFLECTION]: ("오늘을 돌아보는 회고는 기록 화면에서 남길 수 있어요. 아래 버튼으로 열어 볼까요?",
                                               "회고 쓰기는 기록에서 할 수 있어요. 아래 버튼을 누르면 바로 열려요."),
    _ANSWER_TEXT[Intent.TRIP_SUMMARY]: ("이번 여행을 한눈에 보려면 기록의 여행 요약을 열어 보세요. 아래 버튼으로 바로 가요.",
                                        "여행 요약은 기록에 정리돼 있어요. 아래 버튼을 누르면 열려요."),
    _ANSWER_TEXT[Intent.STYLE_ANALYSIS]: ("내 여행 스타일은 기록에 정리돼 있어요. 아래 버튼으로 바로 볼 수 있어요.",
                                          "다닌 기록으로 본 여행 스타일은 아래 버튼을 누르면 열려요."),
    _ANSWER_TEXT[Intent.SHOW_SCHEDULE]: ("일정 화면을 열면 전체 일정을 한눈에 볼 수 있어요.", "잡혀 있는 일정은 일정 화면에 다 있어요."),
    _ANSWER_TEXT[Intent.EDIT_SCHEDULE]: ("바꾸고 싶은 곳은 편집 화면에서 직접 고칠 수 있어요.", "일정 편집 화면에서 넣고 빼기를 할 수 있어요."),
    _ANSWER_TEXT[Intent.OUT_OF_SCOPE]: ("그건 아직 제가 할 수 없는 일이에요.", "아쉽지만 그 부분은 도와드리기 어려워요."),
    NEED_TRIP_TEXT: ("여행을 하나 만들거나 숙소를 등록하면 일정을 같이 챙겨 드릴 수 있어요.",
                     "일정을 함께 보려면 먼저 여행을 만들어 주세요. 숙소를 등록해도 돼요."),
}


def unrepeated(text: str, recent: Iterable[str]) -> str:
    """직전 도우미 말들(`recent`)에 똑같이 있는 결정론 문장이면 아직 안 쓴 같은 뜻의 다른 말로. 변형이 없거나 다 썼으면 원문
    (같은 말을 지어내지 않는다 — 변형은 전부 사람이 적은 문장). LLM 이 지은 문장은 표에 없어 그대로 지나간다."""
    used = set(recent)
    if text not in used:
        return text
    return next((alt for alt in _VARIANTS.get(text, ()) if alt not in used), text)


# status EMPTY — 결과가 없는데 "예보예요"라 하지 않는다 (BE QueryCards·ProposalCards 의 빈 결과 넘기기 문구).
# 표에 없는 의도(넘기기 계열)는 결과라는 것이 없어 _ANSWER_TEXT 그대로.
_EMPTY_TEXT: dict[Intent, str] = {
    Intent.GET_NEXT_SLOT: "남은 일정이 없어요.",
    Intent.SHOW_SCHEDULE: "아직 일정에 장소가 없어요.",
    Intent.GET_WEATHER: "지금 날씨를 확인할 수 없어요.",
    Intent.GET_DISTANCE: "그 구간 거리는 아직 확인하지 못했어요.",
    Intent.GET_POI_INFO: "그 장소는 아직 찾지 못했어요.",
    Intent.SUGGEST_ALTERNATIVE: "근처에서 대신할 곳을 찾지 못했어요.",
    Intent.EXPLORE_PLACES: "그 조건에 맞는 곳을 아직 찾지 못했어요.",
    Intent.RECOMMEND_PLACES: "그 조건에 맞는 곳을 아직 찾지 못했어요.",
    Intent.RECOMMEND_REGION: "말씀하신 취향에 꼭 맞는 지역은 아직 고르지 못했어요.",
}
# EXPLORE_PLACES 의 앵커(지역·일정·여행 목적지)가 하나도 없을 때 — 지역 되묻기 문안(요청당 1회, BR-AO-27)이자 이미 물은 뒤의 결정론 답
EXPLORE_ASK_REGION_TEXT = "어느 지역에서 찾아 드릴까요? '부산'이나 '제주 애월'처럼 알려 주세요."
# RECOMMEND_REGION 에 취향(대화 문맥)도 말한 바람도 없을 때 — 고를 근거가 없으니 묻는다(사실 없음 → LLM 0)
REGION_ASK_TASTE_TEXT = "어떤 여행을 좋아하세요? 바다·맛집·역사처럼 알려 주시면 맞는 지역을 골라 드릴게요."
# status UNAVAILABLE — 출처 불통 (BE FallbackCause.SOURCE_UNAVAILABLE 문구)
_UNAVAILABLE_TEXT = "지금 일부 정보를 확인할 수 없어요."

_FALLBACK_TARGET = "그 장소"  # ProposalCards: `slot.nameKo ?: "그 장소"`
# EXPLORE_PLACES 가 행사를 찾았을 때 — 카드가 없어 결정론 문장이 행사를 늘어놓는다(이름은 대상 장소와 같은 검사, 기간은 날짜 꼴만)
_EVENTS_TEXT = "그 기간에 열리는 행사예요."
_PERIOD = re.compile(r"(?:\d{4}년 )?\d{1,2}월 \d{1,2}일(?:~(?:\d{4}년 )?\d{1,2}월 \d{1,2}일)?")
_MAX_EVENTS_LISTED = 5
_MAX_TARGET_CHARS = 40  # 대상 이름 상한 — 긴 이름은 BE 도 카드 제목에서 자른다


class _Turn(Protocol):
    """recent_turns 항목 — FD DE §2.1 RecentTurn·api DialogueTurnSchema 가 둘 다 이 모양이다."""

    @property
    def role(self) -> str: ...
    @property
    def text(self) -> str: ...


def _lines(items: Sequence[str], empty: str) -> str:
    rendered = [f"- {inline(s)}" for s in items if inline(s)]
    return "\n".join(rendered) or empty


def build_dialogue_answer_vars(
    intent: Intent,
    facts: Mapping[str, object],
    utterance: str,
    recent_turns: Sequence[_Turn],
    memory_lines: Sequence[str],
    trip_summary: str,
    style: str = ANSWER_STYLE,
) -> dict[str, str]:
    """값 전부 str·결정론(facts 는 키 정렬)·좌표 미포함(호출측이 넣지 않는다 — FD DE §2.5).

    제3자 문자열(발화·최근 대화·기억·facts 의 장소명)은 `inline()` 으로 한 줄로 — 프롬프트 골격 위조 차단
    (test_prompt_structure_forgery 계약). facts 는 JSON 이라 줄바꿈은 이미 이스케이프되지만 U+2028 같은
    유니코드 줄 구분자는 json 이 그대로 두므로 inline() 이 필요하다.
    """
    return {
        "intent": intent.value,
        # default=str: date·Decimal 같은 값은 그 문자열 표기가 곧 사실의 올바른 렌더다
        "facts": inline(json.dumps(facts, ensure_ascii=False, sort_keys=True, default=str)),
        "utterance": inline(utterance) or NONE,
        "history": render_history(recent_turns),  # 분류 워커와 같은 줄 — 사전·렌더러는 그쪽 한 곳
        "memory": _lines(memory_lines, NONE),
        "trip": inline(trip_summary) or NO_TRIP,
        "style": inline(style),
    }


def _safe_target(raw: object) -> str:
    """대상 장소 이름 — 웹 수집분이라 게이트(시간 표현·연락처·주입 꼴·길이)를 못 넘는 이름이면 BE 와 같은 대명사로."""
    name = inline(str(raw)) if raw else ""
    if (
        not name
        or len(name) > _MAX_TARGET_CHARS
        or _TIME_EXPR.search(name) is not None
        or _DURATION_EN.search(name) is not None  # 게이트 ③′ — "0H"·"30 min" 같은 이름이 결정론 문장을 스스로 막지 않게
        or has_contact_like(name)
        or has_injection_like(name)  # 게이트 ⑤ — "탈옥 방탈출카페"·"[여행] 게스트하우스" 같은 이름이 템플릿을 스스로 막지 않게
    ):
        return _FALLBACK_TARGET
    return name


def fallback_answer_text(intent: Intent, facts: Mapping[str, object]) -> str:
    """INV-4 마지막 계단 — LLM 실패·게이트 드롭·시한 부족 시 그대로 보일 결정론 문장.

    읽는 facts 키(전부 선택): `needs_trip`(참이면 여행 없음 안내) · `status`("EMPTY"|"UNAVAILABLE" 만 분기)
    · `target`(SUGGEST_ALTERNATIVE 의 대상 장소 표시명) · `events`(EXPLORE_PLACES 가 찾은 행사 — 카드가 없어 이름·기간을 늘어놓는다,
    대상 장소와 같은 검사) · `names`(탐색·추천 카드의 장소 이름 — 대상 장소와 같은 검사, 이어 묻기가 도우미 말에서 보인 곳을 뺀다).
    나머지 키는 보지 않는다 — 문장에 사실을 섞으면
    게이트 자가 만족을 보장할 수 없다(INFO 카드의 값은 payload 로 간다).
    """
    if facts.get("needs_trip"):
        return NEED_TRIP_TEXT
    status = facts.get("status")
    if status == "UNAVAILABLE":
        return _UNAVAILABLE_TEXT
    if status == "EMPTY" and intent in _EMPTY_TEXT:
        return _EMPTY_TEXT[intent]
    if intent is Intent.SUGGEST_ALTERNATIVE:
        return f"{_safe_target(facts.get('target'))} 대신 갈 만한 곳이에요."
    if facts.get("events"):  # 의도와 무관 — 탐색을 감싸는 의도(추천)가 의도만 바꿔 내도 행사가 보인다
        return _events_text(facts["events"])
    if facts.get("names") and intent in (Intent.EXPLORE_PLACES, Intent.RECOMMEND_PLACES, Intent.RECOMMEND_REGION):
        return _names_text(_ANSWER_TEXT[intent], facts["names"])
    return _ANSWER_TEXT[intent]


def _names_text(lead: str, names: object) -> str:
    """후보 카드 이름을 안내 문장 뒤에 — 이어 묻기("더 알려줘")는 도우미 말에 적힌 이름으로 보인 곳을 뺀다(`_shown_before`). 폴백 문장에
    이름이 없으면 같은 곳이 다시 나왔다(2026-10-22 테스트 화면, 답변 LLM 시한 초과 턴). 검사를 못 넘는 이름은 뺀다."""
    listed = [n for n in (_safe_target(x) for x in (names if isinstance(names, (list, tuple)) else ())) if n != _FALLBACK_TARGET]
    return f"{lead} {', '.join(listed[:_MAX_EVENTS_LISTED])}." if listed else lead


def _events_text(events: object) -> str:
    """행사 목록 한 줄 — 검사를 못 넘는 이름은 빼고(없으면 안내 문장만), 기간은 날짜 꼴일 때만 붙인다. ≤5건이라 400자 안."""
    listed = []
    for e in events if isinstance(events, (list, tuple)) else ():
        name = _safe_target(e.get("name")) if isinstance(e, Mapping) else _FALLBACK_TARGET
        if name != _FALLBACK_TARGET:
            period = e.get("period")
            listed.append(f"{name}({period})" if isinstance(period, str) and _PERIOD.fullmatch(period) else name)
    return f"{_EVENTS_TEXT} {', '.join(listed[:_MAX_EVENTS_LISTED])}." if listed else _EVENTS_TEXT


class DialogueAnswerWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def compose(
        self,
        intent: Intent,
        facts: Mapping[str, object],
        utterance: str,
        recent_turns: Sequence[_Turn],
        memory_lines: Sequence[str],
        trip_summary: str,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float,
        style: str = ANSWER_STYLE,
    ) -> TypedResult:
        """`timeout_sec` 은 오케스트레이터가 내린 잔여 시한 (DL-4) — 벤더 요청까지 그대로 간다."""
        return self._gateway.call(
            LlmFeature.DIALOGUE_ANSWER,
            build_dialogue_answer_vars(
                intent, facts, utterance, recent_turns, memory_lines, trip_summary, style
            ),
            None,  # 후보 선택 없음 — 풀 불필요 (사실은 Facts 가 닫힌 목록으로 든다)
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
