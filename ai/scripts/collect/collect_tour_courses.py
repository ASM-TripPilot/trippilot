"""관광공사 여행코스(25) — 코스마다 구성 장소(`detailInfo2`)를 `data/tour_courses.jsonl.gz` 로 모은다.

KB-5·PlanB 요청(2026-11-02, 사용자 "다 해"): 다시 짜기 후보 고르기가 같은 코스에 묶인 곳에 가산한다. 공유본 장소
행과는 content_id 로 잇는다 — 공유본에 없는 번호도 그대로 둔다(거르는 것은 잇는 쪽 몫). 한 줄에 코스 하나:

    {"course_id": "1234", "title": "...", "area": "서울특별시" | null,
     "members": [{"content_id": "126508", "name": "경복궁", "order": 1}, ...], "collected_on": "2026-11-03"}

구성(detailInfo2)은 매일 POI 수집(detailIntro2)·개요 수집(detailCommon2)과 오퍼레이션이 달라 하루 한도가 안
겹친다. 목록(areaBasedList2)은 POI 수집과 같은 오퍼레이션이지만 코스는 전국 1,068개(11쪽)뿐이다. 이미 받은 코스는
다시 부르지 않는다(`--refresh` 면 전부 다시). `area` 는 코스 주소의 시도 — 코스는 주소가 대개 비어 null 이다.

실행(관광공사 키는 GitHub 시크릿에만 있다):
    TOUR_API_KEY=... uv run python scripts/collect/collect_tour_courses.py
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from datetime import date
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(_AI / "scripts" / "collect"))

from trippilot.poi_curation.sourcing.overture_address import expand_sido, sido_abbreviations  # noqa: E402

from collect_localdata import _MIGRATION, load_regions  # noqa: E402

_OUT = _AI / "data" / "tour_courses.jsonl.gz"
_KIND = "25"
_ROWS = 100
_STOP_AFTER_FAILS = 5


def list_courses(adapter) -> list[tuple[str, str, str]]:
    """(course_id, 제목, 주소) — **전국** 목록을 끝까지. 코스는 지역 칸이 대부분 비어 지역을 걸면 1,068개 중
    수십 개만 온다(2026-11-03 실측: 서울·제주 0). 주소도 대개 비어 있다 — 지역은 구성 장소로 잇는 쪽이 정한다."""
    seen: dict[str, tuple[str, str, str]] = {}
    page, pages = 1, 1
    while page <= pages:
        got = adapter.fetch_page("", _KIND, page, _ROWS)
        pages = -(-got.total_count // _ROWS)
        for r in got.records:
            if r.source_ref:
                seen.setdefault(r.source_ref, (r.source_ref, r.name, r.address or ""))
        page += 1
    return list(seen.values())


def row_of(course_id: str, title: str, area: str | None, members, today: str) -> dict:
    return {"course_id": course_id, "title": title, "area": area,
            "members": [{"content_id": c, "name": n, "order": o} for c, n, o in members],
            "collected_on": today}


def collect(adapter, courses, have: dict[str, dict], area_name, max_calls: int, today: str) -> tuple[int, int]:
    """`have` 에 없는 코스만 `max_calls` 까지 구성을 부른다. 반환 (호출 수, 실패 수)."""
    calls = failed = streak = 0
    for course_id, title, area in courses:
        if course_id in have:
            continue
        if calls >= max_calls or streak >= _STOP_AFTER_FAILS:
            break
        calls += 1
        try:
            members = adapter.fetch_course(course_id)
        except Exception as e:  # 한 건 실패가 전체를 죽이지 않는다 — 다음 실행이 다시 부른다
            if not getattr(adapter, "alive", True):
                break  # 키 퇴출(403·429) — 그 키의 끝이다
            failed += 1
            streak += 1
            print(f"  ! {course_id} {title} — {type(e).__name__}: {e}", file=sys.stderr)
            continue
        streak = 0
        have[course_id] = row_of(course_id, title, area_name(area), members, today)
    return calls, failed


def _load(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return {(r := json.loads(line))["course_id"]: r for line in f if line.strip()}


def _save(path: Path, have: dict[str, dict]) -> None:
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        for cid in sorted(have, key=lambda c: (len(c), c)):
            f.write(json.dumps(have[cid], ensure_ascii=False) + "\n")
    tmp.replace(path)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=_OUT)
    ap.add_argument("--refresh", action="store_true", help="이미 받은 코스도 다시 부른다")
    args = ap.parse_args(argv)
    from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter, UrllibHttpClient

    keys = [k for k in (os.environ.get(f"TOUR_API_KEY{s}") for s in ("", "2", "3")) if k]
    if not keys:
        print("TOUR_API_KEY 없음 — 생략")
        return 0
    abbrev = sido_abbreviations(load_regions(_MIGRATION / "R__seed_region_catalog.sql"))

    def area_name(address: str) -> str | None:   # 주소 → 시도 정식명(`서울 종로구 …` → `서울특별시`), 없으면 None
        return expand_sido(address, abbrev).split(" ", 1)[0] or None if address else None

    have = {} if args.refresh else _load(args.out)
    before = len(have)
    per_key = int(os.environ.get("COURSE_CALLS_PER_KEY") or "950")
    today = date.today().isoformat()
    courses: list[tuple[str, str, str]] | None = None
    calls = failed = 0
    for n, key in enumerate(keys, 1):
        adapter = TourApiAdapter(UrllibHttpClient(), key)
        try:
            if courses is None:
                courses = list_courses(adapter)
                print(f"코스 목록 {len(courses)}개")
            c, f = collect(adapter, courses, have, area_name, per_key, today)
        except Exception as e:  # 목록에서 키가 퇴출되면 다음 키로
            print(f"  키 {n}: {type(e).__name__}: {e}")
            continue
        print(f"  키 {n}: 호출 {c}·실패 {f}" + ("" if adapter.alive else " — 키 퇴출, 다음 키로"))
        calls, failed = calls + c, failed + f
        if courses is not None and all(cid in have for cid, _, _ in courses):
            break
    _save(args.out, have)
    total = len(courses or [])
    members = sum(len(r["members"]) for r in have.values())
    print(f"여행코스: 이번 {len(have) - before}개 받음(호출 {calls}·실패 {failed}) · 누적 {len(have)}/{total}개 · "
          f"구성 장소 {members}곳")
    return 1 if courses is None else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
