"""KB 검색 전략 포트 (TRIP-522).

`VectorStorePort` 가 "어디에 저장하나"라면 이건 "어떻게 고르나"다. 둘을 나눈 이유:
유사도 상위 k건 말고 다른 전략(MMR 중복 억제, score threshold, hybrid, 리랭킹)을
쓰려면 저장 계층이 아니라 검색 계층이 바뀌어야 한다.

기본 구현은 없다 — 미주입이면 `PlanBRagPipeline` 이 기존 직접 검색
(`kb_retrieval.retrieve_*`)을 그대로 쓴다. 즉 이 포트는 **선택적 강화**이고,
주입하지 않으면 동작이 한 글자도 안 바뀐다.

INV-1 무관: 여기 결과는 후보가 아니라 참고 문서다. 후보 자격은
`rag.closed_set_filter` 가 풀과 교차한 뒤에만 생긴다.
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.kb import KbHit, KbKind


class KbRetrieverPort(Protocol):
    """KB 한 종류에서 질의에 맞는 문서 top-k 를 고른다.

    구현은 예외를 던져도 된다 — 호출측(`_safe_retrieve`)이 노트로 잡고 나머지 KB 로
    진행한다(부분 성공 허용, INV-4).
    """

    def retrieve(self, kb: KbKind, query: str, top_k: int) -> tuple[KbHit, ...]: ...
