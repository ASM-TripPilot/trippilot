"""probe_intro2 — 제안 문서 기반 표본 추출. 실 호출 0.

프로브는 실 API 로만 의미가 있는 도구라 테스트가 없었는데, `--from-doc` 경로는
순수 로직이라 물릴 수 있다. 이것이 조용히 틀리면 **측정 결과가 틀린 채로 결정에
들어간다** — 예산 등급 경계가 여기서 나온다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from probe_intro2 import _refs_from_doc  # noqa: E402


def _doc(*proposals: dict) -> dict:
    return {"schema_version": 1, "proposals": list(proposals)}


def _prop(cid: str, kind: str) -> dict:
    return {"provenance": {"content_id": cid, "content_type_id": kind}}


def test_refs_from_doc_groups_by_content_type(tmp_path: Path) -> None:
    path = tmp_path / "doc.json"
    path.write_text(json.dumps(_doc(
        _prop("1", "14"), _prop("2", "39"), _prop("3", "14"))), encoding="utf-8")
    assert _refs_from_doc(path) == {"14": ["1", "3"], "39": ["2"]}


def test_refs_from_doc_skips_incomplete_provenance(tmp_path: Path) -> None:
    """식별자나 타입이 없으면 상세를 부를 수 없다 — 건너뛴다(지어내지 않는다)."""
    path = tmp_path / "doc.json"
    path.write_text(json.dumps(_doc(
        _prop("1", "14"),
        {"provenance": {"content_id": "2"}},              # 타입 없음
        {"provenance": {"content_type_id": "14"}},        # 식별자 없음
        {},                                               # provenance 자체 없음
        {"provenance": None},                             # null provenance
    )), encoding="utf-8")
    assert _refs_from_doc(path) == {"14": ["1"]}


def test_refs_from_doc_preserves_document_order(tmp_path: Path) -> None:
    """앞에서 N 건만 자르므로 순서가 표본을 정한다 — 문서 순서 그대로여야 한다."""
    path = tmp_path / "doc.json"
    path.write_text(json.dumps(_doc(*(_prop(str(i), "14") for i in range(50)))),
                    encoding="utf-8")
    assert _refs_from_doc(path)["14"] == [str(i) for i in range(50)]
