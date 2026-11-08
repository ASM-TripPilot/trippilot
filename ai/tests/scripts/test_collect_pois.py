"""collect_pois — 스크립트가 직접 쓰는 파일 (실 호출 0). 수집 자체는 pipeline 테스트가 문다.

`seen_refs.json`(TRIP-1248)은 산출 문서·색인 어디에도 없는 "목록에서 본 id 전부"를 남긴다 —
벤더 목록에서 사라진 공유본 항목을 가려낼 유일한 기록이다.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

from collect_pois import (  # noqa: E402
    _EXCLUDED_FILTERED,
    _load_excluded,
    _print_summary,
    load_closed_refs,
    write_seen_refs,
)

_NOW = datetime(2026, 10, 5, 19, 0, tzinfo=UTC)


def test_seen_refs_문서는_정렬된_id_목록과_실행_맥락을_담는다(tmp_path) -> None:
    path = tmp_path / "seen_refs.json"
    n = write_seen_refs(path, frozenset({"300", "100", "2946228"}), run_at=_NOW,
                        area_codes=["1", "39"], content_types=["12", "39"])
    assert n == 3
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "run_at": "2026-10-05T19:00:00+00:00", "area_codes": ["1", "39"],
        "content_types": ["12", "39"], "seen": ["100", "2946228", "300"]}


def test_본_것이_없어도_파일은_쓴다(tmp_path) -> None:
    """읽는 쪽이 "0건"과 "안 돌았다"를 가르게 — 빈 실행(키 거부 등)도 기록이다."""
    path = tmp_path / "seen_refs.json"
    assert write_seen_refs(path, frozenset(), run_at=_NOW,
                           area_codes=["1"], content_types=["12"]) == 0
    assert json.loads(path.read_text(encoding="utf-8"))["seen"] == []


def test_서머리는_옛_분류가_빈_레포츠_항목의_새_분류를_많은_순으로_찍는다(tmp_path, capsys) -> None:
    """야영장을 수집에서 거를 코드를 찾는 계측(`CollectStats.leports_lcls`) — 다음 일일 수집의 잡 서머리에서 본다.
    과거 산출 문서엔 그 칸이 없다(— 표시)."""
    stats = {"http_calls": 2, "listed": 3, "passed": 3, "category_unmapped": 0, "merged": 0,
             "page_failures": 0, "detail_failures": 0, "budget_exhausted": False, "gate_drops": {}}
    doc = {"area_codes": ["1"], "content_types": ["28"], "collected_at": "2026-10-30T00:00:00+00:00",
           "stats": {**stats, "leports_lcls": {"LS/LS01": 1, "AC/AC01": 2}}}
    path = tmp_path / "doc.json"
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    assert _print_summary(str(path)) == 0
    assert "| 레포츠 옛 분류 빈 항목의 새 분류 | AC/AC01 2 · LS/LS01 1 |" in capsys.readouterr().out
    path.write_text(json.dumps({**doc, "stats": stats}, ensure_ascii=False), encoding="utf-8")
    assert _print_summary(str(path)) == 0
    assert "| 레포츠 옛 분류 빈 항목의 새 분류 | — |" in capsys.readouterr().out


def test_근거_파일이_없거나_깨져도_수동_제외_목록은_들어있다(tmp_path) -> None:
    """load_closed_refs 가 조기 반환하는 두 경로(파일 없음·깨짐)에서도 수동 제외 2종
    (poi_excluded_manual·poi_excluded_filtered)까지 같이 비면 안 된다 — 폐업 근거가 없다고
    사람이 손으로 적은 제외 목록까지 같이 사라지면 안 된다."""
    manual = _load_excluded()
    filtered = _load_excluded(_EXCLUDED_FILTERED)
    assert manual and filtered, "실 제외 목록이 비어 있으면 이 테스트는 아무것도 보지 않는다"

    missing = load_closed_refs(tmp_path / "없음.json")
    broken = tmp_path / "깨짐.json"
    broken.write_text("{not json", encoding="utf-8")
    corrupt = load_closed_refs(broken)

    assert manual <= missing and filtered <= missing
    assert manual <= corrupt and filtered <= corrupt
