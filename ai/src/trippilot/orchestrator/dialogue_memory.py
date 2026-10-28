"""도우미 장기 기억 — 요약 시점·요약 재료·남길 줄·만료 계산 (assistant-orchestrator FD DE §2.6, 브리프 §2.2).

흐름(FD BLM §8, 2026-10-23 개정): 프롬프트에는 최근 대화 3턴(`PROMPT_TURNS`)만 싣고, 그보다 앞은 이 기억에서 꺼내 쓴다
(사용자 결정 "과거 대화는 사라지고 장기 기억에 담았다가 필요할 때 꺼낸다"). 그래서 요약은 창이 밀려나는 만큼 — 3턴마다
(`due`) 아직 요약하지 않은 턴만(`material`) — **답한 뒤 뒤에서** `DIALOGUE_MEMORY` 로 갱신한다. 실패하면 이전 기억을 그대로 두고
다음 턴에 다시 한다(FD 미결 #10 B안 — 대화 원문 조각을 저장하던 결정론 압축은 없앴다). 저장은 `MemoryStorePort.advance` —
`expires_at_for(updated_at)` 로 만료가 쓰기마다 90일 뒤로 미끄러진다.

`DialogueMemory`·`MemoryStorePort` 의 정의는 `ports/memory_store_port.py` 에 있다 — ports·어댑터가
같이 쓰는 타입이라 이 계층에 둘 수 없다(L-1·L-6). 여기서 다시 export 해 브리프·tasks 가 적은
`orchestrator.dialogue_memory` import 경로도 성립한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

from trippilot.llm_gateway.gates.base import has_contact_like, has_injection_like
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.dialogue_intent import PROMPT_TURNS, ROLE_LABELS, last_turns
from trippilot.ports.memory_store_port import (
    GIST_KIND,
    SUMMARY_LINE_CHARS,
    SUMMARY_MAX_LINES,
    DialogueMemory,
    MemoryStorePort,
    split_kind,
)

__all__ = [
    "MEMORY_TTL_DAYS",
    "SUMMARY_EVERY_TURNS",
    "SUMMARY_LINE_CHARS",
    "SUMMARY_MAX_LINES",
    "DialogueMemory",
    "MemoryStorePort",
    "due",
    "expires_at_for",
    "context_lines",
    "gist_lines",
    "is_turn_fragment",
    "legacy_lines",
    "kept_lines",
    "material",
]

MEMORY_TTL_DAYS = 90  # BE DATA-U8-01: assistant_session.expires_at = 마지막 턴 + 90일 — 같은 값
_CONTEXT_KINDS = frozenset({GIST_KIND, "결정", "미해결", None})  # 분류가 지시어를 푸는 데 늘 필요한 줄 — None = 0.2.0 이전 표지 없는 줄
# 프롬프트 창(최근 3턴)과 같은 턴 수 — 창에서 밀려나는 턴은 이미 기억에 있다. 뒤의 요약이 한 턴 늦게 끝나도 다음 턴의 창이
# 아직 요약하지 않은 턴을 다 담는다. 창에서 바로 나오게 둬 창을 바꾸면 주기도 따라간다.
SUMMARY_EVERY_TURNS = PROMPT_TURNS


def expires_at_for(updated_at: datetime, *, ttl_days: int = MEMORY_TTL_DAYS) -> datetime:
    """쓰기 시각 기준 만료 — put 마다 다시 계산해 넣으니 슬라이딩 TTL 이 된다 (FD DE §4)."""
    return updated_at + timedelta(days=ttl_days)


def due(turn_index: int, summarized_turn_index: int, every: int = SUMMARY_EVERY_TURNS) -> bool:
    """요약할 차례인가 — 마지막 요약이 덮은 턴 뒤로 `every` 턴이 쌓였을 때. 기억이 없으면 summarized 는 0."""
    return turn_index - summarized_turn_index >= every


def material(recent_turns: Sequence, turn_index: int, summarized_turn_index: int) -> tuple:
    """요약 재료 중 지난 턴 몫 — 아직 요약하지 않은 턴(summarized+1 … turn_index−1)의 메시지: 끝에서 (turn_index − summarized − 1)
    번째 사용자 말부터 끝까지. 건수(턴당 두 건)로 자르면 턴 밖 노트("적용했어요.")만큼 가장 오래된 미요약 사용자 말이 잘려 나간 채
    그 턴까지 요약했다고 적혔다(2026-10-23 리뷰 재현) — 그래서 사용자 말로 센다. 가려진 말이 있으면 이미 요약한 턴이 겹칠 뿐이다 —
    요약이 같은 사실을 한 줄로 합친다. 이번 턴(발화·답)은 호출측이 뒤에 붙인다."""
    return last_turns(recent_turns, turn_index - summarized_turn_index - 1)


def gist_lines(memory: DialogueMemory | None) -> tuple[str, ...]:
    """분류·답변에 늘 싣는 "요약" 줄(지금 대화가 무엇에 관한 것인지). 지시 주입 꼴은 뺀다 — 기억 게이트가 막기 전에 저장된 줄이
    TTL 90일 동안 남아 있을 수 있다."""
    if memory is None:
        return ()
    return tuple(line for line in memory.summary if split_kind(line)[0] == GIST_KIND and not has_injection_like(line))


def context_lines(memory: DialogueMemory | None) -> tuple[str, ...]:
    """분류에 늘 싣는 줄 — 이 대화를 잇는 "요약"·"결정"·"미해결" 줄과 0.2.0 이전 표지 없는 줄. 분류는 꺼내기를 기다리지 않는데,
    "아까 그 카페"처럼 창(최근 3턴)보다 앞의 장소를 가리키는 말은 결정·미해결 줄에 그 이름이 있어야 푼다(2026-10-23 리뷰 재현 —
    요약 줄만 실었더니 4턴 전 이름이 분류 프롬프트 어디에도 없었다). 지시 주입 꼴은 뺀다."""
    if memory is None:
        return ()
    return tuple(line for line in memory.summary
                 if split_kind(line)[0] in _CONTEXT_KINDS and not is_turn_fragment(line) and not has_injection_like(line))


def legacy_lines(memory: DialogueMemory | None) -> tuple[str, ...]:
    """0.2.0 이전 꼴(종류 표지 없음) 줄 — 벡터가 없어 꺼내기에 안 걸리므로 다시 요약될 때까지 종전처럼 싣는다. 옛 압축의 원문 조각과
    지시 주입 꼴은 뺀다."""
    if memory is None:
        return ()
    return tuple(line for line in memory.summary
                 if split_kind(line)[0] is None and not is_turn_fragment(line) and not has_injection_like(line))


def is_turn_fragment(line: str) -> bool:
    """옛 결정론 압축(2026-10-23 폐지)이 남긴 대화 원문 조각 줄인가 — `history_lines` 와 같은 꼴(`- 사용자: …`/`- 도우미: …`).
    그 줄은 TTL 90일 동안 남아 있을 수 있어, 다음 요약이 비운 배열을 내면 지운다(BR-AO-09 "원문 목록을 저장하지 않는다")."""
    return any(line.startswith(f"- {label}: ") for label in ROLE_LABELS.values())


def kept_lines(previous: Sequence[str], *, max_lines: int = SUMMARY_MAX_LINES) -> tuple[str, ...]:
    """요약 LLM 이 비운 배열("새로 기억할 것 없음")일 때 남길 이전 줄 — 요약 게이트와 같은 술어(시간 표현·연락처·지시 주입)로 다시
    거르고 옛 압축이 남긴 원문 조각 줄을 지운다. 순서와 첫 등장을 지킨다(결정론·멱등: 산출을 다시 넣어도 같다)."""
    kept: list[str] = []
    for raw in previous:
        line = inline(raw)
        # 요약 게이트(DialogueMemoryGate ③④)와 같은 술어 — 그 술어가 생기기 전에 저장된 연락처·소요시간 줄이 되살지 않게(2026-10-19 리뷰)
        if (not line or line in kept or len(line) > SUMMARY_LINE_CHARS or is_turn_fragment(line)
                or _TIME_EXPR.search(line) is not None or has_contact_like(line) or has_injection_like(line)):
            continue
        kept.append(line)
    return tuple(kept[:max_lines])
