"""CachingEmbedding — 같은 텍스트를 두 번 임베딩하지 않는다.

요청 경로는 임베딩을 **직렬 3회** 부르고(SCHEDULE·SITUATION·PERSONA), 그중
상황 KB·페르소나 KB 질의는 `TriggerKind` 4종 × `_REASON_KO` 7종 = **28가지 닫힌
집합**이다(`ai/docs/임베딩-사이징-근거.md`). 즉 같은 문자열이 프로세스 수명 내내
반복해서 들어온다. 이 래퍼는 그 반복을 없앤다.

**세만틱(유사도) 캐시가 아니다.** 키는 텍스트 정확일치다 — 벡터를 유사도로
재사용하면 적재된 공간과 다른 값을 쓰게 되고, 그 오염은 아무 검사도 못 잡는다.
"""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from trippilot.llm_gateway.adapters.caching_embedding import CachingEmbedding


class _CountingEmbedding:
    """호출 횟수를 세는 EmbeddingPort 구현 — 텍스트 길이로 결정론 벡터를 만든다."""

    dim = 4
    model_id = "nlpai-lab/KURE-v1"

    def __init__(self) -> None:
        self.embed_calls: list[str] = []
        self.batch_calls: list[tuple[str, ...]] = []

    def _vector(self, text: str) -> tuple[float, ...]:
        return tuple(float(len(text) + i) for i in range(self.dim))

    def embed(self, text: str) -> tuple[float, ...]:
        self.embed_calls.append(text)
        return self._vector(text)

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        self.batch_calls.append(tuple(texts))
        return tuple(self._vector(text) for text in texts)


def test_repeated_text_is_embedded_once() -> None:
    inner = _CountingEmbedding()
    cache = CachingEmbedding(inner)

    first = cache.embed("비도 오고 걷기도 싫어")
    second = cache.embed("비도 오고 걷기도 싫어")

    assert first == second
    assert inner.embed_calls == ["비도 오고 걷기도 싫어"]


def test_different_text_still_reaches_the_inner_port() -> None:
    inner = _CountingEmbedding()
    cache = CachingEmbedding(inner)

    cache.embed("실내로 바꿔줘")
    cache.embed("이동을 줄여줘")

    assert inner.embed_calls == ["실내로 바꿔줘", "이동을 줄여줘"]


def test_batch_asks_only_for_the_texts_it_does_not_have() -> None:
    inner = _CountingEmbedding()
    cache = CachingEmbedding(inner)
    cache.embed("이미 본 문장")

    vectors = cache.embed_batch(["이미 본 문장", "처음 보는 문장"])

    assert inner.batch_calls == [("처음 보는 문장",)]
    assert vectors == (inner._vector("이미 본 문장"), inner._vector("처음 보는 문장"))


def test_batch_of_known_texts_makes_no_call_at_all() -> None:
    inner = _CountingEmbedding()
    cache = CachingEmbedding(inner)
    cache.embed_batch(["가", "나"])

    vectors = cache.embed_batch(["나", "가"])

    assert inner.batch_calls == [("가", "나")]
    assert vectors == (inner._vector("나"), inner._vector("가"))


def test_dim_and_model_id_pass_through() -> None:
    # collection 이름이 `model_id` 로 만들어진다 — 래퍼가 이 값을 가리면
    # 적재와 질의가 다른 collection 을 보게 된다(TRIP-519).
    inner = _CountingEmbedding()
    cache = CachingEmbedding(inner)

    assert cache.dim == inner.dim
    assert cache.model_id == inner.model_id


def test_inner_port_is_visible() -> None:
    # 배선 테스트가 "provider 가 고른 어댑터"를 계속 단언할 수 있어야 한다 —
    # 래퍼가 그 사실을 가리면 provider 분기의 회귀를 아무도 못 잡는다.
    inner = _CountingEmbedding()

    assert CachingEmbedding(inner).inner is inner


def test_cache_evicts_oldest_beyond_maxsize() -> None:
    # 자유 입력은 무한하다 — 한도가 없으면 장수 프로세스에서 메모리가 샌다.
    inner = _CountingEmbedding()
    cache = CachingEmbedding(inner, maxsize=2)

    cache.embed("첫째")
    cache.embed("둘째")
    cache.embed("셋째")
    cache.embed("첫째")

    assert inner.embed_calls == ["첫째", "둘째", "셋째", "첫째"]


def test_inner_failure_is_not_cached() -> None:
    # 실패를 캐시하면 일시적 장애가 프로세스 수명 내내 굳는다.
    class _Flaky(_CountingEmbedding):
        def __init__(self) -> None:
            super().__init__()
            self.fail_next = True

        def embed(self, text: str) -> tuple[float, ...]:
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("일시 장애")
            return super().embed(text)

    inner = _Flaky()
    cache = CachingEmbedding(inner)

    with pytest.raises(RuntimeError):
        cache.embed("한 번 실패하는 문장")
    assert cache.embed("한 번 실패하는 문장") == inner._vector("한 번 실패하는 문장")
