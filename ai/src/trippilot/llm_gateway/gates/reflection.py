"""REFLECTION 출구 게이트 (정본 §2.3)."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, Mood, ReflectionDraft


class ReflectionGate:
    """REFLECTION 출구 게이트 (정본 §2.3) — 스키마만 강제 (poi 선택 없음, 풀 불필요).

    {"title": str, "body": str, "highlights": [str], "mood": GREAT|GOOD|OKAY|TIRED}
    """

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: JSON 아님: {e.msg}")
        try:
            if not isinstance(data, dict):
                raise ValueError("최상위가 객체가 아님")
            title, body = data.get("title"), data.get("body")
            highlights, mood = data.get("highlights"), data.get("mood")
            if not isinstance(title, str) or not title.strip():
                raise ValueError("title 비정상")
            if not isinstance(body, str) or not body.strip():
                raise ValueError("body 비정상")
            if not isinstance(highlights, list) or not all(
                isinstance(h, str) for h in highlights
            ):
                raise ValueError("highlights 비정상")
            try:
                mood_enum = Mood(mood)
            except ValueError:
                raise ValueError(f"mood가 enum 밖: {mood!r}") from None
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        draft = ReflectionDraft(
            title=title, body=body, highlights=tuple(highlights), mood=mood_enum
        )
        return GateOutcome(value=draft, drop_event=None, error=None)
