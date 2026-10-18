"""도우미 장기 기억 — 요약 시점·결정론 압축·만료 계산 (assistant-orchestrator FD DE §2.6, 브리프 §2.2).

흐름(FD BLM 파이프라인 6단): `due(...)` 이고 잔여 시한 ≥ 2.5s 면 `DIALOGUE_MEMORY` LLM 요약, 실패·시한
부족이면 `compress_fallback` 으로라도 전진한다(INV-4 — 침묵 실패 금지의 마지막 계단). 저장은
`MemoryStorePort.put` — `expires_at_for(updated_at)` 로 만료가 쓰기마다 90일 뒤로 미끄러진다.

`DialogueMemory`·`MemoryStorePort` 의 정의는 `ports/memory_store_port.py` 에 있다 — ports·어댑터가
같이 쓰는 타입이라 이 계층에 둘 수 없다(L-1·L-6). 여기서 다시 export 해 브리프·tasks 가 적은
`orchestrator.dialogue_memory` import 경로도 성립한다.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta

from trippilot.llm_gateway.gates.base import has_contact_like
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import history_lines
from trippilot.ports.memory_store_port import (
    SUMMARY_LINE_CHARS,
    SUMMARY_MAX_LINES,
    DialogueMemory,
    MemoryStorePort,
)

__all__ = [
    "MEMORY_TTL_DAYS",
    "SUMMARY_EVERY_TURNS",
    "SUMMARY_LINE_CHARS",
    "SUMMARY_MAX_LINES",
    "DialogueMemory",
    "MemoryStorePort",
    "compress_fallback",
    "due",
    "expires_at_for",
]

MEMORY_TTL_DAYS = 90  # BE DATA-U8-01: assistant_session.expires_at = 마지막 턴 + 90일 — 같은 값
SUMMARY_EVERY_TURNS = 10


def expires_at_for(updated_at: datetime, *, ttl_days: int = MEMORY_TTL_DAYS) -> datetime:
    """쓰기 시각 기준 만료 — put 마다 다시 계산해 넣으니 슬라이딩 TTL 이 된다 (FD DE §4)."""
    return updated_at + timedelta(days=ttl_days)


def due(turn_index: int, summarized_turn_index: int, every: int = SUMMARY_EVERY_TURNS) -> bool:
    """요약할 차례인가 — 마지막 요약이 덮은 턴 뒤로 `every` 턴이 쌓였을 때. 기억이 없으면 summarized 는 0."""
    return turn_index - summarized_turn_index >= every


def compress_fallback(
    recent_turns: Iterable[object],
    previous: Sequence[str] = (),
    *,
    max_lines: int = SUMMARY_MAX_LINES,
    line_chars: int = SUMMARY_LINE_CHARS,
) -> tuple[str, ...]:
    """LLM 요약 없이 만드는 결정론 요약 — `previous` 줄 뒤에 최근 턴을 `- 사용자: …`/`- 도우미: …` 줄로 붙인다.

    `recent_turns` 는 `RecentTurn` 모양(`role`·`text`)이면 된다. 턴 줄은 워커들의 `$history` 와 **같은 렌더러**
    (`workers.dialogue_intent.history_lines` — `inline()` 으로 한 줄, 빈 턴은 줄이 되지 않음, 모르는 role 은 그대로 —
    역할 검증은 상류 `TurnInput` 몫)로 만들고, 각 줄을 `line_chars` 로 자른 뒤 **뒤에서부터** 보며 `max_lines` 줄만
    남긴다 — 최근 것이 우선이고 같은 줄은 최근 자리 하나만 남는다.
    멱등: 산출을 `previous` 로 다시 넣어도, 같은 턴을 다시 붙여도 같은 줄이다(두 번 적용 = 한 번).

    산출이 발화 조각(줄당 ≤`line_chars`)을 담는 점은 FD 미결 #10(SEC-U8-06, A안 현행) — 저장 전 게이트는
    `DialogueMemory` post-init 만이다.
    """
    lines = list(previous) + history_lines(recent_turns)
    kept: list[str] = []
    seen: set[str] = set()
    for raw in reversed(lines):
        line = inline(raw)[:line_chars].rstrip()
        # 요약 LLM 게이트(DialogueMemoryGate ③④)와 같은 술어 — 게이트가 줄을 전부 버리면 바로 이 압축이 돌기 때문에,
        # 여기서 거르지 않으면 게이트가 막은 연락처·링크·시간 표현이 원문으로 저장된다(2026-10-18 리뷰 재현).
        if not line or line in seen or _TIME_EXPR.search(line) is not None or has_contact_like(line):
            continue
        seen.add(line)
        kept.append(line)
        if len(kept) == max_lines:
            break
    kept.reverse()
    return tuple(kept)
