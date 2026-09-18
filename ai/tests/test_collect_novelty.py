"""수집 신규율 진단 검증 — 순수 로직만, 실 호출 0건 (TRIP-348).

스크립트 본체(scripts/collect_novelty.py)는 pytest 대상이 아니지만, **판정**은
워크플로를 빨간불로 만드는 자리라 여기서 못 박는다:
  ① 분류 — 신규 / 갱신(modified_time 변경) / 반복(같은데 또 실림)
  ② 제자리걸음 판정 — 오탐(미수집 지역 첫 수집)과 진짜 회귀를 가르는가
  ③ 진단 — 원인별로 처방이 나오는가 (증거 없는 원인은 안 나오는가)

②가 이 파일의 존재 이유다. 앞선 판은 "기제안 스킵 0건"만 보고 실패시켰다가
강원(32) 100건 전부가 신규인 실행을 회귀로 오인해 빨간불을 냈다 — 게이트가
오탐을 내면 다음 사람이 게이트를 끄지, 원인을 찾지 않는다.
"""

from __future__ import annotations

import sys
from pathlib import Path

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from collect_novelty import classify, diagnose, stall_check  # noqa: E402


def _proposal(content_id: str, modified_time: str | None = "20250101000000") -> dict:
    return {"provenance": {"content_id": content_id, "modified_time": modified_time}}


def _doc(proposals: list[dict], **stats) -> dict:
    base = {"listed": len(proposals), "skipped_unchanged": 0, "page_failures": 0,
            "gate_drops": {}, "budget_exhausted": False, "per_area": {}}
    return {"proposals": proposals, "stats": base | stats,
            "area_codes": ["32"], "collected_at": "2026-08-19T05:25:04+00:00"}


def _state(proposed: dict[str, str], cursors: dict | None = None) -> dict:
    return {"proposed": proposed, "cursors": cursors or {}}


# ── ① 분류 ────────────────────────────────────────────────────────────────

def test_색인에_없으면_신규():
    nov = classify(_doc([_proposal("A"), _proposal("B")]), _state({"C": "20250101000000"}))
    assert (nov.new, nov.refreshed, nov.repeated) == (2, 0, 0)
    assert nov.rate == 1.0


def test_modified_time_이_다르면_갱신():
    doc = _doc([_proposal("A", "20260819000000")])
    nov = classify(doc, _state({"A": "20250101000000"}))
    assert (nov.new, nov.refreshed, nov.repeated) == (0, 1, 0)


def test_modified_time_까지_같으면_반복():
    doc = _doc([_proposal("A", "20250101000000")])
    nov = classify(doc, _state({"A": "20250101000000"}))
    assert (nov.new, nov.refreshed, nov.repeated) == (0, 0, 1)


def test_이전_상태가_없으면_전부_신규():
    """최초 실행 — 비교 기준이 없으면 새로 본 것으로 센다 (색인 크기 0으로 구분 가능)."""
    nov = classify(_doc([_proposal("A"), _proposal("B")]), None)
    assert (nov.new, nov.prev_index_size) == (2, 0)


def test_제안이_0건이면_신규율은_0():
    """나눌 게 없으면 '새 것도 없다' — ZeroDivisionError 로 죽지 않는다."""
    assert classify(_doc([]), _state({"A": "x"})).rate == 0.0


# ── ② 제자리걸음 판정 ──────────────────────────────────────────────────────

def test_미수집_지역_첫_수집은_제자리걸음이_아니다():
    """강원 100건 전부 신규 · 스킵 0건 — 앞선 판이 오탐을 냈던 바로 그 실행."""
    doc = _doc([_proposal(str(i)) for i in range(100)], skipped_unchanged=0)
    nov = classify(doc, _state({"기존": "x"}))
    assert stall_check(doc, nov) is None


def test_신규도_스킵도_0이면_제자리걸음():
    doc = _doc([_proposal("A", "20260819000000")], listed=50, skipped_unchanged=0)
    nov = classify(doc, _state({"A": "20250101000000"}))   # 전부 갱신 = 신규 0
    reason = stall_check(doc, nov)
    assert reason is not None and "커서·색인이 안 먹고" in reason


def test_같은_modified_time_이_다시_실리면_제자리걸음():
    """색인이 로드됐는데도 스킵이 안 됐다 — 이유를 물을 것도 없는 회귀."""
    doc = _doc([_proposal("A", "20250101000000")], skipped_unchanged=0)
    nov = classify(doc, _state({"A": "20250101000000"}))
    reason = stall_check(doc, nov)
    assert reason is not None and "스킵이 안 먹었다" in reason


def test_스킵이_있으면_신규가_0이어도_정상():
    """완주 지역 재순회 — 색인이 제 일을 하고 있으므로 실패가 아니다."""
    doc = _doc([], listed=200, skipped_unchanged=200)
    nov = classify(doc, _state({"A": "x"}))
    assert stall_check(doc, nov) is None


def test_이전_색인이_비면_판정하지_않는다():
    """비교 기준이 없다 — 복원 실패는 복원 스텝이 잡는 몫이라 여기서 두 번 울리지 않는다."""
    doc = _doc([_proposal("A")], listed=100, skipped_unchanged=0)
    assert stall_check(doc, classify(doc, None)) is None


# ── ③ 진단 ────────────────────────────────────────────────────────────────

def _remedies(doc, state):
    return " ".join(f"{e} {r}" for e, r in diagnose(doc, state, classify(doc, state)))


def test_예산_굶주림이_증거와_함께_나온다():
    doc = _doc([_proposal("A")], budget_exhausted=True,
               per_area={"1": {"calls": 177, "passed": 197}, "32": {"calls": 3, "passed": 0}})
    text = _remedies(doc, _state({"B": "x"}))
    assert "굶었다" in text and "32 강원" in text


def test_완주_지역_재순회가_확장_처방으로_이어진다():
    cursors = {"39": {"12": {"completed": True}, "39": {"completed": True}}}
    text = _remedies(_doc([_proposal("A")]), _state({"B": "x"}, cursors))
    assert "완주한 지역" in text and "39 제주" in text
    assert "TOURAPI_CONTENT_TYPES" in text          # 타입 확장 처방


def test_게이트_드롭_편중이_사유별로_나온다():
    doc = _doc([_proposal("A")], listed=100,
               gate_drops={"existence_out_of_service_region": 40})
    text = _remedies(doc, _state({"B": "x"}))
    assert "수집 게이트에서" in text and "existence_out_of_service_region" in text
    assert "기준을 낮추는 쪽으로 먼저 손대지 않는다" in text


def test_해당_없는_원인은_안_나온다():
    """증거 없는 원인을 나열하면 진단이 소음이 된다 — 깨끗한 실행엔 한 줄만."""
    findings = diagnose(_doc([_proposal("A")]), _state({"B": "x"}),
                        classify(_doc([_proposal("A")]), _state({"B": "x"})))
    assert len(findings) == 1
    assert "알려진 원인 패턴에 걸리는 게 없다" in findings[0][0]


def test_원인이_없어도_처방은_비지_않는다():
    """'모르겠다'로 끝나면 다음 사람이 할 게 없다 — 다음 수는 항상 남긴다."""
    doc, state = _doc([_proposal("A")]), _state({"B": "x"})
    _, remedy = diagnose(doc, state, classify(doc, state))[0]
    assert remedy.strip()
