"""지시 번역 되먹임 — LLM 이 번역한 발화를 KB-4 별칭으로 되쓴다.

## 왜 있나

자유 입력은 1차로 **임베딩 매칭**(`match_free_text`, 임계 0.74)이 받고, 거기서 놓친
발화만 LLM 워커(A-3)가 번역한다. 그런데 워커의 결과는 응답에만 쓰이고 사라져서, 같은
말이 다시 오면 LLM 을 또 부른다. 번역 결과를 별칭으로 적재하면 다음번엔 매칭이 잡는다.

**세만틱 캐시를 둘 자리는 여기다.** 출력이 닫힌 키라 틀린 별칭이 끼어도 사전 조회와
게이트가 막는다(`match_free_text` 는 사전에 없는 키를 버린다). 생성 문구 쪽에 유사도
캐시를 넣으면 게이트가 "이 요청의 장소 집합"으로 막기 때문에 절감이 아니라 드롭이 된다.

## 늘어나는 별칭은 위험이다

실측(2026-09-12)으로 고른 임계 0.74 는 `정확일치 18/23 ∧ 과다선택 3` 지점이다. 별칭이
늘면 **과다선택이 먼저 오른다** — 사용자가 말하지 않은 방향으로 후보가 틀어지는 쪽이라
부분누락보다 나쁘다. 그래서 둘을 둔다:

1. 되먹임분에는 `source` 표식을 박는다 — 되돌리기가 한 줄이다.
   `DELETE FROM kb_vectors WHERE payload->'metadata'->>'source' = 'feedback';`
2. 켜는 것은 호출측 판단이고 기본은 꺼짐이다. 켜기 전에
   `scripts/measure_directive_match.py` 로 회귀를 잰다.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Sequence

from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.domain.kb import KbDocument, KbKind
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

logger = logging.getLogger(__name__)

#: 되먹임으로 적재된 별칭의 표식. 시드와 섞이지 않게 한다.
FEEDBACK_SOURCE = "feedback"


def _doc_id(text: str, key: str) -> str:
    """같은 (발화, 키)는 같은 doc_id — upsert 가 멱등이라 행이 늘지 않는다."""
    digest = hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:16]
    return f"{FEEDBACK_SOURCE}:{key}:{digest}"


def remember_free_text(
    text: str,
    keys: Sequence[str],
    embedding: EmbeddingPort,
    store: VectorStorePort,
) -> int:
    """번역된 발화를 별칭으로 적재하고 적재 건수를 반환한다.

    **예외를 올리지 않는다.** 되먹임은 부가 작업이라 여기서 실패해도 재계획은 계속
    간다(INV-4). 대신 조용히 넘기지 않고 ERROR 로 남긴다 — 되먹임이 꺼진 줄 모르고
    "캐시가 도는데 왜 LLM 호출이 그대로냐"를 뒤지게 되는 쪽이 더 비싸다.
    """
    if not text.strip() or not keys:
        return 0
    documents = [
        KbDocument(
            kb=KbKind.DIRECTIVE,
            doc_id=_doc_id(text, key),
            text=text.strip(),
            poi_ref=None,
            metadata={"key": key, "source": FEEDBACK_SOURCE},
        )
        for key in dict.fromkeys(keys)
    ]
    try:
        return index_documents(documents, embedding, store)
    except Exception:
        logger.exception("지시 되먹임 적재 실패 — 재계획은 계속한다")
        return 0
