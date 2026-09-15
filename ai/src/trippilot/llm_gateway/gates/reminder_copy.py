"""REMINDER_COPY 출구 게이트 — 리마인드 알림 문구 1건(title/body).

산출물은 사용자에게 보이는 **알림 문구**다. 표시 안전성(길이·금지 토큰)에 더해
**장소 대조**를 한다 — 문구가 그날 일정에 없는 곳을 말하면 사용자는 일정이 바뀐
줄 안다(INV-1 정신). 자유 한국어에서 장소를 추출하는 문제는 풀지 않는다: 모델이
언급한 장소를 `places` 로 **스스로 선언**하게 하고 그 선언을 대조한다
(edit_translation 의 affectedSlots 선례).

선언 회피를 막는 대칭 규칙이 하나 더 있다 — 같은 여행의 **다른 날 장소**가 본문에
있으면 선언 여부와 무관하게 드롭한다. 가장 흔한 실패(다른 날 일정을 오늘로 말하기)를
값싸게 잡는다. 세상의 모든 지명을 막지는 못하지만, 못 막는 몫은 폴백이 받는다.

위반은 전부 **드롭**(GateDropEvent) — 빈 결과는 실패이고, 알림 자체는 백엔드가
기존 상수로 보낸다(INV-4, 침묵 실패 금지).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    empty_result_error,
    strip_code_fence,
)

# 푸시 제목·본문 상한 (프롬프트의 "20자/60자"와 같은 값 — 테스트가 고정한다)
_MAX_TITLE = 20
_MAX_BODY = 60

# 소요시간·시각 계열 표시 금지 (INV-3). 부분 문자열 매칭 — 과잉 드롭은 폴백으로 안전.
_FORBIDDEN_TOKENS = ("분", "시간", "시각", "duration")


# 괄호 부기(동명이지역 구분 등)를 뗀 표시형. 수집 POI 이름의 8.5%가 괄호를 달고
# 있는데("약수암(부산)"·"금룡사(제주)"), 알림 문구에 그대로 쓰는 사람은 없다 —
# 모델은 declare 에 원본을 싣고 본문엔 줄여 쓴다. 그 자연스러운 축약을 "선언과
# 본문이 다르다"고 드롭하면 그 슬롯이 든 날은 매번 기본 문구로 떨어진다(겉으로는
# 모델 실패와 구분되지 않는다).
_PAREN = re.compile(r"[\(（][^)）]*[\)）]")

# 괄호 없이 뒤에 붙는 로마자 표기("사라오름 전망대 Sara Observatory"). Overture·OSM
# 출처가 이 관행을 쓴다 — 괄호 안에 넣는 TourAPI 와 다르다. 모델은 한국어 부분만
# 쓰므로 이것도 인정하지 않으면 그 출처의 장소가 든 날이 통째로 드롭된다.
_TRAILING_LATIN = re.compile(r"\s+[A-Za-z][A-Za-z'&.\- ]*$")
_HANGUL = re.compile(r"[가-힣]")


def _display_form(name: str) -> str:
    """사람이 문구에 쓸 법한 표시형 — 괄호 부기와 뒤따르는 로마자를 뗀다.

    로마자 제거는 **한글이 남을 때만** 한다. "Paris Baguette Cafe" 처럼 라틴 문자가
    본명인 곳까지 깎으면 이름이 사라진다.
    """
    stripped = _PAREN.sub("", name).strip()
    without_latin = _TRAILING_LATIN.sub("", stripped).strip()
    if without_latin and _HANGUL.search(without_latin):
        return without_latin
    return stripped


@dataclass(frozen=True, slots=True)
class ReminderCopyContext:
    """게이트 검증 컨텍스트 — `GatewayFacade.call` 의 pool 자리로 관통.

    allowed: 그날 일정의 장소명. 문구가 말해도 되는 전부.
    forbidden: 같은 여행의 **다른 날** 장소명. 본문에 나오면 드롭한다.
    """

    allowed: tuple[str, ...]
    forbidden: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ReminderCopyDraft:
    title: str
    body: str


class ReminderCopyGate:
    """REMINDER_COPY 출구 게이트 — {"title", "body", "places"} → ReminderCopyDraft."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # ReminderCopyContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, ReminderCopyContext):
            return GateOutcome(
                value=None,
                drop_event=None,
                error="gate_error: ReminderCopyContext 없음 (그날 슬롯 대조 집합 필요)",
            )
        ctx = pool
        try:
            data = json.loads(strip_code_fence(raw_text))
            if not isinstance(data, dict):
                raise ValueError("최상위가 객체가 아님")
            title = data["title"]
            body = data["body"]
            places = data.get("places", [])
            if not isinstance(title, str) or not isinstance(body, str):
                raise ValueError("title·body 가 문자열이 아님")
            if not isinstance(places, list) or any(not isinstance(p, str) for p in places):
                raise ValueError("places 가 문자열 배열이 아님")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        title = title.strip()
        body = body.strip()
        declared = tuple(p.strip() for p in places if p.strip())
        allowed = set(ctx.allowed)
        lowered = (title + body).lower()

        dropped = (
            not title
            or not body
            or len(title) > _MAX_TITLE
            or len(body) > _MAX_BODY
            or any(t in lowered for t in _FORBIDDEN_TOKENS)  # INV-3
            or any(name not in allowed for name in declared)  # INV-1
            or any(
                name not in body and _display_form(name) not in body
                for name in declared
            )  # 선언 정직성 — 괄호 부기를 뗀 표시형도 인정
            or any(name and name in body for name in ctx.forbidden)  # 선언 회피 차단
        )
        if dropped:
            drop_event = GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 문구 드롭은 풀 ID가 아님 (nudge·paraphrase 선례)
                total_count=1,
                dropped_count=1,
            )
            return GateOutcome(
                value=None,
                drop_event=drop_event,
                error=empty_result_error(None, drop_event),
            )
        return GateOutcome(
            value=ReminderCopyDraft(title=title, body=body), drop_event=None, error=None
        )
