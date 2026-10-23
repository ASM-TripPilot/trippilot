"""번호 출구 게이트 — 후보를 번호로 실었으니 번호를 poi_id 로 되돌린 뒤 안쪽 게이트 그대로.

REPLAN_COMPOSITION(`NumberedSelectionGate` → `AlternativeSelectionGate`)과 PREFERENCE_SCORING(`NumberedScoringGate` →
`ClosedSetGate`, 프롬프트 0.4.0)이 같은 번호 규칙(`numbered`)을 쓴다.

다시 짜기 구성 출력 글자의 36%가 후보 UUID 를 그대로 베끼는 것이었다(캡처 16건, 출력 ~650토큰·7.4s, 2026-10-21 —
`ai/docs/서빙-최적화-실적.md` §8). 프롬프트에는 `numbered(pool)` 순서의 번호(1부터)만 싣고, 모델은 `{"no": 번호}` 로 답한다.
번호 → poi_id 는 같은 풀을 같은 순서로 세면 다시 만들어지므로 상태가 없다. 풀 안 교차(INV-1)·중복·이유의 시간
표현 비움(INV-3)은 안쪽 게이트가 그대로 한다 — 목록 밖 번호는 풀 밖 ID 로 바꿔 넘겨 그 항목만 버려진다(항목 격리).
`poiId` 로 답해도(옛 판·테스트 가짜) 손대지 않고 넘긴다.
"""

from __future__ import annotations

import json
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.poi import Poi
from trippilot.llm_gateway.gates.alternative_selection import AlternativeSelectionGate
from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object
from trippilot.llm_gateway.gates.scoring import ClosedSetGate


def numbered(pool: CandidatePool) -> tuple[Poi, ...]:
    """후보 번호의 정본 순서 — 프롬프트 렌더(`build_compose_vars`)와 이 게이트가 같은 함수를 쓴다."""
    return tuple(sorted(pool.pois, key=lambda p: str(p.poi_id)))


def _as_index(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _renumbered(items: list, pool: CandidatePool) -> list:
    """`{"no": n}` → `{"poiId": ...}`. 목록 밖 번호는 풀 밖 ID(`no:n`)로 바꿔 안쪽 게이트가 그 항목만 버리게 한다."""
    order = numbered(pool)
    for item in items:
        if isinstance(item, dict) and "poiId" not in item and "no" in item:
            n = _as_index(item.pop("no"))
            item["poiId"] = str(order[n - 1].poi_id) if n is not None and 1 <= n <= len(order) else f"no:{n}"
    return items


class NumberedSelectionGate:
    def __init__(self) -> None:
        self._inner = AlternativeSelectionGate()

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if pool is not None:
            try:
                items = _load_json_object(raw_text, "selections")
            except ValueError:
                items = None  # 모양 오류는 안쪽 게이트가 종전과 같은 사유로 낸다
            if isinstance(items, list):
                raw_text = json.dumps({"selections": _renumbered(items, pool)}, ensure_ascii=False)
        return self._inner.apply(raw_text, pool, feature=feature, trace_id=trace_id, now=now)


class NumberedScoringGate:
    """PREFERENCE_SCORING — `{"scores":[{"no":1,"score":0.8}]}` 의 번호를 poi_id 로 되돌린 뒤 `ClosedSetGate` 그대로.

    점수 출력은 0.2.0 부터 이유 없이 {poiId, score} 뿐인데 그 글자의 대부분이 UUID 베끼기였다 — 5건 묶음 출력
    203~257 토큰 중 ≈185(2026-10-22 개발 파드 llm_cost). 프롬프트 렌더(`build_prompt_vars`)와 같은 `numbered(pool)`
    순서라 상태가 없다. 풀 안 교차(INV-1)·중복·클램프는 안쪽 게이트 몫이고, `poiId` 로 답해도(옛 판·테스트 가짜) 넘긴다.
    """

    def __init__(self) -> None:
        self._inner = ClosedSetGate()

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if pool is not None:
            try:
                items = _load_json_object(raw_text, "scores")
            except ValueError:
                items = None  # 모양 오류는 안쪽 게이트가 종전과 같은 사유로 낸다
            if isinstance(items, list):
                raw_text = json.dumps({"scores": _renumbered(items, pool)}, ensure_ascii=False)
        return self._inner.apply(raw_text, pool, feature=feature, trace_id=trace_id, now=now)
