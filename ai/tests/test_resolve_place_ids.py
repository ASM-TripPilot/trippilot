"""place_id 해결기 — 대상 선정·모호 처리·요금 경계. 실 호출 0.

이 스크립트의 실패는 둘 다 조용하다: **틀린 id 를 저장하면** 엉뚱한 가게의
영업시간으로 일정을 짜고, **FieldMask 를 늘리면** 무료가 유료가 된다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import resolve_place_ids as R  # noqa: E402


def _prop(cid: str, name: str, *, hours: list | None = None,
          lat: float = 37.5, lng: float = 127.0) -> dict:
    return {
        "provenance": {"content_id": cid},
        "poi": {"name": name, "lat": lat, "lng": lng, "open_hours": hours or []},
    }


# ── 대상 선정 — 물을 범위가 곧 비용이다 ────────────────────────────

def test_영업시간이_있으면_대상이_아니다() -> None:
    """보강할 이유가 없는 POI 에 검색을 쓰지 않는다(사용자 결정 2026-09-26)."""
    doc = {"proposals": [
        _prop("1", "성산일출봉"),
        _prop("2", "경복궁", hours=[{"day_of_week": 0, "open_min": 540, "close_min": 1080}]),
    ]}
    got = R._targets(doc, only_missing_hours=True)
    assert [t[0] for t in got] == ["1"]


def test_all_을_주면_전부_대상이다() -> None:
    doc = {"proposals": [
        _prop("1", "성산일출봉"),
        _prop("2", "경복궁", hours=[{"day_of_week": 0, "open_min": 540, "close_min": 1080}]),
    ]}
    assert len(R._targets(doc, only_missing_hours=False)) == 2


@pytest.mark.parametrize("bad", [
    {"provenance": {}, "poi": {"name": "x", "lat": 1.0, "lng": 2.0}},        # cid 없음
    {"provenance": {"content_id": "1"}, "poi": {"lat": 1.0, "lng": 2.0}},    # 이름 없음
    {"provenance": {"content_id": "1"}, "poi": {"name": "x", "lng": 2.0}},   # 좌표 없음
    {"provenance": {"content_id": "1"}, "poi": {"name": "x", "lat": 1.0}},
])
def test_검색에_필요한_것이_없으면_건너뛴다(bad: dict) -> None:
    """좌표가 없으면 동명을 가릴 수 없다 — 지어내기보다 빠뜨리는 편이 낫다."""
    assert R._targets({"proposals": [bad]}, only_missing_hours=True) == []


# ── 요금 경계 — 여기를 건드리면 무료가 유료가 된다 ─────────────────

def test_필드마스크는_id_하나뿐이다() -> None:
    """**이 테스트가 빨개졌다면 요금을 먼저 확인하라.**

    Text Search 는 요청 필드 중 가장 비싼 티어로 과금된다. `places.id` 만이면
    Essentials = **무료**지만, 이름·주소를 더하면 Pro 로 올라가 $32/1,000 이 된다.
    8,603건이면 **$275** 다.

    이름 대조가 필요하면 표본만 따로 받아 눈으로 봐라 — 전량에 붙이지 마라.
    """
    assert R._FIELD_MASK == "places.id", (
        f"FieldMask 가 바뀌었다: {R._FIELD_MASK!r}\n"
        "Text Search 는 필드로 요금 티어가 정해진다 — places.id 만이 무료다."
    )


def test_반경이_좁혀져_있다() -> None:
    """동명이 전국에 있다(`시청`). 반경이 넓으면 엉뚱한 곳의 id 를 저장한다."""
    assert R._RADIUS_M <= 500.0


# ── 모호하면 버린다 ──────────────────────────────────────────────

def _run(tmp_path: Path, monkeypatch, *, results, doc_props) -> dict:
    doc_p, out_p = tmp_path / "doc.json", tmp_path / "out.json"
    doc_p.write_text(json.dumps({"proposals": doc_props}), encoding="utf-8")
    monkeypatch.setattr(R, "_search", lambda name, lat, lng, key: results.get(name, []))
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "KEY")
    monkeypatch.setattr(sys, "argv", [
        "x", "--doc", str(doc_p), "--out", str(out_p), "--max-calls", "100"])
    assert R.main() == 0
    return json.loads(out_p.read_text(encoding="utf-8"))


def test_결과가_둘이면_저장하지_않는다(tmp_path: Path, monkeypatch) -> None:
    """**틀린 id 는 빠뜨린 id 보다 나쁘다** — 엉뚱한 가게의 영업시간이 일정에 들어간다."""
    got = _run(tmp_path, monkeypatch,
               results={"애매한곳": [{"id": "A"}, {"id": "B"}], "분명한곳": [{"id": "C"}]},
               doc_props=[_prop("1", "애매한곳"), _prop("2", "분명한곳")])
    assert got["place_ids"] == {"2": "C"}


@pytest.mark.parametrize("bad", [[], [{}], [{"id": ""}], [{"id": 123}]])
def test_응답이_이상하면_저장하지_않는다(bad, tmp_path: Path, monkeypatch) -> None:
    got = _run(tmp_path, monkeypatch, results={"곳": bad}, doc_props=[_prop("1", "곳")])
    assert got["place_ids"] == {}


def test_이어가기는_기해결분을_건너뛴다(tmp_path: Path, monkeypatch) -> None:
    """여러 날에 나눠 받는다 — 깨지면 매번 처음부터 검색한다."""
    doc_p, out_p = tmp_path / "doc.json", tmp_path / "out.json"
    doc_p.write_text(json.dumps({"proposals": [_prop("1", "가"), _prop("2", "나")]}),
                     encoding="utf-8")
    out_p.write_text(json.dumps({"place_ids": {"1": "already"}}), encoding="utf-8")
    asked: list[str] = []

    def fake(name, lat, lng, key):
        asked.append(name)
        return [{"id": f"id-{name}"}]

    monkeypatch.setattr(R, "_search", fake)
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "KEY")
    monkeypatch.setattr(sys, "argv", [
        "x", "--doc", str(doc_p), "--out", str(out_p), "--max-calls", "100"])
    assert R.main() == 0

    assert asked == ["나"], "이미 해결된 것을 다시 검색했다"
    got = json.loads(out_p.read_text(encoding="utf-8"))
    assert got["place_ids"] == {"1": "already", "2": "id-나"}


def test_키가_없으면_아무것도_안_한다(tmp_path: Path, monkeypatch) -> None:
    doc_p = tmp_path / "doc.json"
    doc_p.write_text(json.dumps({"proposals": []}), encoding="utf-8")
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    monkeypatch.setattr(sys, "argv", [
        "x", "--doc", str(doc_p), "--out", str(tmp_path / "o.json")])
    assert R.main() == 1
    assert not (tmp_path / "o.json").exists()
