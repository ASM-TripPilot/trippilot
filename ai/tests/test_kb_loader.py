"""TRIP-427 — KB seed 로더 + 상황 KB seed 파일 실적재 검증.

증명하는 것 (임베딩·스토어 전부 fake — 실 호출 0, D37):
  ① load_kb_documents — 구조 검증(루트 kb 단일 라벨·doc_id 유일·text 필수·
     poi_ref/metadata 형태), 위반은 KbLoadError로 시끄럽게 (조용한 스킵 금지)
  ② seed 파일(data/planb_situation_kb.yaml) — 파싱·적재 왕복: 전건 SITUATION,
     index_documents 건수 일치, 동일 텍스트 질의로 해당 문서가 1위 회수
     (FakeEmbedding은 동일 텍스트 매칭 전용 — 의미 유사도는 실키 스모크 소관)
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb.kb_retrieval import (
    KbLoadError,
    index_documents,
    load_kb_documents,
    load_kb_file,
    retrieve,
)
from trippilot.domain.kb import KbKind

_SEED = Path(__file__).resolve().parent.parent / "data" / "planb_situation_kb.yaml"


def _data(**over: object) -> dict:
    data = {
        "kb": "SITUATION",
        "documents": [
            {"doc_id": "d1", "text": "우천 시 실내 대안", "metadata": {"reasons": ["weather"]}},
            {"doc_id": "d2", "text": "휴무 시 인접 대안", "poi_ref": "some-poi"},
        ],
    }
    data.update(over)
    return data


# ── ① 구조 검증 ──────────────────────────────────────────────────────


def test_load_valid_structure() -> None:
    docs = load_kb_documents(_data())
    assert [d.doc_id for d in docs] == ["d1", "d2"]
    assert all(d.kb is KbKind.SITUATION for d in docs)
    assert docs[0].metadata == {"reasons": ["weather"]}
    assert docs[0].poi_ref is None and docs[1].poi_ref == "some-poi"


@pytest.mark.parametrize(
    "broken, match",
    [
        ({"kb": "날씨"}, "kb 라벨"),
        ({"kb": None}, "kb 라벨"),
        ({"documents": []}, "documents"),
        ({"documents": "not-a-list"}, "documents"),
        ({"documents": [{"text": "id 없음"}]}, "doc_id 누락"),
        ({"documents": [{"doc_id": "d", "text": "a"}, {"doc_id": "d", "text": "b"}]}, "중복"),
        ({"documents": [{"doc_id": "d"}]}, "text 누락"),
        ({"documents": [{"doc_id": "d", "text": "   "}]}, "비어있음"),
        ({"documents": [{"doc_id": "d", "text": "a", "poi_ref": 7}]}, "poi_ref"),
        ({"documents": [{"doc_id": "d", "text": "a", "metadata": "x"}]}, "metadata"),
    ],
)
def test_broken_structure_raises_loudly(broken: dict, match: str) -> None:
    with pytest.raises(KbLoadError, match=match):
        load_kb_documents(_data(**broken))


def test_non_mapping_root_raises() -> None:
    with pytest.raises(KbLoadError, match="루트"):
        load_kb_documents(["not", "a", "mapping"])


# ── ② seed 파일 실적재 왕복 ──────────────────────────────────────────


def test_seed_file_loads_and_indexes() -> None:
    docs = load_kb_file(_SEED, yaml.safe_load)
    assert len(docs) >= 10, "상황 KB seed가 빈약함 — 문서 유실 여부 확인"
    assert all(d.kb is KbKind.SITUATION for d in docs)
    embedding, store = FakeEmbedding(dim=32), InMemoryVectorStore()
    assert index_documents(docs, embedding, store) == len(docs)


def test_seed_document_retrievable_by_own_text() -> None:
    docs = load_kb_file(_SEED, yaml.safe_load)
    embedding, store = FakeEmbedding(dim=32), InMemoryVectorStore()
    index_documents(docs, embedding, store)
    target = docs[0]
    hits = retrieve(KbKind.SITUATION, target.text, embedding, store, top_k=3)
    assert hits and hits[0].doc_id == target.doc_id
    assert hits[0].text == target.text  # payload 왕복 보존


def test_seed_covers_all_trigger_reasons() -> None:
    """대응 지식이 없는 reason은 검색 컨텍스트가 비어 LLM이 일반론만 하게 된다."""
    docs = load_kb_file(_SEED, yaml.safe_load)
    covered = {r for d in docs for r in d.metadata.get("reasons", ())}
    assert {"weather", "closed", "delay", "canceled", "fatigue"} <= covered
