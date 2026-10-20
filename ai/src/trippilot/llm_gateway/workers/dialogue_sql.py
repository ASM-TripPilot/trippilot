"""DialogueSqlWorker — 도우미 장소 탐색의 말을 `poi_public` SELECT 한 문장으로 옮긴다(NL2SQL, 2026-10-20 사용자 결정).

출력은 출구 게이트(`DialogueSqlGate`)가 허용 목록으로 거른 SQL 문자열뿐이다 — 실행·행 상한·보여 줄 칸은 실행기(`pg_place_sql`)가,
사용자에게 보일 문장은 DIALOGUE_ANSWER 가 맡는다. 제3자 문자열(발화·인자)은 `inline()` 으로 한 줄씩 눌러 넣는다(골격 위조 차단).
실패·시한·깨진 출력·검사 탈락은 폴백 `TypedResult` 그대로 — 반경 탐색으로 내려가는 것은 호출측 몫이다(INV-4).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import NONE

SQL_ARGS = ("region", "category", "theme")  # 분류가 뽑은 탐색 인자 — category 는 호출측이 한글 종류('카페')로 바꿔 넘긴다


def build_dialogue_sql_vars(utterance: str, arguments: Mapping[str, str]) -> dict[str, str]:
    """프롬프트 변수 — 전부 str · 결정론(같은 입력 → 같은 dict)."""
    args = {k: inline(str(arguments[k])) for k in SQL_ARGS if arguments.get(k)}
    return {
        "utterance": inline(utterance) or NONE,
        "args": json.dumps(args, ensure_ascii=False) if args else NONE,
    }


class DialogueSqlWorker:
    """게이트 = `DialogueSqlGate()` — 호출측이 `GatewayFacade(llm, renderer, gate, c1_config, trace)` 로 조립한다."""

    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def write(
        self,
        utterance: str,
        arguments: Mapping[str, str],
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        """성공 value 는 검사를 통과한 SQL 문자열(빈 문자열 = 장소 조회로 답할 말이 아님)."""
        return self._gateway.call(
            LlmFeature.DIALOGUE_SQL,
            build_dialogue_sql_vars(utterance, arguments),
            None,  # 후보 풀 없음 — 닫힘은 DB 뷰가 본다(결과 행은 전부 등록 POI, INV-1)
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
