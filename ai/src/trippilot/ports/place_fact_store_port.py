"""PlaceFactStore + PlaceFacts·FactRecord — 도우미 미확인 칸 웹 확인 결과의 콘센트 (UnknownHandlingAgent, 2026-10-22).

게이트(`llm_gateway/gates/place_fact.py`)·`agents/adapters/pg_place_fact_store.py`·`agents/unknown_handling/agent.py` 가 같은
타입을 쓰는데 어댑터와 에이전트는 agents/ 의 형제라 서로 import 할 수 없다(L-2, `tests/test_architecture.py`) — `memory_store_port.py` 선례대로
포트 모듈 안에 둔다. stdlib 만. 구현 2종: Pg(운영, ai_kb.place_fact_cache) · `agents/adapters/memory_place_fact_store.py` 의 InMemoryPlaceFactStore(로컬·테스트).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

FIELDS = ("hours", "last_entry", "closed", "fee")


@dataclass(frozen=True, slots=True)
class PlaceFacts:
    """찾은 칸(없으면 None)과 출처 — `source_host` 는 화면에 보일 이름, `source_url` 은 검색이 단 인용 URL 그대로."""

    hours: str | None
    last_entry: str | None
    closed: str | None
    fee: str | None
    source_url: str
    source_host: str

    def any(self) -> bool:
        return any((self.hours, self.last_entry, self.closed, self.fee))


@dataclass(frozen=True, slots=True)
class FactRecord:
    """한 장소의 조회 결과 — `facts` None 은 "찾아봤지만 출처 있는 값이 없음"."""

    poi_id: str
    facts: PlaceFacts | None
    fetched_at: datetime
    expires_at: datetime


class PlaceFactStore(Protocol):
    def get(self, poi_id: str, now: datetime) -> FactRecord | None: ...  # 만료 전 것만
    def put(self, record: FactRecord) -> None: ...
