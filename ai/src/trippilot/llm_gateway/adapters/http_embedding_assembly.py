"""`http` 임베딩 provider 조립 — main.py 와 scripts/load_kb.py 의 **공유** 지점.

조사(TRIP-517)에서 드러난 함정: `main.py._vector_rag` 와 `scripts/load_kb.py._embedding`
은 규칙이 같을 뿐 **코드를 공유하지 않는 복사본**이다(`measure_kb_topk.py` 까지 세 벌).
`http` 를 한쪽에만 넣으면 서비스는 HTTP 로, 적재는 로컬 모델로 임베딩하게 되고
**두 벡터 공간이 조용히 섞인다** — 둘 다 1024 차원이라 DDL(`vector(1024)`)도
어댑터의 BR-AF-09 검증도 이걸 못 잡는다. 그래서 이 조립만은 한 곳에 둔다.
"""

from __future__ import annotations

import os
from typing import Callable

_DEFAULT_MODEL = "nlpai-lab/KURE-v1"
# 요청 경로는 임베딩을 **직렬 3회** 부른다(SCHEDULE·SITUATION·PERSONA, 각 단건).
# 이 값 × 3 이 검색 단계의 최악 소요이고, 그 위에 LLM 몫(요청 예산의 절반)이 더 붙는다.
#
# 3.0 → 5.0 (2026-09-02). 3초는 **콜드스타트를 못 덮었다** — 모델 로드가 3.5초라
# 기동 직후 첫 요청이 검색 하나를 잃었다(실측:
# `retrieve_schedule_error: EmbeddingUnreachable: TimeoutError`). #448 의 기동 워밍이
# 그 창을 좁혔지만, 로드 중에 요청이 오면 락에서 대기하다 여전히 넘길 수 있다.
#
# **상한이 5초인 이유**: 3회 직렬이라 5초면 검색 최악 15초다. 요청 예산 20초에서
# LLM 몫 10초가 따로 계산되므로 합이 25초가 되어 이미 예산을 넘는다(백스톱 504).
# 10초로 올리면 검색만 30초라 예산을 훨씬 넘는다 — 그래서 5초가 실질 상한이다.
# 정상 경로(모델 워밍 후)의 임베딩은 수백 ms 라, 이 값은 콜드스타트 보험이지
# 상시 비용이 아니다.
_DEFAULT_TIMEOUT_SEC = 5.0


def http_embedding(fail: Callable[[str], BaseException], http_factory):
    """`fail` 은 실패 예외 팩토리 — main 은 RuntimeError, 스크립트는 SystemExit.

    호출 규모: 요청 경로는 임베딩을 **직렬 3회** 부른다(SCHEDULE·SITUATION·PERSONA,
    각 단건). 하나당 상한을 크게 잡으면 3배가 그대로 요청 예산을 먹으므로 기본 3초로
    둔다 — 참고로 tmap 어댑터의 10초를 그대로 쓰면 최악 30초다.
    """
    from trippilot.llm_gateway.adapters.http_embedding import HttpEmbeddingAdapter

    base_url = os.environ.get("TRIPPILOT_EMBEDDING_BASE_URL") or ""
    if not base_url:
        # 설정 버그다 — provider 를 명시적으로 골라놓고 주소를 안 준 것.
        # 조용히 다른 provider 로 폴백하면 "HTTP 로 테스트했다"가 거짓이 된다.
        raise fail(
            "TRIPPILOT_EMBEDDING_PROVIDER=http 인데 TRIPPILOT_EMBEDDING_BASE_URL 미설정 — "
            "silent fallback 금지: 기동 실패."
        )
    model = os.environ.get("TRIPPILOT_EMBEDDING_MODEL") or _DEFAULT_MODEL
    timeout = float(
        os.environ.get("TRIPPILOT_EMBEDDING_TIMEOUT_SEC") or _DEFAULT_TIMEOUT_SEC
    )
    return HttpEmbeddingAdapter(http_factory(timeout), base_url, model=model)
