"""미리 계산한 질문뱅크 벡터 (TRIP-1410) — 기동·HPA 증설마다 원격 임베딩을 수 분 독점하던 색인을 없앤다.

재는 것:
- 파일 왕복(fp16)이 개수·차원·값을 보존한다
- 지금 뱅크·모델과 맞으면 임베딩 호출 0회로 즉시 색인, 안 맞으면 싣지 않고 원격 색인으로 넘긴다(틀린 벡터 금지)
- **커밋된 파일이 지금 질문뱅크의 것이다** — 뱅크를 고치고 재생성을 잊으면 여기서 빨개진다
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from trippilot.agents.adapters.memory_vector_store import InMemoryVectorStore
from trippilot.domain.intent import Intent
from trippilot.orchestrator.dialogue_interpreter import BankIndex
from trippilot.orchestrator.question_bank import (
    BANK_COLLECTION,
    BankEntry,
    BankLoadError,
    bank_fingerprint,
    dump_bank_vectors,
    load_bank_file,
    load_bank_vectors,
)

_DATA = Path(__file__).resolve().parents[2] / "data"


def _entries(*questions: str) -> tuple[BankEntry, ...]:
    return tuple(BankEntry(entry_id=f"E{i}", intent=Intent.GET_WEATHER, question=q, reviewed=True,
                           origin="seed", bank_version="t") for i, q in enumerate(questions))


class _Emb:
    dim = 3
    model_id = "m"

    def __init__(self) -> None:
        self.batches = 0

    def embed(self, text):
        return (1.0, 0.0, 0.0)

    def embed_batch(self, texts):
        self.batches += 1
        return tuple((1.0, 0.0, 0.0) for _ in texts)


def test_roundtrip_preserves_vectors(tmp_path: Path) -> None:
    entries = _entries("날씨", "거리")
    vectors = ((0.5, -0.25, 1.0), (0.125, 0.0, -1.0))  # fp16 로 정확히 표현되는 값
    path = tmp_path / "v.json.gz"
    dump_bank_vectors(path, entries, "m", 3, vectors)
    loaded = load_bank_vectors(path)
    assert loaded is not None
    assert loaded.vectors == vectors and loaded.model == "m" and loaded.dim == 3
    assert loaded.unusable_reason(entries, "m", 3) is None


def test_missing_file_is_none(tmp_path: Path) -> None:
    assert load_bank_vectors(tmp_path / "없음.json.gz") is None


def test_dump_rejects_shape_mismatch(tmp_path: Path) -> None:
    with pytest.raises(BankLoadError):
        dump_bank_vectors(tmp_path / "v.json.gz", _entries("a", "b"), "m", 3, ((1.0, 0.0, 0.0),))


def test_matching_file_indexes_without_embedding(tmp_path: Path) -> None:
    entries = _entries("날씨")
    path = tmp_path / "v.json.gz"
    dump_bank_vectors(path, entries, "m", 3, ((0.0, 1.0, 0.0),))
    emb, store = _Emb(), InMemoryVectorStore()
    idx = BankIndex(entries, emb, store, precomputed=load_bank_vectors(path))
    assert idx.indexed and emb.batches == 0  # 기동 즉시, 원격 임베딩 0회
    assert store.search(BANK_COLLECTION, (0.0, 1.0, 0.0), 1)[0].item_id == "E0"


@pytest.mark.parametrize("change", ["bank", "model", "dim"])
def test_stale_file_is_not_loaded(tmp_path: Path, change: str) -> None:
    """뱅크 문장·모델·차원 중 하나라도 다르면 싣지 않는다 — 다른 문장·공간의 벡터는 조용히 순위를 망친다."""
    path = tmp_path / "v.json.gz"
    dump_bank_vectors(path, _entries("날씨"), "m" if change != "model" else "다른모델",
                      3 if change != "dim" else 2, ((0.0, 1.0, 0.0)[:3 if change != "dim" else 2],))
    entries = _entries("날씨 어때" if change == "bank" else "날씨")
    emb, store = _Emb(), InMemoryVectorStore()
    idx = BankIndex(entries, emb, store, precomputed=load_bank_vectors(path))
    assert not idx.indexed and not store.search(BANK_COLLECTION, (1.0, 0.0, 0.0), 1)


def test_committed_vectors_match_current_bank() -> None:
    """질문뱅크를 고쳤으면 `cd ai && uv run python scripts/intent/build_bank_vectors.py` 로 다시 만든다.
    잊으면 기동마다 원격 임베딩을 수 분 독점하는 원격 색인으로 돌아간다(DEV HPA 증설 때 다른 기능까지 느려짐)."""
    entries = load_bank_file(_DATA / "intent_question_bank.yaml", yaml.safe_load)
    loaded = load_bank_vectors(_DATA / "intent_question_bank.vectors.json.gz")
    assert loaded is not None, "data/intent_question_bank.vectors.json.gz 가 없다 — build_bank_vectors.py 실행"
    assert loaded.fingerprint == bank_fingerprint(entries), (
        "질문뱅크가 바뀌었는데 벡터 파일이 옛것이다 — scripts/intent/build_bank_vectors.py 로 재생성"
    )
    assert loaded.model == "nlpai-lab/KURE-v1" and loaded.dim == 1024  # 배포 임베딩 서비스와 같은 모델
