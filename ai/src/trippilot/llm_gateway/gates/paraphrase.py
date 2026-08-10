"""PARAPHRASE 출구 게이트 (intent-matching-design §2 [2차]·§4 `llm.paraphrase_query`).

산출물은 사용자에게 보이지 않는 **재매칭용 질의 문자열 묶음**이다 (`tuple[str, ...]`).
poi 선택이 없어 후보 풀과 무관하고, 스키마만 강제한다 (reflection 게이트와 같은 형).

항목 격리(place_extraction 선례)를 쓴다 — 변형 3개 중 1개가 문자열이 아니라고
나머지 2개를 버릴 이유가 없다. 투표는 남은 변형 + 원문으로 계속 성립한다.

정리 3종:
  ① 문자열 아님·공백뿐 → 해당 항목만 격리 (빈 질의는 재매칭에서 의미가 없다)
  ② 중복 제거 (첫 등장 유지) — 같은 변형이 두 표를 행사하면 가중 투표가 부풀려진다
  ③ 개수 상한 `_MAX_QUESTIONS` — 모델이 요청 개수를 무시하고 쏟아내도 투표 가중치가
     한쪽으로 쏠리지 않게 자른다. 최종 개수 판정은 라우터(`n_paraphrase`)가 다시 한다.
전량 소멸이면 `value=()` + `error=None` — 게이트웨이가 폴백으로 전환한다 (INV-4).
"""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent

# 라우터 기본 N=3의 여유배 — 상한 자체는 게이트가 알 수 있는 유일한 방어선이다
# (게이트는 요청 개수를 보지 못한다 — raw_text만 받는다).
_MAX_QUESTIONS = 8


class ParaphraseGate:
    """PARAPHRASE 출구 게이트 — {"questions": [str]} → tuple[str, ...]."""

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
            items = _load_json_object(raw_text, "questions")
            if not isinstance(items, list):
                raise ValueError("questions가 배열이 아님")
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        survivors: list[str] = []
        dropped_count = 0
        for item in items:
            question = item.strip() if isinstance(item, str) else ""
            if not question or question in survivors:  # ①②
                dropped_count += 1
                continue
            if len(survivors) >= _MAX_QUESTIONS:  # ③ 상한 초과분도 드롭으로 계측
                dropped_count += 1
                continue
            survivors.append(question)

        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 유사질문 드롭은 풀 ID가 아님 — 환각률 지표 순수성 (선례 place_extraction)
                total_count=len(items),
                dropped_count=dropped_count,
            )
            if dropped_count
            else None
        )
        return GateOutcome(value=tuple(survivors), drop_event=drop_event, error=None)
