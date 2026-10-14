"""대화 해석 경계 ↔ 해석기 사영 (U8 FD §3).

와이어 스키마를 도메인 입력(`DialogueContext`·`TripView`)으로 풀고, 결과를 다시 와이어로
싼다. `wiring.py` 는 경합이 잦은 파일이라 변환을 여기 둔다 — 거기엔 위임 한 줄만 있다.
"""

from __future__ import annotations

from datetime import datetime, timezone

from trippilot.api import schemas
from trippilot.domain.common import TraceId
from trippilot.orchestrator.dialogue_interpreter import (
    DialogueContext,
    DialogueInterpreter,
    TripView,
)


def _trip_view(snapshot: schemas.DialogueContextSnapshot) -> TripView:
    """되묻기 보기의 재료 — 일수와 **아직 남은 순서대로의** 슬롯 이름."""
    days = 0
    if snapshot.trip is not None:
        days = (snapshot.trip.end_date - snapshot.trip.start_date).days + 1
    names: list[str] = []
    if snapshot.itinerary is not None:
        for day in snapshot.itinerary.days:
            names.extend(s.name for s in day.slots if s.name)
    return TripView(day_count=max(days, 0), slot_names=tuple(names))


def interpret(
    interpreter: DialogueInterpreter,
    request: schemas.DialogueInterpretRequest,
    tz: timezone,
) -> schemas.DialogueInterpretResponse:
    meta = request.request_meta
    now: datetime = meta.requested_at
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    result = interpreter.interpret(
        request.utterance,
        DialogueContext.from_dict(request.dialogue_context),
        _trip_view(request.context),
        TraceId(meta.request_id),
        now,
    )
    clarify = None
    if result.clarify is not None:
        c = result.clarify
        clarify = schemas.DialogueClarifySchema(
            frame_index=c.frame_index, argument=c.argument, question=c.question,
            options=list(c.options) if c.options is not None else None,
        )
    return schemas.DialogueInterpretResponse(
        outcome=result.outcome,
        frames=[
            schemas.DialogueFrameSchema(
                intent=f.intent.value, arguments=dict(f.arguments), missing=list(f.missing),
                confidence=max(0.0, min(1.0, f.confidence)), match_route=f.match_route,
            )
            for f in result.frames
        ],
        clarify=clarify,
        dialogue_context=result.context.to_dict(),
        llm_calls=result.llm_calls,
    )
