"""임베딩 이미지가 굽는 모델 리비전이 **커밋 해시로 고정**돼 있는가 (BR-MLO-05 의 전제).

`main` 같은 브랜치 이름이면 업스트림이 바뀌는 날 이미지를 다시 굽는 순간 가중치가 바뀌고,
이미 적재된 KB 벡터·미리 계산한 질문뱅크 벡터와 공간이 **예외도 로그도 없이** 갈라진다.
종전 기본값이 `main` 이었다(주석은 "고정한다"였다, 2026-10-14 발견).
"""

from __future__ import annotations

import gzip
import json
import re
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
_DOCKERFILE = _AI / "embedding" / "Dockerfile"
_BANK_VECTORS = _AI / "data" / "intent_question_bank.vectors.json.gz"


def _baked_revision() -> str:
    match = re.search(r"^ARG EMBEDDING_REVISION=(\S+)$", _DOCKERFILE.read_text(encoding="utf-8"), re.M)
    assert match, "Dockerfile 에 ARG EMBEDDING_REVISION 이 없다"
    return match.group(1)


def test_baked_revision_is_a_commit_hash_not_a_branch() -> None:
    assert re.fullmatch(r"[0-9a-f]{40}", _baked_revision()), _baked_revision()


def test_precomputed_bank_vectors_match_the_baked_revision() -> None:
    """미리 계산한 질문뱅크 벡터가 있으면 같은 리비전으로 만든 것이어야 한다 — 다르면 공간이 다르다."""
    if not _BANK_VECTORS.exists():
        return  # 미리 계산본이 없으면 원격 색인 경로다 — 대조할 것이 없다
    with gzip.open(_BANK_VECTORS, "rt", encoding="utf-8") as stream:
        provenance = json.load(stream).get("provenance") or {}
    assert provenance.get("model_revision") == _baked_revision(), provenance


def test_precomputed_place_vectors_match_the_baked_revision() -> None:
    """KB-5 장소 조각 벡터(2026-10-18 청킹)도 같다 — 배포 적재가 그 벡터를 그대로 넣고 질의는 서빙 임베딩으로 한다."""
    path = _AI / "data" / "place_corpus_wiki.vectors.json.gz"
    if not path.exists():
        return
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        provenance = json.load(stream).get("provenance") or {}
    assert provenance.get("model_revision") == _baked_revision(), provenance
