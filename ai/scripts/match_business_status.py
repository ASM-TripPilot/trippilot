"""수집 POI × LOCALDATA 인허가 데이터 → 영업상태·인허가일자 (TRIP-280).

**pytest 대상이 아니다** — 원본 CSV(862MB)가 로컬에만 있고 리포에 없다. 순수 로직
(`addr_key`·`norm_name`·`pick`)만 tests/test_match_business_status.py 가 검증한다.

왜 필요한가: TourAPI 수집본에는 폐업 여부가 없다. 폐업한 가게를 일정에 넣으면
사용자가 닫힌 문 앞에 선다. LOCALDATA(지자체 인허가) 는 그 정보를 가진 유일한
공개 소스다.

왜 주소를 문자열로 비교하지 않는가: 실측 매칭률 35.5%. 쉼표 뒤 상세주소("…로 36,
1층")·읍면 유무("제주시 구좌읍 해맞이해안로" vs "제주시 해맞이해안로")·동 표기가
전부 어긋난다. (시도2·시군구·도로명·건물번호) 키만 뽑아 비교하면 83.5% 로 오른다.

왜 주소만 맞고 이름이 다르면 버리는가: 같은 건물의 **다른 가게**다(실측 12.1%).
붙이면 엉뚱한 가게의 폐업 여부를 사용자에게 보여주게 된다 — 미매칭으로 남기면
조회 측이 "모름"으로 다룬다.

사용법:
    cd ai
    LOCALDATA_DIR=/path/to/csv_dir uv run python scripts/match_business_status.py
    uv run python scripts/match_business_status.py --csv a.csv --csv b.csv

    # 잡 서머리용 통계 표 (기존 산출 JSON을 읽기만)
    uv run python scripts/match_business_status.py --summary data/poi_business_status.json

CSV 는 cp949 이고, 쓰는 컬럼은 6개다:
    사업장명 영업상태명 폐업일자 인허가일자 도로명주소 지번주소
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable, NamedTuple

SCHEMA_VERSION = 1
TARGET_CATEGORIES = ("FOOD", "CAFE")
OPEN_STATUS = "영업/정상"
COLUMNS = ("사업장명", "영업상태명", "폐업일자", "인허가일자", "도로명주소", "지번주소")

_DATA = Path(__file__).resolve().parents[1] / "data"

_PAREN = re.compile(r"[(（][^)）]*[)）]")
_SPACE = re.compile(r"\s+")
_ROAD = re.compile(r"^(?P<sido>\S+?[시도])\s+(?P<sgg>\S+?[시군구])\s+.*?"
                   r"(?P<road>\S*[로길])\s+(?P<bldg>\d+(?:-\d+)?)")
_BRANCH = re.compile(r"(본점|직영점|\d+호점)$")


class Biz(NamedTuple):
    """LOCALDATA 한 행에서 쓰는 값만."""

    name: str
    status: str
    closed_at: str
    licensed_at: str


def addr_key(a: str | None) -> tuple[str, str, str, str] | None:
    """(시도2글자, 시군구, 도로명, 건물번호). 못 뽑으면 None.

    쉼표 뒤 상세주소와 괄호(법정동)를 먼저 떼야 읍면 유무 차이를 넘어간다.
    """
    if not a:
        return None
    a = _SPACE.sub(" ", _PAREN.sub(" ", a).split(",")[0]).strip()
    m = _ROAD.search(a)
    return (m["sido"][:2], m["sgg"], m["road"], m["bldg"]) if m else None


def norm_name(n: str | None) -> str:
    """공백·괄호·지점 접미사 제거 — 같은 가게의 표기 흔들림을 흡수한다."""
    n = _SPACE.sub("", _PAREN.sub("", n or ""))
    return _BRANCH.sub("", n)


def pick(poi_name: str, cands: Iterable[Biz]) -> Biz | None:
    """정확 일치 → 부분 포함(양방향, 2글자 이상) → 실패.

    주소만 맞고 이름이 안 맞으면 None 이다 — 같은 건물의 다른 가게다.
    같은 이름이 여럿이면 영업 중인 쪽을 채택한다(폐업 이력 위에 재개업한 경우).
    """
    key = norm_name(poi_name)
    if len(key) < 2:
        return None
    pool = list(cands)
    hits = [c for c in pool if norm_name(c.name) == key]
    if not hits:
        hits = [c for c in pool if _contains(key, norm_name(c.name))]
    if not hits:
        return None
    return min(hits, key=lambda c: c.status != OPEN_STATUS)


def _contains(a: str, b: str) -> bool:
    return len(a) >= 2 and len(b) >= 2 and (a in b or b in a)


def to_status(biz: Biz) -> dict[str, str]:
    entry: dict[str, str] = {"state": "OPEN" if biz.status == OPEN_STATUS else "CLOSED"}
    if biz.closed_at:
        entry["closed_at"] = biz.closed_at
    if biz.licensed_at:
        entry["licensed_at"] = biz.licensed_at
    return entry


def load_targets(pois_path: Path) -> list[tuple[str, str, tuple | None]]:
    """(content_id, 이름, addr_key) — FOOD·CAFE 만."""
    doc = json.loads(pois_path.read_text(encoding="utf-8"))
    out = []
    for p in doc["proposals"]:
        if p["poi"]["category"] not in TARGET_CATEGORIES:
            continue
        out.append((p["provenance"]["content_id"], p["poi"]["name"],
                    addr_key(p["provenance"].get("address"))))
    return out


def index_csv(path: Path, wanted: set[tuple], into: dict[tuple, list[Biz]]) -> int:
    """관심 주소키에 걸리는 행만 담는다 — 293만 행을 다 들고 있을 이유가 없다."""
    rows = 0
    with path.open(encoding="cp949", newline="", errors="replace") as f:
        reader = csv.reader(f)
        header = next(reader)
        idx = {c: header.index(c) for c in COLUMNS}
        for row in reader:
            rows += 1
            if len(row) <= idx["지번주소"]:
                continue
            key = addr_key(row[idx["도로명주소"]]) or addr_key(row[idx["지번주소"]])
            if key in wanted:
                into[key].append(Biz(row[idx["사업장명"]], row[idx["영업상태명"]],
                                     row[idx["폐업일자"]], row[idx["인허가일자"]]))
    return rows


def build(pois_path: Path, csv_paths: list[Path]) -> dict:
    targets = load_targets(pois_path)
    wanted = {k for _, _, k in targets if k}
    cands: dict[tuple, list[Biz]] = defaultdict(list)
    source = {}
    for p in csv_paths:
        print(f"[match] 읽는 중 {p.name} …", file=sys.stderr, flush=True)
        source[p.name] = index_csv(p, wanted, cands)

    status: dict[str, dict[str, str]] = {}
    name_miss = 0
    for content_id, name, key in targets:
        pool = cands.get(key) if key else None
        if not pool:
            continue
        biz = pick(name, pool)
        if biz is None:
            name_miss += 1
            continue
        status[content_id] = to_status(biz)

    closed = sum(1 for e in status.values() if e["state"] == "CLOSED")
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%d"),
        "source": source,
        "stats": {
            "대상": len(targets),
            "매칭": len(status),
            "폐업": closed,
            "주소O이름X": name_miss,
            "주소미적중": len(targets) - len(status) - name_miss,
        },
        # 정렬 = 재실행 시 diff 가 실제 변경만 보이게
        "status": dict(sorted(status.items())),
    }


def print_summary(json_path: Path) -> int:
    doc = json.loads(json_path.read_text(encoding="utf-8"))
    s = doc["stats"]
    total = s["대상"] or 1
    print("## POI 영업상태 매칭 결과")
    print(f"- 생성 {doc['generated_at']} · 소스 "
          + ", ".join(f"`{k}` {v:,}행" for k, v in doc["source"].items()))
    print()
    print("| 항목 | 값 | 비율 |")
    print("|---|---|---|")
    for label in ("대상", "매칭", "폐업", "주소O이름X", "주소미적중"):
        print(f"| {label} | {s[label]:,} | {s[label] / total:.1%} |")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--summary", type=Path, help="산출 JSON을 읽어 마크다운 표만 출력")
    ap.add_argument("--csv", type=Path, action="append", default=[],
                    help="LOCALDATA CSV (반복 가능). 미지정 시 $LOCALDATA_DIR/*.csv")
    ap.add_argument("--pois", type=Path, default=_DATA / "collected_pois.json")
    ap.add_argument("--out", type=Path, default=_DATA / "poi_business_status.json")
    args = ap.parse_args()

    if args.summary:
        return print_summary(args.summary)

    csv_paths = args.csv
    if not csv_paths:
        import os

        d = os.environ.get("LOCALDATA_DIR")
        if not d:
            raise SystemExit("--csv 또는 환경변수 LOCALDATA_DIR 필요 (경로 하드코딩 금지)")
        csv_paths = sorted(Path(d).glob("*.csv"))
    missing = [p for p in csv_paths if not p.is_file()]
    if missing or not csv_paths:
        raise SystemExit(f"CSV 를 못 찾았다: {missing or csv_paths}")

    doc = build(args.pois, list(csv_paths))
    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n",
                        encoding="utf-8")
    print(f"[match] {args.out} · {json.dumps(doc['stats'], ensure_ascii=False)}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
