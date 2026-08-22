"""PgVectorStore — VectorStorePort의 pgvector 실구현 (TRIP-426).

전용 컨테이너(compose `ai-vectordb`, pgvector/pgvector:pg16)의 `kb_vectors` 단일
테이블을 쓴다 — DDL 정본은 `ai/docker/vector-init/01-kb-vectors.sql` (extension·
테이블 생성은 컨테이너 초기화 소유, 어댑터는 DML만).

검색 의미는 InMemoryVectorStore(fake)와 동형으로 맞춘다 — 소비 측이 fake와 실구현
사이에서 동작이 달라지면 안 된다: score = 코사인 유사도(= 1 − pgvector `<=>` 거리),
top-k는 score 내림차순, 동점은 item_id 사전순 (결정론).

DB 커넥션은 팩토리 주입 — psycopg 3 connection을 여는 쪽은 조립 진입점(main.py·
smoke 스크립트)이고, 본 모듈은 어떤 드라이버 패키지도 import하지 않는다
(플레이스홀더는 psycopg의 %s 스타일로 고정). 벡터는 '[f,f,…]' 리터럴 + ::vector
캐스트로 보내 pgvector 전용 파이썬 패키지 의존을 피한다.

# ponytail: 호출마다 커넥션 열고 닫음 + ANN 인덱스 없음(전수 스캔) — KB 수백 건
# 규모에는 충분. 처리량이 문제로 측정되면 커넥션 풀·HNSW 인덱스로 올린다.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from trippilot.ports.vector_store_port import VectorHit

_TABLE = "kb_vectors"


def _vector_literal(vector: tuple[float, ...]) -> str:
    if not vector:
        raise ValueError("빈 벡터는 저장·검색 불가")
    return "[" + ",".join(repr(float(x)) for x in vector) + "]"


def _payload_dict(raw: object) -> dict:
    """jsonb 반환 변주 흡수 — psycopg는 dict, 다른 드라이버·fake는 str일 수 있다."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        return json.loads(raw)
    raise TypeError(f"payload 타입 해석 불가: {type(raw).__name__}")


class PgVectorStore:
    """VectorStorePort Protocol 만족. `connect`는 psycopg 3 호환 connection 팩토리."""

    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    def upsert(
        self, collection: str, item_id: str, vector: tuple[float, ...], payload: dict
    ) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {_TABLE} (collection, item_id, embedding, payload) "
                "VALUES (%s, %s, %s::vector, %s::jsonb) "
                "ON CONFLICT (collection, item_id) "
                "DO UPDATE SET embedding = EXCLUDED.embedding, payload = EXCLUDED.payload",
                (collection, item_id, _vector_literal(vector), json.dumps(payload)),
            )

    def search(
        self, collection: str, vector: tuple[float, ...], top_k: int
    ) -> tuple[VectorHit, ...]:
        if top_k < 1:
            return ()
        literal = _vector_literal(vector)
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT item_id, 1 - (embedding <=> %s::vector) AS score, payload "
                f"FROM {_TABLE} WHERE collection = %s "
                "ORDER BY embedding <=> %s::vector, item_id LIMIT %s",
                (literal, collection, literal, top_k),
            )
            rows = cur.fetchall()
        return tuple(
            VectorHit(item_id=item_id, score=float(score), payload=_payload_dict(payload))
            for item_id, score, payload in rows
        )

    def delete(self, collection: str, item_id: str) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"DELETE FROM {_TABLE} WHERE collection = %s AND item_id = %s",
                (collection, item_id),
            )
