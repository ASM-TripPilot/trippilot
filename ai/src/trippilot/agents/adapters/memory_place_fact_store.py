"""InMemoryPlaceFactStore — PlaceFactStore 의 dict 구현 (UnknownHandlingAgent 저장소, 2026-10-22).

테스트 대역이자 **ai_kb DSN 없는 로컬 기동의 실 구현**이다(`api/dialogue.py` 가 `place_fact_store` 미주입이면 이걸 쓴다 —
`memory_memory_store.py` 와 같은 자리). 프로세스가 죽으면 저장도 사라지고 파드 사이에 공유되지 않는다 — 운영은 `PgPlaceFactStore`.
`put` 은 upsert, `get` 은 만료 전 것만(만료 행은 없는 것과 같다 — Pg 와 같은 `expires_at > now` 경계). Pg 가 쓰기 때 하는 만료 행
정리(백스톱)는 거울하지 않는다 — 읽기가 만료를 거르고 장소마다 한 행이라 프로세스 수명 안에서 쌓이지 않는다.
"""

from __future__ import annotations

import threading
from datetime import datetime

from trippilot.ports.place_fact_store_port import FactRecord


class InMemoryPlaceFactStore:
    def __init__(self) -> None:
        self._rows: dict[str, FactRecord] = {}
        self._lock = threading.Lock()

    def get(self, poi_id: str, now: datetime) -> FactRecord | None:
        with self._lock:
            row = self._rows.get(poi_id)
        return row if row is not None and row.expires_at > now else None

    def put(self, record: FactRecord) -> None:
        with self._lock:
            self._rows[record.poi_id] = record
