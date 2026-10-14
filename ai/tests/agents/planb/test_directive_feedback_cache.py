"""지시 번역 되먹임 캐시 — LLM 이 한 번 번역한 발화를 별칭으로 되쓴다.

자유 입력은 이미 **임베딩 매칭이 1차**(임계 0.74)이고, 거기서 놓친 것만 LLM 워커가
받는다(A-3). 그런데 워커가 번역해 낸 (발화 → 닫힌 키) 결과는 어디에도 남지 않아,
같은 말이 다시 오면 LLM 을 다시 부른다. 이 모듈이 그 결과를 KB-4 별칭으로 적재해
다음번엔 0.74 매칭이 잡게 한다.

**이 자리가 세만틱 캐시가 값을 하는 유일한 지점이다.** 출력이 닫힌 키라 틀린 별칭이
끼어도 게이트가 막는다. 반대로 생성 문구(리마인드·설명)에 유사도 캐시를 넣으면
게이트가 "이 요청의 장소 집합"으로 막기 때문에 절감이 아니라 드롭으로 나타난다.
"""

from __future__ import annotations

import pytest

from trippilot.agents.planb.directive_feedback import (
    FEEDBACK_SOURCE,
    remember_free_text,
)
from trippilot.domain.kb import KbKind


class _FakeEmbedding:
    dim = 4
    model_id = "nlpai-lab/KURE-v1"

    def embed(self, text: str) -> tuple[float, ...]:
        return tuple(float(len(text) + i) for i in range(self.dim))

    def embed_batch(self, texts):
        return tuple(self.embed(text) for text in texts)


class _SpyStore:
    def __init__(self, raises: Exception | None = None) -> None:
        self.upserts: list[tuple[str, str, dict]] = []
        self._raises = raises

    def upsert(self, collection, item_id, vector, payload) -> None:
        if self._raises is not None:
            raise self._raises
        self.upserts.append((collection, item_id, payload))

    def search(self, collection, vector, top_k, *, item_ids=None):
        return ()

    def delete(self, collection, item_id) -> None:
        pass


def test_accepted_translation_becomes_an_alias_document() -> None:
    store = _SpyStore()

    written = remember_free_text("비도 오고 걷기도 싫어", ("INDOOR",), _FakeEmbedding(), store)

    assert written == 1
    collection, _, payload = store.upserts[0]
    assert collection.endswith("__nlpai_lab_kure_v1")
    assert payload["kb"] == KbKind.DIRECTIVE.value
    assert payload["text"] == "비도 오고 걷기도 싫어"
    assert payload["metadata"]["key"] == "INDOOR"


def test_payload_is_tagged_so_a_rollback_is_one_delete() -> None:
    # 별칭이 늘어 과다선택이 오르면 되돌려야 한다. 표식이 없으면 시드와 섞여
    # 어느 행이 되먹임분인지 구분할 수 없다.
    store = _SpyStore()

    remember_free_text("실내로 바꿔줘", ("INDOOR",), _FakeEmbedding(), store)

    assert store.upserts[0][2]["metadata"]["source"] == FEEDBACK_SOURCE


def test_one_document_per_key() -> None:
    store = _SpyStore()

    written = remember_free_text(
        "실내로 하고 이동도 줄여줘", ("INDOOR", "LESS_TRANSIT"), _FakeEmbedding(), store)

    assert written == 2
    assert {item[2]["metadata"]["key"] for item in store.upserts} == {"INDOOR", "LESS_TRANSIT"}


def test_same_utterance_and_key_reuse_the_same_doc_id() -> None:
    # 멱등이 아니면 같은 말을 할 때마다 행이 쌓여 검색 상위가 되먹임분으로 덮인다.
    store = _SpyStore()

    remember_free_text("실내로 바꿔줘", ("INDOOR",), _FakeEmbedding(), store)
    remember_free_text("실내로 바꿔줘", ("INDOOR",), _FakeEmbedding(), store)

    assert store.upserts[0][1] == store.upserts[1][1]


@pytest.mark.parametrize("text,keys", [("", ("INDOOR",)), ("   ", ("INDOOR",)), ("실내로", ())])
def test_nothing_to_remember_writes_nothing(text: str, keys: tuple[str, ...]) -> None:
    store = _SpyStore()

    assert remember_free_text(text, keys, _FakeEmbedding(), store) == 0
    assert store.upserts == []


def test_store_failure_does_not_reach_the_caller() -> None:
    # 되먹임은 부가 작업이다 — 여기서 예외가 올라가면 재계획 자체가 죽는다(INV-4).
    store = _SpyStore(raises=RuntimeError("스토어 장애"))

    assert remember_free_text("실내로 바꿔줘", ("INDOOR",), _FakeEmbedding(), store) == 0
