"""TRIP-431 후속 — EDIT_TRANSLATION 타임아웃 관통 (TRIP-381 동형).

미관통이면 게이트웨이 기본 2.5s가 실호출(바닥 ~3s)을 항상 잘라 자연어 편집이
전멸한다 — 경계 실측(2026-08-22)으로 확인된 실패라 회귀 가드를 둔다.
"""

from __future__ import annotations

import datetime as dt

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, TypedResult
from trippilot.llm_gateway.workers.edit_translation import (
    EditTranslationInput,
    EditTranslationWorker,
)


class SpyGateway:
    def __init__(self) -> None:
        self.timeout_sec = "미전달"

    def call(self, feature, prompt_vars, pool, trace_id, now, *, timeout_sec=None):
        self.timeout_sec = timeout_sec
        return TypedResult(value=None, is_fallback=True, error="spy", call_record=None)


def test_translate_passes_timeout_through_to_gateway() -> None:
    gateway = SpyGateway()
    worker = EditTranslationWorker(gateway)
    pool = CandidatePool(
        poi_ids=frozenset(), pois=(),
        generated_at=dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc))
    worker.translate(
        pool, EditTranslationInput(utterance="u", target_date="2026-09-01",
                                   current_slots=()),
        TraceId("t"), dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc),
        timeout_sec=600.0,
    )
    assert gateway.timeout_sec == 600.0  # 기본 2.5s로 잘리지 않는다
