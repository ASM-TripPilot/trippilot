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

2026-10-23(사용자 결정 "과거 대화는 프롬프트에서 빠지고 장기 기억에 담았다가 필요할 때 꺼낸다"): 줄은 "종류: 내용" 꼴이고
(`MEMORY_KINDS`), 줄마다 임베딩을 같이 둬(`advance`) 이번 말과 가까운 줄만 꺼낸다(`search`). 벡터 행은 기억 행을 따라
지워진다(DB `ON DELETE CASCADE`) — 파기 3호출·TTL 이 그대로 걸린다(BR-AO-10).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.domain.serialization import from_iso, to_iso

SUMMARY_MAX_LINES = 20
SUMMARY_LINE_CHARS = 120
# 줄의 종류 — 닫힌 6종(요약 프롬프트·게이트·오케스트레이터가 이 한 곳을 본다). "요약" 줄은 분류·답변에 늘 싣고, 나머지 사실 줄은
# 이번 말과 관련된 것만 꺼낸다(BR-AO-09 개정 2026-10-23).
GIST_KIND = "요약"
MEMORY_KINDS = (GIST_KIND, "선호", "제약", "결정", "거절", "미해결")


def split_kind(line: str) -> tuple[str | None, str]:
    """`"선호: 조용한 카페"` → `("선호", "조용한 카페")`. 표지가 없거나 목록 밖이면 `(None, line)` — 0.2.0 이전 줄(표지 없음)도
    지울 필요 없이 사실 줄로 읽힌다."""
    head, sep, body = line.partition(":")
    if sep and head.strip() in MEMORY_KINDS and body.strip():
        return head.strip(), body.strip()
    return None, line


@dataclass(frozen=True, slots=True)
class MemoryHit:
    """`search` 한 건 — 그 세션 요약에 **지금 있는** 줄만 나온다(요약에서 빠진 줄의 옛 벡터는 걸리지 않는다)."""

    session_id: str
    line: str
    score: float  # 코사인 유사도


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


def check_vectors(vectors: Mapping[str, tuple[float, ...]] | None, model: str | None) -> None:
    """`advance` 의 벡터 인자 규칙 — 구현 둘이 같은 검사를 공유한다. 모델 없는 벡터는 검색에서 영영 안 걸린다."""
    if vectors is not None and not model:
        raise ValueError("vectors 를 주면 model(임베딩 모델 id)도 줘야 한다")


class MemoryStorePort(Protocol):
    def get(self, session_id: str) -> DialogueMemory | None: ...

    def put(self, memory: DialogueMemory) -> None:
        """upsert + 만료 연장(memory.expires_at 을 그대로 쓴다) + 같은 호출 안에서 만료 행 정리 1회(필수 — TTL 백스톱) + 요약에 없는
        줄의 벡터 정리. 오케스트레이터는 답하기 **전에** 빈 행을 만들 때만 쓴다 — 요약은 `advance` 로 뒤에서 쓴다."""
        ...

    def advance(
        self, memory: DialogueMemory, vectors: Mapping[str, tuple[float, ...]] | None = None, *, model: str | None = None,
    ) -> bool:
        """뒤에서 쓰는 요약 — **있는 행만**, `summarized_turn_index` 가 커질 때만 고친다. 없으면 False(그사이 지워진 대화를
        되살리지 않는다, BR-AO-10). 계정·여행은 행을 만들 때 값을 지킨다(비어 있을 때만 채운다). 같은 호출 안에서 만료 행 정리 1회
        (put 과 같다). 요약에 없는 줄의 벡터는 늘 지운다(벡터 표에는 요약에 지금 있는 줄만 남는다). `vectors`(줄 → `model` 임베딩)를
        주면 그 줄은 넣거나 바꾼다 — None(임베딩 미배선·실패)이면 남은 줄의 기존 벡터는 그대로 둔다.
        `vectors` 를 주면서 `model` 이 없으면 ValueError."""
        ...

    def search(
        self, vector: tuple[float, ...], *, session_id: str, account_ref: str | None, model: str, top_k: int,
    ) -> tuple[MemoryHit, ...]:
        """이 세션과 같은 계정 다른 세션의 기억 줄 중 `vector` 와 가까운 top_k — 점수 내림차순, 동점은 session_id·줄 사전순.
        만료 행·`model` 이 다른 벡터·요약에 없는 줄은 나오지 않는다. account_ref 가 None 이면 이 세션만."""
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
