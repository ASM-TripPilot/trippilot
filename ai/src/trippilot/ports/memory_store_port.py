"""MemoryStorePort + DialogueMemory — 도우미 장기 기억 콘센트 (assistant-orchestrator FD DE §2.6·§4).

`DialogueMemory` 는 세션(백엔드 `assistant_session.session_id`) 하나당 요약 ≤20줄의 기록이다.
ports·`agents/adapters/*memory_store.py`·`orchestrator/dialogue_memory.py` 가 같은 타입을 써야
하는데 ports 와 어댑터는 orchestrator 를 import 할 수 없다(L-1·L-6, `tests/test_architecture.py`).
포트 모듈 안 dataclass 정의 선례(`llm_port.py` LlmRequest/LlmResponse · `vector_store_port.py`
VectorHit)를 따라 여기 둔다(FD DE §2.6 도 이 위치) — orchestrator 모듈이 다시 export 한다. stdlib 만.

구현 2종: `agents/adapters/pg_memory_store.py`(운영, ai_kb.dialogue_memory) ·
`agents/adapters/memory_memory_store.py`(테스트·DSN 없는 로컬). 구현은 예외를 던질 수 있고
삼키는 것은 오케스트레이터 몫이다 — 읽기 실패는 "기억 없이 진행", 쓰기 실패는
`FallbackEvent(stage="memory")`(BR-AO-09); 경계(`DELETE/GET /ai/v1/dialogue/memory`)는 500 으로
올려 백엔드가 재시도한다(DATA-U8-02).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.domain.serialization import from_iso, to_iso

SUMMARY_MAX_LINES = 20
SUMMARY_LINE_CHARS = 120


@dataclass(frozen=True, slots=True)
class DialogueMemory:
    """한 세션의 장기 기억. 길이 상한은 여기(애플리케이션 불변식)에만 있고 DB CHECK 는 없다 (FD DE §4)."""

    session_id: str  # 백엔드 assistant_session.session_id (PK)
    account_ref: str | None  # 불투명 — 로그·프롬프트 금지, 저장 칸과 "지난 여행 기억" 조회 키로만
    trip_id: str | None
    summary: tuple[str, ...]  # ≤ 20 줄 · 줄 ≤ 120 자 · 빈 줄 없음 · 중복 없음
    summarized_turn_index: int  # ≥ 0 — 이 요약이 덮은 마지막 turn_index
    updated_at: datetime  # tz-aware
    expires_at: datetime  # = updated_at + 90 일 (BE DATA-U8-01 과 같은 값) — put 마다 연장

    def __post_init__(self) -> None:
        if not self.session_id:
            raise ValueError("session_id 가 비었다")
        if self.summarized_turn_index < 0:
            raise ValueError(f"summarized_turn_index 는 0 이상: {self.summarized_turn_index}")
        if self.updated_at.tzinfo is None or self.expires_at.tzinfo is None:
            raise ValueError("naive datetime 은 받지 않는다 — tz-aware 만 (updated_at·expires_at)")
        if self.expires_at <= self.updated_at:
            raise ValueError("expires_at 은 updated_at 뒤여야 한다")
        object.__setattr__(self, "summary", tuple(self.summary))  # list 로 와도 해시 가능하게
        if len(self.summary) > SUMMARY_MAX_LINES:
            raise ValueError(f"요약 {len(self.summary)}줄 — 상한 {SUMMARY_MAX_LINES}줄")
        if len(set(self.summary)) != len(self.summary):
            raise ValueError("요약에 중복 줄이 있다")
        for line in self.summary:
            if not line.strip():
                raise ValueError("요약에 빈 줄이 있다")
            if "\n" in line or "\r" in line:
                raise ValueError("요약 줄 안에 줄바꿈이 있다")
            if len(line) > SUMMARY_LINE_CHARS:
                raise ValueError(f"요약 줄 {len(line)}자 — 상한 {SUMMARY_LINE_CHARS}자")

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "account_ref": self.account_ref,
            "trip_id": self.trip_id,
            "summary": list(self.summary),
            "summarized_turn_index": self.summarized_turn_index,
            "updated_at": to_iso(self.updated_at),
            "expires_at": to_iso(self.expires_at),
        }

    @classmethod
    def from_dict(cls, data: dict) -> DialogueMemory:
        return cls(
            session_id=data["session_id"],
            account_ref=data.get("account_ref"),
            trip_id=data.get("trip_id"),
            summary=tuple(data["summary"]),
            summarized_turn_index=data["summarized_turn_index"],
            updated_at=from_iso(data["updated_at"]),
            expires_at=from_iso(data["expires_at"]),
        )


def delete_selector(
    *, session_id: str | None, trip_id: str | None, account_ref: str | None
) -> tuple[str, str]:
    """`delete` 의 "셋 중 정확히 하나" 규칙 — 구현 둘이 같은 검사를 공유한다. (필드명, 값) 을 돌려준다.

    백엔드 파기 경로 3종(이력 지우기=session_id · 여행 삭제=trip_id · 계정 삭제=account_ref, FD DE §4.1)이
    각각 하나씩 넘긴다. 둘 이상이나 없음은 경계에서 422 지만 어댑터도 스스로 막는다 — 값은 메시지에
    싣지 않는다(account_ref 로그 금지).
    """
    given = {
        name: value
        for name, value in (
            ("session_id", session_id),
            ("trip_id", trip_id),
            ("account_ref", account_ref),
        )
        if value is not None
    }
    if len(given) != 1:
        raise ValueError(
            f"delete 는 session_id·trip_id·account_ref 중 정확히 하나만 받는다 — 받은 것: {sorted(given)}"
        )
    return next(iter(given.items()))


class MemoryStorePort(Protocol):
    def get(self, session_id: str) -> DialogueMemory | None: ...

    def put(self, memory: DialogueMemory) -> None:
        """upsert + 만료 연장(memory.expires_at 을 그대로 쓴다) + 같은 호출 안에서 만료 행 정리 1회(필수 — TTL 백스톱)."""
        ...

    def recent_for_account(
        self, account_ref: str, *, exclude_session: str, limit: int
    ) -> tuple[DialogueMemory, ...]:
        """같은 계정의 다른 세션 기억, updated_at DESC(동점 session_id 사전순). account_ref 가 None 인 행은 안 나온다."""
        ...

    def delete(
        self,
        *,
        session_id: str | None = None,
        trip_id: str | None = None,
        account_ref: str | None = None,
    ) -> int:
        """셋 중 정확히 하나 — 아니면 ValueError. 지운 행 수 (없으면 0, 멱등)."""
        ...

    def purge_expired(self, now: datetime) -> int:
        """`expires_at <= now` 인 행을 지우고 그 수를 돌려준다 (TTL 백스톱)."""
        ...
