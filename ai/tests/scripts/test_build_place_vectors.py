"""KB-5 조각 벡터 증분 빌드 — 개요를 모이는 대로 나눠 올린다(2026-10-22).

증명하는 것 (모델·네트워크 0):
  ① 지문이 같은 조각은 이전 파일 순서 그대로 재사용하고, 새·바뀐 조각만 계산 대상이다
  ② 재사용분을 앞에 두고 다시 쓰면 본체 앞쪽 몫 파일이 바이트까지 같다(git 이 다시 저장하지 않는다)
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from trippilot.poi_curation import chunking as c

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "collect" / "build_place_vectors.py"


def _module():
    spec = importlib.util.spec_from_file_location("build_place_vectors_under_test", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _doc(i: int, text: str = "") -> c.KbDocument:
    body = text or f"{i}번 장소는 바닷가에 있는 전시관이다."
    return c.chunk_document({"doc_id": f"overview:{i}", "poi_ref": str(i),
                             "sections": [{"heading": "개요", "text": body}]})[0]


def _vec(i: int) -> tuple[float, float]:
    return (i / 16, -i / 16)


def test_unchanged_chunks_are_reused_in_file_order_and_only_new_or_edited_ones_are_computed(tmp_path) -> None:
    m = _module()
    p = tmp_path / "x.vectors.json.gz"
    prev = [_doc(3), _doc(1), _doc(2)]  # 파일 순서는 코퍼스 순서와 다를 수 있다
    c.dump_chunk_vectors(p, prev, "m", [_vec(3), _vec(1), _vec(2)])
    now = [_doc(1), _doc(2, "바뀐 본문이다. 새 문장이다."), _doc(3), _doc(4)]
    keep, todo = m.incremental_order(now, c.load_chunk_vectors(p))
    assert [d.doc_id for d in keep] == ["overview:3#0", "overview:1#0"]
    assert [d.doc_id for d in todo] == ["overview:2#0", "overview:4#0"]
    assert m.incremental_order(now, None) == ([], now)


def test_appending_new_chunks_keeps_earlier_shard_files_byte_identical(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(c, "F16_SHARD_CHUNKS", 2)
    m = _module()
    p = tmp_path / "x.vectors.json.gz"
    first = [_doc(i) for i in range(4)]
    c.dump_chunk_vectors(p, first, "m", [_vec(i) for i in range(4)])
    before = {f.name: f.read_bytes() for f in tmp_path.glob("x.vectors.f16.*.gz")}
    previous = c.load_chunk_vectors(p)
    keep, todo = m.incremental_order([*first, _doc(4)], previous)
    c.dump_chunk_vectors(p, [*keep, *todo], "m", [*(previous.vector(d.doc_id) for d in keep), _vec(4)])
    after = {f.name: f.read_bytes() for f in tmp_path.glob("x.vectors.f16.*.gz")}
    assert sorted(after) == ["x.vectors.f16.0.gz", "x.vectors.f16.1.gz", "x.vectors.f16.2.gz"]
    assert all(after[name] == data for name, data in before.items())  # 앞 두 몫은 그대로
    assert c.load_chunk_vectors(p).vector("overview:4#0") == _vec(4)
