"""backfill_rest_days — 공유본 휴무 백필 (TRIP-1226).

수집 때 휴무를 반영한 `open_hours` 와 원문 재파싱(휴무 미반영)의 차이가 **요일 단위**면
파서가 읽는 정형 문구를 합성해 원문 칸에 붙인다. 붙인 뒤 재파싱 == 저장본일 때만 쓰고,
아니면 원문을 그대로 두고 사유를 낸다. 실제 공유본 원문으로 합성 왕복을 PBT 한다.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.poi import OpenHour
from trippilot.poi_curation.sourcing.mapping import (
    OPENING_HOURS_MAX,
    parse_open_hours,
    parse_opening_hours_raw,
    split_opening_hours_raw,
)

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from backfill_rest_days import RESTORED, backfill, backfill_one, main, rest_phrase  # noqa: E402


def _week(days, open_min: int = 540, close_min: int = 1080) -> list[dict]:
    return [{"day_of_week": d, "open_min": open_min, "close_min": close_min} for d in days]


def _prop(raw: str | None, hours: list[dict], category: str = "FOOD") -> dict:
    return {"poi": {"category": category, "open_hours": hours}, "opening_hours_raw": raw}


def _hours(stored: list[dict]) -> tuple[OpenHour, ...]:
    return tuple(OpenHour.from_dict(h) for h in stored)


# ── 되살리는 경우 ─────────────────────────────────────────────────────


def test_요일_단위로_빠진_날을_휴무_문구로_되살린다() -> None:
    p = _prop("09:00~18:00", _week(range(1, 7)))
    assert backfill_one(p) == RESTORED
    assert p["opening_hours_raw"] == "09:00~18:00\n휴무: 매주 월요일"
    assert parse_opening_hours_raw(p["opening_hours_raw"]) == _hours(_week(range(1, 7)))


def test_여러_요일은_한_문구로_붙인다() -> None:
    assert rest_phrase({2, 0}) == "매주 월요일, 수요일"
    p = _prop("09:00~18:00", _week([1, 3, 4, 5, 6]))
    assert backfill_one(p) == RESTORED
    assert split_opening_hours_raw(p["opening_hours_raw"])[1] == "매주 월요일, 수요일"


# ── 붙이지 않는 경우 — 원문은 그대로, 사유를 낸다 ──────────────────────


@pytest.mark.parametrize("raw,stored,outcome", [
    (None, [], "no_raw"),
    ("09:00~18:00", _week(range(7)), "same"),                              # 휴무 없음
    ("09:00~18:00\n휴무: 매주 월요일", _week(range(1, 7)), "same"),          # 이미 붙음
    ("09:00~18:00", [], "stored_empty"),
    ("※ 방문 전 문의", _week(range(1, 7)), "reparse_empty"),
    # 실물(공유본 10건) — 수집 뒤 파서가 `상시 개방` 을 읽게 바뀌어 창 자체가 다르다
    ("상시 개방 (해수욕장 09:00~18:00 물놀이 가능)", _week(range(7)), "window_differs"),
    # 이미 휴무 문구가 있는데도 다르다 — 문구를 하나 더 얹지 않는다
    ("09:00~18:00\n휴무: 매주 월요일", _week(range(2, 7)), "not_weekly"),
])
def test_고칠_것이_없거나_못_고치면_원문을_그대로_둔다(raw, stored, outcome) -> None:
    p = _prop(raw, stored)
    assert backfill_one(p) == outcome
    assert p["opening_hours_raw"] == raw


def test_합성_뒤_재파싱이_저장본과_다르면_붙이지_않는다() -> None:
    """200자 절단이 영업 원문의 시각을 잘라 먹는 경우 — 전수 검증에서 걸러진다."""
    raw = "가" * 185 + " 09:00~18:00"   # 197자 — 휴무 문구를 붙이려면 뒤의 시각이 잘린다
    p = _prop(raw, _week(range(1, 7)))
    assert backfill_one(p) == "verify_failed"
    assert p["opening_hours_raw"] == raw


# ── 멱등 ─────────────────────────────────────────────────────────────


def test_다시_돌려도_같다() -> None:
    props = [_prop("09:00~18:00", _week(range(1, 7))),
             _prop("10:00~22:00", _week(range(7), 600, 1320))]
    first, _ = backfill(props)
    snapshot = copy.deepcopy(props)
    second, outcomes = backfill(props)
    assert sum(first.values()) == 1 and sum(second.values()) == 0
    assert outcomes["same"] == 2 and props == snapshot


def test_파일_재실행은_바이트까지_같다(tmp_path: Path) -> None:
    doc = {"schema_version": 1, "proposals": [_prop("09:00~18:00", _week(range(1, 7)), "CAFE")]}
    path = tmp_path / "collected_pois.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    assert main([str(path)]) == 0                     # 집계만 — 파일 안 바꿈
    assert json.loads(path.read_text(encoding="utf-8")) == doc
    assert main([str(path), "--write"]) == 0
    once = path.read_text(encoding="utf-8")
    assert json.loads(once)["proposals"][0]["opening_hours_raw"] == "09:00~18:00\n휴무: 매주 월요일"
    assert main([str(path), "--write"]) == 0
    assert path.read_text(encoding="utf-8") == once


# ── 실제 공유본 표본으로 합성 왕복 ─────────────────────────────────────

_SHARED = Path(__file__).resolve().parents[1] / "data" / "collected_pois.json"
# 원문(휴무 칸을 뗀 영업 원문)이 주간 영업으로 읽히는 실물 전부 — 백필 대상이 될 수 있는 모양
_REAL_HOURS = sorted({
    hours
    for p in json.loads(_SHARED.read_text(encoding="utf-8"))["proposals"]
    if (hours := split_opening_hours_raw(p.get("opening_hours_raw"))[0])
    and parse_open_hours(hours, None)
})


def test_표본이_충분하다() -> None:
    assert len(_REAL_HOURS) > 3_000   # 서로 다른 원문 수(2026-10-04: 3,543) — 줄면 아래 PBT 의 의미도 준다


@settings(max_examples=300, deadline=None)
@given(hours=st.sampled_from(_REAL_HOURS),
       closed=st.sets(st.integers(min_value=0, max_value=6), min_size=1, max_size=6))
def test_pbt_실제_공유본_원문에서_합성_왕복이_성립한다(hours: str, closed: set[int]) -> None:
    """수집 때 휴무를 반영한 저장본을 실제 원문으로 만들어 백필 — 붙였으면 반드시 왕복한다."""
    stored = [h.to_dict() for h in parse_open_hours(hours, None) if h.day_of_week not in closed]
    p = _prop(hours, stored)
    outcome = backfill_one(p)
    raw = p["opening_hours_raw"]
    if outcome == RESTORED:
        assert parse_opening_hours_raw(raw) == _hours(stored)
        assert len(raw) <= OPENING_HOURS_MAX
        assert split_opening_hours_raw(raw)[1] == rest_phrase(closed)
        assert backfill_one(p) == "same"
    else:
        # 못 맞추는 것은 200자 절단뿐이어야 하고, 그때는 원문에 손대지 않는다
        assert outcome == "verify_failed" and raw == hours
